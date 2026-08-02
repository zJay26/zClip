// ============================================================
// MediaPreview — 生成时间轴预览（视频缩略帧条 + 音频波形）
// ============================================================

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { getMediaInfo } from './media-engine'
import { runMediaJob } from './media-job-manager'
import { scheduleCacheEnforcement, touchCacheFile } from './cache-manager'

const previewPromises = new Map<string, Promise<void>>()

export interface PreviewOptions {
  video?: { height: number; frames: number }
  audio?: { width: number; height: number }
}

export interface PreviewResult {
  videoStripPath?: string
  audioWaveformPath?: string
}

function hashKey(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  const stat = await fs.promises.stat(filePath).catch(() => null)
  return Boolean(stat?.isFile() && stat.size > 0)
}

async function ensurePreviewFile(filePath: string, args: string[]): Promise<void> {
  if (await isNonEmptyFile(filePath)) return
  const existing = previewPromises.get(filePath)
  if (existing) return existing

  const pending = (async () => {
    const extension = path.extname(filePath)
    const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp${extension}`
    const actualArgs = [...args]
    if (actualArgs[actualArgs.length - 1] !== filePath) throw new Error('预览输出路径不一致')
    actualArgs[actualArgs.length - 1] = tempPath
    try {
      await runMediaJob(`preview:${filePath}`, actualArgs)
      if (!await isNonEmptyFile(tempPath)) throw new Error('生成的时间线预览为空')
      await fs.promises.rename(tempPath, filePath)
    } catch (error) {
      await fs.promises.unlink(tempPath).catch(() => {})
      throw error
    }
  })()
  previewPromises.set(filePath, pending)
  try {
    await pending
  } finally {
    if (previewPromises.get(filePath) === pending) previewPromises.delete(filePath)
  }
}

export async function getTimelinePreviews(
  filePath: string,
  options: PreviewOptions
): Promise<PreviewResult> {
  const mediaInfo = await getMediaInfo(filePath)
  const cacheDir = path.join(app.getPath('userData'), 'preview-cache')
  await ensureDir(cacheDir)

  const stat = await fs.promises.stat(filePath)
  const baseKey = hashKey(
    JSON.stringify({
      cacheVersion: 'v2-audio-preview',
      filePath,
      size: stat.size,
      mtime: stat.mtimeMs,
      options
    })
  )

  const result: PreviewResult = {}

  if (mediaInfo.hasVideo && options.video) {
    const videoPath = path.join(cacheDir, `${baseKey}-strip.png`)
    if (!await isNonEmptyFile(videoPath)) {
      const frames = Math.max(4, Math.min(options.video.frames, 20))
      const duration = Math.max(0.2, mediaInfo.duration || 0.2)
      const fps = Math.min(frames / duration, 2)
      const filter = [
        `fps=${fps.toFixed(4)}`,
        `scale=-1:${options.video.height}:flags=lanczos`,
        `tile=${frames}x1`
      ].join(',')
      const args = ['-y', '-i', filePath, '-vf', filter, '-frames:v', '1', videoPath]
      await ensurePreviewFile(videoPath, args)
    }
    await touchCacheFile(videoPath)
    result.videoStripPath = videoPath
  }

  if (mediaInfo.hasAudio && options.audio) {
    const audioPath = path.join(cacheDir, `${baseKey}-wave.png`)
    if (!await isNonEmptyFile(audioPath)) {
      const filter = `[0:a]showwavespic=s=${options.audio.width}x${options.audio.height}:colors=#ffffff@0.6,format=rgba`
      const args = ['-y', '-i', filePath, '-vn', '-filter_complex', filter, '-frames:v', '1', audioPath]
      await ensurePreviewFile(audioPath, args)
    }
    await touchCacheFile(audioPath)
    result.audioWaveformPath = audioPath
  }

  scheduleCacheEnforcement()
  return result
}
