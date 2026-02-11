// ============================================================
// MediaProxy — 生成可播放代理文件（仅用于预览）
// ============================================================

import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import type { MediaInfo } from '../../shared/types'
import { ffmpegPath } from './ffmpeg'

const SUPPORTED_VIDEO_CODECS = new Set([
  'h264',
  'avc1',
  'vp8',
  'vp9',
  'av1',
  'hevc',
  'h265'
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

function hashKey(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

async function runFFmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`))
    })
    proc.on('error', reject)
  })
}

function needsProxy(filePath: string, info: MediaInfo): boolean {
  if (!info.hasVideo) return false
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mkv') return true
  const codec = (info.videoCodec || '').toLowerCase()
  const pix = (info.pixelFormat || '').toLowerCase()
  const container = (info.containerFormat || '').toLowerCase()
  const containerNames = container.split(',').map((x) => x.trim()).filter(Boolean)
  const hasSupportedContainer = containerNames.some((name) => SUPPORTED_VIDEO_CONTAINERS.has(name))
  if (codec && !SUPPORTED_VIDEO_CODECS.has(codec)) return true
  if (containerNames.length > 0 && !hasSupportedContainer) return true
  if (!pix) return true
  if (!SUPPORTED_PIXEL_FORMATS.has(pix)) return true
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
  const proxyPath = path.join(cacheDir, `${key}.mp4`)

  if (!fs.existsSync(proxyPath)) {
    const args = [
      '-y',
      '-i', filePath,
      '-map', '0:v:0?',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      proxyPath
    ]
    await runFFmpeg(args)
  }

  return { playbackPath: proxyPath, isProxy: true }
}
