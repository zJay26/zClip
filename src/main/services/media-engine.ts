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
import { buildAudioAdjustmentFilters } from './audio-filters'
import { parseMediaInfo } from '../../shared/media-info-utils'
import {
  getAudioCodecArgs,
  getGifPaletteOptions,
  resolveAnimatedImageFps,
  type ResolvedExportEncodingOptions
} from './export-quality'
export { parseMediaInfo }

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
  options: ResolvedExportEncodingOptions & {
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
      const gifFps = resolveAnimatedImageFps([mediaInfo.fps], options.animatedFps)
      const palette = getGifPaletteOptions(options)
      const gifFilters = [...vFilters, `fps=${gifFps}`]
      args.push(
        '-filter_complex',
        `[0:v]${gifFilters.join(',')},split[g0][g1];[g0]palettegen=${palette.palettegen}[pal];[g1][pal]paletteuse=${palette.paletteuse}[vout]`
      )
      args.push('-map', '[vout]')
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
    } else if (webpFormat) {
      const webpFps = resolveAnimatedImageFps([mediaInfo.fps], options.animatedFps)
      const webpFilters = [...vFilters, `fps=${webpFps}`]
      args.push('-vf', webpFilters.join(','))
      args.push('-loop', options.gifLoop === 'once' ? '1' : '0')
      // Use libwebp for broader FFmpeg compatibility across bundled builds.
      args.push('-c:v', 'libwebp')
      args.push('-lossless', '0')
      args.push('-quality', String(options.webpQuality))
      args.push('-compression_level', String(options.webpCompressionLevel))
    } else if (options.format === 'webm') {
      args.push('-c:v', 'libvpx-vp9')
      args.push('-cpu-used', String(options.vp9CpuUsed))
      if (options.videoBitrateKbps) {
        args.push('-b:v', `${options.videoBitrateKbps}k`)
      } else {
        args.push('-b:v', '0')
        args.push('-crf', String(options.vp9Crf))
      }
    } else {
      args.push('-c:v', 'libx264')
      args.push('-preset', options.h264Preset ?? 'medium')
      if (options.videoBitrateKbps) {
        args.push('-b:v', `${options.videoBitrateKbps}k`)
      } else {
        args.push('-crf', String(options.crf))
      }
    }
  } else {
    args.push('-vn')
  }

  if (animatedImageFormat) {
    args.push('-an')
  } else if (mediaInfo.hasAudio) {
    const audioArgs = getAudioCodecArgs(options.format, options, [mediaInfo.sampleRate])
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
