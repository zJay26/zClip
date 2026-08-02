// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildAudioAdjustmentFilters, buildTempoChain } from './audio-filters'

describe('audio adjustment filters', () => {
  it('decomposes extreme playback rates into FFmpeg-supported atempo steps', () => {
    expect(buildTempoChain(16)).toEqual([
      'atempo=2.0', 'atempo=2.0', 'atempo=2.0', 'atempo=2.0000'
    ])
    expect(buildTempoChain(0.1)).toEqual([
      'atempo=0.5', 'atempo=0.5', 'atempo=0.5', 'atempo=0.8000'
    ])
  })

  it('uses high-quality duration-preserving pitch shift independently from speed', () => {
    expect(buildAudioAdjustmentFilters({
      speedRate: 1.5,
      pitchPercent: 125,
      volumePercent: 250,
      sampleRate: 48_000
    })).toEqual([
      'rubberband=pitch=1.250000',
      'atempo=1.5000',
      'volume=2.5000'
    ])
  })
})
