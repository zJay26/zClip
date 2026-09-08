import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { UPDATE_CHECK_INTERVAL_MS, type UpdateRelease, type UpdateState } from '../../shared/update-types'

export const RELEASE_API_URL = 'https://api.github.com/repos/zJay26/zClip/releases/latest'
const RELEASE_BASE = 'https://github.com/zJay26/zClip/releases'
const MAX_INSTALLER_SIZE = 2 * 1024 * 1024 * 1024

function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null
  const parts = value.replace(/^v/, '').split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

export function parseUpdateRelease(value: unknown, currentVersion: string): UpdateRelease | null {
  if (!value || typeof value !== 'object') throw new Error('Invalid release information')
  const release = value as Record<string, unknown>
  if (release.draft === true || release.prerelease === true) return null
  const latest = versionParts(release.tag_name)
  const current = versionParts(currentVersion)
  if (!latest || !current) throw new Error('Invalid release version')
  const difference = latest.findIndex((part, index) => part !== current[index])
  if (difference === -1 || latest[difference] < current[difference]) return null
  const version = latest.join('.')
  const tag = String(release.tag_name)
  const assetName = `zClip.Setup.${version}.exe`
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item && item.name === assetName && item.state === 'uploaded')
    : undefined
  const assetUrl = `${RELEASE_BASE}/download/${tag}/${assetName}`
  if (!asset || asset.browser_download_url !== assetUrl ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_SIZE ||
      typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    throw new Error('Release installer or SHA-256 verification information is missing')
  }
  return {
    version, assetName, assetUrl, size: asset.size,
    sha256: asset.digest.slice(7).toLowerCase(),
    url: `${RELEASE_BASE}/tag/${tag}`,
    notes: typeof release.body === 'string' ? release.body.slice(0, 32_000) : ''
  }
}

export function isAllowedUpdateUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      url.href === RELEASE_API_URL ||
      (url.hostname === 'github.com' && url.pathname.startsWith('/zJay26/zClip/releases/download/')) ||
      url.hostname === 'release-assets.githubusercontent.com' || url.hostname === 'objects.githubusercontent.com'
    )
  } catch { return false }
}

interface UpdaterOptions {
  currentVersion: string
  settingsPath: string
  defaultDirectory: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
  emit: (state: UpdateState) => void
  openInstaller: (path: string) => Promise<string>
  scheduleChecks?: boolean
}

/** The main process owns all URLs and paths. Checking never downloads or installs. */
export class AppUpdater {
  private state: UpdateState
  private lastAttemptAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null
  private activeOperation: Promise<void> | null = null
  private writes: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: UpdaterOptions) {
    this.state = {
      currentVersion: options.currentVersion,
      settings: { autoCheck: true, downloadDirectory: options.defaultDirectory },
      status: 'idle', lastCheckedAt: null, release: null, downloadedPath: null, progress: 0, error: null
    }
  }

  getState(): UpdateState { return structuredClone(this.state) }

  private publish(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    if (!this.disposed) this.options.emit(this.getState())
  }

  async start(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.options.settingsPath, 'utf8'))
      this.state.settings = {
        autoCheck: typeof saved.autoCheck === 'boolean' ? saved.autoCheck : true,
        downloadDirectory: typeof saved.downloadDirectory === 'string' && isAbsolute(saved.downloadDirectory)
          ? saved.downloadDirectory : this.options.defaultDirectory
      }
      if (Number.isFinite(saved.lastAttemptAt) && saved.lastAttemptAt > 0 && saved.lastAttemptAt <= Date.now()) {
        this.lastAttemptAt = saved.lastAttemptAt
      }
      if (Number.isFinite(saved.lastCheckedAt) && saved.lastCheckedAt > 0 && saved.lastCheckedAt <= Date.now()) {
        this.state.lastCheckedAt = saved.lastCheckedAt
      }
    } catch { /* First launch or invalid preferences: use safe defaults. */ }
    this.schedule()
  }

  private persist(): Promise<void> {
    const value = JSON.stringify({ ...this.state.settings, lastAttemptAt: this.lastAttemptAt, lastCheckedAt: this.state.lastCheckedAt })
    const operation = this.writes.catch(() => {}).then(async () => {
      await mkdir(join(this.options.settingsPath, '..'), { recursive: true })
      const temporary = `${this.options.settingsPath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, value, { flag: 'wx' })
        await rename(temporary, this.options.settingsPath)
      } finally { await rm(temporary, { force: true }) }
    })
    this.writes = operation
    return operation
  }

  private schedule(delay = Math.max(10_000, this.lastAttemptAt + UPDATE_CHECK_INTERVAL_MS - Date.now())): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.disposed || this.options.scheduleChecks === false || !this.state.settings.autoCheck) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.check().finally(() => this.schedule(UPDATE_CHECK_INTERVAL_MS))
    }, delay)
    this.timer.unref?.()
  }

  async setAutoCheck(enabled: boolean): Promise<UpdateState> {
    if (typeof enabled !== 'boolean') throw new Error('Invalid update setting')
    const previous = this.state.settings
    this.state.settings = { ...previous, autoCheck: enabled }
    try { await this.persist() } catch (error) { this.state.settings = previous; throw error }
    this.schedule()
    this.publish({})
    return this.getState()
  }

  /** Called only with a path selected by the main-process native directory dialog. */
  async setDownloadDirectory(directory: string): Promise<UpdateState> {
    if (!isAbsolute(directory) || !(await stat(directory)).isDirectory()) throw new Error('Invalid download directory')
    const previous = this.state.settings
    this.state.settings = { ...previous, downloadDirectory: directory }
    try { await this.persist() } catch (error) { this.state.settings = previous; throw error }
    this.publish({})
    return this.getState()
  }

  private async request(url: string, signal: AbortSignal): Promise<Response> {
    // Validate each redirect before sending it, including the GitHub asset CDN.
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!isAllowedUpdateUrl(url)) throw new Error('Untrusted update URL')
      const response = await this.options.fetch(url, {
        signal, redirect: 'manual', credentials: 'omit', cache: 'no-store',
        headers: { 'User-Agent': `zClip/${this.options.currentVersion}`, Accept: url === RELEASE_API_URL ? 'application/vnd.github+json' : 'application/octet-stream' }
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('Invalid update redirect')
        url = new URL(location, url).href
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Update request failed (HTTP ${response.status})`)
      }
      return response
    }
    throw new Error('Too many update redirects')
  }

  async check(): Promise<UpdateState> {
    if (this.activeOperation || this.state.status === 'installing' || this.disposed) return this.getState()
    this.activeOperation = this.performCheck()
    try { await this.activeOperation } finally { this.activeOperation = null; this.schedule() }
    return this.getState()
  }

  private async performCheck(): Promise<void> {
    const previous = this.getState()
    this.publish({ status: 'checking', error: null })
    this.lastAttemptAt = Date.now()
    const controller = new AbortController()
    this.controller = controller
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      await this.persist()
      const response = await this.request(RELEASE_API_URL, controller.signal)
      const chunks: Uint8Array[] = []
      let size = 0
      if (!response.body) throw new Error('Empty release response')
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        size += chunk.length
        if (size > 1024 * 1024) throw new Error('Release response is too large')
        chunks.push(chunk)
      }
      const release = parseUpdateRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), this.state.currentVersion)
      this.state.lastCheckedAt = Date.now()
      await this.persist()
      const keepDownload = previous.status === 'downloaded' && release !== null &&
        previous.release?.version === release.version && previous.release.sha256 === release.sha256 && previous.release.size === release.size
      this.publish({
        status: keepDownload ? 'downloaded' : release ? 'available' : 'up-to-date', release,
        downloadedPath: keepDownload ? previous.downloadedPath : null, progress: keepDownload ? 100 : 0
      })
    } catch (error) {
      this.publish({ status: previous.status === 'downloaded' ? 'downloaded' : 'error', error: error instanceof Error ? error.message : String(error) })
    } finally { clearTimeout(timeout); this.controller = null }
  }

  async download(): Promise<UpdateState> {
    if (this.activeOperation || !this.state.release || this.state.status === 'downloaded' || this.state.status === 'installing' || this.disposed) return this.getState()
    this.activeOperation = this.performDownload(this.state.release, this.state.settings.downloadDirectory)
    try { await this.activeOperation } finally { this.activeOperation = null }
    return this.getState()
  }

  private async verifyInstaller(filePath: string, release: UpdateRelease): Promise<void> {
    if ((await stat(filePath)).size !== release.size) throw new Error('Installer size verification failed')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) hash.update(chunk)
    if (hash.digest('hex') !== release.sha256) throw new Error('Installer SHA-256 verification failed')
  }

  private async performDownload(release: UpdateRelease, directory: string): Promise<void> {
    const controller = new AbortController()
    this.controller = controller
    // Allow slow connections, but bound stalled downloads; cancellation is always available.
    const timeout = setTimeout(() => controller.abort(new Error('Download timed out')), 60 * 60 * 1000)
    const temporary = join(directory, `.zclip-update-${randomUUID()}.part`)
    let createdTemporary = false
    this.publish({ status: 'downloading', downloadedPath: null, progress: 0, error: null })
    try {
      await mkdir(directory, { recursive: true })
      const response = await this.request(release.assetUrl, controller.signal)
      if (!response.body) throw new Error('Empty installer response')
      const hash = createHash('sha256')
      let received = 0
      let lastProgress = 0
      const progressStream = new Transform({
        transform: (chunk, _encoding, callback) => {
          received += chunk.length
          if (received > release.size) { callback(new Error('Installer exceeds expected size')); return }
          hash.update(chunk)
          if (Date.now() - lastProgress >= 200) {
            lastProgress = Date.now()
            this.publish({ progress: Math.min(99, received / release.size * 100) })
          }
          callback(null, chunk)
        }
      })
      const output = createWriteStream(temporary, { flags: 'wx' })
      output.once('open', () => { createdTemporary = true })
      await pipeline(Readable.fromWeb(response.body as never), progressStream, output, { signal: controller.signal })
      if (received !== release.size || hash.digest('hex') !== release.sha256) throw new Error('Installer SHA-256 or size verification failed')
      controller.signal.throwIfAborted()
      // An isolated subdirectory preserves any pre-existing user files with the same installer name.
      const installerDirectory = join(directory, `zClip-${release.version}-${randomUUID()}`)
      await mkdir(installerDirectory)
      const downloadedPath = join(installerDirectory, release.assetName)
      try { await rename(temporary, downloadedPath) } catch (error) { await rm(installerDirectory, { recursive: true, force: true }); throw error }
      this.publish({ status: 'downloaded', downloadedPath, progress: 100 })
    } catch (error) {
      const cancelled = controller.signal.aborted && !controller.signal.reason?.message?.includes('timed out')
      this.publish({ status: cancelled ? 'available' : 'error', error: cancelled ? null : error instanceof Error ? error.message : String(error), progress: 0 })
    } finally {
      clearTimeout(timeout)
      this.controller = null
      if (createdTemporary) await rm(temporary, { force: true }).catch(() => {})
    }
  }

  cancelDownload(): void {
    if (this.state.status === 'downloading') this.controller?.abort()
  }

  /** Only call after the user explicitly requests installation and accepts project closing. */
  async install(): Promise<boolean> {
    const { release, downloadedPath } = this.state
    if (this.state.status !== 'downloaded' || !release || !downloadedPath || this.activeOperation) return false
    this.publish({ status: 'installing', error: null })
    try {
      await this.verifyInstaller(downloadedPath, release)
      const error = await this.options.openInstaller(downloadedPath)
      if (error) throw new Error(error)
      return true
    } catch (error) {
      this.publish({ status: 'error', downloadedPath: null, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.controller?.abort()
    await this.activeOperation
    await this.writes.catch(() => {})
  }
}
