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
      '-v', 'quiet',
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
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`))
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

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString()
      stderr += line

      // Parse progress: "time=00:01:23.45"
      if (onProgress && durationSeconds > 0) {
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (timeMatch) {
          const hours = parseFloat(timeMatch[1])
          const minutes = parseFloat(timeMatch[2])
          const seconds = parseFloat(timeMatch[3])
          const currentTime = hours * 3600 + minutes * 60 + seconds
          const percent = Math.min(100, (currentTime / durationSeconds) * 100)

          const speedMatch = line.match(/speed=\s*([\d.]+)x/)
          const speed = speedMatch ? `${speedMatch[1]}x` : '0x'

          onProgress({ percent, time: currentTime, speed })
        }
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
