// ============================================================
// IPC Handlers — 导出相关
// ============================================================

import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs/promises'
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
import {
  isAudioFadeSegment,
  isMediaInfo,
  isMediaOperation,
  isTimelineClip,
  isTimelineTransition
} from '../../shared/project-validation'
import { assertAuthorizedMediaPath } from '../security/media-access'
import {
  consumeFileCapability,
  grantFileCapability,
  hasFileCapability
} from '../security/file-capabilities'

const EXPORT_FORMATS = new Set(['mp4', 'mov', 'mkv', 'webm', 'gif', 'webp', 'mp3', 'wav', 'flac', 'aac', 'opus'])
const RESOLUTIONS = new Set(['original', '1080p', '720p', '480p'])
const QUALITIES = new Set(['ultra_high', 'high', 'medium', 'low', 'ultra_low', 'custom'])
const H264_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'])
const GIF_DITHERS = new Set(['bayer', 'floyd_steinberg', 'sierra2_4a'])
const FORMAT_EXTENSIONS: Record<string, string> = {
  mp4: '.mp4', mov: '.mov', mkv: '.mkv', webm: '.webm', gif: '.gif', webp: '.webp',
  mp3: '.mp3', wav: '.wav', flac: '.flac', aac: '.aac', opus: '.opus'
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validateExportOptions(options: ExportOptions): void {
  if (!EXPORT_FORMATS.has(options.format) || !RESOLUTIONS.has(options.resolution) || !QUALITIES.has(options.quality)) {
    throw new Error('导出参数无效')
  }
  const expectedExtension = FORMAT_EXTENSIONS[options.format]
  if (path.extname(options.outputPath).toLowerCase() !== expectedExtension) {
    throw new Error(`输出文件扩展名必须为 ${expectedExtension}`)
  }
  if (options.range && (
    !finite(options.range.startTime, 0, 60 * 60 * 24 * 365) ||
    !finite(options.range.endTime, 0, 60 * 60 * 24 * 365) ||
    options.range.endTime <= options.range.startTime
  )) throw new Error('导出范围无效')
  if (options.gifLoop !== undefined && options.gifLoop !== 'infinite' && options.gifLoop !== 'once') {
    throw new Error('循环参数无效')
  }
  if (options.projectSettings) {
    const canvas = options.projectSettings.canvas
    if (!canvas || !['source', 'landscape', 'portrait', 'square', 'social', 'custom'].includes(canvas.preset) ||
      !Number.isInteger(canvas.width) || canvas.width < 16 || canvas.width > 16_384 ||
      !Number.isInteger(canvas.height) || canvas.height < 16 || canvas.height > 16_384 ||
      !/^#[0-9a-f]{6}$/i.test(canvas.backgroundColor) ||
      (options.projectSettings.frameRate !== undefined && !finite(options.projectSettings.frameRate, 1, 240))) {
      throw new Error('项目画布参数无效')
    }
  }
  if (options.customOptions) {
    const custom = options.customOptions as Record<string, unknown>
    const allowed = new Set([
      'crf', 'videoBitrateKbps', 'audioBitrateKbps', 'h264Preset', 'vp9CpuUsed',
      'animatedFps', 'webpQuality', 'webpCompressionLevel', 'gifColors', 'gifDither',
      'audioSampleRate', 'pcmBitDepth', 'flacCompressionLevel'
    ])
    if (Object.keys(custom).some((key) => !allowed.has(key))) throw new Error('自定义导出参数无效')
    const ranges: Record<string, [number, number]> = {
      crf: [0, 51],
      videoBitrateKbps: [64, 200_000],
      audioBitrateKbps: [32, 512],
      vp9CpuUsed: [0, 8],
      animatedFps: [1, 60],
      webpQuality: [0, 100],
      webpCompressionLevel: [0, 6],
      gifColors: [4, 256],
      audioSampleRate: [8_000, 192_000],
      flacCompressionLevel: [0, 12]
    }
    for (const [key, value] of Object.entries(custom)) {
      if (key === 'h264Preset') {
        if (typeof value !== 'string' || !H264_PRESETS.has(value)) throw new Error('自定义导出参数无效')
      } else if (key === 'gifDither') {
        if (typeof value !== 'string' || !GIF_DITHERS.has(value)) throw new Error('自定义导出参数无效')
      } else if (key === 'pcmBitDepth') {
        if (value !== 16 && value !== 24 && value !== 32) throw new Error('自定义导出参数无效')
      } else {
        const range = ranges[key]
        if (!range || !finite(value, range[0], range[1])) throw new Error('自定义导出参数无效')
      }
    }
  }
}

async function authorizeExportSources(paths: string[], outputPath: string): Promise<void> {
  const normalizeKey = (value: string): string => {
    const resolved = path.resolve(value)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const outputIdentity = await fs.realpath(outputPath).catch(async () => {
    const parent = await fs.realpath(path.dirname(outputPath)).catch(() => path.resolve(path.dirname(outputPath)))
    return path.join(parent, path.basename(outputPath))
  })
  const normalizedOutput = normalizeKey(outputIdentity)
  for (const filePath of Array.from(new Set(paths))) {
    const authorizedPath = await assertAuthorizedMediaPath(filePath)
    if (normalizeKey(authorizedPath) === normalizedOutput) {
      throw new Error('输出文件不能覆盖项目中的源素材')
    }
  }
}

export function registerExportHandlers(): void {
  // Show save dialog
  ipcMain.handle(IPC_CHANNELS.SHOW_SAVE_DIALOG, async (event, defaultName: string) => {
    assertTrustedIpcEvent(event)
    assertNonEmptyString(defaultName, 'defaultName', 255)
    const win = BrowserWindow.fromWebContents(event.sender)
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
    grantFileCapability('export-write', result.filePath)
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
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { success: false, error: 'No window found' }

      try {
        assertTrustedIpcEvent(event)
        assertPlainObject(payload, 'payload')
        assertPlainObject(payload.exportOptions, 'exportOptions')
        assertNonEmptyString(payload.exportOptions.outputPath, 'outputPath')
        validateExportOptions(payload.exportOptions)
        if (!hasFileCapability('export-write', payload.exportOptions.outputPath)) {
          throw new Error('导出路径未授权，请重新选择保存位置')
        }
        if (payload.clips && (!Array.isArray(payload.clips) || payload.clips.length > 10_000 || !payload.clips.every(isTimelineClip))) {
          throw new Error('时间线片段数据无效')
        }
        if (payload.operations && (!Array.isArray(payload.operations) || payload.operations.length > 100 || !payload.operations.every(isMediaOperation))) {
          throw new Error('媒体操作数据无效')
        }
        if (payload.clips && payload.clips.length > 0 && payload.operationsByClip) {
          assertPlainObject(payload.operationsByClip, 'operationsByClip')
          const clipIds = new Set(payload.clips.map((clip) => clip.id))
          for (const [clipId, operations] of Object.entries(payload.operationsByClip)) {
            if (!clipIds.has(clipId) || !Array.isArray(operations) || operations.length > 100 || !operations.every(isMediaOperation)) {
              throw new Error('片段操作数据无效')
            }
          }
          if (!Array.isArray(payload.transitions || []) || (payload.transitions || []).length > 10_000 || !(payload.transitions || []).every(isTimelineTransition)) {
            throw new Error('转场数据无效')
          }
          if (!Array.isArray(payload.audioFades || []) || (payload.audioFades || []).length > 20_000 || !(payload.audioFades || []).every(isAudioFadeSegment)) {
            throw new Error('音频淡化数据无效')
          }
          if ((payload.transitions || []).some((item) => !clipIds.has(item.leftClipId) || !clipIds.has(item.rightClipId)) ||
              (payload.audioFades || []).some((item) => !clipIds.has(item.clipId))) {
            throw new Error('时间线效果引用了不存在的片段')
          }
          await authorizeExportSources(payload.clips.map((clip) => clip.filePath), payload.exportOptions.outputPath)
          if (!consumeFileCapability('export-write', payload.exportOptions.outputPath)) {
            throw new Error('导出路径授权已使用，请重新选择保存位置')
          }
          await startTimelineExport(
            payload.clips,
            payload.operationsByClip,
            payload.exportOptions,
            win,
            payload.transitions || [],
            payload.audioFades || []
          )
        } else if (payload.mediaInfo && isMediaInfo(payload.mediaInfo) && payload.operations) {
          await authorizeExportSources([payload.mediaInfo.filePath], payload.exportOptions.outputPath)
          if (!consumeFileCapability('export-write', payload.exportOptions.outputPath)) {
            throw new Error('导出路径授权已使用，请重新选择保存位置')
          }
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
    void cancelExport()
  })
}
