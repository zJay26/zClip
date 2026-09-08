// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppUpdater, isAllowedUpdateUrl, parseUpdateRelease, RELEASE_API_URL } from './app-updater'
import { UPDATE_CHECK_INTERVAL_MS } from '../../shared/update-types'

const bytes = Buffer.from('synthetic installer; never executed')
const metadata = (version = '2.9.0') => ({
  tag_name: `v${version}`, draft: false, prerelease: false, body: 'Release notes',
  assets: [{ name: `zClip.Setup.${version}.exe`, state: 'uploaded', size: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    browser_download_url: `https://github.com/zJay26/zClip/releases/download/v${version}/zClip.Setup.${version}.exe` }]
})

const instances: AppUpdater[] = []
const directories: string[] = []
async function setup(saved?: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'zclip-update-test-'))
  directories.push(directory)
  const settingsPath = join(directory, 'settings.json')
  if (saved) await writeFile(settingsPath, JSON.stringify(saved))
  const fetch = vi.fn(async (url: string, _init: RequestInit) => url === RELEASE_API_URL
    ? Response.json(metadata()) : new Response(bytes))
  const openInstaller = vi.fn(async (_path: string) => '')
  const options = { currentVersion: '2.8.0', settingsPath, defaultDirectory: join(directory, 'downloads'), fetch, openInstaller, emit: vi.fn() }
  const updater = new AppUpdater(options)
  instances.push(updater)
  await updater.start()
  return { updater, options, fetch, openInstaller, directory, settingsPath }
}

afterEach(async () => {
  for (const updater of instances.splice(0)) await updater.dispose()
  vi.useRealTimers()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('stable release selection and source validation', () => {
  test('compares numeric versions and rejects equal, older, prerelease and draft releases', () => {
    expect(parseUpdateRelease(metadata('2.10.0'), '2.9.0')?.version).toBe('2.10.0')
    for (const version of ['2.8.0', '2.7.99', '1.99.99']) expect(parseUpdateRelease(metadata(version), '2.8.0')).toBeNull()
    expect(parseUpdateRelease({ ...metadata(), prerelease: true }, '2.8.0')).toBeNull()
    expect(parseUpdateRelease({ ...metadata(), draft: true }, '2.8.0')).toBeNull()
    expect(() => parseUpdateRelease({ ...metadata(), tag_name: 'v2.9.0-beta.1' }, '2.8.0')).toThrow()
  })
  test('requires the exact repository asset, bounded size and a complete SHA-256', () => {
    for (const patch of [{ browser_download_url: 'https://evil.example/setup.exe' }, { digest: null }, { size: -1 }, { size: 3 * 1024 ** 3 }]) {
      const release = metadata()
      Object.assign(release.assets[0], patch)
      expect(() => parseUpdateRelease(release, '2.8.0')).toThrow()
    }
    for (const url of ['http://github.com/zJay26/zClip/releases/download/test.exe', 'https://github.com.evil.example/file', 'file:///C:/setup.exe', 'https://github.com/other/project/releases/download/setup.exe', 'https://user:pass@release-assets.githubusercontent.com/a']) {
      expect(isAllowedUpdateUrl(url)).toBe(false)
    }
  })
})

describe('optional update lifecycle', () => {
  test('defaults to six-hour checks without downloading or launching the installer', async () => {
    vi.useFakeTimers()
    const { updater, fetch, openInstaller } = await setup()
    expect(updater.getState().settings.autoCheck).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(updater.getState().status).toBe('available'))
    expect(fetch).toHaveBeenCalledTimes(1)
    const lastAttempt = fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1000)
    expect(fetch).toHaveBeenCalledTimes(lastAttempt)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(openInstaller).not.toHaveBeenCalled()
  })
  test('persists disabling, allows manual checks and retains the selected directory across restart', async () => {
    vi.useFakeTimers()
    const { updater, options, directory, fetch } = await setup()
    await updater.setAutoCheck(false)
    await updater.setDownloadDirectory(directory)
    await updater.dispose()
    const restarted = new AppUpdater(options)
    instances.push(restarted)
    await restarted.start()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2)
    expect(fetch).not.toHaveBeenCalled()
    expect(restarted.getState().settings).toEqual({ autoCheck: false, downloadDirectory: directory })
    await restarted.check()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test('keeps the six-hour cadence across restarts and re-enabling', async () => {
    vi.useFakeTimers()
    const { updater, fetch } = await setup({ autoCheck: true, lastAttemptAt: Date.now() - 2 * 60 * 60 * 1000 })
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(fetch).not.toHaveBeenCalled()
    await updater.setAutoCheck(false)
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)
    expect(fetch).not.toHaveBeenCalled()
    await updater.setAutoCheck(true)
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })
  test('downloads only on request to the chosen directory, verifies it and requires a separate install call', async () => {
    const { updater, openInstaller, directory } = await setup()
    await updater.setDownloadDirectory(directory)
    const existing = join(directory, 'zClip.Setup.2.9.0.exe')
    await writeFile(existing, 'user file')
    await updater.check()
    expect(openInstaller).not.toHaveBeenCalled()
    const ready = await updater.download()
    expect(ready.status).toBe('downloaded')
    expect(ready.downloadedPath?.startsWith(directory)).toBe(true)
    expect(await readFile(ready.downloadedPath!)).toEqual(bytes)
    expect(await readFile(existing, 'utf8')).toBe('user file')
    expect(openInstaller).not.toHaveBeenCalled()
    expect(await updater.install()).toBe(true)
    expect(openInstaller).toHaveBeenCalledExactlyOnceWith(ready.downloadedPath)
  })
  test('refuses a modified installer at installation time', async () => {
    const { updater, openInstaller } = await setup()
    await updater.check()
    const ready = await updater.download()
    await writeFile(ready.downloadedPath!, Buffer.alloc(bytes.length, 65))
    expect(await updater.install()).toBe(false)
    expect(openInstaller).not.toHaveBeenCalled()
    expect(updater.getState().error).toContain('SHA-256')
  })
  test('continues checking after a download, preserves the same installer and offers newer releases without downloading them', async () => {
    const { updater, fetch, openInstaller } = await setup()
    await updater.check()
    const ready = await updater.download()
    expect((await updater.check()).downloadedPath).toBe(ready.downloadedPath)
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect((await updater.check()).status).toBe('downloaded')
    fetch.mockResolvedValueOnce(Response.json(metadata('2.10.0')))
    const next = await updater.check()
    expect(next.status).toBe('available')
    expect(next.release?.version).toBe('2.10.0')
    expect(next.downloadedPath).toBeNull()
    expect(await readFile(ready.downloadedPath!)).toEqual(bytes)
    expect(openInstaller).not.toHaveBeenCalled()
  })
  test.each(['corrupt', 'truncated', 'oversized'])('removes %s downloads and leaves no runnable installer', async (kind) => {
    const { updater, fetch, options, openInstaller } = await setup()
    await updater.check()
    const payload = kind === 'corrupt' ? Buffer.alloc(bytes.length, 65) : kind === 'truncated' ? bytes.subarray(0, 5) : Buffer.concat([bytes, bytes])
    fetch.mockResolvedValueOnce(new Response(payload))
    const result = await updater.download()
    expect(result.status).toBe('error')
    expect(result.downloadedPath).toBeNull()
    expect(await readdir(options.defaultDirectory)).toEqual([])
    expect(await updater.install()).toBe(false)
    expect(openInstaller).not.toHaveBeenCalled()
  })
  test('cancels an in-flight download, rejects concurrent downloads and supports retry', async () => {
    const { updater, fetch, options } = await setup()
    await updater.check()
    fetch.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const first = updater.download()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await updater.download()
    expect(fetch).toHaveBeenCalledTimes(2)
    updater.cancelDownload()
    await first
    expect(updater.getState().status).toBe('available')
    expect(await readdir(options.defaultDirectory)).toEqual([])
    expect((await updater.download()).status).toBe('downloaded')
  })
  test('blocks redirects to untrusted hosts before contacting them', async () => {
    const { updater, fetch } = await setup()
    fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.example/metadata' } }))
    expect((await updater.check()).status).toBe('error')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  test('cancels and removes a partially written installer', async () => {
    const { updater, fetch, options } = await setup()
    await updater.check()
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 5)) } })))
    const downloading = updater.download()
    await vi.waitFor(async () => expect((await readdir(options.defaultDirectory)).some((file) => file.endsWith('.part'))).toBe(true))
    updater.cancelDownload()
    expect((await downloading).status).toBe('available')
    expect(await readdir(options.defaultDirectory)).toEqual([])
  })
  test('reports offline errors and recovers on manual retry', async () => {
    const { updater, fetch } = await setup()
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect((await updater.check()).error).toBe('offline')
    expect((await updater.check()).status).toBe('available')
  })
  test('handles shell launch failures without requesting shutdown', async () => {
    const { updater, openInstaller } = await setup()
    await updater.check()
    await updater.download()
    openInstaller.mockResolvedValueOnce('Unable to open file')
    expect(await updater.install()).toBe(false)
    expect(updater.getState().error).toContain('Unable to open file')
  })
})
