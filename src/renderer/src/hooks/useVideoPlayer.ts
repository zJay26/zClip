// ============================================================
// useVideoPlayer — 封装 <video> 元素播放状态同步
// ============================================================

import { useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../stores/project-store'
import type { SpeedParams, VolumeParams, PitchParams, TimelineClip } from '../../../shared/types'
import { PitchShifter } from 'soundtouchjs'
import {
  getClipTimelineRange,
  getSpeedRate,
  mediaTimeToTimelineTime,
  timelineTimeToMediaTime
} from '../../../shared/timeline-utils'

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const animFrameRef = useRef<number>(0)
  const pendingSeekRef = useRef<number | null>(null)
  const pendingAutoPlayRef = useRef(false)
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
  const syncAudioRef = useRef<((time: number, shouldPlay: boolean) => void) | null>(null)
  const seekVideoRef = useRef<
    ((clip: NonNullable<typeof selectedClip>, timelineTime: number, autoPlay: boolean) => void) | null
  >(null)
  const syncVideoRateRef = useRef<((clipId: string | null) => void) | null>(null)
  const lastVideoClockRef = useRef<{ clipId: string; mediaTime: number } | null>(null)
  const currentTimeRef = useRef(0)
  const lastTickRef = useRef<number>(0)
  const playingRef = useRef(false)

  const {
    clips,
    selectedClipId,
    timelineDuration,
    playing,
    operations,
    operationsByClip,
    currentTime,
    setCurrentTime,
    setPlaying,
    setClipDuration,
    activateClip
  } = useProjectStore()

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null
  // Get current trim & speed params (selected clip)
  const speedOp = operations.find((op) => op.type === 'speed' && op.enabled)
  const speedRate = speedOp ? (speedOp.params as SpeedParams).rate : 1.0

  const getClipRange = useCallback(
    (clip: TimelineClip | null) => {
      if (!clip) return null
      return getClipTimelineRange(clip, operationsByClip)
    },
    [operationsByClip]
  )

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

  const clampTimelineTimeSafe = useCallback(
    (time: number): number => {
      const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
      if (!Number.isFinite(time)) return 0
      return Math.max(0, Math.min(time, safeEnd))
    },
    [timelineDuration]
  )

  const findClipAtTime = useCallback(
    (time: number) => {
      if (clips.length === 0) return null
      const candidates = clips.filter((clip) => {
        const range = getClipRange(clip)
        if (!range || range.visibleDuration <= 0) return false
        return time >= range.start && time < range.end
      })
      if (candidates.length === 0) return null
      const videoCandidates = candidates.filter((c) => c.track === 'video')
      if (videoCandidates.length > 0) {
        return [...videoCandidates].sort((a, b) => a.trackIndex - b.trackIndex)[0]
      }
      return candidates[0]
    },
    [clips, getClipRange]
  )

  const findClipStartingAt = useCallback(
    (time: number) => {
      if (clips.length === 0) return null
      const EPS = 0.0005
      let best: TimelineClip | null = null
      clips.forEach((clip) => {
        const range = getClipRange(clip)
        if (!range || range.visibleDuration <= 0) return
        if (Math.abs(range.start - time) > EPS) return
        if (
          !best ||
          (best.track !== 'video' && clip.track === 'video') ||
          (clip.track === best.track && clip.trackIndex < best.trackIndex) ||
          (clip.track === best.track &&
            clip.trackIndex === best.trackIndex &&
            clip.id.localeCompare(best.id) < 0)
        ) {
          best = clip
        }
      })
      return best
    },
    [clips, getClipRange]
  )

  const findNextClipAfter = useCallback(
    (time: number) => {
      if (clips.length === 0) return null
      const EPS = 0.0005
      let best: TimelineClip | null = null
      let bestStart = Infinity
      clips.forEach((clip) => {
        const range = getClipRange(clip)
        if (!range || range.visibleDuration <= 0) return
        if (range.start < time - EPS) return
        const sameStart = Math.abs(range.start - bestStart) <= EPS
        if (
          !best ||
          range.start < bestStart - EPS ||
          (sameStart &&
            ((best.track !== 'video' && clip.track === 'video') ||
              (clip.track === best.track && clip.trackIndex < best.trackIndex) ||
              (clip.track === best.track &&
                clip.trackIndex === best.trackIndex &&
                clip.id.localeCompare(best.id) < 0)))
        ) {
          best = clip
          bestStart = range.start
        }
      })
      return best
    },
    [clips, getClipRange]
  )

  const getPlaybackPath = useCallback((clip: TimelineClip): string => {
    return clip.mediaInfo.playbackPath || clip.filePath
  }, [])

  const toMediaURL = useCallback((filePath: string): string => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    return normalizedPath.startsWith('/') ? `file://${normalizedPath}` : `file:///${normalizedPath}`
  }, [])

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
      // Ignore resume failures; audio will stay muted
    }
  }, [getAudioContext])

  const ensureAudioPipeline = useCallback(
    (clip: TimelineClip): void => {
      if (audioPipelinesRef.current.has(clip.id)) return
      if (audioLoadingRef.current.has(clip.id)) return
      const ctx = getAudioContext()

      const loadPromise = (async () => {
        try {
          const response = await fetch(toMediaURL(getPlaybackPath(clip)))
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
    [toMediaURL, getAudioContext, getPlaybackPath]
  )

  const ensureAudioElementPipeline = useCallback(
    (clip: TimelineClip): { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; connected: boolean } => {
      const existing = audioElementPipelinesRef.current.get(clip.id)
      if (existing) return existing
      const ctx = getAudioContext()
      let audio = audioElementRef.current.get(clip.id)
      if (!audio) {
        audio = new Audio(toMediaURL(getPlaybackPath(clip)))
        audio.preload = 'auto'
        audioElementRef.current.set(clip.id, audio)
      }
      const source = ctx.createMediaElementSource(audio)
      const gain = ctx.createGain()
      const pipeline = { audio, source, gain, connected: false }
      audioElementPipelinesRef.current.set(clip.id, pipeline)
      return pipeline
    },
    [getAudioContext, toMediaURL, getPlaybackPath]
  )

  const sliceAudioBuffer = useCallback(
    (buffer: AudioBuffer, startTime: number, ctx: AudioContext): AudioBuffer => {
      const startSample = Math.max(0, Math.floor(startTime * buffer.sampleRate))
      const length = Math.max(1, buffer.length - startSample)
      const sliced = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const src = buffer.getChannelData(ch)
        const dst = sliced.getChannelData(ch)
        dst.set(src.subarray(startSample))
      }
      return sliced
    },
    []
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
      const sourceBuffer =
        startTime !== undefined ? sliceAudioBuffer(buffer, startTime, ctx) : buffer
      const shifter = new PitchShifter(ctx, sourceBuffer, 1024)
      shifter.tempo = speedRate
      shifter.pitch = Math.max(0.01, pitchPercent / 100)
      if (connectNow) {
        shifter.connect(gain)
        gain.connect(ctx.destination)
      }
      return shifter
    },
    [sliceAudioBuffer]
  )

  const seekVideoForTime = useCallback(
    (clip: NonNullable<typeof selectedClip>, timelineTime: number, autoPlay: boolean) => {
      const range = getClipRange(clip)
      if (!range) return
      const localTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)

      const video = videoRef.current
      if (video) {
        syncVideoPlaybackRate(clip.id)
        const expectedSrc = toMediaURL(getPlaybackPath(clip))
        const currentSrc = video.currentSrc || ''
        const normalizeUrl = (url: string): string =>
          decodeURIComponent(url)
            .replace(/^file:\/\/\//, '')
            .replace(/^file:\/\//, '')
            .replace(/\\/g, '/')
        const normalizedExpected = normalizeUrl(expectedSrc)
        const normalizedCurrent = normalizeUrl(currentSrc)
        const isSameSource =
          normalizedCurrent === normalizedExpected || normalizedCurrent.endsWith(normalizedExpected)

        if (!isSameSource) {
          video.pause()
          video.src = expectedSrc
          video.load()
          lastVideoClockRef.current = null
          pendingSeekRef.current = localTime
          pendingAutoPlayRef.current = autoPlay
          return
        }

        if ((selectedClipId === clip.id || isSameSource) && video.readyState >= 1) {
          video.currentTime = localTime
          lastVideoClockRef.current = { clipId: clip.id, mediaTime: localTime }
          if (autoPlay) {
            video.play().catch(() => {
              pendingSeekRef.current = localTime
              pendingAutoPlayRef.current = true
            })
          }
          return
        }
        // Source is already set but metadata is not ready yet.
        // Avoid calling load() every frame, which can cause decode thrash/flicker.
      }

      pendingSeekRef.current = localTime
      pendingAutoPlayRef.current = autoPlay
      lastVideoClockRef.current = { clipId: clip.id, mediaTime: localTime }
    },
    [getClipRange, selectedClipId, operationsByClip, toMediaURL, syncVideoPlaybackRate, getPlaybackPath]
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

        const speedRate = getSpeedRateForClip(clip.id)
        const volumePercent = getVolumeForClip(clip.id)
        const pitchPercent = getPitchForClip(clip.id)
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

          pipeline.gain.gain.value = Math.max(0, volumePercent / 100)

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
          elementPipeline.gain.gain.value = Math.max(0, volumePercent / 100)
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
      operationsByClip,
      ensureAudioPipeline,
      ensureAudioElementPipeline,
      toMediaURL
    ]
  )

  useEffect(() => {
    if (!clips.length) return
    syncAudioForTime(currentTimeRef.current, playingRef.current)
  }, [clips, operationsByClip, syncAudioForTime])

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

  const stopTimeLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
  }, [])

  function syncVideoPlaybackRate(clipId: string | null): void {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    if (!clipId) return
    const rate = getSpeedRateForClip(clipId)
    if (video.playbackRate !== rate) {
      video.playbackRate = rate
    }
  }

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    syncAudioRef.current = syncAudioForTime
  }, [syncAudioForTime])

  useEffect(() => {
    seekVideoRef.current = seekVideoForTime
  }, [seekVideoForTime])

  useEffect(() => {
    syncVideoRateRef.current = syncVideoPlaybackRate
  }, [syncVideoPlaybackRate])

  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.track !== 'audio') return
      const pitchPercent = getPitchForClip(clip.id)
      if (pitchPercent !== 100) {
        ensureAudioPipeline(clip)
      }
    })
  }, [clips, getPitchForClip, ensureAudioPipeline])

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id))
    const normalizeUrl = (url: string): string =>
      decodeURIComponent(url)
        .replace(/^file:\/\/\//, '')
        .replace(/^file:\/\//, '')
        .replace(/\\/g, '/')

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

    const video = videoRef.current
    if (video) {
      const currentSrc = video.currentSrc || video.src || ''
      if (currentSrc) {
        const normalizedCurrent = normalizeUrl(currentSrc)
        const hasSource = clips.some((clip) => {
          const normalizedClip = normalizeUrl(getPlaybackPath(clip))
          return normalizedCurrent === normalizedClip || normalizedCurrent.endsWith(normalizedClip)
        })
        if (!hasSource) {
          video.pause()
          video.removeAttribute('src')
          video.load()
        }
      }
    }

    const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
    if (currentTimeRef.current > safeEnd) {
      currentTimeRef.current = safeEnd
      setCurrentTime(safeEnd)
    }

    const activeNow = findClipAtTime(currentTimeRef.current)
    if (!activeNow && playingRef.current) {
      video?.pause()
      stopAllAudio()
      stopTimeLoop()
      playingRef.current = false
      setPlaying(false)
    }
  }, [clips, timelineDuration, setCurrentTime, findClipAtTime, stopAllAudio, stopTimeLoop, setPlaying, getPlaybackPath])

  const commitTimelineTime = useCallback(
    (time: number) => {
      const next = clampTimelineTimeSafe(time)
      currentTimeRef.current = next
      setCurrentTime(next)
    },
    [setCurrentTime, clampTimelineTimeSafe]
  )

  // Time update loop — more responsive than 'timeupdate' event
  const startTimeLoop = useCallback(() => {
    if (animFrameRef.current) return
    const tick = (): void => {
      if (!playingRef.current) {
        stopTimeLoop()
        return
      }
      const syncAudio = syncAudioRef.current || syncAudioForTime
      const seekVideo = seekVideoRef.current || seekVideoForTime
      const syncVideoRate = syncVideoRateRef.current || syncVideoPlaybackRate
      const video = videoRef.current
      const now = performance.now()
      if (!lastTickRef.current) lastTickRef.current = now
      const delta = (now - lastTickRef.current) / 1000
      lastTickRef.current = now

      const timelineTime = currentTimeRef.current
      if (timelineTime >= timelineDuration) {
        const endTime = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
        commitTimelineTime(endTime)
        setPlaying(false)
        playingRef.current = false
        stopAllAudio()
        stopTimeLoop()
        return
      }

      const active = findClipAtTime(timelineTime)
      if (active && active.track === 'video') {
        if (video && video.paused) {
          seekVideo(active, timelineTime, true)
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }
      }

      if (video && !video.paused && active && active.track === 'video') {
        syncVideoRate(active.id)
        const range = getClipRange(active)
        if (!range) return
        const rawTime = Number.isFinite(video.currentTime) ? video.currentTime : range.trimEnd
        let time = rawTime
        const last = lastVideoClockRef.current
        const wrappedToStart =
          !!last &&
          last.clipId === active.id &&
          rawTime + 0.25 < last.mediaTime &&
          timelineTime > range.start + 0.5
        if (wrappedToStart) {
          // Some containers/codecs may silently wrap to 0 instead of firing a stable ended state.
          // Treat it as reached trim end to avoid endless restart loop.
          time = range.trimEnd
        }
        lastVideoClockRef.current = { clipId: active.id, mediaTime: Math.max(0, time) }

        if (time >= range.trimEnd) {
          const boundaryEpsilon = 0.0005
          // Ensure we move past current clip boundary, otherwise high-speed playback
          // can repeatedly re-enter the same tail frame and cause flicker.
          // Do not carry a potentially large frame delta across clip boundaries,
          // otherwise we may occasionally skip most of the next clip.
          const nextTime = range.end + boundaryEpsilon
          // Keep timeline moving linearly when there is still content ahead.
          video.pause()
          commitTimelineTime(nextTime)
          syncAudio(nextTime, true)
          const nextActive = findClipAtTime(nextTime)
          if (nextActive && nextActive.track === 'video') {
            seekVideo(nextActive, nextTime, true)
          }
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }

        const nextTimelineTime = mediaTimeToTimelineTime(active, operationsByClip, time)
        commitTimelineTime(nextTimelineTime)
        syncAudio(nextTimelineTime, true)
        animFrameRef.current = requestAnimationFrame(tick)
        return
      }

      if (active && active.track === 'audio') {
        lastVideoClockRef.current = null
        const range = getClipRange(active)
        if (!range) return
        const pitchPercent = getPitchForClip(active.id)
        const nextTime = timelineTime + delta
        if (nextTime >= range.end - 0.0001) {
          // Keep timeline moving linearly; do not jump over gaps.
          commitTimelineTime(nextTime)
          syncAudio(nextTime, true)
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }
        commitTimelineTime(nextTime)
        syncAudio(nextTime, true)
        animFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const nextTime = timelineTime + delta
      lastVideoClockRef.current = null
      commitTimelineTime(nextTime)
      syncAudio(nextTime, true)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }, [
    commitTimelineTime,
    findClipAtTime,
    getClipRange,
    seekVideoForTime,
    setCurrentTime,
    setPlaying,
    stopAllAudio,
    stopTimeLoop,
    syncAudioForTime,
    timelineDuration,
    operationsByClip
  ])

  // Play / pause
  const togglePlay = useCallback(() => {
    if (!playingRef.current) {
      resumeAudioContext()
      lastTickRef.current = 0
      playingRef.current = true
      const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
      let startTime = currentTimeRef.current
      if (timelineDuration > 0 && startTime >= safeEnd) {
        startTime = 0
        currentTimeRef.current = startTime
        setCurrentTime(startTime)
      }
      const active = findClipAtTime(startTime)
      if (active && active.track === 'video') {
        const video = videoRef.current
        if (!video) {
          setPlaying(true)
          startTimeLoop()
          return
        }
        seekVideoForTime(active, startTime, true)
      }
      syncAudioForTime(startTime, true)
      setPlaying(true)
      startTimeLoop()
    } else {
      const video = videoRef.current
      video?.pause()
      setPlaying(false)
      playingRef.current = false
      stopAllAudio()
      lastTickRef.current = 0
      stopTimeLoop()
    }
  }, [
    findClipAtTime,
    seekVideoForTime,
    setPlaying,
    setCurrentTime,
    stopAllAudio,
    startTimeLoop,
    stopTimeLoop,
    syncAudioForTime,
    resumeAudioContext,
    timelineDuration
  ])

  // Seek to specific time
  const seekTo = useCallback(
    (time: number) => {
      const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
      const clampedTime = Math.max(0, Math.min(time, safeEnd))
      const target = findClipAtTime(clampedTime)
      if (target && target.track === 'video') {
        seekVideoForTime(target, clampedTime, playing)
      }
      syncAudioForTime(clampedTime, playing)
      if (playing) {
        startTimeLoop()
      }
      setCurrentTime(clampedTime)
    },
    [
      findClipAtTime,
      playing,
      seekVideoForTime,
      setCurrentTime,
      startTimeLoop,
      stopTimeLoop,
      syncAudioForTime,
      timelineDuration
    ]
  )

  // Step forward/backward by seconds
  const step = useCallback(
    (seconds: number) => {
      const next = Math.max(0, Math.min(currentTime + seconds, timelineDuration))
      seekTo(next)
    },
    [currentTime, timelineDuration, seekTo]
  )

  // Handle video metadata loaded
  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (video) {
      const active = findClipAtTime(currentTimeRef.current)
      if (active) {
        setClipDuration(active.id, video.duration)
        if (active.track === 'video') {
          const targetTime = timelineTimeToMediaTime(active, operationsByClip, currentTimeRef.current)
          if (Number.isFinite(targetTime)) {
            video.currentTime = targetTime
          }
        }
      }
      if (pendingSeekRef.current !== null) {
        video.currentTime = pendingSeekRef.current
        lastVideoClockRef.current = {
          clipId: active?.id || '',
          mediaTime: pendingSeekRef.current
        }
        pendingSeekRef.current = null
        if (pendingAutoPlayRef.current) {
          pendingAutoPlayRef.current = false
          video.play()
          setPlaying(true)
          startTimeLoop()
        }
      }
    }
  }, [findClipAtTime, setClipDuration, setPlaying, startTimeLoop, operationsByClip])

  // Keep paused video frame in sync when source/clip changes.
  useEffect(() => {
    if (playingRef.current) return
    const active = findClipAtTime(currentTimeRef.current)
    if (!active || active.track !== 'video') return
    seekVideoForTime(active, currentTimeRef.current, false)
  }, [clips, operationsByClip, currentTime, findClipAtTime, seekVideoForTime])

  // Handle video ended
  const onEnded = useCallback(() => {
    const active = findClipAtTime(currentTimeRef.current)
    if (!active || active.track !== 'video') return
    const range = getClipRange(active)
    if (!range) return
    const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
    const target = Math.min(range.end, safeEnd)
    lastVideoClockRef.current = { clipId: active.id, mediaTime: range.trimEnd }
    setCurrentTime(target)
    const nextClip = findClipAtTime(target + 0.001) || findNextClipAfter(target + 0.001)
    if (!nextClip) {
      setPlaying(false)
      playingRef.current = false
      stopAllAudio()
      stopTimeLoop()
      syncAudioForTime(target, false)
      return
    }
    syncAudioForTime(target, true)
  }, [
    findClipAtTime,
    findNextClipAfter,
    getClipRange,
    setCurrentTime,
    setPlaying,
    stopAllAudio,
    stopTimeLoop,
    syncAudioForTime,
    timelineDuration
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimeLoop()
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
  }, [stopTimeLoop, stopAllAudio])

  return {
    videoRef,
    togglePlay,
    seekTo,
    step,
    onLoadedMetadata,
    onEnded,
    playing,
    selectedClip
  }
}
