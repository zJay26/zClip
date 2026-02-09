// ============================================================
// MediaEngine — 接收 MediaOperation[] 编排成 FFmpeg 滤镜链
// 核心抽象层，UI 与 FFmpeg 之间的翻译器
// ============================================================

import type {
  MediaInfo,
  MediaOperation,
  TrimParams,
  SpeedParams,
  VolumeParams,
  PitchParams
} from '../../shared/types'
import { probe } from './ffmpeg'

/**
 * Parse ffprobe output into our MediaInfo structure
 */
export function parseMediaInfo(probeData: Record<string, unknown>, filePath: string): MediaInfo {
  const format = probeData.format as Record<string, unknown>
  const streams = probeData.streams as Record<string, unknown>[]

  const videoStream = streams?.find((s) => s.codec_type === 'video')
  const audioStream = streams?.find((s) => s.codec_type === 'audio')

  // Parse FPS from "30/1" or "30000/1001" format
  let fps = 30
  if (videoStream?.r_frame_rate) {
    const parts = (videoStream.r_frame_rate as string).split('/')
    if (parts.length === 2) {
      fps = Math.round((parseFloat(parts[0]) / parseFloat(parts[1])) * 100) / 100
    }
  }

  const hasVideo = !!videoStream && (videoStream.width as number) > 0
  const hasAudio = !!audioStream

  return {
    duration: parseFloat(format?.duration as string) || 0,
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

/**
 * Probe a media file and return structured info
 */
export async function getMediaInfo(filePath: string): Promise<MediaInfo> {
  const data = await probe(filePath)
  return parseMediaInfo(data, filePath)
}

/**
 * Build FFmpeg arguments from a list of operations.
 * This is the core "compiler" that translates high-level operations
 * into FFmpeg filter graphs and CLI arguments.
 */
export function buildFFmpegArgs(
  inputPath: string,
  outputPath: string,
  operations: MediaOperation[],
  mediaInfo: MediaInfo,
  options: { crf?: number; resolution?: { w: number; h: number } | null }
): string[] {
  const enabledOps = operations.filter((op) => op.enabled)

  // Extract each operation type
  const trim = enabledOps.find((op) => op.type === 'trim')
  const speed = enabledOps.find((op) => op.type === 'speed')
  const volume = enabledOps.find((op) => op.type === 'volume')
  const pitch = enabledOps.find((op) => op.type === 'pitch')

  const args: string[] = ['-y'] // overwrite output

  // --- Input with optional seek ---
  if (trim) {
    const { startTime } = trim.params as TrimParams
    args.push('-ss', startTime.toFixed(3))
  }
  args.push('-i', inputPath)
  if (trim) {
    const { startTime, endTime } = trim.params as TrimParams
    const duration = endTime - startTime
    args.push('-t', duration.toFixed(3))
  }

  // --- Build video filter chain ---
  const vFilters: string[] = []

  if (speed) {
    const { rate } = speed.params as SpeedParams
    // setpts adjusts video speed: PTS/rate = faster, PTS*rate = slower
    vFilters.push(`setpts=PTS/${rate}`)
  }

  if (options.resolution) {
    vFilters.push(`scale=${options.resolution.w}:${options.resolution.h}`)
  }

  // --- Build audio filter chain ---
  const aFilters: string[] = []

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
      // Pitch shift via asetrate + aresample
      const ratio = Math.max(0.01, percent / 100)
      const originalRate = mediaInfo.sampleRate || 44100
      const newRate = Math.round(originalRate * ratio)
      aFilters.push(`asetrate=${newRate}`)
      aFilters.push(`aresample=${originalRate}`)

      // If also changing speed, we need to compensate for pitch's tempo change
      // asetrate changes both pitch and tempo, so we undo the tempo part
      if (!speed) {
        // Compensate tempo change: play at 1/ratio speed to restore original tempo
        const compensate = 1 / ratio
        // atempo only supports 0.5-2.0, chain if needed
        aFilters.push(...buildTempoChain(compensate))
      }
    }
  }

  // Apply filter chains
  if (vFilters.length > 0 && mediaInfo.hasVideo) {
    args.push('-vf', vFilters.join(','))
  }
  if (aFilters.length > 0 && mediaInfo.hasAudio) {
    args.push('-af', aFilters.join(','))
  }

  // --- Output options ---
  if (mediaInfo.hasVideo) {
    args.push('-c:v', 'libx264')
    args.push('-preset', 'medium')
    args.push('-crf', String(options.crf ?? 23))
  } else {
    // Audio-only: no video stream
    args.push('-vn')
  }

  if (mediaInfo.hasAudio) {
    args.push('-c:a', 'aac')
    args.push('-b:a', '192k')
  } else {
    args.push('-an')
  }

  args.push('-movflags', '+faststart')
  args.push(outputPath)

  return args
}

/**
 * Build a chain of atempo filters to achieve arbitrary tempo change.
 * atempo only supports 0.5–2.0, so we chain multiple for larger ranges.
 */
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
