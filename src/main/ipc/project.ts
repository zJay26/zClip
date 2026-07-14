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

export function registerProjectHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECT_SHOW_SAVE_DIALOG, async (event, defaultName: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(defaultName, 'defaultName', 255)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName.endsWith('.zclip') ? defaultName : `${defaultName}.zclip`,
      filters: [
        { name: 'zClip 项目', extensions: ['zclip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SHOW_OPEN_DIALOG, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'zClip 项目', extensions: ['zclip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
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
        if (!isProjectData(payload.data)) throw new Error('项目数据格式无效')
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
      const data = await readProjectFile(filePath)
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
    return getRecentProjects()
  })
  ipcMain.handle(IPC_CHANNELS.PROJECT_REMOVE_RECENT, async (event, filePath: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(filePath, 'filePath')
    return removeRecentProject(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.PROJECT_SAVE_AUTOSAVE, async (event, data: ProjectData) => {
    try {
      assertTrustedIpcEvent(event)
      if (!isProjectData(data)) throw new Error('自动保存数据格式无效')
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
