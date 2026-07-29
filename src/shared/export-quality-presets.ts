import type { GifDither, H264Preset, PcmBitDepth, QualityPreset } from './types'

export type StandardQualityPreset = Exclude<QualityPreset, 'custom'>
export type GifPaletteStatsMode = 'full' | 'diff' | 'single'

export interface ExportQualityProfile {
  crf: number
  h264Preset: H264Preset
  vp9Crf: number
  vp9CpuUsed: number
  webpQuality: number
  webpCompressionLevel: number
  animatedFps: number
  gifMaxColors: number
  gifDither: GifDither
  gifBayerScale?: number
  gifPaletteStatsMode: GifPaletteStatsMode
  gifNewPalette: boolean
  aacBitrateKbps: number
  mp3BitrateKbps: number
  opusBitrateKbps: number
  /** Upper bound only; export never upsamples a lower-rate source. */
  audioSampleRateCap: number
  pcmBitDepth: PcmBitDepth
  /** Changes FLAC size/encode time, not decoded fidelity. */
  flacCompressionLevel: number
}

/**
 * Five deliberately broad presets. Values are format-specific instead of
 * pretending that one CRF number describes every codec.
 */
export const EXPORT_QUALITY_PROFILES: Record<StandardQualityPreset, ExportQualityProfile> = {
  ultra_high: {
    crf: 14,
    h264Preset: 'slow',
    vp9Crf: 18,
    vp9CpuUsed: 1,
    webpQuality: 100,
    webpCompressionLevel: 6,
    animatedFps: 30,
    gifMaxColors: 256,
    gifDither: 'sierra2_4a',
    gifPaletteStatsMode: 'single',
    gifNewPalette: true,
    aacBitrateKbps: 320,
    mp3BitrateKbps: 320,
    opusBitrateKbps: 256,
    audioSampleRateCap: 192_000,
    pcmBitDepth: 32,
    flacCompressionLevel: 12
  },
  high: {
    crf: 18,
    h264Preset: 'medium',
    vp9Crf: 24,
    vp9CpuUsed: 2,
    webpQuality: 90,
    webpCompressionLevel: 6,
    animatedFps: 24,
    gifMaxColors: 256,
    gifDither: 'sierra2_4a',
    gifPaletteStatsMode: 'full',
    gifNewPalette: false,
    aacBitrateKbps: 256,
    mp3BitrateKbps: 256,
    opusBitrateKbps: 192,
    audioSampleRateCap: 96_000,
    pcmBitDepth: 24,
    flacCompressionLevel: 8
  },
  medium: {
    crf: 23,
    h264Preset: 'medium',
    vp9Crf: 32,
    vp9CpuUsed: 4,
    webpQuality: 75,
    webpCompressionLevel: 4,
    animatedFps: 15,
    gifMaxColors: 192,
    gifDither: 'sierra2_4a',
    gifPaletteStatsMode: 'diff',
    gifNewPalette: false,
    aacBitrateKbps: 192,
    mp3BitrateKbps: 192,
    opusBitrateKbps: 128,
    audioSampleRateCap: 48_000,
    pcmBitDepth: 16,
    flacCompressionLevel: 5
  },
  low: {
    crf: 28,
    h264Preset: 'fast',
    vp9Crf: 40,
    vp9CpuUsed: 5,
    webpQuality: 50,
    webpCompressionLevel: 3,
    animatedFps: 10,
    gifMaxColors: 128,
    gifDither: 'bayer',
    gifBayerScale: 3,
    gifPaletteStatsMode: 'diff',
    gifNewPalette: false,
    aacBitrateKbps: 128,
    mp3BitrateKbps: 128,
    opusBitrateKbps: 80,
    audioSampleRateCap: 32_000,
    pcmBitDepth: 16,
    flacCompressionLevel: 8
  },
  ultra_low: {
    crf: 34,
    h264Preset: 'veryfast',
    vp9Crf: 50,
    vp9CpuUsed: 7,
    webpQuality: 25,
    webpCompressionLevel: 2,
    animatedFps: 6,
    gifMaxColors: 64,
    gifDither: 'bayer',
    gifBayerScale: 5,
    gifPaletteStatsMode: 'diff',
    gifNewPalette: false,
    aacBitrateKbps: 64,
    mp3BitrateKbps: 64,
    opusBitrateKbps: 48,
    audioSampleRateCap: 22_050,
    pcmBitDepth: 16,
    flacCompressionLevel: 12
  }
}
