import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/types'
import { assertTrustedIpcEvent } from '../security/ipc-security'
import { AppUpdater } from '../services/app-updater'
import { fetchUpdate } from '../services/update-fetch'

export async function registerUpdateHandlers(requestInstall: () => boolean): Promise<AppUpdater> {
  const updater = new AppUpdater({
    currentVersion: app.getVersion(),
    settingsPath: join(app.getPath('userData'), 'update-settings.json'),
    defaultDirectory: join(app.getPath('downloads'), 'zClip Updates'),
    fetch: fetchUpdate,
    openInstaller: (path) => shell.openPath(path),
    scheduleChecks: app.isPackaged && !process.argv.includes('--smoke-test'),
    emit: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(IPC_CHANNELS.UPDATE_STATE, state)
      }
    }
  })
  await updater.start()
  ipcMain.handle(IPC_CHANNELS.UPDATE_GET_STATE, (event) => {
    assertTrustedIpcEvent(event)
    return updater.getState()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_SET_AUTO_CHECK, (event, enabled: boolean) => {
    assertTrustedIpcEvent(event)
    return updater.setAutoCheck(enabled)
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_SELECT_DIRECTORY, async (event) => {
    assertTrustedIpcEvent(event)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      defaultPath: updater.getState().settings.downloadDirectory,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || !result.filePaths[0]
      ? updater.getState() : updater.setDownloadDirectory(result.filePaths[0])
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, (event) => {
    assertTrustedIpcEvent(event)
    return updater.check()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, (event) => {
    assertTrustedIpcEvent(event)
    return updater.download()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_CANCEL_DOWNLOAD, (event) => {
    assertTrustedIpcEvent(event)
    updater.cancelDownload()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, (event) => {
    assertTrustedIpcEvent(event)
    return updater.getState().status === 'downloaded' && requestInstall()
  })
  return updater
}
