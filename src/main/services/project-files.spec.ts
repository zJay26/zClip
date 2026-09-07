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
  writeAutosave,
  writeProjectFile,
  readProjectFile
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

  test('an empty project can replace and reopen an existing saved document with a backup', async () => {
    const target = path.join(electronState.userData, 'empty.zclip')
    await writeProjectFile(target, emptyProject)
    await writeProjectFile(target, { ...emptyProject, projectSettings: { ...emptyProject.projectSettings, frameRate: 60 } })
    expect((await readProjectFile(target)).projectSettings.frameRate).toBe(60)
    expect(JSON.parse(await fs.readFile(`${target}.bak`, 'utf8')).projectSettings.frameRate).toBe(30)
  })

  test('oversized saves leave both the project and its prior recovery file intact', async () => {
    const target = path.join(electronState.userData, 'protected.zclip')
    await writeProjectFile(target, emptyProject)
    await writeAutosave(emptyProject)
    const before = await fs.readFile(target, 'utf8')
    const recovery = await fs.readFile(getAutosavePath(), 'utf8')
    const filePath = `D:\\${'a'.repeat(18000)}.mp4`
    const oversized: ProjectData = { ...emptyProject, clips: Array.from({ length: 800 }, (_, index) => ({
      id: `clip-${index}`, groupId: `group-${index}`, startTime: index, duration: 1,
      track: 'video' as const, trackIndex: 0, filePath,
      mediaInfo: { filePath, duration: 1, width: 640, height: 360, fps: 30, videoCodec: 'h264',
        audioCodec: '', hasVideo: true, hasAudio: false, sampleRate: 0, fileSize: 1 }
    })) }
    await expect(writeProjectFile(target, oversized)).rejects.toThrow('25 MB')
    await expect(writeAutosave(oversized)).rejects.toThrow('25 MB')
    expect(await fs.readFile(target, 'utf8')).toBe(before)
    expect(await fs.readFile(getAutosavePath(), 'utf8')).toBe(recovery)
  })
})
