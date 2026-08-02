// ============================================================
// MediaProxy — 生成可播放代理文件（仅用于预览）
// ============================================================

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { MediaInfo } from '../../shared/types'
import { runMediaJob } from './media-job-manager'
import { scheduleCacheEnforcement, touchCacheFile } from './cache-manager'

const SUPPORTED_VIDEO_CODECS = new Set([
  'h264',
  'avc1',
  'vp8',
  'vp9',
  'av1'
])

const SUPPORTED_VIDEO_CONTAINERS = new Set([
  'mov',
  'mp4',
  'm4v',
  'webm'
])

const SUPPORTED_PIXEL_FORMATS = new Set([
  'yuv420p',
  'yuvj420p',
  'nv12',
  'p010le',
  'yuv420p10le'
])
const SUPPORTED_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le'])
const proxyPromises = new Map<string, Promise<void>>()

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  const stat = await fs.promises.stat(filePath).catch(() => null)
  return Boolean(stat?.isFile() && stat.size > 0)
}

function hashKey(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

function needsProxy(filePath: string, info: MediaInfo): boolean {
  if (!info.hasVideo && !info.hasAudio) return false
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mkv' || ext === '.wma' || ext === '.ac3' || ext === '.eac3' || ext === '.alac') return true
  if (!info.hasVideo) return !SUPPORTED_AUDIO_CODECS.has((info.audioCodec || '').toLowerCase())
  const codec = (info.videoCodec || '').toLowerCase()
  const pix = (info.pixelFormat || '').toLowerCase()
  const container = (info.containerFormat || '').toLowerCase()
  const containerNames = container.split(',').map((x) => x.trim()).filter(Boolean)
  const hasSupportedContainer = containerNames.some((name) => SUPPORTED_VIDEO_CONTAINERS.has(name))
  if (codec && !SUPPORTED_VIDEO_CODECS.has(codec)) return true
  if (containerNames.length > 0 && !hasSupportedContainer) return true
  if (!pix) return true
  if (!SUPPORTED_PIXEL_FORMATS.has(pix)) return true
  if (info.hasAudio && !SUPPORTED_AUDIO_CODECS.has((info.audioCodec || '').toLowerCase())) return true
  return false
}

export async function ensurePlaybackPath(
  filePath: string,
  info: MediaInfo
): Promise<{ playbackPath: string; isProxy: boolean }> {
  if (!needsProxy(filePath, info)) {
    return { playbackPath: filePath, isProxy: false }
  }

  const stat = await fs.promises.stat(filePath)
  const cacheDir = path.join(app.getPath('userData'), 'proxy-cache')
  await ensureDir(cacheDir)

  const key = hashKey(
    JSON.stringify({
      filePath,
      size: stat.size,
      mtime: stat.mtimeMs,
      container: info.containerFormat,
      codec: info.videoCodec,
      pix: info.pixelFormat
    })
  )
  const proxyPath = path.join(cacheDir, `${key}${info.hasVideo ? '.mp4' : '.m4a'}`)

  if (!await isNonEmptyFile(proxyPath)) {
    let pending = proxyPromises.get(proxyPath)
    if (!pending) {
      pending = (async () => {
        const tempPath = `${proxyPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp${path.extname(proxyPath)}`
        const args = info.hasVideo
          ? [
              '-y', '-i', filePath,
              '-map', '0:v:0?', '-map', '0:a:0?',
              '-vf', `scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${Math.min(60, Math.max(1, info.fps || 30)).toFixed(3)}`,
              '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
              '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tempPath
            ]
          : [
              '-y', '-i', filePath, '-vn', '-map', '0:a:0',
              '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tempPath
            ]
        try {
          await runMediaJob(`proxy:${proxyPath}`, args)
          if (!await isNonEmptyFile(tempPath)) throw new Error('生成的播放代理为空')
          await fs.promises.rename(tempPath, proxyPath)
        } catch (error) {
          await fs.promises.unlink(tempPath).catch(() => {})
          throw error
        }
      })()
      proxyPromises.set(proxyPath, pending)
      void pending.finally(() => proxyPromises.delete(proxyPath)).catch(() => {})
    }
    await pending
  }

  await touchCacheFile(proxyPath)
  scheduleCacheEnforcement()
  return { playbackPath: proxyPath, isProxy: true }
}
