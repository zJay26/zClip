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

/**
 * Parse ffprobe output into the app's MediaInfo model.
 * Attached artwork in audio files is intentionally not treated as video.
 */
export function parseMediaInfo(probeData: Record<string, unknown>, filePath: string): MediaInfo {
  const format = probeData.format as Record<string, unknown>
  const streams = probeData.streams as Record<string, unknown>[]

  const videoStream = streams?.find(isPlayableVideoStream)
  const audioStream = streams?.find((s) => s.codec_type === 'audio')

  let fps = 30
  if (videoStream?.r_frame_rate) {
    const parts = (videoStream.r_frame_rate as string).split('/')
    if (parts.length === 2) {
      fps = Math.round((parseFloat(parts[0]) / parseFloat(parts[1])) * 100) / 100
    }
  }

  const hasVideo = !!videoStream
  const hasAudio = !!audioStream

  return {
    duration: parseFloat(format?.duration as string) || 0,
    containerFormat: (format?.format_name as string) || '',
    width: (videoStream?.width as number) || 0,
    height: (videoStream?.height as number) || 0,
    fps: hasVideo ? fps : 0,
    videoCodec: (videoStream?.codec_name as string) || '',
    pixelFormat: (videoStream?.pix_fmt as string) || '',
    audioCodec: (audioStream?.codec_name as string) || '',
    sampleRate: parseInt(audioStream?.sample_rate as string) || 44100,
    fileSize: parseInt(format?.size as string) || 0,
    filePath,
    hasVideo,
    hasAudio
  }
}
