// ============================================================
// FFmpeg Wrapper — 最底层，负责 spawn FFmpeg/FFprobe 子进程
// 对上层暴露纯函数式 API
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

// Resolve static binary paths — works in both dev and production
function getBinaryPath(name: string): string {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  const resourcesPath = process.resourcesPath
  if (resourcesPath) {
    const packagedBinary = path.join(resourcesPath, 'ffmpeg', executable)
    if (existsSync(packagedBinary)) return packagedBinary
  }
  const preparedBinary = path.resolve(process.cwd(), 'build', 'ffmpeg', executable)
  if (existsSync(preparedBinary)) return preparedBinary
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
const MAX_PROBE_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_PROBE_TIMEOUT_MS = 30_000
const EXPORT_STALL_TIMEOUT_MS = 5 * 60_000

export function terminateProcess(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.killed) return
  proc.kill('SIGTERM')
  const forceTimer = setTimeout(() => {
    if (proc.exitCode !== null) return
    if (process.platform === 'win32' && proc.pid) {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
      killer.unref()
    } else {
      proc.kill('SIGKILL')
    }
  }, 2_000)
  forceTimer.unref()
}

export function probe(
  filePath: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]

    const proc = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = ''
    let stdoutBytes = 0
    let stderr = ''
    let settled = false
    let timeout: NodeJS.Timeout | undefined
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      terminateProcess(proc)
      finish(() => reject(new Error('媒体探测已取消')))
    }
    timeout = setTimeout(() => {
      terminateProcess(proc)
      finish(() => reject(new Error('媒体探测超时，请检查素材是否损坏')))
    }, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS)
    timeout.unref()
    if (options.signal?.aborted) {
      onAbort()
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', (data) => {
      stdoutBytes += data.length
      if (stdoutBytes > MAX_PROBE_OUTPUT_BYTES) {
        terminateProcess(proc)
        finish(() => reject(new Error('媒体元数据超过安全上限')))
        return
      }
      stdout += data.toString()
    })
    proc.stderr.on('data', (data) => {
      stderr = `${stderr}${data.toString()}`.slice(-16_384)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(stdout) as Record<string, unknown>
          finish(() => resolve(result))
        } catch {
          finish(() => reject(new Error('无法解析媒体元数据，文件可能已损坏')))
        }
      } else {
        const detail = stderr.trim() || 'unknown error'
        finish(() => reject(new Error(`媒体探测失败（代码 ${code}）：${detail.slice(-800)}`)))
      }
    })

    proc.on('error', (error) => finish(() => reject(error)))
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
  const outputArg = args[args.length - 1]
  const progressArgs = outputArg
    ? [...args.slice(0, -1), '-progress', 'pipe:1', '-nostats', outputArg]
    : args
  const proc = spawn(ffmpegPath, progressArgs, { windowsHide: true })

  const promise = new Promise<void>((resolve, reject) => {
    let stderr = ''
    let lastTime = 0
    let lastSpeed = '0x'
    let stdoutBuffer = ''
    let settled = false
    let stallTimer: NodeJS.Timeout

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(stallTimer)
      callback()
    }

    const resetStallTimer = (): void => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        terminateProcess(proc)
        finish(() => reject(new Error('FFmpeg 长时间没有响应，导出已终止')))
      }, EXPORT_STALL_TIMEOUT_MS)
      stallTimer.unref()
    }
    resetStallTimer()

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr = `${stderr}${chunk}`.slice(-16_384)
      resetStallTimer()
    })

    proc.stdout?.on('data', (data: Buffer) => {
      resetStallTimer()
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const separator = line.indexOf('=')
        if (separator <= 0) continue
        const key = line.slice(0, separator)
        const value = line.slice(separator + 1).trim()
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const raw = Number(value)
          if (Number.isFinite(raw) && raw >= 0) lastTime = raw / 1_000_000
        } else if (key === 'speed' && value) {
          lastSpeed = value
        } else if (key === 'progress' && onProgress && durationSeconds > 0) {
          const percent = value === 'end' ? 100 : Math.min(100, (lastTime / durationSeconds) * 100)
          onProgress({ percent, time: lastTime, speed: lastSpeed })
        }
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        finish(resolve)
      } else {
        finish(() => reject(new Error(`FFmpeg 退出代码 ${code}：${stderr.slice(-1200)}`)))
      }
    })

    proc.on('error', (error) => finish(() => reject(error)))
  })

  return { process: proc, promise }
}

export { ffmpegPath, ffprobePath }
