import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { runMediaJob } from './media-job-manager'
import { scheduleCacheEnforcement, touchCacheFile } from './cache-manager'

const pendingByPath = new Map<string, Promise<void>>()

export async function ensurePitchedAudioPath(filePath: string, pitchPercent: number): Promise<string> {
  const ratio = Math.max(0.25, Math.min(4, pitchPercent / 100))
  if (Math.abs(ratio - 1) < 0.0001) return filePath
  const stat = await fs.stat(filePath)
  const key = crypto.createHash('sha256').update(JSON.stringify({
    version: 1,
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ratio: Math.round(ratio * 10_000) / 10_000
  })).digest('hex')
  const directory = path.join(app.getPath('userData'), 'proxy-cache')
  const outputPath = path.join(directory, `${key}-pitch.m4a`)
  await fs.mkdir(directory, { recursive: true })

  const existing = await fs.stat(outputPath).catch(() => null)
  if (!existing?.isFile() || existing.size === 0) {
    let pending = pendingByPath.get(outputPath)
    if (!pending) {
      pending = (async () => {
        const tempPath = `${outputPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp.m4a`
        try {
          await runMediaJob(`proxy:${outputPath}`, [
            '-y', '-i', filePath, '-vn', '-map', '0:a:0',
            '-af', `rubberband=pitch=${ratio.toFixed(6)}`,
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tempPath
          ])
          const generated = await fs.stat(tempPath).catch(() => null)
          if (!generated?.isFile() || generated.size <= 0) throw new Error('生成的音调代理为空')
          await fs.rename(tempPath, outputPath)
        } catch (error) {
          await fs.unlink(tempPath).catch(() => {})
          throw error
        }
      })()
      pendingByPath.set(outputPath, pending)
      void pending.finally(() => pendingByPath.delete(outputPath)).catch(() => {})
    }
    await pending
  }

  await touchCacheFile(outputPath)
  scheduleCacheEnforcement()
  return outputPath
}
