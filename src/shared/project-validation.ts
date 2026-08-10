import type {
  AudioFadeSegment,
  MediaInfo,
  MediaOperation,
  ProjectData,
  TimelineClip,
  TimelineTransition
} from './types'
import { isSupportedMediaExtension } from './media-formats'
import { getClipTimelineRange, getTimelineDuration } from './timeline-utils'

const OPERATION_TYPES = new Set(['trim', 'speed', 'volume', 'pitch', 'transform', 'fade'])
const TRACK_TYPES = new Set(['video', 'audio'])
const TRANSITION_TYPES = new Set([
  'crossfade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'slideleft', 'slideright'
])

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function optionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength)
}

export function isMediaInfo(value: unknown): value is MediaInfo {
  if (!object(value)) return false
  const hasVideo = value.hasVideo === true
  const hasAudio = value.hasAudio === true
  return (
    finite(value.duration, 0.001, 60 * 60 * 24 * 365) &&
    finite(value.width, 0, 32_768) &&
    finite(value.height, 0, 32_768) &&
    finite(value.fps, 0, 1000) &&
    finite(value.sampleRate, 0, 1_000_000) &&
    Number.isSafeInteger(value.fileSize) && finite(value.fileSize, 0, Number.MAX_SAFE_INTEGER) &&
    typeof value.filePath === 'string' && value.filePath.length > 0 && value.filePath.length <= 32_768 && !value.filePath.includes('\0') &&
    typeof value.videoCodec === 'string' && value.videoCodec.length <= 128 &&
    typeof value.audioCodec === 'string' && value.audioCodec.length <= 128 &&
    typeof value.hasVideo === 'boolean' && typeof value.hasAudio === 'boolean' &&
    (hasVideo || hasAudio) &&
    (!hasVideo || (value.width > 0 && value.height > 0 && value.fps > 0 && value.videoCodec.length > 0)) &&
    (!hasAudio || (value.sampleRate > 0 && value.audioCodec.length > 0)) &&
    optionalString(value.containerFormat, 256) && optionalString(value.pixelFormat, 128) &&
    (value.rotation === undefined || [0, 90, 180, 270].includes(Number(value.rotation))) &&
    (value.isVariableFrameRate === undefined || typeof value.isVariableFrameRate === 'boolean') &&
    (value.sampleAspectRatio === undefined || (typeof value.sampleAspectRatio === 'string' && value.sampleAspectRatio.length <= 64)) &&
    (value.colorSpace === undefined || (typeof value.colorSpace === 'string' && value.colorSpace.length <= 128)) &&
    (value.playbackPath === undefined || (typeof value.playbackPath === 'string' && value.playbackPath.length > 0 && value.playbackPath.length <= 32_768 && !value.playbackPath.includes('\0'))) &&
    (value.playbackIsProxy === undefined || typeof value.playbackIsProxy === 'boolean') &&
    (value.playbackProxyFailed === undefined || typeof value.playbackProxyFailed === 'boolean')
  )
}

export function isMediaOperation(value: unknown): value is MediaOperation {
  if (!object(value) || !validId(value.id) || !OPERATION_TYPES.has(String(value.type))) return false
  if (typeof value.enabled !== 'boolean' || !object(value.params)) return false
  const params = value.params
  switch (value.type) {
    case 'trim': return finite(params.startTime, 0, 60 * 60 * 24 * 365) && finite(params.endTime, params.startTime as number, 60 * 60 * 24 * 365)
    case 'speed': return finite(params.rate, 0.1, 16)
    case 'volume': return finite(params.percent, 0, 1000)
    case 'pitch': return finite(params.percent, 25, 400)
    case 'fade': return finite(params.fadeIn, 0, 3600) && finite(params.fadeOut, 0, 3600)
    case 'transform':
      return (
        ['contain', 'cover', 'stretch'].includes(String(params.fit)) &&
        finite(params.scale, 0.1, 4) && finite(params.x, -2000, 2000) &&
        finite(params.y, -2000, 2000) && [0, 90, 180, 270].includes(Number(params.rotation)) &&
        finite(params.opacity, 0, 100) && typeof params.flipX === 'boolean' && typeof params.flipY === 'boolean'
      )
    default: return false
  }
}

export function isTimelineClip(value: unknown): value is TimelineClip {
  if (!object(value)) return false
  if (!validId(value.id) || !validId(value.groupId) ||
      typeof value.filePath !== 'string' || value.filePath.length === 0 || value.filePath.length > 32_768 || value.filePath.includes('\0') ||
      !isSupportedMediaExtension(value.filePath) ||
      !finite(value.startTime, 0, 60 * 60 * 24 * 365) || !finite(value.duration, 0.001, 60 * 60 * 24 * 365) ||
      !TRACK_TYPES.has(String(value.track)) || !finite(value.trackIndex, 0, 64) || !Number.isInteger(value.trackIndex) ||
      !isMediaInfo(value.mediaInfo) || value.mediaInfo.filePath !== value.filePath) return false
  const trimBoundStart = value.trimBoundStart ?? 0
  const trimBoundEnd = value.trimBoundEnd ?? value.duration
  return finite(trimBoundStart, 0, value.duration) && finite(trimBoundEnd, trimBoundStart, value.duration) &&
    (value.track === 'video' ? value.mediaInfo.hasVideo : value.mediaInfo.hasAudio)
}

export function isTimelineTransition(value: unknown): value is TimelineTransition {
  return object(value) && validId(value.id) && TRANSITION_TYPES.has(String(value.type)) &&
    validId(value.leftClipId) && validId(value.rightClipId) && value.leftClipId !== value.rightClipId &&
    finite(value.startOffset, -3600, -0.001) && finite(value.endOffset, 0.001, 3600) &&
    value.endOffset > value.startOffset
}

export function isAudioFadeSegment(value: unknown): value is AudioFadeSegment {
  return object(value) && validId(value.id) && validId(value.clipId) &&
    ['in', 'out'].includes(String(value.kind)) && finite(value.startOffset, 0, 3600) &&
    finite(value.endOffset, value.startOffset as number, 3600) && value.endOffset > value.startOffset
}

export function isProjectData(value: unknown): value is ProjectData {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.clips)) return false
  if (typeof value.savedAt !== 'string' || value.savedAt.length === 0 || value.savedAt.length > 64 || !Number.isFinite(Date.parse(value.savedAt))) return false
  if (value.clips.length > 10_000 || !value.clips.every(isTimelineClip)) return false
  if (!object(value.operationsByClip) || !object(value.linkedGroups)) return false
  const clipIds = new Set(value.clips.map((item) => item.id))
  if (clipIds.size !== value.clips.length) return false
  const clipsById = new Map(value.clips.map((item) => [item.id, item]))
  const operationIds = new Set<string>()
  const operationEntries = Object.entries(value.operationsByClip)
  if (operationEntries.length > value.clips.length) return false
  for (const [clipId, operations] of operationEntries) {
    if (!clipIds.has(clipId) || !Array.isArray(operations) || operations.length > 100 || !operations.every(isMediaOperation)) return false
    const operationTypes = new Set<string>()
    for (const operation of operations) {
      if (operationIds.has(operation.id) || operationTypes.has(operation.type)) return false
      operationIds.add(operation.id)
      operationTypes.add(operation.type)
    }
    const clip = clipsById.get(clipId)
    const trim = operations.find((item) => item.type === 'trim')
    if (clip && trim) {
      const params = trim.params as { startTime: number; endTime: number }
      const min = clip.trimBoundStart ?? 0
      const max = clip.trimBoundEnd ?? clip.duration
      if (params.startTime < min || params.endTime > max) return false
    }
  }
  const linkedGroupEntries = Object.entries(value.linkedGroups)
  if (linkedGroupEntries.length > 20_000 || linkedGroupEntries.some(([groupId, linked]) =>
    !validId(groupId) || typeof linked !== 'boolean'
  )) return false
  const transitions = value.transitions ?? []
  const fades = value.audioFades ?? []
  if (!Array.isArray(transitions) || transitions.length > 10_000 || !transitions.every(isTimelineTransition)) return false
  if (!Array.isArray(fades) || fades.length > 20_000 || !fades.every(isAudioFadeSegment)) return false
  if (transitions.some((item) => !clipIds.has(item.leftClipId) || !clipIds.has(item.rightClipId))) return false
  if (fades.some((item) => !clipIds.has(item.clipId))) return false
  const transitionIds = new Set<string>()
  const transitionPairs = new Set<string>()
  for (const transition of transitions) {
    const left = clipsById.get(transition.leftClipId)
    const right = clipsById.get(transition.rightClipId)
    const pair = `${transition.leftClipId}\0${transition.rightClipId}`
    if (!left || !right || left.track !== 'video' || right.track !== 'video' ||
        left.trackIndex !== right.trackIndex || left.startTime > right.startTime ||
        transitionIds.has(transition.id) || transitionPairs.has(pair)) return false
    transitionIds.add(transition.id)
    transitionPairs.add(pair)
  }
  const fadeIds = new Set<string>()
  const fadeTargets = new Set<string>()
  for (const fade of fades) {
    const clip = clipsById.get(fade.clipId)
    const target = `${fade.clipId}\0${fade.kind}`
    if (!clip?.mediaInfo.hasAudio || fadeIds.has(fade.id) || fadeTargets.has(target)) return false
    const visibleDuration = getClipTimelineRange(clip, value.operationsByClip as Record<string, MediaOperation[]>).visibleDuration
    if (fade.endOffset > visibleDuration) return false
    fadeIds.add(fade.id)
    fadeTargets.add(target)
  }
  if (!finite(value.videoTrackCount, 1, 16) || !Number.isInteger(value.videoTrackCount) ||
      !finite(value.audioTrackCount, 1, 16) || !Number.isInteger(value.audioTrackCount)) return false
  if (value.clips.some((clip) => clip.trackIndex >= (clip.track === 'video' ? value.videoTrackCount as number : value.audioTrackCount as number))) return false
  const timelineDuration = getTimelineDuration(value.clips, value.operationsByClip as Record<string, MediaOperation[]>)
  if (!finite(value.currentTime, 0, Math.max(0, timelineDuration) + 0.001) || !object(value.projectSettings) || !object(value.projectSettings.canvas)) return false
  const canvas = value.projectSettings.canvas
  return ['source', 'landscape', 'portrait', 'square', 'social', 'custom'].includes(String(canvas.preset)) &&
    finite(canvas.width, 16, 16_384) && Number.isInteger(canvas.width) &&
    finite(canvas.height, 16, 16_384) && Number.isInteger(canvas.height) &&
    typeof canvas.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(canvas.backgroundColor) &&
    (value.projectSettings.frameRate === undefined || finite(value.projectSettings.frameRate, 1, 240))
}

export function sanitizeProjectForPersistence(data: ProjectData): ProjectData {
  const clips = data.clips.map((item) => ({
    ...item,
    mediaInfo: {
      ...item.mediaInfo,
      filePath: item.filePath,
      playbackPath: undefined,
      playbackIsProxy: false,
      playbackProxyFailed: false
    }
  }))
  return { ...data, clips }
}
