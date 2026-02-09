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
          const response = await fetch(toMediaURL(clip.filePath))
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
    [toMediaURL, getAudioContext]
  )

  const ensureAudioElementPipeline = useCallback(
    (clip: TimelineClip): { audio: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; connected: boolean } => {
      const existing = audioElementPipelinesRef.current.get(clip.id)
      if (existing) return existing
      const ctx = getAudioContext()
      let audio = audioElementRef.current.get(clip.id)
      if (!audio) {
        audio = new Audio(toMediaURL(clip.filePath))
        audio.preload = 'auto'
        audioElementRef.current.set(clip.id, audio)
      }
      const source = ctx.createMediaElementSource(audio)
      const gain = ctx.createGain()
      const pipeline = { audio, source, gain, connected: false }
      audioElementPipelinesRef.current.set(clip.id, pipeline)
      return pipeline
    },
    [getAudioContext, toMediaURL]
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
        const expectedSrc = toMediaURL(clip.filePath)
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

        if ((selectedClipId === clip.id || isSameSource) && video.readyState >= 1) {
          video.currentTime = localTime
          if (autoPlay) {
            video.play()
          }
          return
        }
      }

      pendingSeekRef.current = localTime
      pendingAutoPlayRef.current = autoPlay
    },
    [getClipRange, selectedClipId, operationsByClip, toMediaURL]
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
        const localTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)

        const speedRate = getSpeedRateForClip(clip.id)
        const volumePercent = getVolumeForClip(clip.id)
        const pitchPercent = getPitchForClip(clip.id)
        const useProcessed = pitchPercent !== 100

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
            if (shouldPlay && (!pipeline.connected || timelineJumped)) {
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
          elementPipeline.audio.playbackRate = speedRate
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

  // Sync playback rate
  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.muted = true
      video.playbackRate = speedRate
    }
  }, [speedRate])

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.track !== 'audio') return
      const pitchPercent = getPitchForClip(clip.id)
      if (pitchPercent !== 100) {
        ensureAudioPipeline(clip)
      }
    })
  }, [clips, getPitchForClip, ensureAudioPipeline])

  const stopTimeLoop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
  }, [])

  const commitTimelineTime = useCallback(
    (time: number) => {
      currentTimeRef.current = time
      setCurrentTime(time)
    },
    [setCurrentTime]
  )

  // Time update loop — more responsive than 'timeupdate' event
  const startTimeLoop = useCallback(() => {
    if (animFrameRef.current) return
    const tick = (): void => {
      if (!playingRef.current) {
        stopTimeLoop()
        return
      }
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
          seekVideoForTime(active, timelineTime, true)
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }
      }

      if (video && !video.paused && active && active.track === 'video') {
        const range = getClipRange(active)
        if (!range) return
        const time = video.currentTime

        if (time >= range.trimEnd) {
          const nextTime = range.end + 0.0001
          const nextActive = findClipAtTime(nextTime)
          if (nextActive && nextActive.track === 'video') {
            commitTimelineTime(nextTime)
            seekVideoForTime(nextActive, nextTime, true)
            syncAudioForTime(nextTime, true)
            animFrameRef.current = requestAnimationFrame(tick)
            return
          }
          // No next clip at this time; keep moving through the gap
          video.pause()
          commitTimelineTime(nextTime)
          syncAudioForTime(nextTime, true)
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }

        const nextTimelineTime = mediaTimeToTimelineTime(active, operationsByClip, time)
        commitTimelineTime(nextTimelineTime)
        syncAudioForTime(nextTimelineTime, true)
        animFrameRef.current = requestAnimationFrame(tick)
        return
      }

      if (active && active.track === 'audio') {
        const range = getClipRange(active)
        if (!range) return
        const pitchPercent = getPitchForClip(active.id)
        const nextTime = timelineTime + delta
        if (nextTime >= range.end - 0.0001) {
          const nextSeek = range.end + 0.0001
          const nextActive = findClipAtTime(nextSeek)
          if (nextActive) {
            commitTimelineTime(nextSeek)
            syncAudioForTime(nextSeek, true)
            animFrameRef.current = requestAnimationFrame(tick)
            return
          }
          // No next clip at this time; continue through gap
          commitTimelineTime(nextSeek)
          syncAudioForTime(nextSeek, true)
          animFrameRef.current = requestAnimationFrame(tick)
          return
        }
        commitTimelineTime(nextTime)
        syncAudioForTime(nextTime, true)
        animFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const nextTime = timelineTime + delta
      commitTimelineTime(nextTime)
      syncAudioForTime(nextTime, true)
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
      const active = findClipAtTime(currentTime)
      if (active && active.track === 'video') {
        const video = videoRef.current
        if (!video) {
          setPlaying(true)
          startTimeLoop()
          return
        }
        seekVideoForTime(active, currentTime, true)
      }
      syncAudioForTime(currentTime, true)
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
    currentTime,
    findClipAtTime,
    seekVideoForTime,
    setPlaying,
    stopAllAudio,
    startTimeLoop,
    stopTimeLoop,
    syncAudioForTime,
    resumeAudioContext
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
      }
      if (pendingSeekRef.current !== null) {
        video.currentTime = pendingSeekRef.current
        pendingSeekRef.current = null
        if (pendingAutoPlayRef.current) {
          pendingAutoPlayRef.current = false
          video.play()
          setPlaying(true)
          startTimeLoop()
        }
      }
    }
  }, [findClipAtTime, setClipDuration, setPlaying, startTimeLoop])

  // Handle video ended
  const onEnded = useCallback(() => {
    if (!selectedClip) return
    const range = getClipRange(selectedClip)
    if (!range) return
    const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
    const target = Math.min(range.end, safeEnd)
    setCurrentTime(target)
    syncAudioForTime(target, true)
  }, [
    getClipRange,
    selectedClip,
    setCurrentTime,
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
