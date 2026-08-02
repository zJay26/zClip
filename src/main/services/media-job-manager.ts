import { spawn, type ChildProcess } from 'child_process'
import { ffmpegPath, terminateProcess } from './ffmpeg'

const MAX_CONCURRENT_JOBS = 2
const runningByKey = new Map<string, Promise<void>>()
const processes = new Set<ChildProcess>()
let activeCount = 0
let cancellationGeneration = 0
const queue: Array<() => void> = []

async function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT_JOBS) {
    activeCount += 1
    return
  }
  await new Promise<void>((resolve) => queue.push(resolve))
  activeCount += 1
}

function release(): void {
  activeCount = Math.max(0, activeCount - 1)
  queue.shift()?.()
}

export function runMediaJob(key: string, args: string[]): Promise<void> {
  const existing = runningByKey.get(key)
  if (existing) return existing
  const generation = cancellationGeneration
  const job = (async () => {
    await acquire()
    try {
      if (generation !== cancellationGeneration) throw new Error('媒体任务已取消')
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, { windowsHide: true })
        processes.add(proc)
        let stderr = ''
        let settled = false
        const timeoutMs = key.startsWith('preview:') ? 2 * 60_000 : 30 * 60_000
        const timeout = setTimeout(() => {
          terminateProcess(proc)
          if (!settled) {
            settled = true
            processes.delete(proc)
            reject(new Error(key.startsWith('preview:') ? '预览生成超时' : '代理生成超时'))
          }
        }, timeoutMs)
        timeout.unref()
        proc.stderr.on('data', (data) => {
          stderr = `${stderr}${data.toString()}`.slice(-16_384)
        })
        proc.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          processes.delete(proc)
          if (code === 0) resolve()
          else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-800)}`))
        })
        proc.on('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          processes.delete(proc)
          reject(error)
        })
      })
    } finally {
      release()
    }
  })()
  runningByKey.set(key, job)
  void job.finally(() => runningByKey.delete(key)).catch(() => {})
  return job
}

export async function cancelAllMediaJobs(): Promise<void> {
  cancellationGeneration += 1
  const pending = Array.from(runningByKey.values())
  processes.forEach(terminateProcess)
  await Promise.allSettled(pending)
  processes.clear()
}
