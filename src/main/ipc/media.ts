// ============================================================
// IPC Handlers — 媒体文件相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getMediaInfo } from '../services/media-engine'
import { getTimelinePreviews } from '../services/media-preview'
import type { TimelinePreviewOptions } from '../../shared/types'

export function registerMediaHandlers(): void {
  // Open file dialog and return selected file path
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        {
          name: '媒体文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'
          ]
        },
        {
          name: '视频文件',
          extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v']
        },
        {
          name: '音频文件',
          extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus']
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Open dialog for multiple files
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG_MULTI, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '媒体文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'
          ]
        },
        {
          name: '视频文件',
          extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v']
        },
        {
          name: '音频文件',
          extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus']
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths
  })

  // Get media info via ffprobe
  ipcMain.handle(IPC_CHANNELS.GET_MEDIA_INFO, async (_event, filePath: string) => {
    try {
      const info = await getMediaInfo(filePath)
      return { success: true, data: info }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to probe media'
      }
    }
  })

  // Get timeline preview assets (video strip / audio waveform)
  ipcMain.handle(
    IPC_CHANNELS.GET_TIMELINE_PREVIEW,
    async (_event, filePath: string, options: TimelinePreviewOptions) => {
      try {
        const data = await getTimelinePreviews(filePath, options)
        return { success: true, data }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to generate preview'
        }
      }
    }
  )
}
