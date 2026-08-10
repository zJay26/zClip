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
let enforcementTimer: NodeJS.Timeout | null = null
let lastEnforcedAt = 0

interface CacheEntry {
  filePath: string
  size: number
  mtimeMs: number
}

interface CachePolicy {
  maxBytes: number
  maxAgeMs: number
}

export function getCacheEvictionPaths(
  entries: CacheEntry[],
  policy: CachePolicy,
  now = Date.now()
): string[] {
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs)
  const evicted: string[] = []
  let retainedBytes = 0
  for (const entry of sorted) {
    const isTemporary = /\.(?:tmp|partial)(?:\.|$)/i.test(path.basename(entry.filePath))
    const expired = now - entry.mtimeMs > policy.maxAgeMs
    const exceedsBudget = retainedBytes + entry.size > policy.maxBytes
    if (isTemporary || expired || exceedsBudget) {
      evicted.push(entry.filePath)
    } else {
      retainedBytes += entry.size
    }
  }
  return evicted
}

export function scheduleCacheEnforcement(): void {
  if (enforcementTimer || Date.now() - lastEnforcedAt < 60_000) return
  enforcementTimer = setTimeout(() => {
    enforcementTimer = null
    lastEnforcedAt = Date.now()
    void enforceCachePolicies()
  }, 2_000)
  enforcementTimer.unref()
}

export async function touchCacheFile(filePath: string): Promise<void> {
  const now = new Date()
  await fs.utimes(filePath, now, now).catch(() => {})
}

async function entriesFor(directory: string) {
  const names = await fs.readdir(directory).catch(() => [])
  const entries: CacheEntry[] = []
  const batchSize = 64
  for (let index = 0; index < names.length; index += batchSize) {
    const batch = await Promise.all(names.slice(index, index + batchSize).map(async (name) => {
      const filePath = path.join(directory, name)
      const stat = await fs.stat(filePath).catch(() => null)
      return stat?.isFile() ? { filePath, size: stat.size, mtimeMs: stat.mtimeMs } : null
    }))
    entries.push(...batch.filter((entry): entry is CacheEntry => Boolean(entry)))
  }
  return entries
}

export async function enforceCachePolicies(): Promise<void> {
  const now = Date.now()
  for (const policy of CACHE_POLICIES) {
    const directory = path.join(app.getPath('userData'), policy.name)
    const entries = await entriesFor(directory)
    for (const filePath of getCacheEvictionPaths(entries, policy, now)) {
      await fs.unlink(filePath).catch(() => {})
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
