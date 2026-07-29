import type {
  ExportFormat,
  ExportOptions,
  GifDither,
  H264Preset,
  PcmBitDepth
} from '../../shared/types'
import {
  EXPORT_QUALITY_PROFILES,
  type ExportQualityProfile,
  type GifPaletteStatsMode
} from '../../shared/export-quality-presets'

export interface ResolvedExportEncodingOptions {
  crf: number
  h264Preset: H264Preset
  vp9Crf: number
  vp9CpuUsed: number
  webpQuality: number
  webpCompressionLevel: number
  videoBitrateKbps?: number
  audioBitrateKbps?: number
  animatedFps: number
  gifMaxColors: number
  gifDither: GifDither
  gifBayerScale?: number
  gifPaletteStatsMode: GifPaletteStatsMode
  gifNewPalette: boolean
  audioSampleRateCap: number
  pcmBitDepth: PcmBitDepth
  flacCompressionLevel: number
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

const PCM_BIT_DEPTHS = new Set<PcmBitDepth>([16, 24, 32])
const GIF_DITHERS = new Set<GifDither>(['bayer', 'floyd_steinberg', 'sierra2_4a'])

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(min, Math.min(max, Math.round(value)))
}

function resolveH264Preset(value: unknown): H264Preset {
  return typeof value === 'string' && H264_PRESETS.has(value as H264Preset)
    ? (value as H264Preset)
    : 'medium'
}

function resolvePcmBitDepth(value: unknown): PcmBitDepth {
  return typeof value === 'number' && PCM_BIT_DEPTHS.has(value as PcmBitDepth)
    ? (value as PcmBitDepth)
    : 16
}

function resolveGifDither(value: unknown): GifDither {
  return typeof value === 'string' && GIF_DITHERS.has(value as GifDither)
    ? (value as GifDither)
    : 'sierra2_4a'
}

function getProfileAudioBitrate(format: ExportFormat, profile: ExportQualityProfile): number | undefined {
  if (format === 'mp3') return profile.mp3BitrateKbps
  if (format === 'opus' || format === 'webm') return profile.opusBitrateKbps
  if (['aac', 'mp4', 'mov', 'mkv'].includes(format)) return profile.aacBitrateKbps
  return undefined
}

function getCustomAudioBitrate(format: ExportFormat, value: unknown): number | undefined {
  if (format === 'mp3') return clampInt(value, 32, 320)
  if (format === 'opus' || format === 'webm') return clampInt(value, 32, 510)
  if (['aac', 'mp4', 'mov', 'mkv'].includes(format)) return clampInt(value, 32, 512)
  return undefined
}

function mapVp9Crf(x264Crf: number): number {
  return Math.max(0, Math.min(63, Math.round(x264Crf + 9)))
}

function mapWebpQuality(x264Crf: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - (x264Crf - 14) * 3.4)))
}

function mapPresetToVp9CpuUsed(preset: H264Preset): number {
  switch (preset) {
    case 'veryslow':
      return 0
    case 'slower':
      return 1
    case 'slow':
      return 2
    case 'medium':
      return 4
    case 'fast':
      return 5
    case 'faster':
      return 6
    case 'veryfast':
      return 7
    default:
      return 8
  }
}

export function resolveExportEncodingOptions(options: ExportOptions): ResolvedExportEncodingOptions {
  if (options.quality !== 'custom') {
    const profile = EXPORT_QUALITY_PROFILES[options.quality] ?? EXPORT_QUALITY_PROFILES.medium
    return {
      crf: profile.crf,
      h264Preset: profile.h264Preset,
      vp9Crf: profile.vp9Crf,
      vp9CpuUsed: profile.vp9CpuUsed,
      webpQuality: profile.webpQuality,
      webpCompressionLevel: profile.webpCompressionLevel,
      audioBitrateKbps: getProfileAudioBitrate(options.format, profile),
      animatedFps: profile.animatedFps,
      gifMaxColors: profile.gifMaxColors,
      gifDither: profile.gifDither,
      gifBayerScale: profile.gifBayerScale,
      gifPaletteStatsMode: profile.gifPaletteStatsMode,
      gifNewPalette: profile.gifNewPalette,
      audioSampleRateCap: profile.audioSampleRateCap,
      pcmBitDepth: profile.pcmBitDepth,
      flacCompressionLevel: profile.flacCompressionLevel
    }
  }

  const custom = options.customOptions ?? {}
  const crf = clampInt(custom.crf, 0, 51) ?? EXPORT_QUALITY_PROFILES.medium.crf
  const h264Preset = resolveH264Preset(custom.h264Preset)
  const gifDither = resolveGifDither(custom.gifDither)
  return {
    crf,
    h264Preset,
    vp9Crf: mapVp9Crf(crf),
    vp9CpuUsed: clampInt(custom.vp9CpuUsed, 0, 8) ?? mapPresetToVp9CpuUsed(h264Preset),
    webpQuality: clampInt(custom.webpQuality, 0, 100) ?? mapWebpQuality(crf),
    webpCompressionLevel:
      clampInt(custom.webpCompressionLevel, 0, 6) ??
      EXPORT_QUALITY_PROFILES.medium.webpCompressionLevel,
    videoBitrateKbps: clampInt(custom.videoBitrateKbps, 64, 200_000),
    audioBitrateKbps:
      getCustomAudioBitrate(options.format, custom.audioBitrateKbps) ??
      getProfileAudioBitrate(options.format, EXPORT_QUALITY_PROFILES.medium),
    animatedFps: clampInt(custom.animatedFps, 1, 60) ?? EXPORT_QUALITY_PROFILES.medium.animatedFps,
    gifMaxColors: clampInt(custom.gifColors, 4, 256) ?? 256,
    gifDither,
    gifBayerScale: gifDither === 'bayer' ? 3 : undefined,
    gifPaletteStatsMode: 'full',
    gifNewPalette: false,
    audioSampleRateCap: clampInt(custom.audioSampleRate, 8_000, 192_000) ?? 48_000,
    pcmBitDepth: resolvePcmBitDepth(custom.pcmBitDepth),
    flacCompressionLevel: clampInt(custom.flacCompressionLevel, 0, 12) ?? 5
  }
}

export function resolveOutputSampleRate(
  inputSampleRates: number[],
  sampleRateCap: number
): number {
  // Treat the preset as a ceiling so a 44.1 kHz source is never inflated to
  // 96/192 kHz without gaining information.
  const highestSourceRate = inputSampleRates
    .filter((rate) => Number.isFinite(rate) && rate > 0)
    .reduce((highest, rate) => Math.max(highest, Math.round(rate)), 0)
  return Math.min(highestSourceRate || 48_000, sampleRateCap)
}

export function getAudioCodecArgs(
  format: ExportFormat,
  encoding: ResolvedExportEncodingOptions,
  inputSampleRates: number[]
): string[] {
  const bitrate = encoding.audioBitrateKbps ? `${encoding.audioBitrateKbps}k` : undefined
  const sampleRate = resolveOutputSampleRate(inputSampleRates, encoding.audioSampleRateCap)

  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', bitrate ?? '192k']
    case 'wav': {
      const codec = encoding.pcmBitDepth === 32
        ? 'pcm_s32le'
        : encoding.pcmBitDepth === 24
          ? 'pcm_s24le'
          : 'pcm_s16le'
      return ['-c:a', codec, '-ar', String(sampleRate)]
    }
    case 'flac': {
      // The bundled FLAC encoder accepts s16/s32 sample formats and up to
      // 24 meaningful bits, so 24-bit PCM is carried in an s32 container.
      const bitDepth = Math.min(24, encoding.pcmBitDepth)
      const sampleFormat = bitDepth > 16 ? 's32' : 's16'
      return [
        '-c:a', 'flac',
        '-compression_level', String(encoding.flacCompressionLevel),
        '-sample_fmt', sampleFormat,
        '-bits_per_raw_sample', String(bitDepth),
        '-ar', String(sampleRate)
      ]
    }
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', bitrate ?? '128k']
    case 'webm':
      return ['-c:a', 'libopus', '-b:a', bitrate ?? '128k']
    case 'aac':
    case 'mp4':
    case 'mov':
    case 'mkv':
    default:
      return ['-c:a', 'aac', '-b:a', bitrate ?? '192k']
  }
}

export function getGifPaletteOptions(encoding: ResolvedExportEncodingOptions): {
  palettegen: string
  paletteuse: string
} {
  const palettegen = [
    `stats_mode=${encoding.gifPaletteStatsMode}`,
    `max_colors=${encoding.gifMaxColors}`
  ].join(':')
  const paletteuse = [`dither=${encoding.gifDither}`]
  if (encoding.gifDither === 'bayer' && encoding.gifBayerScale !== undefined) {
    paletteuse.push(`bayer_scale=${encoding.gifBayerScale}`)
  }
  if (encoding.gifNewPalette) {
    paletteuse.push('new=1')
  }
  return { palettegen, paletteuse: paletteuse.join(':') }
}

export function resolveAnimatedImageFps(inputFps: number[], targetFps: number): number {
  const highestSourceFps = inputFps
    .filter((fps) => Number.isFinite(fps) && fps > 0)
    .reduce((highest, fps) => Math.max(highest, fps), 0)
  const sourceCap = highestSourceFps > 0 ? Math.round(highestSourceFps) : targetFps
  return Math.max(1, Math.min(60, sourceCap, Math.round(targetFps)))
}
