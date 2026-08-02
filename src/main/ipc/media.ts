// ============================================================
// IPC Handlers — 媒体文件相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getMediaInfo } from '../services/media-engine'
import { ensurePlaybackPath } from '../services/media-proxy'
import { getTimelinePreviews } from '../services/media-preview'
import { ensurePitchedAudioPath } from '../services/audio-effect-proxy'
import type { TimelinePreviewOptions } from '../../shared/types'
import { assertNonEmptyString, assertTrustedIpcEvent } from '../security/ipc-security'
import {
  assertAuthorizedMediaPath,
  authorizeMediaPath,
  isSupportedMediaPath
} from '../security/media-access'
import { AUDIO_EXTENSIONS, MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '../../shared/media-formats'
import fs from 'fs/promises'

async function canonicalMediaPaths(filePaths: string[], limit = 200): Promise<string[]> {
  const accepted: string[] = []
  const seen = new Set<string>()
  for (const candidate of filePaths.slice(0, limit)) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 32_768) continue
    const realPath = await fs.realpath(candidate).catch(() => null)
    if (!realPath || !isSupportedMediaPath(realPath)) continue
    const stat = await fs.stat(realPath).catch(() => null)
    if (!stat?.isFile()) continue
    const key = process.platform === 'win32' ? realPath.toLowerCase() : realPath
    if (seen.has(key)) continue
    seen.add(key)
    authorizeMediaPath(realPath)
    accepted.push(realPath)
  }
  return accepted
}

export function registerMediaHandlers(): void {
  // Open file dialog and return selected file path
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        {
          name: '媒体文件',
          extensions: [...MEDIA_EXTENSIONS]
        },
        {
          name: '视频文件',
          extensions: [...VIDEO_EXTENSIONS]
        },
        {
          name: '音频文件',
          extensions: [...AUDIO_EXTENSIONS]
        }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return (await canonicalMediaPaths(result.filePaths, 1))[0] || null
  })

  // Open dialog for multiple files
  ipcMain.handle(IPC_CHANNELS.SHOW_OPEN_DIALOG_MULTI, async (event) => {
    assertTrustedIpcEvent(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '媒体文件',
          extensions: [...MEDIA_EXTENSIONS]
        },
        {
          name: '视频文件',
          extensions: [...VIDEO_EXTENSIONS]
        },
        {
          name: '音频文件',
          extensions: [...AUDIO_EXTENSIONS]
        }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return canonicalMediaPaths(result.filePaths)
  })

  ipcMain.handle(IPC_CHANNELS.AUTHORIZE_DROPPED_FILES, async (event, filePaths: unknown) => {
    assertTrustedIpcEvent(event)
    if (!Array.isArray(filePaths) || filePaths.length > 200 || !filePaths.every((item) => typeof item === 'string' && item.length <= 32_768)) {
      throw new Error('拖放文件参数无效')
    }
    return canonicalMediaPaths(filePaths)
  })

  // Get media info via ffprobe
  ipcMain.handle(IPC_CHANNELS.GET_MEDIA_INFO, async (event, filePath: string) => {
    try {
      assertTrustedIpcEvent(event)
      assertNonEmptyString(filePath, 'filePath')
      if (!isSupportedMediaPath(filePath)) throw new Error('不支持的媒体文件类型')
      const authorizedPath = await assertAuthorizedMediaPath(filePath)
      const stat = await fs.stat(authorizedPath)
      if (!stat.isFile()) throw new Error('媒体路径不是文件')
      const info = await getMediaInfo(authorizedPath)
      return {
        success: true,
        data: { ...info, playbackPath: authorizedPath, playbackIsProxy: false, playbackProxyFailed: false }
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
      const authorizedPath = await assertAuthorizedMediaPath(filePath)
      const info = await getMediaInfo(authorizedPath)
      const proxy = await ensurePlaybackPath(authorizedPath, info)
      authorizeMediaPath(proxy.playbackPath)
      return { success: true, playbackPath: proxy.playbackPath, playbackIsProxy: proxy.isProxy }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '代理生成失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.PREPARE_AUDIO_PITCH, async (event, filePath: string, pitchPercent: number) => {
    try {
      assertTrustedIpcEvent(event)
      assertNonEmptyString(filePath, 'filePath')
      if (!Number.isFinite(pitchPercent) || pitchPercent < 25 || pitchPercent > 400) throw new Error('音调参数无效')
      const authorizedPath = await assertAuthorizedMediaPath(filePath)
      const playbackPath = await ensurePitchedAudioPath(authorizedPath, pitchPercent)
      authorizeMediaPath(playbackPath)
      return { success: true, playbackPath }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '音调代理生成失败' }
    }
  })

  // Get timeline preview assets (video strip / audio waveform)
  ipcMain.handle(
    IPC_CHANNELS.GET_TIMELINE_PREVIEW,
    async (event, filePath: string, options: TimelinePreviewOptions) => {
      try {
        assertTrustedIpcEvent(event)
        assertNonEmptyString(filePath, 'filePath')
        if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('预览参数无效')
        if (!options.video && !options.audio) throw new Error('至少需要一种预览类型')
        const authorizedPath = await assertAuthorizedMediaPath(filePath)
        if (options.video && (
          !Number.isInteger(options.video.height) || options.video.height < 24 || options.video.height > 240 ||
          !Number.isInteger(options.video.frames) || options.video.frames < 1 || options.video.frames > 20
        )) throw new Error('视频预览参数无效')
        if (options.audio && (
          !Number.isInteger(options.audio.width) || options.audio.width < 16 || options.audio.width > 4096 ||
          !Number.isInteger(options.audio.height) || options.audio.height < 16 || options.audio.height > 256
        )) throw new Error('音频预览参数无效')
        const data = await getTimelinePreviews(authorizedPath, options)
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
