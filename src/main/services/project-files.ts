import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { ProjectData, RecentProject } from '../../shared/types'
import { isProjectData, sanitizeProjectForPersistence } from '../../shared/project-validation'
import { authorizeMediaPaths } from '../security/media-access'

const PROJECT_SCHEMA_VERSION = 1
const RECENT_LIMIT = 10

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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
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
  await atomicWrite(filePath, `${JSON.stringify(projectData, null, 2)}\n`)
  await addRecentProject(filePath)
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  await ensureProjectStateDir()
  const recents = await readJsonFile<RecentProject[]>(getRecentProjectsPath())
  if (!Array.isArray(recents)) return []
  return recents
    .filter((item) => item && item.filePath && item.name)
    .slice(0, RECENT_LIMIT)
}

export async function addRecentProject(filePath: string): Promise<RecentProject[]> {
  await ensureProjectStateDir()
  const recents = await getRecentProjects()
  const normalized = path.normalize(filePath)
  const next: RecentProject[] = [
    {
      filePath: normalized,
      name: path.basename(normalized, path.extname(normalized)) || '未命名项目',
      updatedAt: new Date().toISOString()
    },
    ...recents.filter((item) => path.normalize(item.filePath) !== normalized)
  ].slice(0, RECENT_LIMIT)
  await atomicWrite(getRecentProjectsPath(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function removeRecentProject(filePath: string): Promise<RecentProject[]> {
  await ensureProjectStateDir()
  const normalized = path.normalize(filePath)
  const next = (await getRecentProjects()).filter(
    (item) => path.normalize(item.filePath) !== normalized
  )
  await atomicWrite(getRecentProjectsPath(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function writeAutosave(data: ProjectData): Promise<void> {
  await ensureProjectStateDir()
  const autosaveData: ProjectData = {
    ...sanitizeProjectForPersistence(data),
    schemaVersion: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString()
  }
  if (!isProjectData(autosaveData)) throw new Error('自动保存数据校验失败')
  await atomicWrite(getAutosavePath(), `${JSON.stringify(autosaveData, null, 2)}\n`)
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.writeFile(tempPath, contents, 'utf8')
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
}

export async function readAutosave(): Promise<ProjectData | null> {
  const data = await readJsonFile<unknown>(getAutosavePath())
  return isProjectData(data) ? data : null
}

export async function clearAutosave(): Promise<void> {
  try {
    await fs.unlink(getAutosavePath())
  } catch {
    // Missing autosave files are expected.
  }
}
