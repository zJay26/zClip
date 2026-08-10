import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import type { ProjectData, RecentProject } from '../../shared/types'
import { isProjectData, sanitizeProjectForPersistence } from '../../shared/project-validation'
import { authorizeMediaPaths } from '../security/media-access'

const PROJECT_SCHEMA_VERSION = 1
const RECENT_LIMIT = 10
const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024
const writeQueues = new Map<string, Promise<void>>()

function pathKey(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function getProjectStateDir(): string {
  return path.join(app.getPath('userData'), 'projects')
}

function getRecentProjectsPath(): string {
  return path.join(getProjectStateDir(), 'recent-projects.json')
}

export function getAutosavePath(): string {
  return path.join(getProjectStateDir(), 'autosave.zclip')
}

async function ensureProjectStateDir(): Promise<void> {
  await fs.mkdir(getProjectStateDir(), { recursive: true })
}

async function readJsonFile<T>(filePath: string, maxBytes = MAX_PROJECT_FILE_BYTES): Promise<T | null> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) throw new Error('路径不是文件')
    if (stat.size > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`)
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`读取 JSON 文件失败：${filePath}`, error)
    }
    return null
  }
}

export async function readProjectFile(filePath: string): Promise<ProjectData> {
  const data = await readJsonFile<unknown>(filePath)
  if (!isProjectData(data)) {
    throw new Error('项目文件格式不受支持或已损坏')
  }
  authorizeMediaPaths(data.clips.map((clip) => clip.filePath))
  await addRecentProject(filePath)
  return data
}

export async function writeProjectFile(filePath: string, data: ProjectData): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const projectData: ProjectData = {
    ...sanitizeProjectForPersistence(data),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString()
  }
  if (!isProjectData(projectData)) throw new Error('项目数据校验失败')
  await queuedAtomicWrite(filePath, `${JSON.stringify(projectData, null, 2)}\n`, true)
  await addRecentProject(filePath)
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  await ensureProjectStateDir()
  const recents = await readJsonFile<RecentProject[]>(getRecentProjectsPath())
  if (!Array.isArray(recents)) return []
  return recents
    .filter((item) =>
      item && typeof item.filePath === 'string' && item.filePath.length > 0 && item.filePath.length <= 32_768 &&
      !item.filePath.includes('\0') && item.filePath.toLowerCase().endsWith('.zclip') &&
      typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 255 &&
      typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    )
    .slice(0, RECENT_LIMIT)
}

export async function addRecentProject(filePath: string): Promise<RecentProject[]> {
  const recentProjectsPath = getRecentProjectsPath()
  return queuedFileOperation(recentProjectsPath, async () => {
    await ensureProjectStateDir()
    const recents = await getRecentProjects()
    const normalized = path.normalize(filePath)
    const next: RecentProject[] = [
      {
        filePath: normalized,
        name: path.basename(normalized, path.extname(normalized)) || '未命名项目',
        updatedAt: new Date().toISOString()
      },
      ...recents.filter((item) => pathKey(item.filePath) !== pathKey(normalized))
    ].slice(0, RECENT_LIMIT)
    await atomicWrite(recentProjectsPath, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}

export async function removeRecentProject(filePath: string): Promise<RecentProject[]> {
  const recentProjectsPath = getRecentProjectsPath()
  return queuedFileOperation(recentProjectsPath, async () => {
    await ensureProjectStateDir()
    const normalized = path.normalize(filePath)
    const next = (await getRecentProjects()).filter(
      (item) => pathKey(item.filePath) !== pathKey(normalized)
    )
    await atomicWrite(recentProjectsPath, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}

export async function writeAutosave(data: ProjectData): Promise<void> {
  const autosaveData: ProjectData = {
    ...sanitizeProjectForPersistence(data),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString()
  }
  if (!isProjectData(autosaveData)) throw new Error('自动保存数据校验失败')
  const autosavePath = getAutosavePath()
  await queuedFileOperation(autosavePath, async () => {
    await atomicWrite(autosavePath, `${JSON.stringify(autosaveData, null, 2)}\n`)
  })
}

async function queuedAtomicWrite(filePath: string, contents: string, keepBackup = false): Promise<void> {
  await queuedFileOperation(filePath, () => atomicWrite(filePath, contents, keepBackup))
}

async function queuedFileOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const queueKey = pathKey(filePath)
  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  let result!: T
  const next = previous.catch(() => undefined).then(async () => {
    result = await operation()
  })
  writeQueues.set(queueKey, next)
  try {
    await next
    return result
  } finally {
    if (writeQueues.get(queueKey) === next) writeQueues.delete(queueKey)
  }
}

async function atomicWrite(filePath: string, contents: string, keepBackup = false): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(tempPath, 'wx')
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    if (keepBackup) {
      await fs.copyFile(filePath, `${filePath}.bak`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
}

export async function readAutosave(): Promise<ProjectData | null> {
  const data = await readJsonFile<unknown>(getAutosavePath())
  if (!isProjectData(data)) return null
  authorizeMediaPaths(data.clips.map((clip) => clip.filePath))
  return data
}

export async function clearAutosave(): Promise<void> {
  const autosavePath = getAutosavePath()
  await queuedFileOperation(autosavePath, async () => {
    try {
      await fs.unlink(autosavePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  })
}
