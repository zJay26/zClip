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
  PitchParams,
  ExportFormat,
  GifLoopMode
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
  options: {
    crf?: number
    resolution?: { w: number; h: number } | null
    format: ExportFormat
    gifLoop?: GifLoopMode
  }
): string[] {
  const enabledOps = operations.filter((op) => op.enabled)
  const audioOnlyFormat = isAudioFormat(options.format)
  const gifFormat = options.format === 'gif'
  const webpFormat = options.format === 'webp'
  const animatedImageFormat = gifFormat || webpFormat

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
  if (vFilters.length > 0 && mediaInfo.hasVideo && !audioOnlyFormat && !animatedImageFormat) {
    args.push('-vf', vFilters.join(','))
  }
  if (aFilters.length > 0 && mediaInfo.hasAudio && !animatedImageFormat) {
    args.push('-af', aFilters.join(','))
  }

  // --- Output options ---
  if (!audioOnlyFormat && mediaInfo.hasVideo) {
    if (gifFormat) {
      const gifFilters = [...vFilters, `fps=${getGifFps(mediaInfo.fps)}`]
      args.push(
        '-filter_complex',
        `[0:v]${gifFilters.join(',')},split[g0][g1];[g0]palettegen=stats_mode=diff[pal];[g1][pal]paletteuse=dither=sierra2_4a[vout]`
      )
      args.push('-map', '[vout]')
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
    } else if (webpFormat) {
      const webpFilters = [...vFilters, `fps=${getGifFps(mediaInfo.fps)}`]
      args.push('-vf', webpFilters.join(','))
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
      // Use libwebp for broader FFmpeg compatibility across bundled builds.
      args.push('-c:v', 'libwebp')
      args.push('-lossless', '0')
      args.push('-quality', String(mapWebpQuality(options.crf ?? 23)))
      args.push('-compression_level', '6')
    } else if (options.format === 'webm') {
      args.push('-c:v', 'libvpx-vp9')
      args.push('-b:v', '0')
      args.push('-crf', String(mapVp9Crf(options.crf ?? 23)))
    } else {
      args.push('-c:v', 'libx264')
      args.push('-preset', 'medium')
      args.push('-crf', String(options.crf ?? 23))
    }
  } else {
    args.push('-vn')
  }

  if (animatedImageFormat) {
    args.push('-an')
  } else if (mediaInfo.hasAudio) {
    const audioArgs = getAudioCodecArgs(options.format)
    args.push(...audioArgs)
  } else {
    args.push('-an')
  }

  if (options.format === 'mp4' || options.format === 'mov') {
    args.push('-movflags', '+faststart')
  }
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

function isAudioFormat(format: ExportFormat): boolean {
  return ['mp3', 'wav', 'flac', 'aac', 'opus'].includes(format)
}

function getAudioCodecArgs(format: ExportFormat): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', '192k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'flac':
      return ['-c:a', 'flac']
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', '160k']
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', '160k']
    case 'aac':
    case 'mp4':
    case 'mov':
    case 'mkv':
    default:
      return ['-c:a', 'aac', '-b:a', '192k']
  }
}

function mapVp9Crf(x264Crf: number): number {
  const vp9 = Math.round(x264Crf + 10)
  return Math.max(0, Math.min(63, vp9))
}

function mapWebpQuality(x264Crf: number): number {
  // x264 CRF lower means better quality. WebP quality is inverse in [0,100].
  const q = Math.round(100 - (x264Crf - 18) * 2.5)
  return Math.max(35, Math.min(95, q))
}

function getGifFps(inputFps: number): number {
  if (!Number.isFinite(inputFps) || inputFps <= 0) return 15
  return Math.max(5, Math.min(20, Math.round(inputFps)))
}
