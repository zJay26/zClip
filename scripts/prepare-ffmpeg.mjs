import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FFMPEG_VERSION = '8.1.2'
const ARCHIVE_URL = `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${FFMPEG_VERSION}-essentials_build.7z`
const ARCHIVE_SHA256 = 'e25b682664025d49034c981afb4bae36238a40f29a3cc1c713ad9a8b5b3528f6'
const FFMPEG_SHA256 = '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e'
const FFPROBE_SHA256 = 'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07'
const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(repoRoot, 'build', 'ffmpeg')
const downloadCacheDirectory = path.join(repoRoot, 'build', '.cache')
const archivePath = path.join(downloadCacheDirectory, `ffmpeg-${FFMPEG_VERSION}-essentials_build.7z`)
const partialArchivePath = `${archivePath}.part`
const require = createRequire(import.meta.url)
const { path7za } = require('7zip-bin')
const sourceMetadata = {
  version: FFMPEG_VERSION,
  sourceCommit: '38b88335f9',
  archiveUrl: ARCHIVE_URL,
  archiveSha256: ARCHIVE_SHA256,
  ffmpegSha256: FFMPEG_SHA256,
  ffprobeSha256: FFPROBE_SHA256
}

async function writeSourceMetadata() {
  await fs.mkdir(outputDirectory, { recursive: true })
  await fs.writeFile(
    path.join(outputDirectory, 'SOURCE.json'),
    `${JSON.stringify(sourceMetadata, null, 2)}\n`,
    'utf8'
  )
}

async function fileSha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function writeAll(handle, value) {
  let offset = 0
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset, null)
    if (bytesWritten <= 0) throw new Error('Unable to persist FFmpeg download chunk')
    offset += bytesWritten
  }
}

async function downloadPinnedArchive() {
  await fs.mkdir(downloadCacheDirectory, { recursive: true })
  const cached = await fs.stat(archivePath).catch(() => null)
  if (cached?.isFile() && cached.size > 0 && await fileSha256(archivePath) === ARCHIVE_SHA256) {
    return archivePath
  }
  if (cached) await fs.unlink(archivePath).catch(() => {})

  let offset = (await fs.stat(partialArchivePath).catch(() => null))?.size || 0
  if (offset > MAX_ARCHIVE_BYTES) {
    await fs.unlink(partialArchivePath).catch(() => {})
    offset = 0
  }
  if (offset > 0 && await fileSha256(partialArchivePath) === ARCHIVE_SHA256) {
    await fs.rename(partialArchivePath, archivePath)
    return archivePath
  }

  const controller = new AbortController()
  let stallTimer
  const resetStallTimer = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(new Error('FFmpeg download stalled')), 90_000)
    stallTimer.unref()
  }
  resetStallTimer()
  try {
    const response = await fetch(ARCHIVE_URL, {
      redirect: 'follow',
      signal: controller.signal,
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
    })
    if (response.status === 416 && offset > 0) {
      await fs.unlink(partialArchivePath).catch(() => {})
      return downloadPinnedArchive()
    }
    if (!response.ok || !response.body) throw new Error(`FFmpeg download failed: HTTP ${response.status}`)
    const append = offset > 0 && response.status === 206
    if (!append) offset = 0
    const contentRange = response.headers.get('content-range')
    const declaredTotal = contentRange
      ? Number(/\/(\d+)$/.exec(contentRange)?.[1] || 0)
      : offset + Number(response.headers.get('content-length') || 0)
    if (declaredTotal > MAX_ARCHIVE_BYTES) throw new Error('FFmpeg archive exceeds size limit')

    const handle = await fs.open(partialArchivePath, append ? 'a' : 'w')
    let downloaded = offset
    let nextProgress = Math.floor(downloaded / (5 * 1024 * 1024) + 1) * 5 * 1024 * 1024
    try {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetStallTimer()
        downloaded += value.byteLength
        if (downloaded > MAX_ARCHIVE_BYTES) throw new Error('FFmpeg archive exceeds size limit')
        await writeAll(handle, value)
        if (downloaded >= nextProgress) {
          console.log(`Downloaded ${Math.round(downloaded / 1024 / 1024)} MB...`)
          nextProgress += 5 * 1024 * 1024
        }
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
  } finally {
    clearTimeout(stallTimer)
  }

  const actualHash = await fileSha256(partialArchivePath)
  if (actualHash !== ARCHIVE_SHA256) {
    await fs.unlink(partialArchivePath).catch(() => {})
    throw new Error(`FFmpeg SHA-256 mismatch: expected ${ARCHIVE_SHA256}, got ${actualHash}`)
  }
  await fs.rename(partialArchivePath, archivePath)
  return archivePath
}

async function findNamed(directory, fileName) {
  const queue = [directory]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) queue.push(entryPath)
      else if (entry.name.toLowerCase() === fileName.toLowerCase()) return entryPath
    }
  }
  return null
}

function reportsExpectedVersion(binaryPath, tool) {
  const result = spawnSync(binaryPath, ['-version'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000
  })
  return result.status === 0 && new RegExp(`^${tool} version ${FFMPEG_VERSION}\\b`, 'm').test(result.stdout)
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('zClip currently packages FFmpeg only for Windows x64')
}

const cachedFfmpeg = path.join(outputDirectory, 'ffmpeg.exe')
const cachedFfprobe = path.join(outputDirectory, 'ffprobe.exe')
if (
  reportsExpectedVersion(cachedFfmpeg, 'ffmpeg') &&
  reportsExpectedVersion(cachedFfprobe, 'ffprobe') &&
  await fileSha256(cachedFfmpeg).catch(() => '') === FFMPEG_SHA256 &&
  await fileSha256(cachedFfprobe).catch(() => '') === FFPROBE_SHA256
) {
  await writeSourceMetadata()
  console.log(`FFmpeg/FFprobe ${FFMPEG_VERSION} already prepared.`)
  process.exit(0)
}

const token = `${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
const extractDirectory = path.join(os.tmpdir(), `zclip-ffmpeg-${token}`)

try {
  console.log(`Downloading pinned FFmpeg ${FFMPEG_VERSION} archive...`)
  const preparedArchivePath = await downloadPinnedArchive()
  await fs.mkdir(extractDirectory, { recursive: false })

  const expanded = spawnSync(path7za, [
    'x', preparedArchivePath, `-o${extractDirectory}`, '-y'
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000
  })
  if (expanded.error) throw expanded.error
  if (expanded.status !== 0) throw new Error(`FFmpeg extraction failed: ${expanded.stderr}`)

  const sourceFfmpeg = await findNamed(extractDirectory, 'ffmpeg.exe')
  const sourceFfprobe = await findNamed(extractDirectory, 'ffprobe.exe')
  const sourceLicense = await findNamed(extractDirectory, 'LICENSE')
  const sourceReadme = await findNamed(extractDirectory, 'README.txt')
  if (!sourceFfmpeg || !sourceFfprobe || !sourceLicense || !sourceReadme) {
    throw new Error('FFmpeg archive is missing binaries or redistribution documents')
  }

  await fs.mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    fs.copyFile(sourceFfmpeg, cachedFfmpeg),
    fs.copyFile(sourceFfprobe, cachedFfprobe),
    fs.copyFile(sourceLicense, path.join(outputDirectory, 'LICENSE')),
    fs.copyFile(sourceReadme, path.join(outputDirectory, 'README.txt'))
  ])
  if (!reportsExpectedVersion(cachedFfmpeg, 'ffmpeg') || !reportsExpectedVersion(cachedFfprobe, 'ffprobe')) {
    throw new Error('Extracted FFmpeg binaries do not report the pinned version')
  }
  if (await fileSha256(cachedFfmpeg) !== FFMPEG_SHA256 || await fileSha256(cachedFfprobe) !== FFPROBE_SHA256) {
    throw new Error('Extracted FFmpeg binary hash does not match the pinned archive contents')
  }
  await writeSourceMetadata()
  console.log(`Prepared FFmpeg/FFprobe ${FFMPEG_VERSION} in ${outputDirectory}`)
} finally {
  await fs.rm(extractDirectory, { recursive: true, force: true }).catch(() => {})
}
