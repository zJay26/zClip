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
import fs from 'fs/promises'
import path from 'path'
import { isMediaInfo } from '../../shared/project-validation'
export { parseMediaInfo }

const MEDIA_INFO_CACHE_LIMIT = 512
const mediaInfoCache = new Map<string, { size: number; mtimeMs: number; info: MediaInfo }>()
const mediaInfoPending = new Map<string, Promise<MediaInfo>>()

function mediaCacheKey(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * Probe a media file and return structured info
 */
export async function getMediaInfo(filePath: string): Promise<MediaInfo> {
  const stat = await fs.stat(filePath)
  const cacheKey = mediaCacheKey(filePath)
  const cached = mediaInfoCache.get(cacheKey)
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    mediaInfoCache.delete(cacheKey)
    mediaInfoCache.set(cacheKey, cached)
    return cached.info
  }

  const pendingKey = `${cacheKey}\0${stat.size}\0${stat.mtimeMs}`
  const existing = mediaInfoPending.get(pendingKey)
  if (existing) return existing

  const pending = (async () => {
    const data = await probe(filePath)
    const currentStat = await fs.stat(filePath)
    if (currentStat.size !== stat.size || currentStat.mtimeMs !== stat.mtimeMs) {
      throw new Error('媒体文件在探测期间发生变化，请等待写入完成后重试')
    }
    const info = { ...parseMediaInfo(data, filePath), fileSize: currentStat.size }
    if (!isMediaInfo(info)) {
      throw new Error('文件不包含可编辑且具有有效时长的音视频流')
    }
    mediaInfoCache.set(cacheKey, { size: currentStat.size, mtimeMs: currentStat.mtimeMs, info })
    while (mediaInfoCache.size > MEDIA_INFO_CACHE_LIMIT) {
      const oldest = mediaInfoCache.keys().next().value as string | undefined
      if (!oldest) break
      mediaInfoCache.delete(oldest)
    }
    return info
  })()
  mediaInfoPending.set(pendingKey, pending)
  try {
    return await pending
  } finally {
    if (mediaInfoPending.get(pendingKey) === pending) mediaInfoPending.delete(pendingKey)
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
    vFilters.push(
      `scale=${options.resolution.w}:${options.resolution.h}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      `pad=${options.resolution.w}:${options.resolution.h}:(ow-iw)/2:(oh-ih)/2`,
      'setsar=1'
    )
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
