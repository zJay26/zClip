// ============================================================
// MediaPreview — 生成时间轴预览（视频缩略帧条 + 音频波形）
// ============================================================

import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { getMediaInfo } from './media-engine'
import { ffmpegPath } from './ffmpeg'

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
    if (!fs.existsSync(videoPath)) {
      const frames = Math.max(4, Math.min(options.video.frames, 20))
      const duration = Math.max(0.2, mediaInfo.duration || 0.2)
      const fps = Math.min(frames / duration, 2)
      const filter = [
        `fps=${fps.toFixed(4)}`,
        `scale=-1:${options.video.height}:flags=lanczos`,
        `tile=${frames}x1`
      ].join(',')
      const args = ['-y', '-i', filePath, '-vf', filter, '-frames:v', '1', videoPath]
      await runFFmpeg(args)
    }
    result.videoStripPath = videoPath
  }

  if (mediaInfo.hasAudio && options.audio) {
    const audioPath = path.join(cacheDir, `${baseKey}-wave.png`)
    if (!fs.existsSync(audioPath)) {
      const filter = `[0:a]showwavespic=s=${options.audio.width}x${options.audio.height}:colors=#ffffff@0.6,format=rgba`
      const args = ['-y', '-i', filePath, '-vn', '-filter_complex', filter, '-frames:v', '1', audioPath]
      await runFFmpeg(args)
    }
    result.audioWaveformPath = audioPath
  }

  return result
}
