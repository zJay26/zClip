import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { ProjectData } from '../../shared/types'
import { isProjectData } from '../../shared/project-validation'
import { assertNonEmptyString, assertPlainObject, assertTrustedIpcEvent } from '../security/ipc-security'
import {
  clearAutosave,
  getRecentProjects,
  readAutosave,
  readProjectFile,
  removeRecentProject,
  writeAutosave,
  writeProjectFile
} from '../services/project-files'
import {
  grantFileCapability,
  hasFileCapability
} from '../security/file-capabilities'
import { isMediaPathAuthorized, isSupportedMediaPath } from '../security/media-access'

function assertProjectMediaPathsAuthorized(data: ProjectData): void {
  const unauthorized = data.clips.find((clip) =>
    !isSupportedMediaPath(clip.filePath) || !isMediaPathAuthorized(clip.filePath)
  )
  if (unauthorized) {
    throw new Error('项目包含未经用户授权的素材路径')
  }
}

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_SHOW_SAVE_DIALOG, async (event, defaultName: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(defaultName, 'defaultName', 255)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName.endsWith('.zclip') ? defaultName : `${defaultName}.zclip`,
      filters: [{ name: 'zClip 项目', extensions: ['zclip'] }]
    })

    if (result.canceled || !result.filePath) return null
    grantFileCapability('project-write', result.filePath)
    return result.filePath
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SHOW_OPEN_DIALOG, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'zClip 项目', extensions: ['zclip'] }]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    grantFileCapability('project-read', result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECT_SAVE,
    async (event, payload: { filePath: string; data: ProjectData }) => {
      try {
        assertTrustedIpcEvent(event)
        assertPlainObject(payload, 'payload')
        assertNonEmptyString(payload.filePath, 'filePath')
        if (!payload.filePath.toLowerCase().endsWith('.zclip')) throw new Error('项目文件扩展名必须为 .zclip')
        if (!hasFileCapability('project-write', payload.filePath)) throw new Error('项目保存路径未授权，请重新选择保存位置')
        if (!isProjectData(payload.data)) throw new Error('项目数据格式无效')
        assertProjectMediaPathsAuthorized(payload.data)
        await writeProjectFile(payload.filePath, payload.data)
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '项目保存失败'
        }
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, async (event, filePath: string) => {
    try {
      assertTrustedIpcEvent(event)
      assertNonEmptyString(filePath, 'filePath')
      if (!filePath.toLowerCase().endsWith('.zclip')) throw new Error('项目文件扩展名必须为 .zclip')
      if (!hasFileCapability('project-read', filePath)) throw new Error('项目路径未授权，请通过打开对话框或最近项目进入')
      const data = await readProjectFile(filePath)
      grantFileCapability('project-write', filePath)
      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '项目打开失败'
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_RECENTS, async (event) => {
    assertTrustedIpcEvent(event)
    const recents = await getRecentProjects()
    recents.forEach((item) => grantFileCapability('project-read', item.filePath))
    return recents
  })
  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE_RECENT, async (event, filePath: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(filePath, 'filePath')
    if (!hasFileCapability('project-read', filePath)) throw new Error('最近项目路径未授权')
    return removeRecentProject(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE_AUTOSAVE, async (event, data: ProjectData) => {
    try {
      assertTrustedIpcEvent(event)
      if (!isProjectData(data)) throw new Error('自动保存数据格式无效')
      assertProjectMediaPathsAuthorized(data)
      await writeAutosave(data)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '自动保存失败'
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_GET_AUTOSAVE, async (event) => {
    assertTrustedIpcEvent(event)
    return readAutosave()
  })
  ipcMain.handle(IPC_CHANNELS.PROJECT_CLEAR_AUTOSAVE, async (event) => {
    assertTrustedIpcEvent(event)
    await clearAutosave()
    return { success: true }
  })
}
