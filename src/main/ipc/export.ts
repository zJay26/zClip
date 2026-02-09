// ============================================================
// IPC Handlers — 导出相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { MediaInfo, MediaOperation, ExportOptions, TimelineClip } from '../../shared/types'
import { startExport, startTimelineExport, cancelExport } from '../services/export-service'

export function registerExportHandlers(): void {
  // Show save dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_SAVE_DIALOG, async (_event, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })

    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Start export
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_START,
    async (
      _event,
      payload: {
        mediaInfo?: MediaInfo
        operations?: MediaOperation[]
        clips?: TimelineClip[]
        operationsByClip?: Record<string, MediaOperation[]>
        exportOptions: ExportOptions
      }
    ) => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No window found' }

      try {
        if (payload.clips && payload.clips.length > 0 && payload.operationsByClip) {
          await startTimelineExport(payload.clips, payload.operationsByClip, payload.exportOptions, win)
        } else if (payload.mediaInfo && payload.operations) {
          await startExport(payload.mediaInfo, payload.operations, payload.exportOptions, win)
        } else {
          throw new Error('No export source found')
        }
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Export failed'
        }
      }
    }
  )

  // Cancel export
  ipcMain.on(IPC_CHANNELS.EXPORT_CANCEL, () => {
    cancelExport()
  })
}
