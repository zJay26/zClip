import type { MediaInfo } from './types'

function isTruthyDisposition(value: unknown): boolean {
  return value === 1 || value === '1' || value === true
}

function isAttachedArtworkStream(stream: Record<string, unknown>): boolean {
  const disposition = stream.disposition as Record<string, unknown> | undefined
  return Boolean(
    isTruthyDisposition(stream.attached_pic) ||
    isTruthyDisposition(disposition?.attached_pic) ||
    isTruthyDisposition(disposition?.still_image) ||
    isTruthyDisposition(disposition?.timed_thumbnails)
  )
}

function isPlayableVideoStream(stream: Record<string, unknown>): boolean {
  return (
    stream.codec_type === 'video' &&
    !isAttachedArtworkStream(stream) &&
    Number(stream.width) > 0 &&
    Number(stream.height) > 0
  )
}

function parseRational(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const [numeratorText, denominatorText] = value.split('/')
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  const result = numerator / denominator
  return Number.isFinite(result) && result > 0 ? result : null
}

function parseDuration(format: Record<string, unknown> | undefined, streams: Record<string, unknown>[]): number {
  const formatDuration = Number(format?.duration)
  if (Number.isFinite(formatDuration) && formatDuration >= 0) return formatDuration
  return streams.reduce((longest, stream) => {
    const direct = Number(stream.duration)
    if (Number.isFinite(direct) && direct >= 0) return Math.max(longest, direct)
    const timeBase = parseRational(stream.time_base)
    const durationTs = Number(stream.duration_ts)
    return timeBase && Number.isFinite(durationTs) ? Math.max(longest, durationTs * timeBase) : longest
  }, 0)
}

function parseRotation(stream: Record<string, unknown> | undefined): 0 | 90 | 180 | 270 {
  if (!stream) return 0
  const tags = stream.tags as Record<string, unknown> | undefined
  const sideData = Array.isArray(stream.side_data_list)
    ? stream.side_data_list as Record<string, unknown>[]
    : []
  const raw = Number(tags?.rotate ?? sideData.find((item) => item.rotation !== undefined)?.rotation ?? 0)
  if (!Number.isFinite(raw)) return 0
  const normalized = ((Math.round(raw / 90) * 90) % 360 + 360) % 360
  return [0, 90, 180, 270].includes(normalized) ? normalized as 0 | 90 | 180 | 270 : 0
}

/**
 * Parse ffprobe output into the app's MediaInfo model.
 * Attached artwork in audio files is intentionally not treated as video.
 */
export function parseMediaInfo(probeData: Record<string, unknown>, filePath: string): MediaInfo {
  const format = probeData.format as Record<string, unknown> | undefined
  const streams = Array.isArray(probeData.streams)
    ? probeData.streams as Record<string, unknown>[]
    : []

  const videoStream = streams?.find(isPlayableVideoStream)
  const audioStream = streams?.find((s) => s.codec_type === 'audio')

  const averageFps = parseRational(videoStream?.avg_frame_rate)
  const realFps = parseRational(videoStream?.r_frame_rate)
  const fps = Math.round((averageFps ?? realFps ?? 30) * 1000) / 1000

  const hasVideo = !!videoStream
  const hasAudio = !!audioStream

  const rotation = parseRotation(videoStream)
  const encodedWidth = Number(videoStream?.width) || 0
  const encodedHeight = Number(videoStream?.height) || 0
  const rotated = rotation === 90 || rotation === 270

  return {
    duration: parseDuration(format, streams),
    containerFormat: (format?.format_name as string) || '',
    width: rotated ? encodedHeight : encodedWidth,
    height: rotated ? encodedWidth : encodedHeight,
    fps: hasVideo ? fps : 0,
    videoCodec: (videoStream?.codec_name as string) || '',
    pixelFormat: (videoStream?.pix_fmt as string) || '',
    audioCodec: (audioStream?.codec_name as string) || '',
    sampleRate: hasAudio ? parseInt(audioStream?.sample_rate as string) || 44_100 : 0,
    fileSize: parseInt(format?.size as string) || 0,
    filePath,
    hasVideo,
    hasAudio,
    rotation,
    isVariableFrameRate: Boolean(averageFps && realFps && Math.abs(averageFps - realFps) / averageFps > 0.01),
    sampleAspectRatio: (videoStream?.sample_aspect_ratio as string) || undefined,
    colorSpace: (videoStream?.color_space as string) || undefined
  }
}
