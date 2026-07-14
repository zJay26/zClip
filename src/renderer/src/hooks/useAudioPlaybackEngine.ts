import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { PitchShifter } from 'soundtouchjs'
import type { AudioFadeSegment, MediaOperation, PitchParams, TimelineClip, VolumeParams } from '../../../shared/types'
import { getSpeedRate, timelineTimeToMediaTime, type ClipTimelineRange } from '../../../shared/timeline-utils'
import { toMediaUrl } from '../lib/utils'

interface UseAudioPlaybackEngineOptions {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  audioFades: AudioFadeSegment[]
  getClipRange: (clip: TimelineClip | null) => ClipTimelineRange | null
  getPlaybackPath: (clip: TimelineClip) => string
  videoRef: RefObject<HTMLVideoElement>
}

function setGainValue(ctx: AudioContext, gain: GainNode, value: number): void {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0)
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setTargetAtTime(safeValue, ctx.currentTime, 0.015)
  } catch {
    gain.gain.value = safeValue
  }
}

export function useAudioPlaybackEngine({
  clips,
  operationsByClip,
  audioFades,
  getClipRange,
  getPlaybackPath,
  videoRef
}: UseAudioPlaybackEngineOptions): {
  resumeAudioContext: () => void
  syncAudioForTime: (time: number, shouldPlay: boolean) => void
  stopAllAudio: () => void
} {
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioPipelinesRef = useRef<
    Map<
      string,
      {
        buffer: AudioBuffer
        shifter: PitchShifter
        gain: GainNode
        connected: boolean
      }
    >
  >(new Map())
  const audioElementRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const audioElementPipelinesRef = useRef<
    Map<
      string,
      {
        audio: HTMLAudioElement
        source: MediaElementAudioSourceNode
        gain: GainNode
        connected: boolean
      }
    >
  >(new Map())
  const audioLoadingRef = useRef<Map<string, Promise<void>>>(new Map())
  const lastTimelineTimeRef = useRef<Map<string, number>>(new Map())
  const lastAudioParamsRef = useRef<
    Map<
      string,
      {
        speedRate: number
        pitchPercent: number
        volumePercent: number
        useProcessed: boolean
      }
    >
  >(new Map())

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      audioContextRef.current = new AudioContextCtor()
    }
    return audioContextRef.current
  }, [])

  const resumeAudioContext = useCallback(() => {
    try {
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
    } catch {
      // Ignore resume failures; audio will stay muted.
    }
  }, [getAudioContext])

  const getSpeedRateForClip = useCallback(
    (clipId: string): number => {
      const ops = operationsByClip[clipId] || []
      return getSpeedRate(ops)
    },
    [operationsByClip]
  )

  const getVolumeForClip = useCallback(
    (clipId: string): number => {
      const ops = operationsByClip[clipId] || []
      const volume = ops.find((op) => op.type === 'volume' && op.enabled)
      if (!volume) return 100
      const percent = (volume.params as VolumeParams).percent
      return Math.max(0, percent)
    },
    [operationsByClip]
  )

  const getPitchForClip = useCallback(
    (clipId: string): number => {
      const ops = operationsByClip[clipId] || []
      const pitch = ops.find((op) => op.type === 'pitch' && op.enabled)
      if (!pitch) return 100
      const percent = (pitch.params as PitchParams).percent
      return Math.max(0.01, percent)
    },
    [operationsByClip]
  )

  const getFadeMultiplierForClip = useCallback(
    (clipId: string, clipLocalTime: number, visibleDuration: number): number => {
      let multiplier = 1
      audioFades
        .filter((fade) => fade.clipId === clipId)
        .forEach((fade) => {
          const start = Math.max(0, Math.min(fade.startOffset, visibleDuration))
          const end = Math.max(start, Math.min(fade.endOffset, visibleDuration))
          const duration = end - start
          if (duration <= 0.001) return

          if (fade.kind === 'in') {
            if (clipLocalTime <= start) {
              multiplier = Math.min(multiplier, 0)
            } else if (clipLocalTime < end) {
              multiplier = Math.min(multiplier, (clipLocalTime - start) / duration)
            }
            return
          }

          if (clipLocalTime >= end) {
            multiplier = Math.min(multiplier, 0)
          } else if (clipLocalTime > start) {
            multiplier = Math.min(multiplier, 1 - (clipLocalTime - start) / duration)
          }
        })
      return Math.max(0, Math.min(1, multiplier))
    },
    [audioFades]
  )

  const ensureAudioPipeline = useCallback(
    (clip: TimelineClip): void => {
      if (audioPipelinesRef.current.has(clip.id)) return
      if (audioLoadingRef.current.has(clip.id)) return
      const ctx = getAudioContext()

      const loadPromise = (async () => {
        try {
          const response = await fetch(toMediaUrl(getPlaybackPath(clip)))
          const data = await response.arrayBuffer()
          const buffer = await ctx.decodeAudioData(data.slice(0))
          const shifter = new PitchShifter(ctx, buffer, 1024)
          const gain = ctx.createGain()
          audioPipelinesRef.current.set(clip.id, {
            buffer,
            shifter,
            gain,
            connected: false
          })
        } catch (error) {
          console.error('Failed to load audio buffer:', error)
        } finally {
          audioLoadingRef.current.delete(clip.id)
        }
      })()

      audioLoadingRef.current.set(clip.id, loadPromise)
    },
    [getAudioContext, getPlaybackPath]
  )

  const ensureAudioElementPipeline = useCallback(
    (clip: TimelineClip): { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; connected: boolean } => {
      const existing = audioElementPipelinesRef.current.get(clip.id)
      if (existing) return existing
      const ctx = getAudioContext()
      let audio = audioElementRef.current.get(clip.id)
      if (!audio) {
        audio = new Audio(toMediaUrl(getPlaybackPath(clip)))
        audio.preload = 'auto'
        audioElementRef.current.set(clip.id, audio)
      }
      const source = ctx.createMediaElementSource(audio)
      const gain = ctx.createGain()
      const pipeline = { audio, source, gain, connected: false }
      audioElementPipelinesRef.current.set(clip.id, pipeline)
      return pipeline
    },
    [getAudioContext, getPlaybackPath]
  )

  const rebuildPitchPipeline = useCallback(
    (
      buffer: AudioBuffer,
      ctx: AudioContext,
      gain: GainNode,
      speedRate: number,
      pitchPercent: number,
      connectNow: boolean,
      startTime?: number
    ): PitchShifter => {
      const shifter = new PitchShifter(ctx, buffer, 1024)
      shifter.tempo = speedRate
      shifter.pitch = Math.max(0.01, pitchPercent / 100)
      if (startTime !== undefined && buffer.duration > 0) {
        shifter.percentagePlayed = Math.max(0, Math.min(1, startTime / buffer.duration))
      }
      if (connectNow) {
        shifter.connect(gain)
        gain.connect(ctx.destination)
      }
      return shifter
    },
    []
  )

  const syncAudioForTime = useCallback(
    (timelineTime: number, shouldPlay: boolean) => {
      const ctx = audioContextRef.current
      if (!ctx) return
      const activeIds = new Set<string>()
      let shouldMuteVideo = false
      clips.forEach((clip) => {
        if (clip.track !== 'audio') return
        const range = getClipRange(clip)
        if (!range || range.visibleDuration <= 0) return
        if (timelineTime < range.start || timelineTime >= range.end) return
        activeIds.add(clip.id)
        shouldMuteVideo = true
        const localTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)
        const clipLocalTimelineTime = Math.max(0, Math.min(timelineTime - range.start, range.visibleDuration))

        const speedRate = getSpeedRateForClip(clip.id)
        const volumePercent = getVolumeForClip(clip.id)
        const pitchPercent = getPitchForClip(clip.id)
        const fadeMultiplier = getFadeMultiplierForClip(
          clip.id,
          clipLocalTimelineTime,
          range.visibleDuration
        )
        const gainValue = Math.max(0, volumePercent / 100) * fadeMultiplier
        const useProcessed = pitchPercent !== 100
        const lastParams = lastAudioParamsRef.current.get(clip.id)
        const paramsChanged =
          !lastParams ||
          lastParams.speedRate !== speedRate ||
          lastParams.pitchPercent !== pitchPercent ||
          lastParams.volumePercent !== volumePercent ||
          lastParams.useProcessed !== useProcessed
        lastAudioParamsRef.current.set(clip.id, {
          speedRate,
          pitchPercent,
          volumePercent,
          useProcessed
        })

        if (useProcessed) {
          shouldMuteVideo = true
          ensureAudioPipeline(clip)
          const pipeline = audioPipelinesRef.current.get(clip.id)
          if (!pipeline) return
          const elementPipeline = audioElementPipelinesRef.current.get(clip.id)
          if (elementPipeline?.connected) {
            elementPipeline.source.disconnect()
            elementPipeline.gain.disconnect()
            elementPipeline.connected = false
          }

          setGainValue(ctx, pipeline.gain, gainValue)

          const duration = pipeline.buffer.duration || 0
          if (duration > 0) {
            const lastTimeline = lastTimelineTimeRef.current.get(clip.id)
            const timelineJumped =
              lastTimeline === undefined || Math.abs(timelineTime - lastTimeline) > 0.1
            if (shouldPlay && (!pipeline.connected || timelineJumped || paramsChanged)) {
              if (pipeline.connected) {
                pipeline.shifter.disconnect()
                pipeline.gain.disconnect()
                pipeline.connected = false
              }
              pipeline.shifter = rebuildPitchPipeline(
                pipeline.buffer,
                ctx,
                pipeline.gain,
                speedRate,
                pitchPercent,
                true,
                localTime
              )
              pipeline.connected = true
            } else if (!shouldPlay && pipeline.connected) {
              pipeline.shifter.disconnect()
              pipeline.gain.disconnect()
              pipeline.connected = false
            }
            lastTimelineTimeRef.current.set(clip.id, timelineTime)
          }

          const nativeAudio = audioElementRef.current.get(clip.id)
          if (nativeAudio) {
            nativeAudio.pause()
          }
        } else {
          const pipeline = audioPipelinesRef.current.get(clip.id)
          if (pipeline?.connected) {
            pipeline.shifter.disconnect()
            pipeline.gain.disconnect()
            pipeline.connected = false
          }

          const elementPipeline = ensureAudioElementPipeline(clip)
          setGainValue(ctx, elementPipeline.gain, gainValue)
          if (Math.abs(elementPipeline.audio.currentTime - localTime) > 0.08) {
            elementPipeline.audio.currentTime = localTime
          }
          if (elementPipeline.audio.playbackRate !== speedRate) {
            elementPipeline.audio.playbackRate = speedRate
          }
          elementPipeline.audio.volume = 1
          if (shouldPlay && !elementPipeline.connected) {
            elementPipeline.source.connect(elementPipeline.gain)
            elementPipeline.gain.connect(ctx.destination)
            elementPipeline.connected = true
          } else if (!shouldPlay && elementPipeline.connected) {
            elementPipeline.source.disconnect()
            elementPipeline.gain.disconnect()
            elementPipeline.connected = false
          }
          if (shouldPlay) {
            elementPipeline.audio.play().catch(() => {})
          } else {
            elementPipeline.audio.pause()
          }
        }
      })

      audioPipelinesRef.current.forEach((pipeline, id) => {
        if (!activeIds.has(id) && pipeline.connected) {
          pipeline.shifter.disconnect()
          pipeline.gain.disconnect()
          pipeline.connected = false
        }
      })

      audioElementRef.current.forEach((audio, id) => {
        if (!activeIds.has(id)) {
          audio.pause()
        }
      })

      audioElementPipelinesRef.current.forEach((pipeline, id) => {
        if (!activeIds.has(id) && pipeline.connected) {
          pipeline.source.disconnect()
          pipeline.gain.disconnect()
          pipeline.connected = false
        }
      })

      const video = videoRef.current
      if (video) {
        video.muted = shouldMuteVideo
      }
    },
    [
      clips,
      getClipRange,
      getSpeedRateForClip,
      getVolumeForClip,
      getPitchForClip,
      getFadeMultiplierForClip,
      operationsByClip,
      ensureAudioPipeline,
      ensureAudioElementPipeline,
      videoRef
    ]
  )

  const stopAllAudio = useCallback(() => {
    audioPipelinesRef.current.forEach((pipeline) => {
      if (pipeline.connected) {
        pipeline.shifter.disconnect()
        pipeline.gain.disconnect()
        pipeline.connected = false
      }
    })
    audioElementRef.current.forEach((audio) => audio.pause())
    audioElementPipelinesRef.current.forEach((pipeline) => {
      if (pipeline.connected) {
        pipeline.source.disconnect()
        pipeline.gain.disconnect()
        pipeline.connected = false
      }
    })
  }, [])

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id))

    audioPipelinesRef.current.forEach((pipeline, id) => {
      if (clipIds.has(id)) return
      if (pipeline.connected) {
        pipeline.shifter.disconnect()
        pipeline.gain.disconnect()
      }
      audioPipelinesRef.current.delete(id)
    })

    audioElementPipelinesRef.current.forEach((pipeline, id) => {
      if (clipIds.has(id)) return
      if (pipeline.connected) {
        pipeline.source.disconnect()
        pipeline.gain.disconnect()
      }
      pipeline.audio.pause()
      pipeline.audio.removeAttribute('src')
      pipeline.audio.load()
      audioElementPipelinesRef.current.delete(id)
    })

    audioElementRef.current.forEach((audio, id) => {
      if (clipIds.has(id)) return
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioElementRef.current.delete(id)
    })

    audioLoadingRef.current.forEach((_promise, id) => {
      if (!clipIds.has(id)) {
        audioLoadingRef.current.delete(id)
      }
    })

    lastTimelineTimeRef.current.forEach((_time, id) => {
      if (!clipIds.has(id)) {
        lastTimelineTimeRef.current.delete(id)
      }
    })

    lastAudioParamsRef.current.forEach((_params, id) => {
      if (!clipIds.has(id)) {
        lastAudioParamsRef.current.delete(id)
      }
    })
  }, [clips])

  useEffect(() => {
    return () => {
      stopAllAudio()
      audioLoadingRef.current.clear()
      audioPipelinesRef.current.clear()
      audioElementRef.current.clear()
      audioElementPipelinesRef.current.clear()
      lastTimelineTimeRef.current.clear()
      lastAudioParamsRef.current.clear()
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
        audioContextRef.current = null
      }
    }
  }, [stopAllAudio])

  return {
    resumeAudioContext,
    syncAudioForTime,
    stopAllAudio
  }
}
