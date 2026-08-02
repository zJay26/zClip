// ============================================================
// useVideoPlayer — 封装 <video> 元素播放状态同步
// ============================================================

import { useRef, useEffect, useCallback } from 'react'
import { useProjectStore } from '../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import type { TimelineClip } from '../../../shared/types'
import {
  getClipTimelineRange,
  getTopmostVideoClipAtTime,
  getSpeedRate,
  mediaTimeToTimelineTime,
  timelineTimeToMediaTime
} from '../../../shared/timeline-utils'
import { mediaUrlToPath, toMediaUrl } from '../lib/utils'
import { useAudioPlaybackEngine } from './useAudioPlaybackEngine'

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const animFrameRef = useRef<number>(0)
  const pendingSeekRef = useRef<number | null>(null)
  const pendingAutoPlayRef = useRef(false)
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
    operationsByClip,
    audioFades,
    setCurrentTime,
    setPlaying,
    activateClip
  } = useProjectStore(useShallow((state) => ({
    clips: state.clips,
    selectedClipId: state.selectedClipId,
    timelineDuration: state.timelineDuration,
    playing: state.playing,
    operationsByClip: state.operationsByClip,
    audioFades: state.audioFades,
    setCurrentTime: state.setCurrentTime,
    setPlaying: state.setPlaying,
    activateClip: state.activateClip
  })))

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null

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
      const topVideo = getTopmostVideoClipAtTime(clips, operationsByClip, time)
      if (topVideo) return topVideo
      const candidates = clips.filter((clip) => {
        const range = getClipRange(clip)
        if (!range || range.visibleDuration <= 0) return false
        return time >= range.start && time < range.end
      })
      if (candidates.length === 0) return null
      return candidates[0]
    },
    [clips, operationsByClip, getClipRange]
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
      if (Number.isFinite(bestStart)) {
        const topVideo = getTopmostVideoClipAtTime(clips, operationsByClip, bestStart)
        if (topVideo) return topVideo
      }
      return best
    },
    [clips, operationsByClip, getClipRange]
  )

  const getPlaybackPath = useCallback((clip: TimelineClip): string => {
    return clip.mediaInfo.playbackPath || clip.filePath
  }, [])

  const { resumeAudioContext, syncAudioForTime, stopAllAudio } = useAudioPlaybackEngine({
    clips,
    operationsByClip,
    audioFades,
    getClipRange,
    getPlaybackPath,
    videoRef
  })

  const seekVideoForTime = useCallback(
    (clip: NonNullable<typeof selectedClip>, timelineTime: number, autoPlay: boolean) => {
      const range = getClipRange(clip)
      if (!range) return
      const localTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)

      const video = videoRef.current
      if (video) {
        syncVideoPlaybackRate(clip.id)
        const expectedSrc = toMediaUrl(getPlaybackPath(clip))
        const currentSrc = video.currentSrc || ''
        const normalizeUrl = (url: string): string => mediaUrlToPath(url).replace(/\\/g, '/')
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
    [getClipRange, selectedClipId, operationsByClip, syncVideoPlaybackRate, getPlaybackPath]
  )

  useEffect(() => {
    if (!clips.length) return
    syncAudioForTime(currentTimeRef.current, playingRef.current)
  }, [clips, operationsByClip, syncAudioForTime])

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

  useEffect(() => useProjectStore.subscribe((state, previous) => {
    if (state.currentTime === previous.currentTime) return
    currentTimeRef.current = state.currentTime
    if (playingRef.current) return
    const active = findClipAtTime(state.currentTime)
    if (active?.track === 'video') seekVideoRef.current?.(active, state.currentTime, false)
  }), [findClipAtTime])

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
    const normalizeUrl = (url: string): string => mediaUrlToPath(url).replace(/\\/g, '/')

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
      const next = Math.max(0, Math.min(currentTimeRef.current + seconds, timelineDuration))
      seekTo(next)
    },
    [timelineDuration, seekTo]
  )

  // Handle video metadata loaded
  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (video) {
      const active = findClipAtTime(currentTimeRef.current)
      if (active) {
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
          void video.play().catch(() => {
            pendingAutoPlayRef.current = true
          })
          setPlaying(true)
          startTimeLoop()
        }
      }
    }
  }, [findClipAtTime, setPlaying, startTimeLoop, operationsByClip])

  // Keep paused video frame in sync when source/clip structure changes.
  useEffect(() => {
    if (playingRef.current) return
    const active = findClipAtTime(currentTimeRef.current)
    if (!active || active.track !== 'video') return
    seekVideoForTime(active, currentTimeRef.current, false)
  }, [clips, operationsByClip, findClipAtTime, seekVideoForTime])

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
