// ============================================================
// IPC Handlers — 导出相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type {
  AudioFadeSegment,
  MediaInfo,
  MediaOperation,
  ExportOptions,
  TimelineClip,
  TimelineTransition
} from '../../shared/types'
import { startExport, startTimelineExport, cancelExport } from '../services/export-service'
import { assertNonEmptyString, assertPlainObject, assertTrustedIpcEvent } from '../security/ipc-security'
import { isMediaOperation, isTimelineClip } from '../../shared/project-validation'

const EXPORT_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm', 'gif', 'webp', 'mp3', 'wav', 'flac', 'aac', 'opus'])
const RESOLUTIONS = new Set(['original', '1080p', '720p', '480p'])
const QUALITIES = new Set(['high', 'medium', 'low', 'custom'])

export function registerExportHandlers(): void {
  // Show save dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_SAVE_DIALOG, async (event, defaultName: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(defaultName, 'defaultName', 255)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'webm', 'gif', 'webp'] },
        { name: '音频文件', extensions: ['mp3', 'wav', 'flac', 'aac', 'opus'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Start export
  ipcMain.handle(
    IPC_CHANNELS.EXPORT_START,
    async (
      event,
      payload: {
        mediaInfo?: MediaInfo
        operations?: MediaOperation[]
        clips?: TimelineClip[]
        operationsByClip?: Record<string, MediaOperation[]>
        transitions?: TimelineTransition[]
        audioFades?: AudioFadeSegment[]
        exportOptions: ExportOptions
      }
    ) => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No window found' }

      try {
        assertTrustedIpcEvent(event)
        assertPlainObject(payload, 'payload')
        assertPlainObject(payload.exportOptions, 'exportOptions')
        assertNonEmptyString(payload.exportOptions.outputPath, 'outputPath')
        if (!EXPORT_FORMATS.has(payload.exportOptions.format) || !RESOLUTIONS.has(payload.exportOptions.resolution) || !QUALITIES.has(payload.exportOptions.quality)) {
          throw new Error('导出参数无效')
        }
        if (payload.clips && (!Array.isArray(payload.clips) || payload.clips.length > 10_000 || !payload.clips.every(isTimelineClip))) {
          throw new Error('时间线片段数据无效')
        }
        if (payload.operations && (!Array.isArray(payload.operations) || !payload.operations.every(isMediaOperation))) {
          throw new Error('媒体操作数据无效')
        }
        if (payload.clips && payload.clips.length > 0 && payload.operationsByClip) {
          await startTimelineExport(
            payload.clips,
            payload.operationsByClip,
            payload.exportOptions,
            win,
            payload.transitions || [],
            payload.audioFades || []
          )
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
  ipcMain.on(IPC_CHANNELS.EXPORT_CANCEL, (event) => {
    assertTrustedIpcEvent(event)
    cancelExport()
  })
}
