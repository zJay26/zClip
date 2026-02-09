// ============================================================
// Export Service — 执行导出任务，管理进度与取消
// ============================================================

import { BrowserWindow } from 'electron'
import type {
  MediaInfo,
  MediaOperation,
  ExportOptions,
  ResolutionPreset,
  TimelineClip,
  TrimParams,
  SpeedParams,
  VolumeParams,
  PitchParams
} from '../../shared/types'
import { IPC_CHANNELS } from '../../shared/types'
import { getTimelineDuration, getVisibleDurationFromOps } from '../../shared/timeline-utils'
import { runFFmpeg, type FFmpegProgress } from './ffmpeg'
import { buildFFmpegArgs } from './media-engine'
import type { ChildProcess } from 'child_process'

/** Resolution presets -> pixel dimensions */
const RESOLUTION_MAP: Record<ResolutionPreset, { w: number; h: number } | null> = {
  original: null,
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '480p': { w: 854, h: 480 }
}

/** Quality preset -> CRF value (lower = better quality, larger file) */
const CRF_MAP: Record<string, number> = {
  high: 18,
  medium: 23,
  low: 28
}

let currentExportProcess: ChildProcess | null = null

/**
 * Start an export job. Progress is sent to the renderer via IPC events.
 */
export async function startExport(
  mediaInfo: MediaInfo,
  operations: MediaOperation[],
  exportOptions: ExportOptions,
  win: BrowserWindow
): Promise<void> {
  const resolution = RESOLUTION_MAP[exportOptions.resolution]
  const crf = CRF_MAP[exportOptions.quality] ?? 23

  // Calculate effective duration for progress tracking
  const duration = getVisibleDurationFromOps(mediaInfo.duration, operations)

  const args = buildFFmpegArgs(
    mediaInfo.filePath,
    exportOptions.outputPath,
    operations,
    mediaInfo,
    { crf, resolution }
  )

  const onProgress = (progress: FFmpegProgress): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_PROGRESS, {
        percent: Math.round(progress.percent * 100) / 100,
        currentTime: progress.time,
        speed: progress.speed,
        eta: ''
      })
    }
  }

  const { process, promise } = runFFmpeg(args, duration, onProgress)
  currentExportProcess = process

  try {
    await promise
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_COMPLETE, exportOptions.outputPath)
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        IPC_CHANNELS.EXPORT_ERROR,
        error instanceof Error ? error.message : 'Unknown export error'
      )
    }
  } finally {
    currentExportProcess = null
  }
}

/**
 * Start a timeline export job with multiple clips/tracks.
 */
export async function startTimelineExport(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  exportOptions: ExportOptions,
  win: BrowserWindow
): Promise<void> {
  const resolution = RESOLUTION_MAP[exportOptions.resolution]
  const crf = CRF_MAP[exportOptions.quality] ?? 23

  const videoClips = clips.filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const audioClips = clips.filter((clip) => clip.track === 'audio' && clip.mediaInfo.hasAudio)

  const timelineDuration = getTimelineDuration(clips, operationsByClip)
  const outputSize = resolution || getDefaultVideoSize(videoClips)

  const args = buildTimelineFFmpegArgs(
    clips,
    operationsByClip,
    exportOptions.outputPath,
    outputSize,
    timelineDuration,
    crf
  )

  const onProgress = (progress: FFmpegProgress): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_PROGRESS, {
        percent: Math.round(progress.percent * 100) / 100,
        currentTime: progress.time,
        speed: progress.speed,
        eta: ''
      })
    }
  }

  const { process, promise } = runFFmpeg(args, timelineDuration, onProgress)
  currentExportProcess = process

  try {
    await promise
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_COMPLETE, exportOptions.outputPath)
    }
  } catch (error) {
    if (!win.isDestroyed()) {
      win.webContents.send(
        IPC_CHANNELS.EXPORT_ERROR,
        error instanceof Error ? error.message : 'Unknown export error'
      )
    }
  } finally {
    currentExportProcess = null
  }
}

/**
 * Cancel a running export
 */
export function cancelExport(): void {
  if (currentExportProcess) {
    currentExportProcess.kill('SIGTERM')
    currentExportProcess = null
  }
}

function getDefaultVideoSize(videoClips: TimelineClip[]): { w: number; h: number } | null {
  if (videoClips.length === 0) return null
  const first = videoClips[0]
  return { w: first.mediaInfo.width, h: first.mediaInfo.height }
}

function buildTimelineFFmpegArgs(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  outputPath: string,
  outputSize: { w: number; h: number } | null,
  timelineDuration: number,
  crf: number
): string[] {
  const args: string[] = ['-y']

  const inputs: TimelineClip[] = [...clips]
  inputs.forEach((clip) => {
    args.push('-i', clip.filePath)
  })

  const filterParts: string[] = []
  const videoLabels: { label: string; trackIndex: number; startTime: number }[] = []
  const audioLabels: string[] = []

  inputs.forEach((clip, index) => {
    const ops = operationsByClip[clip.id] || []
    const trim = ops.find((op) => op.type === 'trim' && op.enabled)
    const speed = ops.find((op) => op.type === 'speed' && op.enabled)
    const volume = ops.find((op) => op.type === 'volume' && op.enabled)
    const pitch = ops.find((op) => op.type === 'pitch' && op.enabled)

    const trimStart = trim ? (trim.params as TrimParams).startTime : 0
    const trimEnd = trim ? (trim.params as TrimParams).endTime : clip.duration

    if (clip.track === 'video' && clip.mediaInfo.hasVideo) {
      const vFilters: string[] = []
      vFilters.push(`trim=start=${trimStart}:end=${trimEnd}`)
      vFilters.push('setpts=PTS-STARTPTS')
      if (speed) {
        const { rate } = speed.params as SpeedParams
        vFilters.push(`setpts=PTS/${rate}`)
      }
      if (outputSize) {
        vFilters.push(`scale=${outputSize.w}:${outputSize.h}`)
      }
      vFilters.push(`setpts=PTS+${clip.startTime}/TB`)
      filterParts.push(`[${index}:v]${vFilters.join(',')}[v${index}]`)
      videoLabels.push({ label: `v${index}`, trackIndex: clip.trackIndex, startTime: clip.startTime })
    }

    if (clip.track === 'audio' && clip.mediaInfo.hasAudio) {
      const aFilters: string[] = []
      aFilters.push(`atrim=start=${trimStart}:end=${trimEnd}`)
      aFilters.push('asetpts=PTS-STARTPTS')

      if (speed) {
        const { rate } = speed.params as SpeedParams
        aFilters.push(...buildTempoChain(rate))
      }

      if (volume) {
        const { percent } = volume.params as VolumeParams
        const gain = Math.max(0, percent / 100)
        aFilters.push(`volume=${gain.toFixed(4)}`)
      }

      if (pitch) {
        const { percent } = pitch.params as PitchParams
        if (percent !== 100) {
          const ratio = Math.max(0.01, percent / 100)
          const originalRate = clip.mediaInfo.sampleRate || 44100
          const newRate = Math.round(originalRate * ratio)
          aFilters.push(`asetrate=${newRate}`)
          aFilters.push(`aresample=${originalRate}`)
          if (!speed) {
            const compensate = 1 / ratio
            aFilters.push(...buildTempoChain(compensate))
          }
        }
      }

      const delayMs = Math.max(0, Math.round(clip.startTime * 1000))
      aFilters.push(`adelay=${delayMs}`)
      filterParts.push(`[${index}:a]${aFilters.join(',')}[a${index}]`)
      audioLabels.push(`a${index}`)
    }
  })

  let videoOutLabel = ''
  if (videoLabels.length > 0 && outputSize) {
    filterParts.push(`color=c=black:s=${outputSize.w}x${outputSize.h}:d=${timelineDuration}[base]`)
    const sortedVideo = videoLabels
      .slice()
      .sort((a, b) => a.trackIndex - b.trackIndex || a.startTime - b.startTime)
    let current = 'base'
    sortedVideo.forEach((item, idx) => {
      const next = `vout${idx}`
      filterParts.push(`[${current}][${item.label}]overlay=eof_action=pass[${next}]`)
      current = next
    })
    videoOutLabel = current
  }

  let audioOutLabel = ''
  if (audioLabels.length > 0) {
    if (audioLabels.length === 1) {
      audioOutLabel = audioLabels[0]
      if (timelineDuration > 0) {
        filterParts.push(
          `[${audioOutLabel}]atrim=0:${timelineDuration},asetpts=PTS-STARTPTS[aout]`
        )
        audioOutLabel = 'aout'
      }
    } else {
      const inputsConcat = audioLabels.map((label) => `[${label}]`).join('')
      if (timelineDuration > 0) {
        filterParts.push(
          `${inputsConcat}amix=inputs=${audioLabels.length}:dropout_transition=0,atrim=0:${timelineDuration},asetpts=PTS-STARTPTS[aout]`
        )
        audioOutLabel = 'aout'
      } else {
        filterParts.push(
          `${inputsConcat}amix=inputs=${audioLabels.length}:dropout_transition=0[aout]`
        )
        audioOutLabel = 'aout'
      }
    }
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'))
  }

  if (videoOutLabel) {
    args.push('-map', `[${videoOutLabel}]`)
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf))
  } else {
    args.push('-vn')
  }

  if (audioOutLabel) {
    args.push('-map', `[${audioOutLabel}]`)
    args.push('-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-an')
  }

  args.push('-movflags', '+faststart', outputPath)
  return args
}

function buildTempoChain(targetTempo: number): string[] {
  const filters: string[] = []
  let remaining = targetTempo

  while (remaining < 0.5 || remaining > 2.0) {
    if (remaining < 0.5) {
      filters.push('atempo=0.5')
      remaining /= 0.5
    } else {
      filters.push('atempo=2.0')
      remaining /= 2.0
    }
  }

  filters.push(`atempo=${remaining.toFixed(4)}`)
  return filters
}
