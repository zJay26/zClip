import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { ProjectData } from '../../shared/types'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userData
  }
}))

import {
  addRecentProject,
  clearAutosave,
  getAutosavePath,
  getRecentProjects,
  writeAutosave
} from './project-files'

const emptyProject: ProjectData = {
  schemaVersion: 1,
  savedAt: new Date(0).toISOString(),
  clips: [],
  operationsByClip: {},
  transitions: [],
  audioFades: [],
  linkedGroups: {},
  videoTrackCount: 2,
  audioTrackCount: 2,
  currentTime: 0,
  projectSettings: {
    frameRate: 30,
    canvas: { preset: 'source', width: 1920, height: 1080, backgroundColor: '#000000' }
  }
}

describe('project file operation ordering', () => {
  beforeEach(async () => {
    electronState.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'zclip-project-files-'))
  })

  afterEach(async () => {
    await fs.rm(electronState.userData, { recursive: true, force: true })
  })

  test('does not lose concurrent recent-project updates', async () => {
    await Promise.all([
      addRecentProject('D:\\media\\first.zclip'),
      addRecentProject('D:\\media\\second.zclip')
    ])

    const recents = await getRecentProjects()
    expect(new Set(recents.map((item) => item.filePath))).toEqual(new Set([
      'D:\\media\\first.zclip',
      'D:\\media\\second.zclip'
    ]))
  })

  test('orders autosave deletion after an in-flight write', async () => {
    await Promise.all([writeAutosave(emptyProject), clearAutosave()])
    await expect(fs.access(getAutosavePath())).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
