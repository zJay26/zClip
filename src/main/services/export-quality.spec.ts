// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ExportFormat, ExportOptions, QualityPreset } from '../../shared/types'
import {
  getAudioCodecArgs,
  getGifPaletteOptions,
  resolveAnimatedImageFps,
  resolveExportEncodingOptions
} from './export-quality'

const STANDARD_QUALITIES: Exclude<QualityPreset, 'custom'>[] = [
  'ultra_high',
  'high',
  'medium',
  'low',
  'ultra_low'
]

function resolve(format: ExportFormat, quality: QualityPreset) {
  const options: ExportOptions = {
    format,
    quality,
    resolution: 'original',
    outputPath: `C:\\output.${format}`
  }
  return resolveExportEncodingOptions(options)
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

describe('export quality profiles', () => {
  it('uses a broad, monotonically decreasing visual quality range', () => {
    expect(STANDARD_QUALITIES.map((quality) => resolve('mp4', quality).crf))
      .toEqual([14, 18, 23, 28, 34])
    expect(STANDARD_QUALITIES.map((quality) => resolve('webm', quality).vp9Crf))
      .toEqual([18, 24, 32, 40, 50])
    expect(STANDARD_QUALITIES.map((quality) => resolve('webp', quality).webpQuality))
      .toEqual([100, 90, 75, 50, 25])
  })

  it.each([
    ['mp3', [320, 256, 192, 128, 64]],
    ['aac', [320, 256, 192, 128, 64]],
    ['opus', [256, 192, 128, 80, 48]],
    ['mp4', [320, 256, 192, 128, 64]],
    ['webm', [256, 192, 128, 80, 48]]
  ] as const)('maps every %s quality to a distinct audio bitrate', (format, bitrates) => {
    expect(STANDARD_QUALITIES.map((quality) => resolve(format, quality).audioBitrateKbps))
      .toEqual(bitrates)
  })

  it('maps GIF presets to distinct frame rate, palette, and dithering strategies', () => {
    const profiles = STANDARD_QUALITIES.map((quality) => resolve('gif', quality))
    expect(profiles.map((profile) => profile.animatedFps)).toEqual([30, 24, 15, 10, 6])
    expect(profiles.map((profile) => profile.gifMaxColors)).toEqual([256, 256, 192, 128, 64])
    expect(getGifPaletteOptions(profiles[0])).toEqual({
      palettegen: 'stats_mode=single:max_colors=256',
      paletteuse: 'dither=sierra2_4a:new=1'
    })
    expect(getGifPaletteOptions(profiles[4])).toEqual({
      palettegen: 'stats_mode=diff:max_colors=64',
      paletteuse: 'dither=bayer:bayer_scale=5'
    })
  })

  it('uses source-aware PCM and FLAC parameters without upsampling', () => {
    const wavUltra = resolve('wav', 'ultra_high')
    const wavLow = resolve('wav', 'ultra_low')
    const flacHigh = resolve('flac', 'high')

    const wavUltraArgs = getAudioCodecArgs('wav', wavUltra, [44_100])
    expect(valueAfter(wavUltraArgs, '-c:a')).toBe('pcm_s32le')
    expect(valueAfter(wavUltraArgs, '-ar')).toBe('44100')

    const wavLowArgs = getAudioCodecArgs('wav', wavLow, [48_000])
    expect(valueAfter(wavLowArgs, '-c:a')).toBe('pcm_s16le')
    expect(valueAfter(wavLowArgs, '-ar')).toBe('22050')

    const flacArgs = getAudioCodecArgs('flac', flacHigh, [192_000])
    expect(valueAfter(flacArgs, '-sample_fmt')).toBe('s32')
    expect(valueAfter(flacArgs, '-bits_per_raw_sample')).toBe('24')
    expect(valueAfter(flacArgs, '-compression_level')).toBe('8')
    expect(valueAfter(flacArgs, '-ar')).toBe('96000')
  })

  it('makes all five presets materially distinct for every export format', () => {
    const formats: ExportFormat[] = [
      'mp4', 'mov', 'mkv', 'webm', 'gif', 'webp',
      'mp3', 'wav', 'flac', 'aac', 'opus'
    ]

    formats.forEach((format) => {
      const signatures = STANDARD_QUALITIES.map((quality) => {
        const encoding = resolve(format, quality)
        if (format === 'gif') {
          return [
            encoding.animatedFps,
            encoding.gifMaxColors,
            encoding.gifDither,
            encoding.gifPaletteStatsMode,
            encoding.gifNewPalette
          ].join(':')
        }
        if (format === 'webp') {
          return [
            encoding.webpQuality,
            encoding.webpCompressionLevel,
            encoding.animatedFps
          ].join(':')
        }
        if (format === 'wav' || format === 'flac') {
          return getAudioCodecArgs(format, encoding, [96_000]).join(' ')
        }
        if (format === 'mp3' || format === 'aac' || format === 'opus') {
          return getAudioCodecArgs(format, encoding, [48_000]).join(' ')
        }
        if (format === 'webm') {
          return `${encoding.vp9Crf}:${encoding.vp9CpuUsed}:${encoding.audioBitrateKbps}`
        }
        return `${encoding.crf}:${encoding.h264Preset}:${encoding.audioBitrateKbps}`
      })
      expect(new Set(signatures).size, format).toBe(STANDARD_QUALITIES.length)
    })
  })

  it('clamps custom values to codec-safe ranges', () => {
    const encoding = resolveExportEncodingOptions({
      format: 'mp3',
      quality: 'custom',
      resolution: 'original',
      outputPath: 'C:\\output.mp3',
      customOptions: {
        crf: 80,
        audioBitrateKbps: 500,
        vp9CpuUsed: 99,
        animatedFps: 120,
        webpQuality: -5,
        webpCompressionLevel: 99,
        gifColors: 2,
        audioSampleRate: 500_000,
        pcmBitDepth: 32,
        flacCompressionLevel: 99
      }
    })

    expect(encoding.crf).toBe(51)
    expect(encoding.audioBitrateKbps).toBe(320)
    expect(encoding.vp9CpuUsed).toBe(8)
    expect(encoding.animatedFps).toBe(60)
    expect(encoding.webpQuality).toBe(0)
    expect(encoding.webpCompressionLevel).toBe(6)
    expect(encoding.gifMaxColors).toBe(4)
    expect(encoding.audioSampleRateCap).toBe(192_000)
    expect(encoding.flacCompressionLevel).toBe(12)
  })

  it('caps animated-image FPS at the highest source FPS', () => {
    expect(resolveAnimatedImageFps([12, 24], 30)).toBe(24)
    expect(resolveAnimatedImageFps([60], 15)).toBe(15)
  })
})
