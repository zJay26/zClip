import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ffmpegPath = path.join(repoRoot, 'build', 'ffmpeg', 'ffmpeg.exe')
const ffprobePath = path.join(repoRoot, 'build', 'ffmpeg', 'ffprobe.exe')
const EXPECTED_HASHES = new Map([
  [ffmpegPath, '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e'],
  [ffprobePath, 'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07']
])

function run(binary, args, label) {
  if (!binary) throw new Error(`${label} binary is missing`)
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${(result.stderr || '').slice(-1200)}`)
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

async function fileSha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

const ffmpegVersion = run(ffmpegPath, ['-version'], 'FFmpeg')
const ffprobeVersion = run(ffprobePath, ['-version'], 'FFprobe')
for (const [binaryPath, expectedHash] of EXPECTED_HASHES) {
  const actualHash = await fileSha256(binaryPath)
  if (actualHash !== expectedHash) throw new Error(`Native binary SHA-256 mismatch: ${binaryPath}`)
}
if (!/^ffmpeg version 8\.1\.2\b/m.test(ffmpegVersion)) {
  throw new Error('Unexpected FFmpeg version; expected 8.1.2')
}
if (!/^ffprobe version 8\.1\.2\b/m.test(ffprobeVersion)) {
  throw new Error('Unexpected FFprobe version; expected 8.1.2')
}

const filters = run(ffmpegPath, ['-hide_banner', '-filters'], 'FFmpeg filter inventory')
for (const requiredFilter of ['rubberband', 'palettegen', 'paletteuse', 'overlay']) {
  if (!new RegExp(`\\b${requiredFilter}\\b`).test(filters)) {
    throw new Error(`Bundled FFmpeg is missing required filter: ${requiredFilter}`)
  }
}

const encoders = run(ffmpegPath, ['-hide_banner', '-encoders'], 'FFmpeg encoder inventory')
for (const requiredEncoder of ['libx264', 'libvpx-vp9', 'libwebp', 'libmp3lame', 'libopus']) {
  if (!new RegExp(`\\b${requiredEncoder}\\b`).test(encoders)) {
    throw new Error(`Bundled FFmpeg is missing required encoder: ${requiredEncoder}`)
  }
}

for (const licensePath of [path.join(path.dirname(ffmpegPath), 'LICENSE')]) {
  if (statSync(licensePath).size <= 0) throw new Error(`Empty license file: ${licensePath}`)
}

console.log('Native media tools verified: FFmpeg/FFprobe 8.1.2, required filters, encoders, and licenses.')
