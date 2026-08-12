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
import { getTimelineTransitionTiming } from '../../shared/transition-utils'
import { getEffectiveTimelineAudioClips } from '../../shared/audio-utils'
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
import {
  detectPreferredH264Encoder,
  getH264EncoderArgs,
  getVp9ParallelArgs,
  type H264EncoderKind
} from './hardware-encoder'

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

function getVideoTransitionExtension(
  clip: TimelineClip,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  transitions: TimelineTransition[]
): { startPadding: number; endPadding: number; effectiveStart: number } {
  let startPadding = 0
  let endPadding = 0
  transitions.forEach((transition) => {
    const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
    if (!timing) return
    if (transition.rightClipId === clip.id) {
      startPadding = Math.max(startPadding, timing.boundary - timing.start)
    }
    if (transition.leftClipId === clip.id) {
      endPadding = Math.max(endPadding, timing.end - timing.boundary)
    }
  })
  return {
    startPadding,
    endPadding,
    effectiveStart: clip.startTime - startPadding
  }
}

function addVideoTransitionFilters(
  filters: string[],
  clip: TimelineClip,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  transitions: TimelineTransition[],
  effectiveStart: number
): void {
  transitions.forEach((transition) => {
    const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
    if (!timing) return
    const localStart = timing.start - effectiveStart
    const localBoundary = timing.boundary - effectiveStart
    const localEnd = timing.end - effectiveStart
    const duration = localEnd - localStart
    if (duration <= 0.01) return
    if (transition.type === 'crossfade' && transition.rightClipId === clip.id) {
      // Right is overlaid after left. Fading only the right layer in yields
      // left*(1-progress) + right*progress without exposing the canvas.
      filters.push(
        `fade=t=in:st=${localStart.toFixed(3)}:d=${duration.toFixed(3)}:alpha=1`
      )
    } else if (
      (transition.type === 'fadeblack' || transition.type === 'fadewhite') &&
      transition.rightClipId === clip.id
    ) {
      // Keep the incoming frame transparent until the opaque matte covers the
      // cut, then reveal it immediately underneath the matte.
      filters.push(`fade=t=in:st=${localBoundary.toFixed(3)}:d=0.010:alpha=1`)
    } else if (transition.rightClipId === clip.id && (transition.type === 'wipeleft' || transition.type === 'wiperight')) {
      const progress = `clip((T-${localStart.toFixed(3)})/${duration.toFixed(3)},0,1)`
      const visible = transition.type === 'wipeleft'
        ? `gte(X/W,1-${progress})`
        : `lte(X/W,${progress})`
      // geq is one of FFmpeg's most expensive per-pixel filters. The incoming
      // clip is already extended to the transition start, so keep it transparent
      // before the wipe and only evaluate geq while the wipe is actually moving.
      // After localEnd the unmodified, fully opaque frames pass through.
      if (localStart > 0.001) {
        filters.push(`colorchannelmixer=aa=0:enable='lt(t,${localStart.toFixed(3)})'`)
      }
      filters.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(${visible},alpha(X,Y),0)':` +
        `enable='between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})'`
      )
    }
  })
}

function addVideoFadeFilters(
  filters: string[],
  ops: MediaOperation[],
  visibleDuration: number,
  startPadding = 0
): void {
  const fade = ops.find((item) => item.type === 'fade' && item.enabled)
  if (!fade) return
  const params = fade.params as FadeParams
  const fadeIn = Math.max(0, Math.min(params.fadeIn, visibleDuration))
  const fadeOut = Math.max(0, Math.min(params.fadeOut, visibleDuration))
  if (fadeIn > 0.01) filters.push(`fade=t=in:st=${startPadding.toFixed(3)}:d=${fadeIn.toFixed(3)}:alpha=1`)
  if (fadeOut > 0.01) {
    filters.push(`fade=t=out:st=${Math.max(0, startPadding + visibleDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`)
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

function isDefaultSequenceTransform(transform: TransformParams): boolean {
  return transform.fit === 'contain' &&
    Math.abs(transform.scale - 1) < 0.0001 &&
    Math.abs(transform.x) < 0.0001 &&
    Math.abs(transform.y) < 0.0001 &&
    transform.rotation === 0 &&
    Math.abs(transform.opacity - 100) < 0.0001 &&
    !transform.flipX &&
    !transform.flipY
}

function buildSequenceScaleFilters(
  outputSize: { w: number; h: number },
  backgroundColor: string
): string[] {
  return [
    `scale=${outputSize.w}:${outputSize.h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${outputSize.w}:${outputSize.h}:(ow-iw)/2:(oh-ih)/2:color=${backgroundColor}`,
    'setsar=1',
    'format=yuv420p'
  ]
}

function canUseSequentialVideoFastPath(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  transitions: TimelineTransition[],
  outputSize: { w: number; h: number } | null,
  timelineDuration: number,
  audioOnlyFormat: boolean,
  projectSettings?: ProjectSettings
): boolean {
  if (audioOnlyFormat || !outputSize || transitions.length > 0) return false
  const videoClips = clips
    .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
    .slice()
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
  if (videoClips.length === 0) return false
  const trackIndex = videoClips[0].trackIndex
  const tolerance = 1 / Math.max(1, resolveProjectFrameRate(clips, projectSettings))
  let expectedStart = 0
  for (const clip of videoClips) {
    const ops = operationsByClip[clip.id] || []
    const fade = ops.find((operation) => operation.type === 'fade' && operation.enabled)
    const fadeParams = fade?.params as FadeParams | undefined
    const hasVisibleFade = Boolean(
      fadeParams && (fadeParams.fadeIn > 0.01 || fadeParams.fadeOut > 0.01)
    )
    const transform = getTransformParams(ops)
    if (clip.trackIndex !== trackIndex || hasVisibleFade || !isDefaultSequenceTransform(transform)) return false
    if (Math.abs(clip.startTime - expectedStart) > tolerance) return false
    expectedStart = clip.startTime + getClipTimelineRange(clip, operationsByClip).visibleDuration
  }
  return Math.abs(expectedStart - timelineDuration) <= tolerance
}

interface TimelineInputWindow {
  filePath: string
  seekStart: number
  seekEnd: number
  speedRate: number
  clips: TimelineClip[]
}

function buildTimelineInputWindows(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  effectiveAudioIds: Set<string>,
  audioOnlyFormat: boolean
): TimelineInputWindow[] {
  const relevant = clips.filter((clip) =>
    (!audioOnlyFormat && clip.track === 'video' && clip.mediaInfo.hasVideo) || effectiveAudioIds.has(clip.id)
  )
  const sorted = relevant.slice().sort((a, b) => {
    const pathOrder = a.filePath.localeCompare(b.filePath)
    if (pathOrder !== 0) return pathOrder
    const aRange = getClipTimelineRange(a, operationsByClip)
    const bRange = getClipTimelineRange(b, operationsByClip)
    return aRange.speedRate - bRange.speedRate || aRange.trimStart - bRange.trimStart || a.id.localeCompare(b.id)
  })
  const windows: TimelineInputWindow[] = []
  const maxMergeGapSeconds = 0.25
  for (const clip of sorted) {
    const range = getClipTimelineRange(clip, operationsByClip)
    let candidate: TimelineInputWindow | undefined
    for (let index = windows.length - 1; index >= 0; index -= 1) {
      const window = windows[index]
      if (
        window.filePath === clip.filePath &&
        Math.abs(window.speedRate - range.speedRate) < 0.0001 &&
        range.trimStart <= window.seekEnd + maxMergeGapSeconds
      ) {
        candidate = window
        break
      }
    }
    if (candidate) {
      candidate.seekStart = Math.min(candidate.seekStart, range.trimStart)
      candidate.seekEnd = Math.max(candidate.seekEnd, range.trimEnd)
      candidate.clips.push(clip)
    } else {
      windows.push({
        filePath: clip.filePath,
        seekStart: range.trimStart,
        seekEnd: range.trimEnd,
        speedRate: range.speedRate,
        clips: [clip]
      })
    }
  }
  return windows
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
    const timing = getTimelineTransitionTiming(slide, clips, operationsByClip)
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

interface ExportJobOptions {
  prepass?: {
    args: string[]
    duration: number
    outputPath: string
    progressWeight: number
  }
  fallbackArgs?: string[]
  cleanupPaths?: string[]
}

export async function runExportJob(
  args: string[],
  duration: number,
  outputPath: string,
  win: BrowserWindow,
  expectedStreamKind: 'video' | 'audio',
  format: ExportOptions['format'],
  options: ExportJobOptions = {}
): Promise<void> {
  if (currentExportProcess || currentExportSettled) {
    throw new Error('已有导出任务正在运行')
  }

  const startedAt = Date.now()
  const etaHistory: number[] = []
  const lastEtaRef = { value: '' }
  const onProgress = (progress: FFmpegProgress, offset: number, span: number): void => {
    if (win.isDestroyed()) return
    const mappedPercent = offset + progress.percent * span / 100
    const normalizedPercent = Math.round(mappedPercent * 100) / 100
    const mappedTime = duration * normalizedPercent / 100
    win.webContents.send(IPC_CHANNELS.EXPORT_PROGRESS, {
      percent: normalizedPercent,
      currentTime: mappedTime,
      speed: progress.speed,
      eta: buildEta(duration, mappedTime, startedAt, normalizedPercent, etaHistory, lastEtaRef)
    })
  }

  const extension = path.extname(outputPath)
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, extension)}.${randomUUID()}.partial${extension}`
  )
  const withOutputPath = (sourceArgs: string[], expectedPath: string, actualPath: string): string[] => {
    const next = [...sourceArgs]
    if (next[next.length - 1] !== expectedPath) throw new Error('导出命令的输出路径不一致')
    next[next.length - 1] = actualPath
    return next
  }
  const actualArgs = withOutputPath(args, outputPath, tempPath)
  const verificationController = new AbortController()
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  currentExportCancelled = false
  currentExportAbortController = verificationController
  currentExportSettled = settled

  const runStage = async (
    stageArgs: string[],
    stageDuration: number,
    progressOffset: number,
    progressSpan: number
  ): Promise<void> => {
    const launched = runFFmpeg(
      stageArgs,
      stageDuration,
      (progress) => onProgress(progress, progressOffset, progressSpan)
    )
    currentExportProcess = launched.process
    try {
      await launched.promise
    } finally {
      if (currentExportProcess === launched.process) currentExportProcess = null
    }
  }

  try {
    const prepassWeight = Math.max(0, Math.min(80, options.prepass?.progressWeight ?? 0))
    if (options.prepass) {
      await fs.unlink(options.prepass.outputPath).catch(() => {})
      await runStage(options.prepass.args, options.prepass.duration, 0, prepassWeight)
      const paletteStat = await fs.stat(options.prepass.outputPath)
      if (!paletteStat.isFile() || paletteStat.size <= 0) throw new Error('GIF 调色板生成失败')
      if (currentExportCancelled) return
    }

    try {
      await runStage(actualArgs, duration, prepassWeight, 100 - prepassWeight)
    } catch (error) {
      if (!options.fallbackArgs || currentExportCancelled) throw error
      // Runtime probing can succeed while a real project still hits a driver,
      // pixel-format or resolution limitation. Retry the exact same graph with
      // the software encoder before surfacing an error to the user.
      await fs.unlink(tempPath).catch(() => {})
      const fallbackActualArgs = withOutputPath(options.fallbackArgs, outputPath, tempPath)
      await runStage(fallbackActualArgs, duration, prepassWeight, 100 - prepassWeight)
    }
    if (currentExportCancelled) {
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
      return
    }
    const message = formatExportError(error, format)
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EXPORT_ERROR, message)
    }
    throw new Error(message)
  } finally {
    await fs.unlink(tempPath).catch(() => {})
    await Promise.all((options.cleanupPaths || []).map((cleanupPath) => fs.unlink(cleanupPath).catch(() => {})))
    if (currentExportSettled === settled) {
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
  const h264Encoder = mediaInfo.hasVideo && isH264Format(exportOptions.format)
    ? await detectPreferredH264Encoder()
    : 'software'
  const palettePath = exportOptions.format === 'gif'
    ? path.join(os.tmpdir(), `zclip-palette-${process.pid}-${randomUUID()}.png`)
    : null
  const args = buildFFmpegArgs(
    mediaInfo.filePath,
    exportOptions.outputPath,
    operations,
    mediaInfo,
    {
      ...encoding,
      resolution,
      format: exportOptions.format,
      gifLoop: exportOptions.gifLoop,
      gifPalettePass: palettePath ? { mode: 'use', palettePath } : undefined,
      h264Encoder
    }
  )
  const paletteArgs = palettePath
    ? buildFFmpegArgs(
        mediaInfo.filePath,
        palettePath,
        operations,
        mediaInfo,
        {
          ...encoding,
          resolution,
          format: exportOptions.format,
          gifLoop: exportOptions.gifLoop,
          gifPalettePass: { mode: 'generate', palettePath }
        }
      )
    : null
  const fallbackArgs = h264Encoder !== 'software'
    ? buildFFmpegArgs(
        mediaInfo.filePath,
        exportOptions.outputPath,
        operations,
        mediaInfo,
        {
          ...encoding,
          resolution,
          format: exportOptions.format,
          gifLoop: exportOptions.gifLoop,
          h264Encoder: 'software'
        }
      )
    : undefined

  await runExportJob(
    args,
    duration,
    exportOptions.outputPath,
    win,
    isAudioFormat(exportOptions.format) || !mediaInfo.hasVideo ? 'audio' : 'video',
    exportOptions.format,
    {
      fallbackArgs,
      ...(paletteArgs && palettePath
        ? {
          prepass: { args: paletteArgs, duration, outputPath: palettePath, progressWeight: 35 },
          cleanupPaths: [palettePath]
        }
        : {})
    }
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
  const hasAudio = getEffectiveTimelineAudioClips(sliced.clips).length > 0
  const audioOnlyFormat = isAudioFormat(exportOptions.format)
  if (!Number.isFinite(timelineDuration) || timelineDuration <= 0.001) {
    throw new Error('导出范围内没有有效时长')
  }
  if (audioOnlyFormat ? !hasAudio : videoClips.length === 0) {
    throw new Error(audioOnlyFormat ? '导出范围内没有音频内容' : '导出范围内没有视频内容')
  }
  const outputSize = resolveOutputSize(videoClips, resolution, exportOptions.projectSettings)
  const h264Encoder = !audioOnlyFormat && isH264Format(exportOptions.format)
    ? await detectPreferredH264Encoder()
    : 'software'

  const palettePath = exportOptions.format === 'gif'
    ? path.join(os.tmpdir(), `zclip-palette-${process.pid}-${randomUUID()}.png`)
    : null
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
    exportOptions.projectSettings,
    palettePath ? { mode: 'use', palettePath } : undefined,
    h264Encoder
  )
  const compiledPaletteArgs = palettePath
    ? buildTimelineFFmpegArgs(
        sliced.clips,
        sliced.operationsByClip,
        palettePath,
        outputSize,
        timelineDuration,
        sliced.transitions,
        sliced.audioFades,
        encoding,
        exportOptions.format,
        exportOptions.gifLoop,
        exportOptions.projectSettings,
        { mode: 'generate', palettePath },
        'software'
      )
    : null
  const compiledFallbackArgs = h264Encoder !== 'software'
    ? buildTimelineFFmpegArgs(
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
        exportOptions.projectSettings,
        undefined,
        'software'
      )
    : null

  const materialized = await materializeFilterGraph(compiledArgs)
  let materializedPalette: Awaited<ReturnType<typeof materializeFilterGraph>> | null = null
  let materializedFallback: Awaited<ReturnType<typeof materializeFilterGraph>> | null = null
  try {
    materializedPalette = compiledPaletteArgs
      ? await materializeFilterGraph(compiledPaletteArgs)
      : null
    materializedFallback = compiledFallbackArgs
      ? await materializeFilterGraph(compiledFallbackArgs)
      : null
    await runExportJob(
      materialized.args,
      timelineDuration,
      exportOptions.outputPath,
      win,
      audioOnlyFormat ? 'audio' : 'video',
      exportOptions.format,
      {
        fallbackArgs: materializedFallback?.args,
        ...(materializedPalette && palettePath
          ? {
            prepass: {
              args: materializedPalette.args,
              duration: timelineDuration,
              outputPath: palettePath,
              progressWeight: 35
            },
            cleanupPaths: [palettePath]
          }
          : {})
      }
    )
  } finally {
    if (materialized.scriptPath) await fs.unlink(materialized.scriptPath).catch(() => {})
    if (materializedPalette?.scriptPath) await fs.unlink(materializedPalette.scriptPath).catch(() => {})
    if (materializedFallback?.scriptPath) await fs.unlink(materializedFallback.scriptPath).catch(() => {})
    if (palettePath) await fs.unlink(palettePath).catch(() => {})
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
  projectSettings?: ProjectSettings,
  gifPalettePass?: { mode: 'generate' | 'use'; palettePath: string },
  h264Encoder: H264EncoderKind = 'software'
): string[] {
  const args: string[] = ['-y']
  const audioOnlyFormat = isAudioFormat(format)
  const gifFormat = format === 'gif'
  const webpFormat = format === 'webp'
  const animatedImageFormat = gifFormat || webpFormat

  const inputs: TimelineClip[] = [...clips]
  const effectiveAudioIds = new Set(getEffectiveTimelineAudioClips(inputs).map((clip) => clip.id))
  const frameRate = resolveProjectFrameRate(clips, projectSettings)
  const animatedFps = animatedImageFormat
    ? resolveAnimatedImageFps(
        clips
          .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
          .map((clip) => clip.mediaInfo.fps),
        encoding.animatedFps
      )
    : frameRate
  const sequentialVideoFastPath = canUseSequentialVideoFastPath(
    clips,
    operationsByClip,
    transitions,
    outputSize,
    timelineDuration,
    audioOnlyFormat,
    projectSettings
  )
  const filterParts: string[] = []
  const videoSourceByClip = new Map<string, string>()
  const audioSourceByClip = new Map<string, string>()
  const inputSeekStartByClip = new Map<string, number>()
  let inputCount = 0
  if (animatedImageFormat) {
    // A shared split source can retain decoded frames until every trimmed
    // consumer advances. With long/high-resolution sources this may exhaust
    // memory before the first WebP/GIF frame reaches the encoder. Animated
    // image exports have no audio, so give every visible video clip a bounded,
    // independently seeked input instead.
    inputs
      .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo && !audioOnlyFormat)
      .forEach((clip) => {
        const inputIndex = inputCount
        inputCount += 1
        const range = getClipTimelineRange(clip, operationsByClip)
        const sourceDuration = Math.max(0.001, range.trimEnd - range.trimStart)
        if (range.trimStart > 0.000_001) {
          args.push('-ss', range.trimStart.toFixed(6))
        }
        args.push('-t', sourceDuration.toFixed(6), '-i', clip.filePath)
        videoSourceByClip.set(clip.id, `${inputIndex}:v`)
        inputSeekStartByClip.set(clip.id, range.trimStart)
      })
  } else {
    const inputWindows = buildTimelineInputWindows(
      inputs,
      operationsByClip,
      effectiveAudioIds,
      audioOnlyFormat
    )
    inputWindows.forEach((window) => {
      const inputIndex = inputCount
      inputCount += 1
      if (window.seekStart > 0.000_001) args.push('-ss', window.seekStart.toFixed(6))
      args.push('-t', Math.max(0.001, window.seekEnd - window.seekStart).toFixed(6), '-i', window.filePath)
      window.clips.forEach((clip) => inputSeekStartByClip.set(clip.id, window.seekStart))
      const videoConsumers = window.clips.filter((clip) =>
        clip.track === 'video' && clip.mediaInfo.hasVideo && !audioOnlyFormat
      )
      const audioConsumers = window.clips.filter((clip) => effectiveAudioIds.has(clip.id))
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
  }
  let gifPaletteInputLabel = ''
  if (gifFormat && gifPalettePass?.mode === 'use') {
    gifPaletteInputLabel = `${inputCount}:v`
    args.push('-i', gifPalettePass.palettePath)
    inputCount += 1
  }
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
    const inputSeekStart = inputSeekStartByClip.get(clip.id) ?? 0

    if (clip.track === 'video' && clip.mediaInfo.hasVideo && !audioOnlyFormat) {
      const transform = getTransformParams(ops)
      const transitionExtension = getVideoTransitionExtension(
        clip,
        clips,
        operationsByClip,
        transitions
      )
      const vFilters: string[] = []
      const filterTrimStart = Math.max(0, trimStart - inputSeekStart)
      const filterTrimEnd = Math.max(filterTrimStart + 0.001, trimEnd - inputSeekStart)
      vFilters.push(`trim=start=${filterTrimStart}:end=${filterTrimEnd}`)
      vFilters.push('setpts=PTS-STARTPTS')
      if (Math.abs(speedRate - 1) > 0.0001) {
        vFilters.push(`setpts=PTS/${speedRate}`)
      }
      // Decimate after the speed PTS transform but before scaling, RGBA
      // conversion and compositing. A 16x clip otherwise makes those expensive
      // filters process roughly sixteen frames for every frame that survives.
      if (sequentialVideoFastPath || speedRate > 1.0001) {
        vFilters.push(`fps=${animatedFps}`)
      }
      if (outputSize) {
        vFilters.push(...(
          sequentialVideoFastPath
            ? buildSequenceScaleFilters(
                outputSize,
                sanitizeColor(getProjectSettings(projectSettings).canvas.backgroundColor)
              )
            : buildVideoScaleFilters(transform, outputSize)
        ))
      }
      if (transitionExtension.startPadding > 0.001 || transitionExtension.endPadding > 0.001) {
        vFilters.push(
          `tpad=start_mode=clone:start_duration=${transitionExtension.startPadding.toFixed(3)}:` +
          `stop_mode=clone:stop_duration=${transitionExtension.endPadding.toFixed(3)}`
        )
      }
      addVideoFadeFilters(vFilters, ops, range.visibleDuration, transitionExtension.startPadding)
      addVideoTransitionFilters(
        vFilters,
        clip,
        clips,
        operationsByClip,
        transitions,
        transitionExtension.effectiveStart
      )
      if (!sequentialVideoFastPath) {
        vFilters.push(`setpts=PTS+${transitionExtension.effectiveStart}/TB`)
      }
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
      const filterTrimStart = Math.max(0, trimStart - inputSeekStart)
      const filterTrimEnd = Math.max(filterTrimStart + 0.001, trimEnd - inputSeekStart)
      aFilters.push(`atrim=start=${filterTrimStart}:end=${filterTrimEnd}`)
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
  if (sequentialVideoFastPath && videoLabels.length > 0) {
    const sortedVideo = videoLabels.slice().sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id))
    if (sortedVideo.length === 1) {
      videoOutLabel = sortedVideo[0].label
    } else {
      videoOutLabel = 'vsequence'
      filterParts.push(
        `${sortedVideo.map((item) => `[${item.label}]`).join('')}concat=n=${sortedVideo.length}:v=1:a=0[${videoOutLabel}]`
      )
    }
  } else if (videoLabels.length > 0 && outputSize) {
    const bg = sanitizeColor(getProjectSettings(projectSettings).canvas.backgroundColor)
    filterParts.push(`color=c=${bg}:s=${outputSize.w}x${outputSize.h}:r=${frameRate}:d=${timelineDuration}[base]`)
    const sortedVideo = videoLabels
      .slice()
      .sort(compareVideoOverlayOrder)
    const mattesByRightClip = new Map<string, Array<{
      transition: TimelineTransition
      transitionIndex: number
      start: number
      end: number
      boundary: number
    }>>()
    transitions.forEach((transition, transitionIndex) => {
      if (transition.type !== 'fadeblack' && transition.type !== 'fadewhite') return
      const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
      if (!timing || timing.end <= 0 || timing.start >= timelineDuration) return
      const start = Math.max(0, timing.start)
      const end = Math.min(timelineDuration, timing.end)
      if (end - start <= 0.02) return
      const entry = {
        transition,
        transitionIndex,
        start,
        end,
        boundary: Math.max(start, Math.min(end, timing.boundary))
      }
      const entries = mattesByRightClip.get(transition.rightClipId)
      if (entries) entries.push(entry)
      else mattesByRightClip.set(transition.rightClipId, [entry])
    })
    let current = 'base'
    sortedVideo.forEach((item, idx) => {
      const next = `vout${idx}`
      filterParts.push(
        `[${current}][${item.label}]overlay=x='${item.overlayX}':y='${item.overlayY}':eof_action=pass[${next}]`
      )
      current = next
      for (const entry of mattesByRightClip.get(item.id) ?? []) {
        const duration = entry.end - entry.start
        const fadeInDuration = Math.max(0.01, entry.boundary - entry.start)
        const fadeOutDuration = Math.max(0.01, entry.end - entry.boundary)
        const matte = `matte${entry.transitionIndex}`
        const matteOut = `matteout${entry.transitionIndex}`
        const color = entry.transition.type === 'fadewhite' ? 'white' : 'black'
        filterParts.push(
          `color=c=${color}:s=${outputSize.w}x${outputSize.h}:r=${frameRate}:d=${duration},format=rgba,` +
          `fade=t=in:st=0:d=${fadeInDuration.toFixed(3)}:alpha=1,` +
          `fade=t=out:st=${fadeInDuration.toFixed(3)}:d=${fadeOutDuration.toFixed(3)}:alpha=1,` +
          `setpts=PTS+${entry.start.toFixed(3)}/TB[${matte}]`
        )
        filterParts.push(`[${current}][${matte}]overlay=eof_action=pass[${matteOut}]`)
        current = matteOut
      }
    })
    videoOutLabel = current
  }

  if (gifFormat && videoOutLabel) {
    const palette = getGifPaletteOptions(encoding)
    if (gifPalettePass?.mode === 'generate') {
      filterParts.push(
        `[${videoOutLabel}]fps=${animatedFps},palettegen=${palette.palettegen}[gifpalette]`
      )
      videoOutLabel = 'gifpalette'
    } else if (gifPalettePass?.mode === 'use') {
      filterParts.push(
        `[${videoOutLabel}]fps=${animatedFps}[gifvideo];` +
        `[gifvideo][${gifPaletteInputLabel}]paletteuse=${palette.paletteuse}[gifout]`
      )
      videoOutLabel = 'gifout'
    } else {
      filterParts.push(
        `[${videoOutLabel}]fps=${animatedFps},split[g0][g1];` +
        `[g0]palettegen=${palette.palettegen}[pal];[g1][pal]paletteuse=${palette.paletteuse}[gifout]`
      )
      videoOutLabel = 'gifout'
    }
  } else if (webpFormat && videoOutLabel) {
    filterParts.push(`[${videoOutLabel}]fps=${animatedFps}[webpout]`)
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
    if (gifFormat && gifPalettePass?.mode === 'generate') {
      args.push('-frames:v', '1', '-c:v', 'png', '-threads', '1', '-update', '1')
    } else if (animatedImageFormat) {
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
      args.push(...getVp9ParallelArgs(outputSize?.w ?? overlayOutputSize.w))
      if (encoding.videoBitrateKbps) {
        args.push('-b:v', `${encoding.videoBitrateKbps}k`)
      } else {
        args.push('-b:v', '0', '-crf', String(encoding.vp9Crf))
      }
    } else {
      args.push(...getH264EncoderArgs(h264Encoder, encoding))
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

export function formatExportError(
  error: unknown,
  format?: ExportOptions['format']
): string {
  if (!(error instanceof Error)) return 'Unknown export error'
  const message = error.message || ''
  if (/Unknown encoder|Encoder .* not found/i.test(message)) {
    return `当前 FFmpeg 缺少所需编码器，导出失败。${message}`
  }
  if (/Cannot allocate memory|Out of memory|return code -12|退出代码 4294967284/i.test(message)) {
    if (format === 'webp' || format === 'gif') {
      return `导出 ${format.toUpperCase()} 时内存不足。请缩短导出范围，或降低分辨率和动图帧率；较长内容建议改用 MP4 或 WebM。`
    }
    return '导出时内存不足。请关闭占用内存较高的程序，或降低导出分辨率后重试。'
  }
  return message
}

function isAudioFormat(format: ExportOptions['format']): boolean {
  return ['mp3', 'wav', 'flac', 'aac', 'opus'].includes(format)
}

function isH264Format(format: ExportOptions['format']): boolean {
  return format === 'mp4' || format === 'mov' || format === 'mkv'
}
