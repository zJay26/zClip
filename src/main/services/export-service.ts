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
  TransformParams,
  VolumeParams,
  PitchParams,
  FadeParams
} from '../../shared/types'
import { IPC_CHANNELS } from '../../shared/types'
import {
  compareVideoOverlayOrder,
  getClipTimelineRange,
  getTimelineDuration,
  getVisibleDurationFromOps
} from '../../shared/timeline-utils'
import { probe, runFFmpeg, terminateProcess, type FFmpegProgress } from './ffmpeg'
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
import path from 'path'
import { randomUUID } from 'crypto'
import os from 'os'
import { authorizeMediaPath } from '../security/media-access'

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
  const first = videoClips
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.trackIndex - b.trackIndex || a.id.localeCompare(b.id))[0]
  if (settings.canvas.preset === 'source' && first) {
    return { w: first.mediaInfo.width, h: first.mediaInfo.height }
  }

  const width = Math.max(16, Math.round(settings.canvas.width))
  const height = Math.max(16, Math.round(settings.canvas.height))
  return { w: Math.round(width / 2) * 2, h: Math.round(height / 2) * 2 }
}

export function resolveProjectFrameRate(clips: TimelineClip[], projectSettings?: ProjectSettings): number {
  const configured = projectSettings?.frameRate
  if (typeof configured === 'number' && Number.isFinite(configured)) {
    return Math.max(1, Math.min(240, configured))
  }
  const sourceFps = clips
    .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
    .sort((a, b) => a.startTime - b.startTime || a.trackIndex - b.trackIndex || a.id.localeCompare(b.id))[0]
    ?.mediaInfo.fps
  return sourceFps && Number.isFinite(sourceFps) ? Math.max(1, Math.min(240, sourceFps)) : 30
}

export function resolveOutputSize(
  videoClips: TimelineClip[],
  resolution: { w: number; h: number } | null,
  projectSettings?: ProjectSettings
): { w: number; h: number } | null {
  const canvas = resolveCanvasSize(videoClips, projectSettings)
  if (!canvas) return null
  if (!resolution) return canvas
  const aspect = canvas.w / canvas.h
  const targetShortEdge = resolution.h
  const rawWidth = aspect >= 1 ? targetShortEdge * aspect : targetShortEdge
  const rawHeight = aspect >= 1 ? targetShortEdge : targetShortEdge / aspect
  return {
    w: Math.max(16, Math.round(rawWidth / 2) * 2),
    h: Math.max(16, Math.round(rawHeight / 2) * 2)
  }
}

function sanitizeColor(color: string | undefined): string {
  const value = color || '#000000'
  const match = value.match(/^#?([0-9a-fA-F]{6})$/)
  return match ? `0x${match[1]}` : '0x000000'
}

function getTransformParams(ops: MediaOperation[]): TransformParams {
  const op = ops.find((item) => item.type === 'transform' && item.enabled)
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

function getEffectiveAudioClips(clips: TimelineClip[]): TimelineClip[] {
  const explicitAudioGroupIds = new Set(
    clips
      .filter((clip) => clip.track === 'audio' && clip.mediaInfo.hasAudio)
      .map((clip) => clip.groupId)
  )
  return clips.filter((clip) =>
    clip.mediaInfo.hasAudio &&
    (clip.track === 'audio' || !explicitAudioGroupIds.has(clip.groupId))
  )
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
    if (transition.type === 'crossfade' && transition.leftClipId === clip.id) {
      filters.push(
        `fade=t=out:st=${localStart.toFixed(3)}:d=${duration.toFixed(3)}:alpha=1`
      )
    } else if (transition.type === 'crossfade' && transition.rightClipId === clip.id) {
      filters.push(
        `fade=t=in:st=${localStart.toFixed(3)}:d=${duration.toFixed(3)}:alpha=1`
      )
    } else if ((transition.type === 'fadeblack' || transition.type === 'fadewhite')) {
      const halfDuration = duration / 2
      if (transition.leftClipId === clip.id) {
        filters.push(`fade=t=out:st=${localStart.toFixed(3)}:d=${halfDuration.toFixed(3)}:alpha=1`)
      } else if (transition.rightClipId === clip.id) {
        filters.push(`fade=t=in:st=${(localStart + halfDuration).toFixed(3)}:d=${halfDuration.toFixed(3)}:alpha=1`)
      }
    } else if (transition.rightClipId === clip.id && (transition.type === 'wipeleft' || transition.type === 'wiperight')) {
      const progress = `clip((T-${localStart.toFixed(3)})/${duration.toFixed(3)},0,1)`
      const visible = transition.type === 'wipeleft'
        ? `gte(X/W,1-${progress})`
        : `lte(X/W,${progress})`
      filters.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${visible},alpha(X,Y),0)'`
      )
    }
  })
}

function addVideoFadeFilters(filters: string[], ops: MediaOperation[], visibleDuration: number): void {
  const fade = ops.find((item) => item.type === 'fade' && item.enabled)
  if (!fade) return
  const params = fade.params as FadeParams
  const fadeIn = Math.max(0, Math.min(params.fadeIn, visibleDuration))
  const fadeOut = Math.max(0, Math.min(params.fadeOut, visibleDuration))
  if (fadeIn > 0.01) filters.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}:alpha=1`)
  if (fadeOut > 0.01) {
    filters.push(`fade=t=out:st=${Math.max(0, visibleDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`)
  }
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
  filters.push('setsar=1')
  filters.push('format=rgba')

  const opacity = Math.max(0, Math.min(transform.opacity, 100)) / 100
  if (opacity < 0.999) {
    filters.push(`colorchannelmixer=aa=${opacity.toFixed(4)}`)
  }

  return filters
}

function buildOverlayExpr(
  transform: TransformParams,
  clip: TimelineClip,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  transitions: TimelineTransition[],
  outputSize: { w: number; h: number },
  projectSettings?: ProjectSettings
): { x: string; y: string } {
  const logicalCanvas = resolveCanvasSize(
    clips.filter((item) => item.track === 'video' && item.mediaInfo.hasVideo),
    projectSettings
  ) || outputSize
  const x = Math.round((Number.isFinite(transform.x) ? transform.x : 0) * outputSize.w / logicalCanvas.w)
  const y = Math.round((Number.isFinite(transform.y) ? transform.y : 0) * outputSize.h / logicalCanvas.h)
  const baseX = `(W-w)/2${x >= 0 ? `+${x}` : x}`
  const slide = transitions.find((transition) =>
    transition.rightClipId === clip.id && (transition.type === 'slideleft' || transition.type === 'slideright')
  )
  let xExpression = baseX
  if (slide) {
    const timing = getTransitionTiming(slide, clips, operationsByClip)
    if (timing) {
      const duration = Math.max(0.01, timing.end - timing.start)
      const progress = `min(max((t-${timing.start.toFixed(3)})/${duration.toFixed(3)},0),1)`
      xExpression = slide.type === 'slideleft'
        ? `${baseX}+(1-${progress})*W`
        : `${baseX}-(1-${progress})*W`
    }
  }
  return {
    x: xExpression,
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
  const slicedById = new Map(nextClips.map((clip) => [clip.id, clip]))
  const originalById = new Map(clips.map((clip) => [clip.id, clip]))
  const nextAudioFades = audioFades.flatMap((fade) => {
    const original = originalById.get(fade.clipId)
    const slicedClip = slicedById.get(fade.clipId)
    if (!original || !slicedClip) return []
    const originalRange = getClipTimelineRange(original, operationsByClip)
    const slicedRange = getClipTimelineRange(slicedClip, nextOps)
    const removedVisibleStart = Math.max(0, start - originalRange.start)
    const startOffset = Math.max(0, Math.min(slicedRange.visibleDuration, fade.startOffset - removedVisibleStart))
    const endOffset = Math.max(startOffset, Math.min(slicedRange.visibleDuration, fade.endOffset - removedVisibleStart))
    return endOffset - startOffset > 0.01 ? [{ ...fade, startOffset, endOffset }] : []
  })

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
let currentExportAbortController: AbortController | null = null
let currentExportSettled: Promise<void> | null = null
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
  win: BrowserWindow,
  expectedStreamKind: 'video' | 'audio'
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

  const extension = path.extname(outputPath)
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, extension)}.${randomUUID()}.partial${extension}`
  )
  const actualArgs = [...args]
  if (actualArgs[actualArgs.length - 1] !== outputPath) throw new Error('导出命令的输出路径不一致')
  actualArgs[actualArgs.length - 1] = tempPath

  const { process, promise } = runFFmpeg(actualArgs, duration, onProgress)
  const verificationController = new AbortController()
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  currentExportProcess = process
  currentExportCancelled = false
  currentExportAbortController = verificationController
  currentExportSettled = settled

  try {
    await promise
    if (currentExportCancelled) {
      await fs.unlink(tempPath).catch(() => {})
      return
    }
    const stat = await fs.stat(tempPath)
    if (!stat.isFile() || stat.size <= 0) throw new Error('导出文件为空')
    const metadata = await probe(tempPath, {
      timeoutMs: 30_000,
      signal: verificationController.signal
    })
    if (
      !Array.isArray(metadata.streams) ||
      !metadata.streams.some((stream) =>
        stream && typeof stream === 'object' &&
        (stream as Record<string, unknown>).codec_type === expectedStreamKind
      )
    ) {
      throw new Error(`导出文件没有预期的${expectedStreamKind === 'video' ? '视频' : '音频'}流`)
    }
    if (currentExportCancelled) {
      await fs.unlink(tempPath).catch(() => {})
      return
    }
    await commitExportOutput(tempPath, outputPath)
    authorizeMediaPath(outputPath)
    if (!currentExportCancelled && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_COMPLETE, outputPath)
    }
  } catch (error) {
    if (currentExportCancelled) {
      await fs.unlink(tempPath).catch(() => {})
      return
    }
    const message = formatExportError(error)
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_ERROR, message)
    }
    await fs.unlink(tempPath).catch(() => {})
    throw new Error(message)
  } finally {
    if (currentExportProcess === process) {
      currentExportProcess = null
      currentExportAbortController = null
      currentExportSettled = null
    }
    currentExportCancelled = false
    resolveSettled()
  }
}

export async function commitExportOutput(tempPath: string, outputPath: string): Promise<void> {
  const backupPath = `${outputPath}.${randomUUID()}.bak`
  let hasBackup = false
  try {
    // Windows rejects FlushFileBuffers for a read-only handle. Open the
    // completed temporary file read/write so the durability barrier works on
    // every supported platform before we replace the visible destination.
    const handle = await fs.open(tempPath, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.copyFile(outputPath, backupPath)
      hasBackup = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.rename(tempPath, outputPath)
    if (hasBackup) await fs.unlink(backupPath).catch(() => {})
  } catch (error) {
    if (hasBackup) {
      const outputExists = await fs.stat(outputPath).then(() => true).catch(() => false)
      if (!outputExists) await fs.rename(backupPath, outputPath).catch(() => {})
      else await fs.unlink(backupPath).catch(() => {})
    }
    throw error
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

  await runExportJob(
    args,
    duration,
    exportOptions.outputPath,
    win,
    isAudioFormat(exportOptions.format) || !mediaInfo.hasVideo ? 'audio' : 'video'
  )
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
  const hasAudio = getEffectiveAudioClips(sliced.clips).length > 0
  const audioOnlyFormat = isAudioFormat(exportOptions.format)
  if (!Number.isFinite(timelineDuration) || timelineDuration <= 0.001) {
    throw new Error('导出范围内没有有效时长')
  }
  if (audioOnlyFormat ? !hasAudio : videoClips.length === 0) {
    throw new Error(audioOnlyFormat ? '导出范围内没有音频内容' : '导出范围内没有视频内容')
  }
  const outputSize = resolveOutputSize(videoClips, resolution, exportOptions.projectSettings)

  const compiledArgs = buildTimelineFFmpegArgs(
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

  const materialized = await materializeFilterGraph(compiledArgs)
  try {
    await runExportJob(
      materialized.args,
      timelineDuration,
      exportOptions.outputPath,
      win,
      audioOnlyFormat ? 'audio' : 'video'
    )
  } finally {
    if (materialized.scriptPath) await fs.unlink(materialized.scriptPath).catch(() => {})
  }
}

export async function materializeFilterGraph(
  args: string[],
  threshold = 8_000
): Promise<{ args: string[]; scriptPath: string | null }> {
  const filterIndex = args.indexOf('-filter_complex')
  if (filterIndex < 0 || typeof args[filterIndex + 1] !== 'string' || args[filterIndex + 1].length < threshold) {
    return { args, scriptPath: null }
  }
  const scriptPath = path.join(os.tmpdir(), `zclip-filter-${process.pid}-${randomUUID()}.txt`)
  await fs.writeFile(scriptPath, args[filterIndex + 1], { encoding: 'utf8', flag: 'wx' })
  const next = [...args]
  next.splice(filterIndex, 2, '-filter_complex_script', scriptPath)
  return { args: next, scriptPath }
}

/**
 * Cancel a running export
 */
export async function cancelExport(): Promise<void> {
  const process = currentExportProcess
  const settled = currentExportSettled
  if (!process && !settled) return
  currentExportCancelled = true
  currentExportAbortController?.abort()
  if (process) terminateProcess(process)
  if (!settled) return
  let timeout: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, 10_000)
    timeout.unref()
  })
  await Promise.race([settled, timeoutPromise])
  if (timeout) clearTimeout(timeout)
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
  const effectiveAudioIds = new Set(getEffectiveAudioClips(inputs).map((clip) => clip.id))
  const inputPaths = Array.from(new Set(inputs.map((clip) => clip.filePath)))
  inputPaths.forEach((filePath) => args.push('-i', filePath))
  const filterParts: string[] = []
  const videoSourceByClip = new Map<string, string>()
  const audioSourceByClip = new Map<string, string>()
  inputPaths.forEach((filePath, inputIndex) => {
    const videoConsumers = inputs.filter((clip) =>
      clip.filePath === filePath && clip.track === 'video' && clip.mediaInfo.hasVideo && !audioOnlyFormat
    )
    const audioConsumers = inputs.filter((clip) =>
      clip.filePath === filePath && effectiveAudioIds.has(clip.id) && !animatedImageFormat
    )
    if (videoConsumers.length > 1) {
      const labels = videoConsumers.map((_, index) => `srcv${inputIndex}_${index}`)
      filterParts.push(`[${inputIndex}:v]split=${labels.length}${labels.map((label) => `[${label}]`).join('')}`)
      videoConsumers.forEach((clip, index) => videoSourceByClip.set(clip.id, labels[index]))
    } else if (videoConsumers.length === 1) {
      videoSourceByClip.set(videoConsumers[0].id, `${inputIndex}:v`)
    }
    if (audioConsumers.length > 1) {
      const labels = audioConsumers.map((_, index) => `srca${inputIndex}_${index}`)
      filterParts.push(`[${inputIndex}:a]asplit=${labels.length}${labels.map((label) => `[${label}]`).join('')}`)
      audioConsumers.forEach((clip, index) => audioSourceByClip.set(clip.id, labels[index]))
    } else if (audioConsumers.length === 1) {
      audioSourceByClip.set(audioConsumers[0].id, `${inputIndex}:a`)
    }
  })
  const frameRate = resolveProjectFrameRate(clips, projectSettings)
  const overlayOutputSize = outputSize || resolveCanvasSize(
    clips.filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo),
    projectSettings
  ) || { w: 1920, h: 1080 }
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
      addVideoFadeFilters(vFilters, ops, range.visibleDuration)
      addVideoTransitionFilters(vFilters, clip, range, clips, operationsByClip, transitions)
      vFilters.push(`setpts=PTS+${clip.startTime}/TB`)
      const sourceLabel = videoSourceByClip.get(clip.id)
      if (!sourceLabel) throw new Error(`视频片段缺少输入流：${clip.id}`)
      filterParts.push(`[${sourceLabel}]${vFilters.join(',')}[v${index}]`)
      const overlay = buildOverlayExpr(
        transform,
        clip,
        clips,
        operationsByClip,
        transitions,
        overlayOutputSize,
        projectSettings
      )
      videoLabels.push({
        label: `v${index}`,
        trackIndex: clip.trackIndex,
        startTime: clip.startTime,
        id: clip.id,
        overlayX: overlay.x,
        overlayY: overlay.y
      })
    }

    if (!animatedImageFormat && effectiveAudioIds.has(clip.id)) {
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
      const sourceLabel = audioSourceByClip.get(clip.id)
      if (!sourceLabel) throw new Error(`音频片段缺少输入流：${clip.id}`)
      filterParts.push(`[${sourceLabel}]${aFilters.join(',')}[a${index}]`)
      audioLabels.push(`a${index}`)
    }
  })

  let videoOutLabel = ''
  if (videoLabels.length > 0 && outputSize) {
    const bg = sanitizeColor(getProjectSettings(projectSettings).canvas.backgroundColor)
    filterParts.push(`color=c=${bg}:s=${outputSize.w}x${outputSize.h}:r=${frameRate}:d=${timelineDuration}[base]`)
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

    transitions.forEach((transition, transitionIndex) => {
      if (transition.type !== 'fadeblack' && transition.type !== 'fadewhite') return
      const timing = getTransitionTiming(transition, clips, operationsByClip)
      if (!timing || timing.end <= 0 || timing.start >= timelineDuration) return
      const start = Math.max(0, timing.start)
      const end = Math.min(timelineDuration, timing.end)
      const duration = end - start
      if (duration <= 0.02) return
      const half = duration / 2
      const matte = `matte${transitionIndex}`
      const next = `matteout${transitionIndex}`
      const color = transition.type === 'fadewhite' ? 'white' : 'black'
      filterParts.push(
        `color=c=${color}:s=${outputSize.w}x${outputSize.h}:r=${frameRate}:d=${duration},format=rgba,` +
        `fade=t=in:st=0:d=${half.toFixed(3)}:alpha=1,` +
        `fade=t=out:st=${half.toFixed(3)}:d=${half.toFixed(3)}:alpha=1,` +
        `setpts=PTS+${start.toFixed(3)}/TB[${matte}]`
      )
      filterParts.push(`[${videoOutLabel}][${matte}]overlay=eof_action=pass[${next}]`)
      videoOutLabel = next
    })
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
  } else if (videoOutLabel) {
    filterParts.push(`[${videoOutLabel}]fps=${frameRate},format=yuv420p[vfinal]`)
    videoOutLabel = 'vfinal'
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
          `${inputsConcat}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95,atrim=0:${timelineDuration},asetpts=PTS-STARTPTS[aout]`
        )
        audioOutLabel = 'aout'
      } else {
        filterParts.push(
          `${inputsConcat}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`
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
      args.push('-pix_fmt', 'yuv420p')
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
        .filter((clip) => effectiveAudioIds.has(clip.id))
        .map((clip) => clip.mediaInfo.sampleRate)
    ))
  } else {
    args.push('-an')
  }

  if (format === 'mp4' || format === 'mov') {
    args.push('-movflags', '+faststart')
  }
  args.push('-map_metadata', '-1')
  if (timelineDuration > 0) args.push('-t', timelineDuration.toFixed(3))
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
