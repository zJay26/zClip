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

interface NativeAudioController {
  audio: HTMLAudioElement
  src: string
  pendingTime: number | null
  shouldPlay: boolean
  playPromise: Promise<void> | null
  onLoadedMetadata: () => void
}

function applyNativeAudioTime(controller: NativeAudioController, time: number): boolean {
  controller.pendingTime = Math.max(0, Number.isFinite(time) ? time : 0)
  const { audio } = controller
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA || !Number.isFinite(audio.duration)) {
    return false
  }

  const target = Math.min(controller.pendingTime, Math.max(0, audio.duration - 0.0001))
  try {
    audio.currentTime = target
    controller.pendingTime = null
    return true
  } catch {
    return false
  }
}

function startNativeAudio(controller: NativeAudioController): void {
  if (!controller.shouldPlay || controller.playPromise || !controller.audio.paused) return
  if (controller.pendingTime !== null && !applyNativeAudioTime(controller, controller.pendingTime)) {
    return
  }

  controller.playPromise = controller.audio.play()
    .catch((error) => {
      console.error('Failed to play audio:', error)
    })
    .finally(() => {
      controller.playPromise = null
    })
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
  const nativeAudioControllersRef = useRef<Map<string, NativeAudioController>>(new Map())
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

  const ensureNativeAudioController = useCallback(
    (clip: TimelineClip): NativeAudioController => {
      const src = toMediaUrl(getPlaybackPath(clip))
      const existing = nativeAudioControllersRef.current.get(clip.id)
      if (existing?.src === src) return existing
      if (existing) {
        existing.shouldPlay = false
        existing.audio.pause()
        existing.audio.removeEventListener('loadedmetadata', existing.onLoadedMetadata)
        existing.audio.removeAttribute('src')
        existing.audio.load()
      }

      const audio = new Audio(src)
      audio.preload = 'auto'
      const controller: NativeAudioController = {
        audio,
        src,
        pendingTime: null,
        shouldPlay: false,
        playPromise: null,
        onLoadedMetadata: () => {}
      }
      controller.onLoadedMetadata = () => {
        if (controller.pendingTime !== null) {
          applyNativeAudioTime(controller, controller.pendingTime)
        }
        startNativeAudio(controller)
      }
      audio.addEventListener('loadedmetadata', controller.onLoadedMetadata)
      audio.load()
      nativeAudioControllersRef.current.set(clip.id, controller)
      return controller
    },
    [getPlaybackPath]
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
        const useProcessed = pitchPercent !== 100 || gainValue > 1
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
          const ctx = getAudioContext()
          shouldMuteVideo = true
          ensureAudioPipeline(clip)
          const pipeline = audioPipelinesRef.current.get(clip.id)
          if (!pipeline) return

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

          const nativeController = nativeAudioControllersRef.current.get(clip.id)
          if (nativeController) {
            nativeController.shouldPlay = false
            nativeController.audio.pause()
          }
        } else {
          const pipeline = audioPipelinesRef.current.get(clip.id)
          if (pipeline?.connected) {
            pipeline.shifter.disconnect()
            pipeline.gain.disconnect()
            pipeline.connected = false
          }

          const controller = ensureNativeAudioController(clip)
          const { audio } = controller
          audio.volume = Math.max(0, Math.min(1, gainValue))
          if (audio.playbackRate !== speedRate) {
            audio.playbackRate = speedRate
          }
          const lastTimeline = lastTimelineTimeRef.current.get(clip.id)
          const timelineJumped =
            lastTimeline === undefined || Math.abs(timelineTime - lastTimeline) > 0.1
          if (shouldPlay) {
            controller.shouldPlay = true
            if (timelineJumped || paramsChanged) {
              applyNativeAudioTime(controller, localTime)
            }
            startNativeAudio(controller)
          } else {
            controller.shouldPlay = false
            audio.pause()
            applyNativeAudioTime(controller, localTime)
          }
          lastTimelineTimeRef.current.set(clip.id, timelineTime)
        }
      })

      audioPipelinesRef.current.forEach((pipeline, id) => {
        if (!activeIds.has(id) && pipeline.connected) {
          pipeline.shifter.disconnect()
          pipeline.gain.disconnect()
          pipeline.connected = false
        }
      })

      nativeAudioControllersRef.current.forEach((controller, id) => {
        if (!activeIds.has(id)) {
          controller.shouldPlay = false
          controller.audio.pause()
          controller.pendingTime = null
          lastTimelineTimeRef.current.delete(id)
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
      ensureNativeAudioController,
      getAudioContext,
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
    nativeAudioControllersRef.current.forEach((controller) => {
      controller.shouldPlay = false
      controller.audio.pause()
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

    nativeAudioControllersRef.current.forEach((controller, id) => {
      if (clipIds.has(id)) return
      controller.shouldPlay = false
      controller.audio.pause()
      controller.audio.removeEventListener('loadedmetadata', controller.onLoadedMetadata)
      controller.audio.removeAttribute('src')
      controller.audio.load()
      nativeAudioControllersRef.current.delete(id)
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
      nativeAudioControllersRef.current.forEach((controller) => {
        controller.audio.removeEventListener('loadedmetadata', controller.onLoadedMetadata)
        controller.audio.removeAttribute('src')
        controller.audio.load()
      })
      nativeAudioControllersRef.current.clear()
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
