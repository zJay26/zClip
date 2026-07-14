import type {
  AudioFadeSegment,
  MediaInfo,
  MediaOperation,
  ProjectData,
  TimelineClip,
  TimelineTransition
} from './types'

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

function mediaInfo(value: unknown): value is MediaInfo {
  if (!object(value)) return false
  return (
    finite(value.duration, 0, 60 * 60 * 24 * 365) &&
    finite(value.width, 0, 32_768) &&
    finite(value.height, 0, 32_768) &&
    finite(value.fps, 0, 1000) &&
    finite(value.sampleRate, 0, 1_000_000) &&
    finite(value.fileSize, 0) &&
    typeof value.filePath === 'string' && value.filePath.length > 0 &&
    typeof value.videoCodec === 'string' &&
    typeof value.audioCodec === 'string' &&
    typeof value.hasVideo === 'boolean' &&
    typeof value.hasAudio === 'boolean'
  )
}

export function isMediaOperation(value: unknown): value is MediaOperation {
  if (!object(value) || typeof value.id !== 'string' || !OPERATION_TYPES.has(String(value.type))) return false
  if (typeof value.enabled !== 'boolean' || !object(value.params)) return false
  const params = value.params
  switch (value.type) {
    case 'trim': return finite(params.startTime, 0) && finite(params.endTime, 0)
    case 'speed': return finite(params.rate, 0.01, 100)
    case 'volume': return finite(params.percent, 0, 10_000)
    case 'pitch': return finite(params.percent, 1, 10_000)
    case 'fade': return finite(params.fadeIn, 0) && finite(params.fadeOut, 0)
    case 'transform':
      return (
        ['contain', 'cover', 'stretch'].includes(String(params.fit)) &&
        finite(params.scale, 0.01, 100) && finite(params.x, -100_000, 100_000) &&
        finite(params.y, -100_000, 100_000) && [0, 90, 180, 270].includes(Number(params.rotation)) &&
        finite(params.opacity, 0, 100) && typeof params.flipX === 'boolean' && typeof params.flipY === 'boolean'
      )
    default: return false
  }
}

export function isTimelineClip(value: unknown): value is TimelineClip {
  if (!object(value)) return false
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.groupId === 'string' && value.groupId.length > 0 &&
    typeof value.filePath === 'string' && value.filePath.length > 0 && value.filePath.length <= 32_768 &&
    finite(value.startTime, 0, 60 * 60 * 24 * 365) && finite(value.duration, 0, 60 * 60 * 24 * 365) &&
    TRACK_TYPES.has(String(value.track)) && finite(value.trackIndex, 0, 64) && Number.isInteger(value.trackIndex) &&
    (value.trimBoundStart === undefined || finite(value.trimBoundStart, 0)) &&
    (value.trimBoundEnd === undefined || finite(value.trimBoundEnd, 0)) &&
    mediaInfo(value.mediaInfo)
  )
}

function transition(value: unknown): value is TimelineTransition {
  return object(value) && typeof value.id === 'string' && TRANSITION_TYPES.has(String(value.type)) &&
    typeof value.leftClipId === 'string' && typeof value.rightClipId === 'string' &&
    finite(value.startOffset, -3600, 3600) && finite(value.endOffset, -3600, 3600)
}

function audioFade(value: unknown): value is AudioFadeSegment {
  return object(value) && typeof value.id === 'string' && typeof value.clipId === 'string' &&
    ['in', 'out'].includes(String(value.kind)) && finite(value.startOffset, 0, 3600) && finite(value.endOffset, 0, 3600)
}

export function isProjectData(value: unknown): value is ProjectData {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.clips)) return false
  if (value.clips.length > 10_000 || !value.clips.every(isTimelineClip)) return false
  if (!object(value.operationsByClip) || !object(value.linkedGroups)) return false
  const clipIds = new Set(value.clips.map((item) => item.id))
  if (clipIds.size !== value.clips.length) return false
  for (const [clipId, operations] of Object.entries(value.operationsByClip)) {
    if (!clipIds.has(clipId) || !Array.isArray(operations) || operations.length > 100 || !operations.every(isMediaOperation)) return false
  }
  const transitions = value.transitions ?? []
  const fades = value.audioFades ?? []
  if (!Array.isArray(transitions) || !transitions.every(transition)) return false
  if (!Array.isArray(fades) || !fades.every(audioFade)) return false
  if (transitions.some((item) => !clipIds.has(item.leftClipId) || !clipIds.has(item.rightClipId))) return false
  if (fades.some((item) => !clipIds.has(item.clipId))) return false
  if (!finite(value.videoTrackCount, 1, 64) || !finite(value.audioTrackCount, 1, 64)) return false
  if (!finite(value.currentTime, 0, 60 * 60 * 24 * 365) || !object(value.projectSettings) || !object(value.projectSettings.canvas)) return false
  const canvas = value.projectSettings.canvas
  return ['source', 'landscape', 'portrait', 'square', 'social', 'custom'].includes(String(canvas.preset)) &&
    finite(canvas.width, 16, 16_384) && finite(canvas.height, 16, 16_384) &&
    typeof canvas.backgroundColor === 'string' && /^#?[0-9a-fA-F]{6}$/.test(canvas.backgroundColor)
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
