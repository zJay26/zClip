interface AudioAdjustmentOptions {
  speedRate?: number
  volumePercent?: number
  pitchPercent?: number
  sampleRate?: number
}

const AUDIO_EPSILON = 0.0001

export function buildTempoChain(targetTempo: number): string[] {
  const filters: string[] = []
  let remaining = Number.isFinite(targetTempo) && targetTempo > 0 ? targetTempo : 1

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

export function buildAudioAdjustmentFilters(options: AudioAdjustmentOptions): string[] {
  const filters: string[] = []
  const rawSpeedRate = options.speedRate ?? 1
  const rawPitchPercent = options.pitchPercent ?? 100
  const speedRate = Number.isFinite(rawSpeedRate) && rawSpeedRate > 0 ? rawSpeedRate : 1
  const pitchPercent = Number.isFinite(rawPitchPercent) ? rawPitchPercent : 100
  const pitchRatio = Math.max(0.01, pitchPercent / 100)
  const hasPitchShift = Math.abs(pitchRatio - 1) > AUDIO_EPSILON

  if (hasPitchShift) {
    const originalRate = Number.isFinite(options.sampleRate) && options.sampleRate && options.sampleRate > 0
      ? Math.round(options.sampleRate)
      : 44100
    const shiftedRate = Math.max(1, Math.round(originalRate * pitchRatio))
    filters.push(`asetrate=${shiftedRate}`)
    filters.push(`aresample=${originalRate}`)
  }

  const tempo = hasPitchShift ? speedRate / pitchRatio : speedRate
  if (Math.abs(tempo - 1) > AUDIO_EPSILON) {
    filters.push(...buildTempoChain(tempo))
  }

  if (options.volumePercent !== undefined) {
    const volumePercent = Number.isFinite(options.volumePercent) ? options.volumePercent : 100
    const gain = Math.max(0, volumePercent / 100)
    filters.push(`volume=${gain.toFixed(4)}`)
  }

  return filters
}
