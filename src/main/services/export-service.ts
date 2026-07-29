// ============================================================
// Export Service — 执行导出任务，管理进度与取消
// ============================================================

import { BrowserWindow } from 'electron'
import type {
  AudioFadeSegment,
  MediaInfo,
  MediaOperation,
  ExportOptions,
  ExportRange,
  ProjectSettings,
  ResolutionPreset,
  TimelineClip,
  TimelineTransition,
  TrimParams,
  TransitionEffectType,
  TransformParams,
  VolumeParams,
  PitchParams
} from '../../shared/types'
import { IPC_CHANNELS } from '../../shared/types'
import {
  compareVideoOverlayOrder,
  getClipTimelineRange,
  getTimelineDuration,
  getVisibleDurationFromOps
} from '../../shared/timeline-utils'
import { runFFmpeg, type FFmpegProgress } from './ffmpeg'
import { buildFFmpegArgs } from './media-engine'
import {
  getAudioCodecArgs,
  getGifPaletteOptions,
  resolveAnimatedImageFps,
  resolveExportEncodingOptions,
  type ResolvedExportEncodingOptions
} from './export-quality'
import { buildAudioAdjustmentFilters } from './audio-filters'
import type { ChildProcess } from 'child_process'
import fs from 'fs/promises'

/** Resolution presets -> pixel dimensions */
const RESOLUTION_MAP: Record<ResolutionPreset, { w: number; h: number } | null> = {
  original: null,
  '1080p': { w: 1920, h: 1080 },
  '720p': { w: 1280, h: 720 },
  '480p': { w: 854, h: 480 }
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  canvas: {
    preset: 'source',
    width: 1920,
    height: 1080,
    backgroundColor: '#000000'
  }
}

function getProjectSettings(settings?: ProjectSettings): ProjectSettings {
  return {
    ...DEFAULT_PROJECT_SETTINGS,
    ...(settings || {}),
    canvas: {
      ...DEFAULT_PROJECT_SETTINGS.canvas,
      ...(settings?.canvas || {})
    }
  }
}

function resolveCanvasSize(
  videoClips: TimelineClip[],
  projectSettings?: ProjectSettings
): { w: number; h: number } | null {
  const settings = getProjectSettings(projectSettings)
  const first = videoClips[0]
  if (settings.canvas.preset === 'source' && first) {
    return { w: first.mediaInfo.width, h: first.mediaInfo.height }
  }

  const width = Math.max(16, Math.round(settings.canvas.width))
  const height = Math.max(16, Math.round(settings.canvas.height))
  return { w: width, h: height }
}

function resolveOutputSize(
  videoClips: TimelineClip[],
  resolution: { w: number; h: number } | null,
  projectSettings?: ProjectSettings
): { w: number; h: number } | null {
  const canvas = resolveCanvasSize(videoClips, projectSettings)
  if (!canvas) return null
  if (!resolution) return canvas
  const aspect = canvas.w / canvas.h
  const targetHeight = resolution.h
  return {
    w: Math.max(16, Math.round(targetHeight * aspect)),
    h: targetHeight
  }
}

function sanitizeColor(color: string | undefined): string {
  const value = color || '#000000'
  const match = value.match(/^#?([0-9a-fA-F]{6})$/)
  return match ? `0x${match[1]}` : '0x000000'
}

function getTransformParams(ops: MediaOperation[]): TransformParams {
  const op = ops.find((item) => item.type === 'transform')
  return {
    fit: 'contain',
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    opacity: 100,
    flipX: false,
    flipY: false,
    ...(op?.params as Partial<TransformParams> | undefined)
  }
}

function getAudioFadesForClip(
  clip: TimelineClip,
  operationsByClip: Record<string, MediaOperation[]>,
  audioFades: AudioFadeSegment[]
): Array<{ kind: AudioFadeSegment['kind']; start: number; duration: number }> {
  const range = getClipTimelineRange(clip, operationsByClip)
  return audioFades
    .filter((fade) => fade.clipId === clip.id)
    .map((fade) => {
      const start = Math.max(0, Math.min(fade.startOffset, range.visibleDuration))
      const end = Math.max(start, Math.min(fade.endOffset, range.visibleDuration))
      return { kind: fade.kind, start, duration: end - start }
    })
    .filter((fade) => fade.duration > 0.01)
}

function getTransitionTiming(
  transition: TimelineTransition,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): { start: number; end: number; boundary: number } | null {
  const left = clips.find((clip) => clip.id === transition.leftClipId)
  const right = clips.find((clip) => clip.id === transition.rightClipId)
  if (!left || !right) return null
  const leftRange = getClipTimelineRange(left, operationsByClip)
  const rightRange = getClipTimelineRange(right, operationsByClip)
  const boundary = (leftRange.end + rightRange.start) / 2
  const start = boundary + transition.startOffset
  const end = boundary + transition.endOffset
  if (end <= start + 0.01) return null
  return { start, end, boundary }
}

function transitionOpacityCurve(type: TransitionEffectType, direction: 'in' | 'out'): string {
  if (type === 'fadeblack' || type === 'fadewhite') return direction
  if (type === 'wipeleft' || type === 'wiperight' || type === 'slideleft' || type === 'slideright') return direction
  return direction
}

function addVideoTransitionFilters(
  filters: string[],
  clip: TimelineClip,
  clipRange: ReturnType<typeof getClipTimelineRange>,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  transitions: TimelineTransition[]
): void {
  transitions.forEach((transition) => {
    const timing = getTransitionTiming(transition, clips, operationsByClip)
    if (!timing) return
    const localStart = Math.max(0, timing.start - clipRange.start)
    const localEnd = Math.min(clipRange.visibleDuration, timing.end - clipRange.start)
    const duration = localEnd - localStart
    if (duration <= 0.01) return
    if (transition.leftClipId === clip.id) {
      filters.push(
        `fade=t=${transitionOpacityCurve(transition.type, 'out')}:st=${localStart.toFixed(3)}:d=${duration.toFixed(3)}:alpha=1`
      )
    } else if (transition.rightClipId === clip.id) {
      filters.push(
        `fade=t=${transitionOpacityCurve(transition.type, 'in')}:st=${localStart.toFixed(3)}:d=${duration.toFixed(3)}:alpha=1`
      )
    }
  })
}

function buildVideoScaleFilters(
  transform: TransformParams,
  outputSize: { w: number; h: number }
): string[] {
  const filters: string[] = []
  const scaleFactor = Math.max(0.1, Math.min(transform.scale || 1, 8))
  const targetW = Math.max(16, Math.round(outputSize.w * scaleFactor))
  const targetH = Math.max(16, Math.round(outputSize.h * scaleFactor))

  if (transform.fit === 'stretch') {
    filters.push(`scale=${targetW}:${targetH}`)
  } else if (transform.fit === 'cover') {
    filters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`)
    filters.push(`crop=${targetW}:${targetH}`)
  } else {
    filters.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`)
  }

  if (transform.rotation === 90) filters.push('transpose=1')
  if (transform.rotation === 180) filters.push('hflip,vflip')
  if (transform.rotation === 270) filters.push('transpose=2')
  if (transform.flipX) filters.push('hflip')
  if (transform.flipY) filters.push('vflip')
  filters.push('format=rgba')

  const opacity = Math.max(0, Math.min(transform.opacity, 100)) / 100
  if (opacity < 0.999) {
    filters.push(`colorchannelmixer=aa=${opacity.toFixed(4)}`)
  }

  return filters
}

function buildOverlayExpr(transform: TransformParams): { x: string; y: string } {
  const x = Math.round(Number.isFinite(transform.x) ? transform.x : 0)
  const y = Math.round(Number.isFinite(transform.y) ? transform.y : 0)
  return {
    x: `(W-w)/2${x >= 0 ? `+${x}` : x}`,
    y: `(H-h)/2${y >= 0 ? `+${y}` : y}`
  }
}

export function sliceTimelineForRange(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  range?: ExportRange,
  transitions: TimelineTransition[] = [],
  audioFades: AudioFadeSegment[] = []
): {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  transitions: TimelineTransition[]
  audioFades: AudioFadeSegment[]
  duration: number
} {
  const timelineDuration = getTimelineDuration(clips, operationsByClip)
  if (!range) {
    return { clips, operationsByClip, transitions, audioFades, duration: timelineDuration }
  }

  const start = Math.max(0, Math.min(range.startTime, timelineDuration))
  const end = Math.max(start, Math.min(range.endTime, timelineDuration))
  const duration = Math.max(0, end - start)
  const nextClips: TimelineClip[] = []
  const nextOps: Record<string, MediaOperation[]> = {}

  clips.forEach((clip) => {
    const clipOps = operationsByClip[clip.id] || []
    const clipRange = getClipTimelineRange(clip, operationsByClip)
    const overlapStart = Math.max(start, clipRange.start)
    const overlapEnd = Math.min(end, clipRange.end)
    if (overlapEnd <= overlapStart + 0.0001) return

    const trimStart = clipRange.trimStart + (overlapStart - clipRange.start) * clipRange.speedRate
    const trimEnd = clipRange.trimStart + (overlapEnd - clipRange.start) * clipRange.speedRate
    const hasTrim = clipOps.some((op) => op.type === 'trim')
    const slicedOps = hasTrim
      ? clipOps.map((op) =>
          op.type === 'trim'
            ? {
                ...op,
                enabled: true,
                params: { startTime: trimStart, endTime: trimEnd } as TrimParams
              }
            : op
        )
      : [
          {
            id: `trim-${clip.id}`,
            type: 'trim' as const,
            enabled: true,
            params: { startTime: trimStart, endTime: trimEnd } as TrimParams
          },
          ...clipOps
        ]

    const slicedClip: TimelineClip = {
      ...clip,
      startTime: overlapStart - start,
      trimBoundStart: trimStart,
      trimBoundEnd: trimEnd
    }
    nextClips.push(slicedClip)
    nextOps[clip.id] = slicedOps
  })

  const keptIds = new Set(nextClips.map((clip) => clip.id))
  const nextTransitions = transitions.filter(
    (transition) => keptIds.has(transition.leftClipId) && keptIds.has(transition.rightClipId)
  )
  const nextAudioFades = audioFades.filter((fade) => keptIds.has(fade.clipId))

  return {
    clips: nextClips,
    operationsByClip: nextOps,
    transitions: nextTransitions,
    audioFades: nextAudioFades,
    duration
  }
}

let currentExportProcess: ChildProcess | null = null
let currentExportCancelled = false
const ETA_HISTORY_SIZE = 6

function formatEta(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  if (safe <= 0) return '即将完成'
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60

  if (hours > 0) {
    return `${hours}小时${minutes}分${secs}秒`
  }
  if (minutes > 0) {
    return `${minutes}分${secs}秒`
  }
  return `${secs}秒`
}

function calcEtaFromMediaRate(totalDuration: number, currentTime: number, elapsed: number): number | null {
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return null
  if (!Number.isFinite(currentTime) || currentTime <= 0.05) return null
  if (!Number.isFinite(elapsed) || elapsed <= 0.3) return null

  const mediaPerSecond = currentTime / elapsed
  if (!Number.isFinite(mediaPerSecond) || mediaPerSecond <= 0) return null

  const remaining = Math.max(0, totalDuration - currentTime)
  if (remaining <= 0.2) return 0
  const eta = remaining / mediaPerSecond
  return Number.isFinite(eta) ? eta : null
}

function calcEtaFromPercent(percent: number, elapsed: number): number | null {
  if (!Number.isFinite(percent) || percent <= 0.05 || percent >= 100) return null
  if (!Number.isFinite(elapsed) || elapsed <= 0.3) return null
  const eta = elapsed * (100 - percent) / percent
  return Number.isFinite(eta) ? eta : null
}

function clampEta(etaSeconds: number | null): number | null {
  if (etaSeconds === null) return null
  if (!Number.isFinite(etaSeconds) || etaSeconds < 0 || etaSeconds > 604800) return null
  return etaSeconds
}

function smoothEta(history: number[], etaSeconds: number): number {
  history.push(etaSeconds)
  if (history.length > ETA_HISTORY_SIZE) {
    history.shift()
  }
  const sorted = [...history].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function buildEta(
  totalDuration: number,
  currentTime: number,
  startedAt: number,
  percent: number,
  etaHistory: number[],
  lastEtaRef: { value: string }
): string {
  if (percent >= 99.6) return '即将完成'
  const elapsed = (Date.now() - startedAt) / 1000

  const etaPrimary = clampEta(calcEtaFromMediaRate(totalDuration, currentTime, elapsed))
  const etaFallback = clampEta(calcEtaFromPercent(percent, elapsed))
  const etaRaw = etaPrimary ?? etaFallback
  if (etaRaw === null) return lastEtaRef.value

  const etaStable = smoothEta(etaHistory, etaRaw)
  if (etaStable <= 1.2) return '即将完成'
  const etaText = formatEta(etaStable)
  lastEtaRef.value = etaText
  return etaText
}

async function runExportJob(
  args: string[],
  duration: number,
  outputPath: string,
  win: BrowserWindow
): Promise<void> {
  if (currentExportProcess) {
    throw new Error('已有导出任务正在运行')
  }

  const startedAt = Date.now()
  const etaHistory: number[] = []
  const lastEtaRef = { value: '' }
  const onProgress = (progress: FFmpegProgress): void => {
    if (win.isDestroyed()) return
    const normalizedPercent = Math.round(progress.percent * 100) / 100
    win.webContents.send(IPC_CHANNELS.EXPORT_PROGRESS, {
      percent: normalizedPercent,
      currentTime: progress.time,
      speed: progress.speed,
      eta: buildEta(duration, progress.time, startedAt, normalizedPercent, etaHistory, lastEtaRef)
    })
  }

  const { process, promise } = runFFmpeg(args, duration, onProgress)
  currentExportProcess = process
  currentExportCancelled = false

  try {
    await promise
    if (!currentExportCancelled && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_COMPLETE, outputPath)
    }
  } catch (error) {
    if (currentExportCancelled) {
      await fs.unlink(outputPath).catch(() => {})
      return
    }
    const message = formatExportError(error)
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_ERROR, message)
    }
    await fs.unlink(outputPath).catch(() => {})
    throw new Error(message)
  } finally {
    if (currentExportProcess === process) {
      currentExportProcess = null
    }
    currentExportCancelled = false
  }
}

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
  const encoding = resolveExportEncodingOptions(exportOptions)

  // Calculate effective duration for progress tracking
  const duration = getVisibleDurationFromOps(mediaInfo.duration, operations)

  const args = buildFFmpegArgs(
    mediaInfo.filePath,
    exportOptions.outputPath,
    operations,
    mediaInfo,
    { ...encoding, resolution, format: exportOptions.format, gifLoop: exportOptions.gifLoop }
  )

  await runExportJob(args, duration, exportOptions.outputPath, win)
}

/**
 * Start a timeline export job with multiple clips/tracks.
 */
export async function startTimelineExport(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  exportOptions: ExportOptions,
  win: BrowserWindow,
  transitions: TimelineTransition[] = [],
  audioFades: AudioFadeSegment[] = []
): Promise<void> {
  const resolution = RESOLUTION_MAP[exportOptions.resolution]
  const encoding = resolveExportEncodingOptions(exportOptions)

  const sliced = sliceTimelineForRange(clips, operationsByClip, exportOptions.range, transitions, audioFades)
  const videoClips = sliced.clips.filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const timelineDuration = sliced.duration
  const outputSize = resolveOutputSize(videoClips, resolution, exportOptions.projectSettings)

  const args = buildTimelineFFmpegArgs(
    sliced.clips,
    sliced.operationsByClip,
    exportOptions.outputPath,
    outputSize,
    timelineDuration,
    sliced.transitions,
    sliced.audioFades,
    encoding,
    exportOptions.format,
    exportOptions.gifLoop,
    exportOptions.projectSettings
  )

  await runExportJob(args, timelineDuration, exportOptions.outputPath, win)
}

/**
 * Cancel a running export
 */
export function cancelExport(): void {
  if (currentExportProcess) {
    currentExportCancelled = true
    currentExportProcess.kill('SIGTERM')
  }
}

export function buildTimelineFFmpegArgs(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  outputPath: string,
  outputSize: { w: number; h: number } | null,
  timelineDuration: number,
  transitions: TimelineTransition[],
  audioFades: AudioFadeSegment[],
  encoding: ResolvedExportEncodingOptions,
  format: ExportOptions['format'],
  gifLoop?: ExportOptions['gifLoop'],
  projectSettings?: ProjectSettings
): string[] {
  const args: string[] = ['-y']
  const audioOnlyFormat = isAudioFormat(format)
  const gifFormat = format === 'gif'
  const webpFormat = format === 'webp'
  const animatedImageFormat = gifFormat || webpFormat

  const inputs: TimelineClip[] = [...clips]
  inputs.forEach((clip) => {
    args.push('-i', clip.filePath)
  })

  const filterParts: string[] = []
  const videoLabels: {
    label: string
    trackIndex: number
    startTime: number
    id: string
    overlayX: string
    overlayY: string
  }[] = []
  const audioLabels: string[] = []

  inputs.forEach((clip, index) => {
    const ops = operationsByClip[clip.id] || []
    const volume = ops.find((op) => op.type === 'volume' && op.enabled)
    const pitch = ops.find((op) => op.type === 'pitch' && op.enabled)
    const range = getClipTimelineRange(clip, operationsByClip)
    const { trimStart, trimEnd, speedRate } = range

    if (clip.track === 'video' && clip.mediaInfo.hasVideo && !audioOnlyFormat) {
      const transform = getTransformParams(ops)
      const vFilters: string[] = []
      vFilters.push(`trim=start=${trimStart}:end=${trimEnd}`)
      vFilters.push('setpts=PTS-STARTPTS')
      if (Math.abs(speedRate - 1) > 0.0001) {
        vFilters.push(`setpts=PTS/${speedRate}`)
      }
      if (outputSize) {
        vFilters.push(...buildVideoScaleFilters(transform, outputSize))
      }
      addVideoTransitionFilters(vFilters, clip, range, clips, operationsByClip, transitions)
      vFilters.push(`setpts=PTS+${clip.startTime}/TB`)
      filterParts.push(`[${index}:v]${vFilters.join(',')}[v${index}]`)
      const overlay = buildOverlayExpr(transform)
      videoLabels.push({
        label: `v${index}`,
        trackIndex: clip.trackIndex,
        startTime: clip.startTime,
        id: clip.id,
        overlayX: overlay.x,
        overlayY: overlay.y
      })
    }

    if (!animatedImageFormat && clip.track === 'audio' && clip.mediaInfo.hasAudio) {
      const aFilters: string[] = []
      aFilters.push(`atrim=start=${trimStart}:end=${trimEnd}`)
      aFilters.push('asetpts=PTS-STARTPTS')
      aFilters.push(...buildAudioAdjustmentFilters({
        speedRate,
        volumePercent: volume ? (volume.params as VolumeParams).percent : undefined,
        pitchPercent: pitch ? (pitch.params as PitchParams).percent : undefined,
          sampleRate: clip.mediaInfo.sampleRate
      }))
      getAudioFadesForClip(clip, operationsByClip, audioFades).forEach((fade) => {
        aFilters.push(`afade=t=${fade.kind}:st=${fade.start.toFixed(3)}:d=${fade.duration.toFixed(3)}`)
      })

      const delayMs = Math.max(0, Math.round(clip.startTime * 1000))
      // Use legacy-compatible list syntax instead of `all=1` for older FFmpeg builds.
      const adelayDelays = Array(16).fill(delayMs).join('|')
      aFilters.push(`adelay=${adelayDelays}`)
      filterParts.push(`[${index}:a]${aFilters.join(',')}[a${index}]`)
      audioLabels.push(`a${index}`)
    }
  })

  let videoOutLabel = ''
  if (videoLabels.length > 0 && outputSize) {
    const bg = sanitizeColor(getProjectSettings(projectSettings).canvas.backgroundColor)
    filterParts.push(`color=c=${bg}:s=${outputSize.w}x${outputSize.h}:d=${timelineDuration}[base]`)
    const sortedVideo = videoLabels
      .slice()
      .sort(compareVideoOverlayOrder)
    let current = 'base'
    sortedVideo.forEach((item, idx) => {
      const next = `vout${idx}`
      filterParts.push(
        `[${current}][${item.label}]overlay=x='${item.overlayX}':y='${item.overlayY}':eof_action=pass[${next}]`
      )
      current = next
    })
    videoOutLabel = current
  }

  if (gifFormat && videoOutLabel) {
    const gifFps = resolveAnimatedImageFps(
      clips
        .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
        .map((clip) => clip.mediaInfo.fps),
      encoding.animatedFps
    )
    const palette = getGifPaletteOptions(encoding)
    filterParts.push(
      `[${videoOutLabel}]fps=${gifFps},split[g0][g1];[g0]palettegen=${palette.palettegen}[pal];[g1][pal]paletteuse=${palette.paletteuse}[gifout]`
    )
    videoOutLabel = 'gifout'
  } else if (webpFormat && videoOutLabel) {
    const webpFps = resolveAnimatedImageFps(
      clips
        .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
        .map((clip) => clip.mediaInfo.fps),
      encoding.animatedFps
    )
    filterParts.push(`[${videoOutLabel}]fps=${webpFps}[webpout]`)
    videoOutLabel = 'webpout'
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
    if (animatedImageFormat) {
      args.push('-loop', gifLoop === 'once' ? '1' : '0')
      if (webpFormat) {
        // Use libwebp for broader FFmpeg compatibility across bundled builds.
        args.push(
          '-c:v', 'libwebp',
          '-lossless', '0',
          '-quality', String(encoding.webpQuality),
          '-compression_level', String(encoding.webpCompressionLevel)
        )
      }
    } else if (format === 'webm') {
      args.push('-c:v', 'libvpx-vp9')
      args.push('-cpu-used', String(encoding.vp9CpuUsed))
      if (encoding.videoBitrateKbps) {
        args.push('-b:v', `${encoding.videoBitrateKbps}k`)
      } else {
        args.push('-b:v', '0', '-crf', String(encoding.vp9Crf))
      }
    } else {
      args.push('-c:v', 'libx264', '-preset', encoding.h264Preset)
      if (encoding.videoBitrateKbps) {
        args.push('-b:v', `${encoding.videoBitrateKbps}k`)
      } else {
        args.push('-crf', String(encoding.crf))
      }
    }
  } else {
    args.push('-vn')
  }

  if (animatedImageFormat) {
    args.push('-an')
  } else if (audioOutLabel) {
    args.push('-map', `[${audioOutLabel}]`)
    args.push(...getAudioCodecArgs(
      format,
      encoding,
      clips
        .filter((clip) => clip.track === 'audio' && clip.mediaInfo.hasAudio)
        .map((clip) => clip.mediaInfo.sampleRate)
    ))
  } else {
    args.push('-an')
  }

  if (format === 'mp4' || format === 'mov') {
    args.push('-movflags', '+faststart')
  }
  args.push(outputPath)
  return args
}

function formatExportError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown export error'
  const message = error.message || ''
  if (/Unknown encoder|Encoder .* not found/i.test(message)) {
    return `当前 FFmpeg 缺少所需编码器，导出失败。${message}`
  }
  return message
}

function isAudioFormat(format: ExportOptions['format']): boolean {
  return ['mp3', 'wav', 'flac', 'aac', 'opus'].includes(format)
}
