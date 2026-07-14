// ============================================================
// IPC Handlers — 媒体文件相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getMediaInfo } from '../services/media-engine'
import { ensurePlaybackPath } from '../services/media-proxy'
import { getTimelinePreviews } from '../services/media-preview'
import type { TimelinePreviewOptions } from '../../shared/types'
import { assertNonEmptyString, assertTrustedIpcEvent } from '../security/ipc-security'
import { authorizeMediaPath, authorizeMediaPaths, isMediaPathAuthorized, isSupportedMediaPath } from '../security/media-access'
import fs from 'fs/promises'

export function registerMediaHandlers(): void {
  // Open file dialog and return selected file path
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        {
          name: '媒体文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mpg', 'mpeg', 'mpe', '3gp', '3g2', 'mts', 'm2ts', 'vob',
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus',
            'aiff', 'aif', 'alac', 'ac3', 'eac3', 'amr'
          ]
        },
        {
          name: '视频文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mpg', 'mpeg', 'mpe', '3gp', '3g2', 'mts', 'm2ts', 'vob'
          ]
        },
        {
          name: '音频文件',
          extensions: [
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus',
            'aiff', 'aif', 'alac', 'ac3', 'eac3', 'amr'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    authorizeMediaPath(result.filePaths[0])
    return result.filePaths[0]
  })

  // Open dialog for multiple files
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG_MULTI, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '媒体文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mpg', 'mpeg', 'mpe', '3gp', '3g2', 'mts', 'm2ts', 'vob',
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus',
            'aiff', 'aif', 'alac', 'ac3', 'eac3', 'amr'
          ]
        },
        {
          name: '视频文件',
          extensions: [
            'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
            'mpg', 'mpeg', 'mpe', '3gp', '3g2', 'mts', 'm2ts', 'vob'
          ]
        },
        {
          name: '音频文件',
          extensions: [
            'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus',
            'aiff', 'aif', 'alac', 'ac3', 'eac3', 'amr'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    authorizeMediaPaths(result.filePaths)
    return result.filePaths
  })

  // Get media info via ffprobe
  ipcMain.handle(IPC_CHANNELS.GET_MEDIA_INFO, async (event, filePath: string) => {
    try {
      assertTrustedIpcEvent(event)
      assertNonEmptyString(filePath, 'filePath')
      if (!isSupportedMediaPath(filePath)) throw new Error('不支持的媒体文件类型')
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) throw new Error('媒体路径不是文件')
      authorizeMediaPath(filePath)
      const info = await getMediaInfo(filePath)
      return {
        success: true,
        data: { ...info, playbackPath: filePath, playbackIsProxy: false, playbackProxyFailed: false }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to probe media'
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PREPARE_PLAYBACK, async (event, filePath: string) => {
    try {
      assertTrustedIpcEvent(event)
      assertNonEmptyString(filePath, 'filePath')
      if (!isMediaPathAuthorized(filePath)) throw new Error('媒体路径未授权')
      const info = await getMediaInfo(filePath)
      const proxy = await ensurePlaybackPath(filePath, info)
      authorizeMediaPath(proxy.playbackPath)
      return { success: true, playbackPath: proxy.playbackPath, playbackIsProxy: proxy.isProxy }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '代理生成失败' }
    }
  })

  // Get timeline preview assets (video strip / audio waveform)
  ipcMain.handle(
    IPC_CHANNELS.GET_TIMELINE_PREVIEW,
    async (event, filePath: string, options: TimelinePreviewOptions) => {
      try {
        assertTrustedIpcEvent(event)
        assertNonEmptyString(filePath, 'filePath')
        if (!isMediaPathAuthorized(filePath)) throw new Error('媒体路径未授权')
        if (!options || typeof options !== 'object') throw new Error('预览参数无效')
        if (options.video && (!Number.isFinite(options.video.height) || !Number.isFinite(options.video.frames))) throw new Error('视频预览参数无效')
        if (options.audio && (!Number.isFinite(options.audio.width) || !Number.isFinite(options.audio.height))) throw new Error('音频预览参数无效')
        const data = await getTimelinePreviews(filePath, options)
        if (data.videoStripPath) authorizeMediaPath(data.videoStripPath)
        if (data.audioWaveformPath) authorizeMediaPath(data.audioWaveformPath)
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
