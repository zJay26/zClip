import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

export interface CacheStats {
  bytes: number
  files: number
}

const CACHE_POLICIES = [
  { name: 'proxy-cache', maxBytes: 10 * 1024 ** 3, maxAgeMs: 45 * 24 * 60 * 60 * 1000 },
  { name: 'preview-cache', maxBytes: 1024 ** 3, maxAgeMs: 30 * 24 * 60 * 60 * 1000 }
]

async function entriesFor(directory: string) {
  const names = await fs.readdir(directory).catch(() => [])
  const entries = await Promise.all(names.map(async (name) => {
    const filePath = path.join(directory, name)
    const stat = await fs.stat(filePath).catch(() => null)
    return stat?.isFile() ? { filePath, size: stat.size, mtimeMs: stat.mtimeMs } : null
  }))
  return entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

export async function enforceCachePolicies(): Promise<void> {
  const now = Date.now()
  for (const policy of CACHE_POLICIES) {
    const directory = path.join(app.getPath('userData'), policy.name)
    const entries = (await entriesFor(directory)).sort((a, b) => b.mtimeMs - a.mtimeMs)
    let retainedBytes = 0
    for (const entry of entries) {
      retainedBytes += entry.size
      if (now - entry.mtimeMs > policy.maxAgeMs || retainedBytes > policy.maxBytes || entry.filePath.endsWith('.tmp')) {
        await fs.unlink(entry.filePath).catch(() => {})
      }
    }
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  const all = await Promise.all(CACHE_POLICIES.map((policy) => entriesFor(path.join(app.getPath('userData'), policy.name))))
  return all.flat().reduce((stats, entry) => ({ bytes: stats.bytes + entry.size, files: stats.files + 1 }), { bytes: 0, files: 0 })
}

export async function clearMediaCaches(): Promise<void> {
  for (const policy of CACHE_POLICIES) {
    const directory = path.join(app.getPath('userData'), policy.name)
    await fs.rm(directory, { recursive: true, force: true })
  }
}
