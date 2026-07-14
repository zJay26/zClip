import { spawn, type ChildProcess } from 'child_process'
import { ffmpegPath } from './ffmpeg'

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
        proc.stderr.on('data', (data) => {
          stderr = `${stderr}${data.toString()}`.slice(-16_384)
        })
        proc.on('close', (code) => {
          processes.delete(proc)
          if (code === 0) resolve()
          else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-800)}`))
        })
        proc.on('error', (error) => {
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

export function cancelAllMediaJobs(): void {
  cancellationGeneration += 1
  processes.forEach((process) => process.kill('SIGTERM'))
  processes.clear()
}
