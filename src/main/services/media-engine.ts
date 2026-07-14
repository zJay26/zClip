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
  GifLoopMode,
  ExportOptions,
  H264Preset
} from '../../shared/types'
import { probe } from './ffmpeg'
import { buildAudioAdjustmentFilters } from './audio-filters'
import { parseMediaInfo } from '../../shared/media-info-utils'
export { parseMediaInfo }

/**
 * Probe a media file and return structured info
 */
export async function getMediaInfo(filePath: string): Promise<MediaInfo> {
  const data = await probe(filePath)
  return parseMediaInfo(data, filePath)
}

export interface ResolvedExportEncodingOptions {
  crf: number
  h264Preset: H264Preset
  videoBitrateKbps?: number
  audioBitrateKbps?: number
  animatedFps?: number
}

/** Quality preset -> CRF value (lower = better quality, larger file) */
const CRF_MAP: Record<string, number> = {
  high: 18,
  medium: 23,
  low: 28
}

const H264_PRESETS = new Set<H264Preset>([
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow'
])

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, Math.round(value)))
}

function resolveH264Preset(value: unknown): H264Preset {
  return typeof value === 'string' && H264_PRESETS.has(value as H264Preset)
    ? (value as H264Preset)
    : 'medium'
}

export function resolveExportEncodingOptions(options: ExportOptions): ResolvedExportEncodingOptions {
  if (options.quality !== 'custom') {
    return {
      crf: CRF_MAP[options.quality] ?? 23,
      h264Preset: 'medium'
    }
  }

  const custom = options.customOptions ?? {}
  return {
    crf: clampInt(custom.crf, 0, 51) ?? 23,
    h264Preset: resolveH264Preset(custom.h264Preset),
    videoBitrateKbps: clampInt(custom.videoBitrateKbps, 64, 200000),
    audioBitrateKbps: clampInt(custom.audioBitrateKbps, 32, 512),
    animatedFps: clampInt(custom.animatedFps, 1, 60)
  }
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
    h264Preset?: H264Preset
    videoBitrateKbps?: number
    audioBitrateKbps?: number
    animatedFps?: number
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
  const crf = options.crf ?? 23

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

  aFilters.push(...buildAudioAdjustmentFilters({
    speedRate: speed ? (speed.params as SpeedParams).rate : 1,
    volumePercent: volume ? (volume.params as VolumeParams).percent : undefined,
    pitchPercent: pitch ? (pitch.params as PitchParams).percent : undefined,
    sampleRate: mediaInfo.sampleRate
  }))

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
      const gifFilters = [...vFilters, `fps=${getGifFps(mediaInfo.fps, options.animatedFps)}`]
      args.push(
        '-filter_complex',
        `[0:v]${gifFilters.join(',')},split[g0][g1];[g0]palettegen=stats_mode=diff[pal];[g1][pal]paletteuse=dither=sierra2_4a[vout]`
      )
      args.push('-map', '[vout]')
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
    } else if (webpFormat) {
      const webpFilters = [...vFilters, `fps=${getGifFps(mediaInfo.fps, options.animatedFps)}`]
      args.push('-vf', webpFilters.join(','))
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
      // Use libwebp for broader FFmpeg compatibility across bundled builds.
      args.push('-c:v', 'libwebp')
      args.push('-lossless', '0')
      args.push('-quality', String(mapWebpQuality(crf)))
      args.push('-compression_level', '6')
    } else if (options.format === 'webm') {
      args.push('-c:v', 'libvpx-vp9')
      if (options.videoBitrateKbps) {
        args.push('-b:v', `${options.videoBitrateKbps}k`)
      } else {
        args.push('-b:v', '0')
        args.push('-crf', String(mapVp9Crf(crf)))
      }
    } else {
      args.push('-c:v', 'libx264')
      args.push('-preset', options.h264Preset ?? 'medium')
      if (options.videoBitrateKbps) {
        args.push('-b:v', `${options.videoBitrateKbps}k`)
      } else {
        args.push('-crf', String(crf))
      }
    }
  } else {
    args.push('-vn')
  }

  if (animatedImageFormat) {
    args.push('-an')
  } else if (mediaInfo.hasAudio) {
    const audioArgs = getAudioCodecArgs(options.format, options.audioBitrateKbps)
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

function isAudioFormat(format: ExportFormat): boolean {
  return ['mp3', 'wav', 'flac', 'aac', 'opus'].includes(format)
}

function getAudioCodecArgs(format: ExportFormat, audioBitrateKbps?: number): string[] {
  const bitrate = audioBitrateKbps ? `${audioBitrateKbps}k` : undefined
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', bitrate ?? '192k']
    case 'wav':
      return ['-c:a', 'pcm_s16le']
    case 'flac':
      return ['-c:a', 'flac']
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', bitrate ?? '160k']
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', bitrate ?? '160k']
    case 'aac':
    case 'mp4':
    case 'mov':
    case 'mkv':
    default:
      return ['-c:a', 'aac', '-b:a', bitrate ?? '192k']
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

function getGifFps(inputFps: number, customFps?: number): number {
  if (customFps) return Math.max(1, Math.min(60, Math.round(customFps)))
  if (!Number.isFinite(inputFps) || inputFps <= 0) return 15
  return Math.max(5, Math.min(20, Math.round(inputFps)))
}
