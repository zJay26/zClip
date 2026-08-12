import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type {
  AudioFadeSegment,
  MediaOperation,
  PitchParams,
  TimelineClip,
  VolumeParams
} from '../../../shared/types'
import {
  getSpeedRate,
  timelineTimeToMediaTime,
  type ClipTimelineRange
} from '../../../shared/timeline-utils'
import { getEffectiveTimelineAudioClips } from '../../../shared/audio-utils'
import { toMediaUrl } from '../lib/utils'
import { translate } from '../contexts/preferences'

interface UseAudioPlaybackEngineOptions {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  audioFades: AudioFadeSegment[]
  getClipRange: (clip: TimelineClip | null) => ClipTimelineRange | null
  getPlaybackPath: (clip: TimelineClip) => string
  videoRef: RefObject<HTMLVideoElement>
}

interface NativeAudioController {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
  src: string
  pendingTime: number | null
  shouldPlay: boolean
  playPromise: Promise<void> | null
  onLoadedMetadata: () => void
  lastUsed: number
}

const MAX_RETAINED_AUDIO_CONTROLLERS = 32

interface PitchProxyState {
  pitchPercent: number
  sourcePath: string
  playbackPath: string
}

function setGainValue(context: AudioContext, gain: GainNode, value: number): void {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0)
  try {
    gain.gain.cancelScheduledValues(context.currentTime)
    gain.gain.setTargetAtTime(safeValue, context.currentTime, 0.015)
  } catch {
    gain.gain.value = safeValue
  }
}

function applyAudioTime(controller: NativeAudioController, time: number): boolean {
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

function startAudio(controller: NativeAudioController): void {
  if (!controller.shouldPlay || controller.playPromise || !controller.audio.paused) return
  if (controller.pendingTime !== null && !applyAudioTime(controller, controller.pendingTime)) return

  controller.playPromise = controller.audio.play()
    .catch((error) => {
      if ((error as DOMException).name !== 'AbortError') {
        console.error('Failed to play timeline audio:', error)
      }
    })
    .finally(() => {
      controller.playPromise = null
    })
}

function disposeController(controller: NativeAudioController): void {
  controller.shouldPlay = false
  controller.audio.pause()
  controller.audio.removeEventListener('loadedmetadata', controller.onLoadedMetadata)
  controller.audio.removeAttribute('src')
  controller.audio.load()
  controller.source.disconnect()
  controller.gain.disconnect()
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
  const controllersRef = useRef<Map<string, NativeAudioController>>(new Map())
  const pitchProxyRef = useRef<Map<string, PitchProxyState>>(new Map())
  const pitchLoadingRef = useRef<
    Map<string, PitchProxyState & { promise: Promise<void> }>
  >(new Map())
  const pitchFailureRef = useRef<
    Map<string, { pitchPercent: number; sourcePath: string; retryAfter: number }>
  >(new Map())
  const lastTimelineTimeRef = useRef<Map<string, number>>(new Map())
  const lastParamsRef = useRef<
    Map<string, { speedRate: number; pitchPercent: number; playbackPath: string }>
  >(new Map())

  const fadesByClip = useMemo(() => {
    const result = new Map<string, AudioFadeSegment[]>()
    audioFades.forEach((fade) => {
      const current = result.get(fade.clipId)
      if (current) current.push(fade)
      else result.set(fade.clipId, [fade])
    })
    return result
  }, [audioFades])

  const effectiveAudioIds = useMemo(
    () => new Set(getEffectiveTimelineAudioClips(clips).map((clip) => clip.id)),
    [clips]
  )

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) throw new Error(translate('当前环境不支持 Web Audio', 'Web Audio is not supported in this environment'))
      audioContextRef.current = new AudioContextCtor()
    }
    return audioContextRef.current
  }, [])

  const resumeAudioContext = useCallback(() => {
    try {
      const context = getAudioContext()
      if (context.state === 'suspended') void context.resume().catch(() => {})
    } catch {
      // If Web Audio is unavailable, the preview remains safely muted.
    }
  }, [getAudioContext])

  const getVolumeForClip = useCallback((clipId: string): number => {
    const operation = (operationsByClip[clipId] || [])
      .find((item) => item.type === 'volume' && item.enabled)
    return operation
      ? Math.max(0, (operation.params as VolumeParams).percent)
      : 100
  }, [operationsByClip])

  const getPitchForClip = useCallback((clipId: string): number => {
    const operation = (operationsByClip[clipId] || [])
      .find((item) => item.type === 'pitch' && item.enabled)
    return operation
      ? Math.max(25, Math.min(400, (operation.params as PitchParams).percent))
      : 100
  }, [operationsByClip])

  const getFadeMultiplier = useCallback((
    clipId: string,
    clipLocalTime: number,
    visibleDuration: number
  ): number => {
    let multiplier = 1
    for (const fade of fadesByClip.get(clipId) || []) {
      const start = Math.max(0, Math.min(fade.startOffset, visibleDuration))
      const end = Math.max(start, Math.min(fade.endOffset, visibleDuration))
      const duration = end - start
      if (duration <= 0.001) continue

      if (fade.kind === 'in') {
        if (clipLocalTime <= start) multiplier = Math.min(multiplier, 0)
        else if (clipLocalTime < end) {
          multiplier = Math.min(multiplier, (clipLocalTime - start) / duration)
        }
      } else if (clipLocalTime >= end) {
        multiplier = Math.min(multiplier, 0)
      } else if (clipLocalTime > start) {
        multiplier = Math.min(multiplier, 1 - (clipLocalTime - start) / duration)
      }
    }
    return Math.max(0, Math.min(1, multiplier))
  }, [fadesByClip])

  const ensurePitchProxy = useCallback((clip: TimelineClip, pitchPercent: number): void => {
    const sourcePath = clip.filePath
    const ready = pitchProxyRef.current.get(clip.id)
    if (ready?.pitchPercent === pitchPercent && ready.sourcePath === sourcePath) return
    const loading = pitchLoadingRef.current.get(clip.id)
    if (loading?.pitchPercent === pitchPercent && loading.sourcePath === sourcePath) return
    const failed = pitchFailureRef.current.get(clip.id)
    if (
      failed?.pitchPercent === pitchPercent &&
      failed.sourcePath === sourcePath &&
      failed.retryAfter > Date.now()
    ) return

    let promise: Promise<void>
    promise = window.api.prepareAudioPitch(sourcePath, pitchPercent)
      .then((result) => {
        const current = pitchLoadingRef.current.get(clip.id)
        if (current?.promise !== promise) return
        if (!result.success || !result.playbackPath) {
          throw new Error(result.error || translate('音调代理生成失败', 'Pitch proxy generation failed'))
        }
        pitchProxyRef.current.set(clip.id, {
          pitchPercent,
          sourcePath,
          playbackPath: result.playbackPath
        })
        pitchFailureRef.current.delete(clip.id)
      })
      .catch((error) => {
        const current = pitchLoadingRef.current.get(clip.id)
        if (current?.promise !== promise) return
        pitchFailureRef.current.set(clip.id, {
          pitchPercent,
          sourcePath,
          retryAfter: Date.now() + 5_000
        })
        console.error('Failed to prepare pitch proxy:', error)
      })
      .finally(() => {
        const current = pitchLoadingRef.current.get(clip.id)
        if (current?.promise === promise) pitchLoadingRef.current.delete(clip.id)
      })

    pitchLoadingRef.current.set(clip.id, {
      pitchPercent,
      sourcePath,
      playbackPath: '',
      promise
    })
  }, [])

  const ensureController = useCallback((clip: TimelineClip, playbackPath: string): NativeAudioController => {
    const src = toMediaUrl(playbackPath)
    const existing = controllersRef.current.get(clip.id)
    if (existing?.src === src) return existing
    if (existing) disposeController(existing)

    const context = getAudioContext()
    const audio = new Audio(src)
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
    audio.preservesPitch = true
    const source = context.createMediaElementSource(audio)
    const gain = context.createGain()
    source.connect(gain)
    gain.connect(context.destination)
    const controller: NativeAudioController = {
      audio,
      source,
      gain,
      src,
      pendingTime: null,
      shouldPlay: false,
      playPromise: null,
      onLoadedMetadata: () => {},
      lastUsed: performance.now()
    }
    controller.onLoadedMetadata = () => {
      if (controller.pendingTime !== null) applyAudioTime(controller, controller.pendingTime)
      startAudio(controller)
    }
    audio.addEventListener('loadedmetadata', controller.onLoadedMetadata)
    audio.load()
    controllersRef.current.set(clip.id, controller)
    return controller
  }, [getAudioContext])

  const syncAudioForTime = useCallback((timelineTime: number, shouldPlay: boolean) => {
    const activeIds = new Set<string>()

    clips.forEach((clip) => {
      if (!effectiveAudioIds.has(clip.id)) return
      const range = getClipRange(clip)
      if (
        !range ||
        range.visibleDuration <= 0 ||
        timelineTime < range.start ||
        timelineTime >= range.end
      ) return

      activeIds.add(clip.id)
      const speedRate = getSpeedRate(operationsByClip[clip.id] || [])
      const pitchPercent = getPitchForClip(clip.id)
      if (pitchPercent !== 100) ensurePitchProxy(clip, pitchPercent)
      const pitched = pitchProxyRef.current.get(clip.id)
      const playbackPath = pitchPercent !== 100 &&
        pitched?.pitchPercent === pitchPercent &&
        pitched.sourcePath === clip.filePath
        ? pitched.playbackPath
        : getPlaybackPath(clip)

      const controller = ensureController(clip, playbackPath)
      controller.lastUsed = performance.now()
      const clipLocalTime = Math.max(0, Math.min(
        timelineTime - range.start,
        range.visibleDuration
      ))
      const gainValue = (getVolumeForClip(clip.id) / 100) *
        getFadeMultiplier(clip.id, clipLocalTime, range.visibleDuration)
      setGainValue(getAudioContext(), controller.gain, gainValue)
      if (controller.audio.playbackRate !== speedRate) controller.audio.playbackRate = speedRate

      const localMediaTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)
      const lastTimelineTime = lastTimelineTimeRef.current.get(clip.id)
      const lastParams = lastParamsRef.current.get(clip.id)
      const timelineJumped = lastTimelineTime === undefined ||
        Math.abs(timelineTime - lastTimelineTime) > 0.1
      const paramsChanged = !lastParams ||
        lastParams.speedRate !== speedRate ||
        lastParams.pitchPercent !== pitchPercent ||
        lastParams.playbackPath !== playbackPath

      if (shouldPlay) {
        controller.shouldPlay = true
        if (timelineJumped || paramsChanged) applyAudioTime(controller, localMediaTime)
        startAudio(controller)
      } else {
        controller.shouldPlay = false
        controller.audio.pause()
        applyAudioTime(controller, localMediaTime)
      }

      lastTimelineTimeRef.current.set(clip.id, timelineTime)
      lastParamsRef.current.set(clip.id, { speedRate, pitchPercent, playbackPath })
    })

    controllersRef.current.forEach((controller, id) => {
      if (activeIds.has(id)) return
      controller.shouldPlay = false
      controller.audio.pause()
      controller.pendingTime = null
      lastTimelineTimeRef.current.delete(id)
    })

    if (controllersRef.current.size > MAX_RETAINED_AUDIO_CONTROLLERS) {
      const inactive = Array.from(controllersRef.current.entries())
        .filter(([id]) => !activeIds.has(id))
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
      while (controllersRef.current.size > MAX_RETAINED_AUDIO_CONTROLLERS && inactive.length > 0) {
        const [id, controller] = inactive.shift()!
        disposeController(controller)
        controllersRef.current.delete(id)
        lastTimelineTimeRef.current.delete(id)
        lastParamsRef.current.delete(id)
      }
    }

    // All media audio is mixed by the streaming controllers above. Keeping the
    // visual element muted prevents duplicate audio and supports overlapping
    // video/audio clips just like the export graph.
    if (videoRef.current) videoRef.current.muted = true
  }, [
    clips,
    ensureController,
    ensurePitchProxy,
    effectiveAudioIds,
    getAudioContext,
    getClipRange,
    getFadeMultiplier,
    getPitchForClip,
    getPlaybackPath,
    getVolumeForClip,
    operationsByClip,
    videoRef
  ])

  const stopAllAudio = useCallback(() => {
    controllersRef.current.forEach((controller) => {
      controller.shouldPlay = false
      controller.audio.pause()
    })
  }, [])

  useEffect(() => {
    const clipsById = new Map(clips.map((clip) => [clip.id, clip]))
    controllersRef.current.forEach((controller, id) => {
      if (clipsById.has(id)) return
      disposeController(controller)
      controllersRef.current.delete(id)
    })
    pitchProxyRef.current.forEach((proxy, id) => {
      const clip = clipsById.get(id)
      if (!clip || clip.filePath !== proxy.sourcePath) pitchProxyRef.current.delete(id)
    })
    pitchLoadingRef.current.forEach((loading, id) => {
      const clip = clipsById.get(id)
      if (!clip || clip.filePath !== loading.sourcePath) pitchLoadingRef.current.delete(id)
    })
    pitchFailureRef.current.forEach((failure, id) => {
      const clip = clipsById.get(id)
      if (!clip || clip.filePath !== failure.sourcePath) pitchFailureRef.current.delete(id)
    })
    lastTimelineTimeRef.current.forEach((_time, id) => {
      if (!clipsById.has(id)) lastTimelineTimeRef.current.delete(id)
    })
    lastParamsRef.current.forEach((_params, id) => {
      if (!clipsById.has(id)) lastParamsRef.current.delete(id)
    })
  }, [clips])

  useEffect(() => () => {
    stopAllAudio()
    controllersRef.current.forEach(disposeController)
    controllersRef.current.clear()
    pitchProxyRef.current.clear()
    pitchLoadingRef.current.clear()
    pitchFailureRef.current.clear()
    lastTimelineTimeRef.current.clear()
    lastParamsRef.current.clear()
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [stopAllAudio])

  return { resumeAudioContext, syncAudioForTime, stopAllAudio }
}
