import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire
} from '@electron/fuses'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appDirectory = path.resolve(repoRoot, process.argv[2] || path.join('release', 'win-unpacked'))
const resourcesDirectory = path.join(appDirectory, 'resources')
const nativeDirectory = path.join(resourcesDirectory, 'ffmpeg')
const appPath = path.join(appDirectory, 'zClip.exe')
const appAsarPath = path.join(resourcesDirectory, 'app.asar')
const packagedIconPath = path.join(resourcesDirectory, 'zClip.ico')
const sourceIconPath = path.join(repoRoot, 'build', 'zClip.ico')
const ffmpegPath = path.join(nativeDirectory, 'ffmpeg.exe')
const ffprobePath = path.join(nativeDirectory, 'ffprobe.exe')
const expectedHashes = new Map([
  [ffmpegPath, '1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e'],
  [ffprobePath, 'b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07']
])

async function smokeTestPackagedApp() {
  const userDataPath = await fs.mkdtemp(path.join(repoRoot, 'build', 'packaged-smoke-'))
  const logPath = path.join(userDataPath, 'electron.log')
  try {
    const child = spawnSync(appPath, [
      '--smoke-test',
      `--user-data-dir=${userDataPath}`,
      '--disable-gpu',
      '--enable-logging',
      `--log-file=${logPath}`
    ], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    })
    if (child.error || child.status !== 0) {
      const log = await fs.readFile(logPath, 'utf8').catch(() => '')
      throw new Error(
        `Packaged app smoke test failed (${child.status}): ${child.error?.message || ''}\n` +
        `${(child.stderr || '').slice(-2000)}\n${log.slice(-4000)}`
      )
    }
  } finally {
    // Electron's logging thread can release electron.log a moment after the
    // smoke-test process exits on Windows. Let fs.rm retry transient EBUSY /
    // EPERM failures instead of turning a successful launch into a flaky CI
    // failure.
    await fs.rm(userDataPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150
    })
  }
}

async function requireNonEmptyFile(filePath) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size <= 0) throw new Error(`Packaged artifact is missing or empty: ${filePath}`)
}

async function fileSha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function reportsVersion(binaryPath, tool) {
  const result = spawnSync(binaryPath, ['-version'], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !new RegExp(`^${tool} version 8\\.1\\.2\\b`, 'm').test(result.stdout)) {
    throw new Error(`Packaged ${tool} does not report version 8.1.2`)
  }
}

for (const filePath of [
  appPath,
  appAsarPath,
  packagedIconPath,
  sourceIconPath,
  ffmpegPath,
  ffprobePath,
  path.join(nativeDirectory, 'LICENSE'),
  path.join(nativeDirectory, 'README.txt'),
  path.join(nativeDirectory, 'SOURCE.json')
]) await requireNonEmptyFile(filePath)

for (const [binaryPath, expectedHash] of expectedHashes) {
  const actualHash = await fileSha256(binaryPath)
  if (actualHash !== expectedHash) throw new Error(`Packaged native binary hash mismatch: ${binaryPath}`)
}

if (await fileSha256(packagedIconPath) !== await fileSha256(sourceIconPath)) {
  throw new Error('Packaged app icon does not match build/zClip.ico')
}

const source = JSON.parse(await fs.readFile(path.join(nativeDirectory, 'SOURCE.json'), 'utf8'))
if (
  source.version !== '8.1.2' ||
  source.ffmpegSha256 !== expectedHashes.get(ffmpegPath) ||
  source.ffprobeSha256 !== expectedHashes.get(ffprobePath)
) throw new Error('Packaged FFmpeg source metadata does not match the binaries')

reportsVersion(ffmpegPath, 'ffmpeg')
reportsVersion(ffprobePath, 'ffprobe')

const fuseWire = await getCurrentFuseWire(appPath)
const expectedFuses = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE]
])
for (const [fuse, expectedState] of expectedFuses) {
  if (fuseWire[fuse] !== expectedState) throw new Error(`Unexpected packaged Electron fuse state: ${FuseV1Options[fuse]}`)
}

await smokeTestPackagedApp()

console.log('Packaged app verified: startup/shutdown, app icon, ASAR, hardened Electron fuses, FFmpeg/FFprobe 8.1.2 hashes, source, and licenses.')
