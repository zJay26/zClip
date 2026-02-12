// ============================================================
// FFmpeg Wrapper — 最底层，负责 spawn FFmpeg/FFprobe 子进程
// 对上层暴露纯函数式 API
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import path from 'path'

// Resolve static binary paths — works in both dev and production
function getBinaryPath(name: string): string {
  try {
    if (name === 'ffmpeg') {
      return require('@ffmpeg-installer/ffmpeg').path.replace('app.asar', 'app.asar.unpacked')
    }
    if (name === 'ffprobe') {
      return require('@ffprobe-installer/ffprobe').path.replace('app.asar', 'app.asar.unpacked')
    }
  } catch {
    // fallback: assume binary is on PATH
  }
  return name
}

const ffmpegPath = getBinaryPath('ffmpeg')
const ffprobePath = getBinaryPath('ffprobe')

export interface FFmpegProgress {
  percent: number
  time: number // seconds
  speed: string
}

export type ProgressCallback = (progress: FFmpegProgress) => void

/**
 * Run ffprobe and return parsed JSON output
 */
export function probe(filePath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]

    const proc = spawn(ffprobePath, args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => { stdout += data.toString() })
    proc.stderr.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new Error(`ffprobe JSON parse error: ${stdout}`))
        }
      } else {
        const detail = stderr.trim() || 'unknown error'
        reject(new Error(`ffprobe exited with code ${code} for ${filePath}: ${detail}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Run an FFmpeg command with progress reporting.
 * Returns the child process so caller can cancel it.
 */
export function runFFmpeg(
  args: string[],
  durationSeconds: number,
  onProgress?: ProgressCallback
): { process: ChildProcess; promise: Promise<void> } {
  const proc = spawn(ffmpegPath, args)

  const promise = new Promise<void>((resolve, reject) => {
    let stderr = ''
    let lastTime = 0
    let lastSpeed = '0x'

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk

      if (!onProgress || durationSeconds <= 0) return

      const timeRegex = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g
      const speedRegex = /speed=\s*(\d+(?:\.\d+)?)x/gi

      let timeMatch: RegExpExecArray | null = null
      let latestTimeMatch: RegExpExecArray | null = null
      while ((timeMatch = timeRegex.exec(chunk)) !== null) {
        latestTimeMatch = timeMatch
      }

      let speedMatch: RegExpExecArray | null = null
      let latestSpeedMatch: RegExpExecArray | null = null
      while ((speedMatch = speedRegex.exec(chunk)) !== null) {
        latestSpeedMatch = speedMatch
      }

      if (latestTimeMatch) {
        const hours = Number(latestTimeMatch[1])
        const minutes = Number(latestTimeMatch[2])
        const seconds = Number(latestTimeMatch[3])
        const parsedTime = hours * 3600 + minutes * 60 + seconds
        if (Number.isFinite(parsedTime) && parsedTime >= 0) {
          lastTime = parsedTime
        }
      }

      if (latestSpeedMatch) {
        lastSpeed = `${latestSpeedMatch[1]}x`
      }

      if (lastTime > 0) {
        const percent = Math.min(100, (lastTime / durationSeconds) * 100)
        onProgress({ percent, time: lastTime, speed: lastSpeed })
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-500)}`))
      }
    })

    proc.on('error', reject)
  })

  return { process: proc, promise }
}

export { ffmpegPath, ffprobePath }
