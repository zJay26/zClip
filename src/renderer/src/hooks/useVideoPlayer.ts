// ============================================================
// useVideoPlayer — 封装 <video> 元素播放状态同步
// ============================================================

import { useRef, useEffect, useCallback, useState } from 'react'
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
import {
  getEligibleTransitionCuts,
  getTimelineTransitionTiming,
  transitionTimelineTimeToMediaTime,
  type TransitionCut,
  type TimelineTransitionTiming
} from '../../../shared/transition-utils'
import { mediaUrlToPath, toMediaUrl } from '../lib/utils'
import { useAudioPlaybackEngine } from './useAudioPlaybackEngine'

export type VideoBufferIndex = 0 | 1 | 2
export type VideoBufferClipIds = readonly [string | null, string | null, string | null]

export interface TransitionVideoBufferAssignment {
  transitionId: string
  leftIndex: VideoBufferIndex
  rightIndex: VideoBufferIndex
}

interface PendingVideoSeek {
  clipId: string
  mediaTime: number
  autoPlay: boolean
}

const VIDEO_BUFFER_INDICES: VideoBufferIndex[] = [0, 1, 2]

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoBuffer1Ref = useRef<HTMLVideoElement>(null)
  const videoBuffer2Ref = useRef<HTMLVideoElement>(null)
  const animFrameRef = useRef<number>(0)
  const pendingVideoSeeksRef = useRef<Map<VideoBufferIndex, PendingVideoSeek>>(new Map())
  const bufferClipIdsRef = useRef<Array<string | null>>([null, null, null])
  const activeVideoBufferRef = useRef<VideoBufferIndex>(0)
  const [activeVideoBuffer, setActiveVideoBuffer] = useState<VideoBufferIndex>(0)
  const [videoBufferClipIds, setVideoBufferClipIds] =
    useState<VideoBufferClipIds>([null, null, null])
  const [transitionVideoBuffers, setTransitionVideoBuffers] =
    useState<TransitionVideoBufferAssignment | null>(null)
  const transitionVideoBuffersRef = useRef<TransitionVideoBufferAssignment | null>(null)
  const syncAudioRef = useRef<((time: number, shouldPlay: boolean) => void) | null>(null)
  const seekVideoRef = useRef<
    ((clip: NonNullable<typeof selectedClip>, timelineTime: number, autoPlay: boolean) => void) | null
  >(null)
  const syncVideoRateRef = useRef<((clipId: string | null) => void) | null>(null)
  const lastVideoClockRef = useRef<{ clipId: string; mediaTime: number } | null>(null)
  const currentTimeRef = useRef(0)
  const lastTickRef = useRef<number>(0)
  const playingRef = useRef(false)
  const activeTransitionClockRef = useRef<{
    id: string
    phase: 'before' | 'after'
  } | null>(null)

  const {
    clips,
    selectedClipId,
    timelineDuration,
    playing,
    operationsByClip,
    transitions,
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
    transitions: state.transitions,
    audioFades: state.audioFades,
    setCurrentTime: state.setCurrentTime,
    setPlaying: state.setPlaying,
    activateClip: state.activateClip
  })))

  const selectedClip = clips.find((clip) => clip.id === selectedClipId) || null

  const getVideoBuffer = useCallback((index: VideoBufferIndex): HTMLVideoElement | null => {
    if (index === 0) return videoRef.current
    if (index === 1) return videoBuffer1Ref.current
    return videoBuffer2Ref.current
  }, [])

  const getActiveVideo = useCallback(
    (): HTMLVideoElement | null => getVideoBuffer(activeVideoBufferRef.current),
    [getVideoBuffer]
  )

  const activateVideoBuffer = useCallback((index: VideoBufferIndex): void => {
    activeVideoBufferRef.current = index
    setActiveVideoBuffer((current) => current === index ? current : index)
  }, [])

  const commitVideoBufferClipId = useCallback((
    index: VideoBufferIndex,
    clipId: string | null
  ): void => {
    bufferClipIdsRef.current[index] = clipId
    setVideoBufferClipIds((current) => {
      if (current[index] === clipId) return current
      const next: [string | null, string | null, string | null] = [...current]
      next[index] = clipId
      return next
    })
  }, [])

  const commitTransitionVideoBuffers = useCallback((assignment: TransitionVideoBufferAssignment | null): void => {
    transitionVideoBuffersRef.current = assignment
    setTransitionVideoBuffers((current) => {
      if (!assignment) return current ? null : current
      if (
        current?.transitionId === assignment.transitionId &&
        current.leftIndex === assignment.leftIndex &&
        current.rightIndex === assignment.rightIndex
      ) return current
      return assignment
    })
  }, [])

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

  const findActiveTransitionAtTime = useCallback((time: number) => {
    let active: ReturnType<typeof getTimelineTransitionTiming> = null
    for (const transition of transitions) {
      const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
      if (!timing || time < timing.start || time >= timing.end) continue
      if (
        !active ||
        timing.trackIndex > active.trackIndex ||
        (timing.trackIndex === active.trackIndex && timing.start > active.start)
      ) active = timing
    }
    return active
  }, [clips, operationsByClip, transitions])

  const findPreparedTransitionAtTime = useCallback((time: number, lead = 1.25) => {
    let prepared: TimelineTransitionTiming | null = null
    for (const transition of transitions) {
      const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
      if (!timing || time < timing.start - lead || time > timing.end) continue
      if (!prepared || timing.start < prepared.start) prepared = timing
    }
    return prepared
  }, [clips, operationsByClip, transitions])

  const findNextTransitionAtTime = useCallback((time: number) => {
    let next: TimelineTransitionTiming | null = null
    for (const transition of transitions) {
      const timing = getTimelineTransitionTiming(transition, clips, operationsByClip)
      if (!timing || timing.end < time) continue
      if (!next || timing.start < next.start) next = timing
    }
    return next
  }, [clips, operationsByClip, transitions])

  const findUpcomingVideoCutAtTime = useCallback((
    time: number,
    lead = 1.25
  ): TransitionCut | null => {
    const EPS = 0.0005
    let upcoming: TransitionCut | null = null
    for (const cut of getEligibleTransitionCuts(clips, operationsByClip)) {
      if (time < cut.leftRange.start - EPS || time > cut.boundary + EPS) continue
      if (cut.boundary - time > lead) continue
      if (transitions.some((transition) =>
        transition.leftClipId === cut.left.id && transition.rightClipId === cut.right.id
      )) continue

      // Only prime a cut that really owns the visible top layer on both sides.
      // A same-track edit hidden underneath another video must not steal the
      // main decoder when the playhead reaches its boundary.
      const beforeProbe = Math.max(
        cut.leftRange.start,
        Math.min(time, cut.boundary - EPS)
      )
      const visibleBefore = getTopmostVideoClipAtTime(clips, operationsByClip, beforeProbe)
      const visibleAfter = getTopmostVideoClipAtTime(clips, operationsByClip, cut.boundary + EPS)
      if (visibleBefore?.id !== cut.left.id || visibleAfter?.id !== cut.right.id) continue
      if (!upcoming || cut.boundary < upcoming.boundary) upcoming = cut
    }
    return upcoming
  }, [clips, operationsByClip, transitions])

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

  const setVideoBufferPlaybackRate = useCallback((index: VideoBufferIndex, rate: number): void => {
    const video = getVideoBuffer(index)
    if (!video) return
    video.muted = true
    if (!Number.isFinite(rate) || rate <= 0) return
    const safeRate = Math.max(0.0625, Math.min(16, rate))
    if (Math.abs(video.playbackRate - safeRate) > 0.0001) video.playbackRate = safeRate
  }, [getVideoBuffer])

  const syncVideoBufferPlaybackRate = useCallback((index: VideoBufferIndex, clipId: string | null): void => {
    if (!clipId) return
    setVideoBufferPlaybackRate(index, getSpeedRateForClip(clipId))
  }, [getSpeedRateForClip, setVideoBufferPlaybackRate])

  const syncVideoPlaybackRate = useCallback((clipId: string | null): void => {
    syncVideoBufferPlaybackRate(activeVideoBufferRef.current, clipId)
  }, [syncVideoBufferPlaybackRate])

  const seekVideoBuffer = useCallback((
    index: VideoBufferIndex,
    clip: TimelineClip,
    timelineTime: number,
    autoPlay: boolean,
    mediaTimeOverride?: number
  ): void => {
    const ordinaryMediaTime = timelineTimeToMediaTime(clip, operationsByClip, timelineTime)
    const localTime = Number.isFinite(mediaTimeOverride)
      ? Math.max(0, Math.min(clip.duration, mediaTimeOverride as number))
      : ordinaryMediaTime
    const video = getVideoBuffer(index)
    const pending: PendingVideoSeek = { clipId: clip.id, mediaTime: localTime, autoPlay }
    commitVideoBufferClipId(index, clip.id)
    pendingVideoSeeksRef.current.set(index, pending)
    if (!video) return

    syncVideoBufferPlaybackRate(index, clip.id)
    const expectedSrc = toMediaUrl(getPlaybackPath(clip))
    const currentSrc = video.currentSrc || video.src || ''
    const normalizeUrl = (url: string): string => mediaUrlToPath(url).replace(/\\/g, '/')
    const normalizedExpected = normalizeUrl(expectedSrc)
    const normalizedCurrent = normalizeUrl(currentSrc)
    const isSameSource = normalizedCurrent === normalizedExpected || normalizedCurrent.endsWith(normalizedExpected)

    if (!isSameSource) {
      video.pause()
      video.src = expectedSrc
      video.load()
      if (index === activeVideoBufferRef.current) lastVideoClockRef.current = null
      return
    }
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return

    if (Math.abs(video.currentTime - localTime) > 0.002) video.currentTime = localTime
    pendingVideoSeeksRef.current.delete(index)
    if (index === activeVideoBufferRef.current) {
      lastVideoClockRef.current = { clipId: clip.id, mediaTime: localTime }
    }
    if (autoPlay) {
      void video.play().catch(() => pendingVideoSeeksRef.current.set(index, pending))
    } else {
      video.pause()
    }
  }, [commitVideoBufferClipId, getPlaybackPath, getVideoBuffer, operationsByClip, syncVideoBufferPlaybackRate])

  const seekVideoForTime = useCallback(
    (clip: NonNullable<typeof selectedClip>, timelineTime: number, autoPlay: boolean) => {
      const range = getClipRange(clip)
      if (!range) return
      const existingIndex = VIDEO_BUFFER_INDICES.find(
        (index) => bufferClipIdsRef.current[index] === clip.id
      )
      const targetIndex = existingIndex ?? activeVideoBufferRef.current
      activateVideoBuffer(targetIndex)
      seekVideoBuffer(targetIndex, clip, timelineTime, autoPlay)
    },
    [activateVideoBuffer, getClipRange, seekVideoBuffer]
  )

  const prepareTransitionVideoBuffers = useCallback((
    timing: TimelineTransitionTiming,
    timelineTime: number,
    transitionOwnsActiveVideo: boolean
  ): TransitionVideoBufferAssignment | null => {
    const current = transitionVideoBuffersRef.current
    const preparedTime = Math.max(timing.start, Math.min(timelineTime, timing.end))
    if (
      current?.transitionId === timing.transition.id &&
      bufferClipIdsRef.current[current.leftIndex] === timing.left.id &&
      bufferClipIdsRef.current[current.rightIndex] === timing.right.id
    ) {
      if (!playingRef.current && timelineTime >= timing.start && timelineTime <= timing.end) {
        seekVideoBuffer(
          current.leftIndex,
          timing.left,
          preparedTime,
          false,
          transitionTimelineTimeToMediaTime(timing, 'left', preparedTime)
        )
        seekVideoBuffer(
          current.rightIndex,
          timing.right,
          preparedTime,
          false,
          transitionTimelineTimeToMediaTime(timing, 'right', preparedTime)
        )
      } else if (timelineTime < timing.start) {
        const rightVideo = getVideoBuffer(current.rightIndex)
        const expectedRight = transitionTimelineTimeToMediaTime(
          timing,
          'right',
          timing.start
        )
        const pending = pendingVideoSeeksRef.current.get(current.rightIndex)
        const hasMatchingPending = pending?.clipId === timing.right.id &&
          Math.abs(pending.mediaTime - expectedRight) <= 0.002 &&
          !pending.autoPlay
        const needsPrime = (!rightVideo || rightVideo.readyState < HTMLMediaElement.HAVE_METADATA)
          ? !hasMatchingPending
          : !rightVideo.paused || Math.abs(rightVideo.currentTime - expectedRight) > 0.01
        if (needsPrime) {
          seekVideoBuffer(
            current.rightIndex,
            timing.right,
            preparedTime,
            false,
            expectedRight
          )
        }
      }
      return current
    }

    const activeIndex = activeVideoBufferRef.current
    const findClipBuffer = (clipId: string): VideoBufferIndex | undefined =>
      VIDEO_BUFFER_INDICES.find((index) => bufferClipIdsRef.current[index] === clipId)
    const chooseBuffer = (excluded: Set<VideoBufferIndex>): VideoBufferIndex | undefined =>
      VIDEO_BUFFER_INDICES.find((index) => !excluded.has(index))

    let leftIndex = findClipBuffer(timing.left.id)
    if (leftIndex === undefined) {
      leftIndex = transitionOwnsActiveVideo
        ? activeIndex
        : chooseBuffer(new Set([activeIndex]))
    }
    if (leftIndex === undefined) return null

    let rightIndex = findClipBuffer(timing.right.id)
    if (rightIndex === leftIndex) rightIndex = undefined
    if (rightIndex === undefined) {
      const excluded = new Set<VideoBufferIndex>([leftIndex])
      if (!transitionOwnsActiveVideo) excluded.add(activeIndex)
      rightIndex = chooseBuffer(excluded)
    }
    if (rightIndex === undefined) return null

    const assignment = {
      transitionId: timing.transition.id,
      leftIndex,
      rightIndex
    }
    if (leftIndex !== activeIndex || !transitionOwnsActiveVideo) {
      seekVideoBuffer(
        leftIndex,
        timing.left,
        preparedTime,
        false,
        transitionTimelineTimeToMediaTime(timing, 'left', preparedTime)
      )
    }
    seekVideoBuffer(
      rightIndex,
      timing.right,
      preparedTime,
      false,
      transitionTimelineTimeToMediaTime(timing, 'right', preparedTime)
    )
    commitTransitionVideoBuffers(assignment)
    return assignment
  }, [commitTransitionVideoBuffers, getVideoBuffer, seekVideoBuffer])

  const prepareUpcomingVideoCut = useCallback((time: number): VideoBufferIndex | null => {
    const cut = findUpcomingVideoCutAtTime(time)
    if (!cut) return null
    const existingIndex = VIDEO_BUFFER_INDICES.find(
      (index) => bufferClipIdsRef.current[index] === cut.right.id
    )
    if (existingIndex !== undefined) return existingIndex

    const activeIndex = activeVideoBufferRef.current
    const candidates = VIDEO_BUFFER_INDICES.filter((index) => index !== activeIndex)
    const transitionAssignment = transitionVideoBuffersRef.current
    const targetIndex = candidates.find((index) => bufferClipIdsRef.current[index] === null) ??
      candidates.find((index) =>
        index !== transitionAssignment?.leftIndex && index !== transitionAssignment?.rightIndex
      ) ??
      candidates[0]
    if (targetIndex === undefined) return null

    // Decode the incoming clip's first visible frame off-screen. At the cut we
    // only rotate buffer identity; the visible decoder is never repointed.
    seekVideoBuffer(targetIndex, cut.right, cut.boundary + 0.0005, false)
    return targetIndex
  }, [findUpcomingVideoCutAtTime, seekVideoBuffer])

  const syncTransitionVideoBuffers = useCallback((
    timing: TimelineTransitionTiming,
    timelineTime: number,
    transitionOwnsActiveVideo: boolean
  ): TransitionVideoBufferAssignment | null => {
    const assignment = prepareTransitionVideoBuffers(
      timing,
      timelineTime,
      transitionOwnsActiveVideo
    )
    if (!assignment) return null

    const syncSide = (side: 'left' | 'right', index: VideoBufferIndex): void => {
      const video = getVideoBuffer(index)
      if (!video) return
      const expectedMediaTime = transitionTimelineTimeToMediaTime(timing, side, timelineTime)
      const startMediaTime = transitionTimelineTimeToMediaTime(timing, side, timing.start)
      const endMediaTime = transitionTimelineTimeToMediaTime(timing, side, timing.end)
      const transitionRate = (endMediaTime - startMediaTime) / timing.duration

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA &&
        Math.abs(video.currentTime - expectedMediaTime) > 0.075) {
        video.currentTime = expectedMediaTime
      }
      if (transitionRate <= 0.0001) {
        video.pause()
        return
      }
      setVideoBufferPlaybackRate(index, transitionRate)
      const holdingSourceEnd = video.ended || (
        Number.isFinite(video.duration) &&
        expectedMediaTime >= video.duration - 0.003 &&
        timelineTime >= timing.end - 0.01
      )
      if (
        !holdingSourceEnd &&
        video.paused &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        void video.play().catch(() => undefined)
      }
    }

    // Both decoders run for the whole effect. Their rates are derived from the
    // continuous entry/exit mapping, so crossing the edit point does not stop
    // one stream and cold-start the other.
    syncSide('left', assignment.leftIndex)
    syncSide('right', assignment.rightIndex)
    return assignment
  }, [getVideoBuffer, prepareTransitionVideoBuffers, setVideoBufferPlaybackRate])

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
    VIDEO_BUFFER_INDICES.forEach((index) => {
      const video = getVideoBuffer(index)
      if (!video) return
      const assignedClipId = bufferClipIdsRef.current[index]
      if (assignedClipId && !clips.some((clip) => clip.id === assignedClipId)) {
        commitVideoBufferClipId(index, null)
        pendingVideoSeeksRef.current.delete(index)
      }
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
          commitVideoBufferClipId(index, null)
          pendingVideoSeeksRef.current.delete(index)
        }
      }
    })

    const activeAssignment = transitionVideoBuffersRef.current
    if (activeAssignment && !transitions.some((transition) => transition.id === activeAssignment.transitionId)) {
      commitTransitionVideoBuffers(null)
    }

    const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
    if (currentTimeRef.current > safeEnd) {
      currentTimeRef.current = safeEnd
      setCurrentTime(safeEnd)
    }

    const activeNow = findClipAtTime(currentTimeRef.current)
    if (!activeNow && playingRef.current) {
      getActiveVideo()?.pause()
      stopAllAudio()
      stopTimeLoop()
      playingRef.current = false
      setPlaying(false)
    }
  }, [clips, transitions, timelineDuration, setCurrentTime, findClipAtTime, stopAllAudio, stopTimeLoop, setPlaying, getPlaybackPath, getActiveVideo, getVideoBuffer, commitTransitionVideoBuffers, commitVideoBufferClipId])

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
      const video = getActiveVideo()
      const now = performance.now()
      if (!lastTickRef.current) lastTickRef.current = now
      const delta = (now - lastTickRef.current) / 1000
      lastTickRef.current = now

      const timelineTime = currentTimeRef.current
      const endTime = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
      if (timelineDuration <= 0 || timelineTime >= endTime) {
        commitTimelineTime(endTime)
        setPlaying(false)
        playingRef.current = false
        stopAllAudio()
        stopTimeLoop()
        return
      }

      const active = findClipAtTime(timelineTime)
      const activeTransition = findActiveTransitionAtTime(timelineTime)
      const transitionOwnsMainVideo = !!activeTransition && !!active && (
        active.id === activeTransition.left.id || active.id === activeTransition.right.id
      )
      prepareUpcomingVideoCut(timelineTime)
      const preparedTransition = activeTransition ?? findPreparedTransitionAtTime(timelineTime)
      if (preparedTransition) {
        const preparedOwnsMainVideo = !!active && (
          active.id === preparedTransition.left.id || active.id === preparedTransition.right.id
        )
        if (activeTransition) {
          syncTransitionVideoBuffers(activeTransition, timelineTime, preparedOwnsMainVideo)
        } else {
          prepareTransitionVideoBuffers(preparedTransition, timelineTime, preparedOwnsMainVideo)
        }
      }
      if (activeTransition && transitionOwnsMainVideo) {
        const phase = timelineTime < activeTransition.boundary ? 'before' : 'after'
        const transitionClock = activeTransitionClockRef.current
        if (transitionClock?.id !== activeTransition.transition.id) {
          activeTransitionClockRef.current = {
            id: activeTransition.transition.id,
            phase
          }
        } else if (transitionClock.phase !== phase) {
          activeTransitionClockRef.current = {
            id: activeTransition.transition.id,
            phase
          }
          const assignment = transitionVideoBuffersRef.current
          if (assignment?.transitionId === activeTransition.transition.id) {
            // Keep the ordinary main-buffer identity unchanged until the whole
            // transition has finished. Promoting the incoming buffer at the
            // edit point can briefly classify it as a normal full-opacity
            // layer while React is committing the transition styles.
            syncTransitionVideoBuffers(activeTransition, timelineTime, true)
          }
        }

        const nextTime = Math.min(
          timelineTime + Math.max(0, delta),
          activeTransition.end + 0.0005
        )
        commitTimelineTime(nextTime)
        syncAudio(nextTime, true)
        if (nextTime >= activeTransition.end - 0.0001) {
          activeTransitionClockRef.current = null
          const assignment = transitionVideoBuffersRef.current
          if (assignment?.transitionId === activeTransition.transition.id) {
            getVideoBuffer(assignment.leftIndex)?.pause()
            activateVideoBuffer(assignment.rightIndex)
            syncVideoBufferPlaybackRate(assignment.rightIndex, activeTransition.right.id)
            const incomingVideo = getVideoBuffer(assignment.rightIndex)
            if (incomingVideo) {
              lastVideoClockRef.current = {
                clipId: activeTransition.right.id,
                mediaTime: incomingVideo.currentTime
              }
            }
            const nextTransition = findNextTransitionAtTime(activeTransition.end + 0.001)
            if (nextTransition) {
              const nextActive = findClipAtTime(activeTransition.end + 0.001)
              const nextOwnsMainVideo = !!nextActive && (
                nextActive.id === nextTransition.left.id || nextActive.id === nextTransition.right.id
              )
              prepareTransitionVideoBuffers(nextTransition, activeTransition.end + 0.001, nextOwnsMainVideo)
            }
          }
        }
        animFrameRef.current = requestAnimationFrame(tick)
        return
      }
      activeTransitionClockRef.current = null
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
    activateVideoBuffer,
    findClipAtTime,
    findActiveTransitionAtTime,
    findNextTransitionAtTime,
    findPreparedTransitionAtTime,
    getActiveVideo,
    getVideoBuffer,
    getClipRange,
    prepareUpcomingVideoCut,
    prepareTransitionVideoBuffers,
    seekVideoForTime,
    setCurrentTime,
    setPlaying,
    stopAllAudio,
    stopTimeLoop,
    syncAudioForTime,
    syncVideoBufferPlaybackRate,
    syncTransitionVideoBuffers,
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
      prepareUpcomingVideoCut(startTime)
      const activeTransition = findActiveTransitionAtTime(startTime)
      const transitionOwnsMainVideo = !!activeTransition && !!active && (
        active.id === activeTransition.left.id || active.id === activeTransition.right.id
      )
      if (activeTransition) {
        const phase = startTime < activeTransition.boundary ? 'before' : 'after'
        activeTransitionClockRef.current = {
          id: activeTransition.transition.id,
          phase
        }
        const assignment = syncTransitionVideoBuffers(
          activeTransition,
          startTime,
          transitionOwnsMainVideo
        )
        if (transitionOwnsMainVideo && phase === 'after' && assignment) {
          activateVideoBuffer(assignment.rightIndex)
        }
      } else if (active && active.track === 'video') {
        const video = getActiveVideo()
        if (!video) {
          setPlaying(true)
          startTimeLoop()
          return
        }
        seekVideoForTime(active, startTime, true)
      }
      const preparedTransition = findPreparedTransitionAtTime(startTime)
      if (preparedTransition && !activeTransition) {
        const ownsPreparedVideo = !!active && (
          active.id === preparedTransition.left.id || active.id === preparedTransition.right.id
        )
        prepareTransitionVideoBuffers(preparedTransition, startTime, ownsPreparedVideo)
      }
      syncAudioForTime(startTime, true)
      setPlaying(true)
      startTimeLoop()
    } else {
      VIDEO_BUFFER_INDICES.forEach((index) => getVideoBuffer(index)?.pause())
      setPlaying(false)
      playingRef.current = false
      stopAllAudio()
      lastTickRef.current = 0
      stopTimeLoop()
    }
  }, [
    activateVideoBuffer,
    findClipAtTime,
    findActiveTransitionAtTime,
    findPreparedTransitionAtTime,
    getActiveVideo,
    getVideoBuffer,
    prepareUpcomingVideoCut,
    prepareTransitionVideoBuffers,
    seekVideoForTime,
    setPlaying,
    setCurrentTime,
    stopAllAudio,
    startTimeLoop,
    stopTimeLoop,
    syncAudioForTime,
    syncTransitionVideoBuffers,
    resumeAudioContext,
    timelineDuration
  ])

  // Seek to specific time
  const seekTo = useCallback(
    (time: number) => {
      const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
      const clampedTime = Math.max(0, Math.min(time, safeEnd))
      const target = findClipAtTime(clampedTime)
      prepareUpcomingVideoCut(clampedTime)
      const activeTransition = findActiveTransitionAtTime(clampedTime)
      const transitionOwnsMainVideo = !!activeTransition && !!target && (
        target.id === activeTransition.left.id || target.id === activeTransition.right.id
      )
      if (activeTransition) {
        const phase = clampedTime < activeTransition.boundary ? 'before' : 'after'
        activeTransitionClockRef.current = { id: activeTransition.transition.id, phase }
        const assignment = prepareTransitionVideoBuffers(
          activeTransition,
          clampedTime,
          transitionOwnsMainVideo
        )
        if (assignment) {
          seekVideoBuffer(
            assignment.leftIndex,
            activeTransition.left,
            clampedTime,
            playing,
            transitionTimelineTimeToMediaTime(activeTransition, 'left', clampedTime)
          )
          seekVideoBuffer(
            assignment.rightIndex,
            activeTransition.right,
            clampedTime,
            playing,
            transitionTimelineTimeToMediaTime(activeTransition, 'right', clampedTime)
          )
          if (transitionOwnsMainVideo) {
            activateVideoBuffer(phase === 'before' ? assignment.leftIndex : assignment.rightIndex)
          }
        }
      } else if (target && target.track === 'video') {
        activeTransitionClockRef.current = null
        seekVideoForTime(target, clampedTime, playing)
      }
      const preparedTransition = findPreparedTransitionAtTime(clampedTime)
      if (preparedTransition && !activeTransition) {
        const ownsPreparedVideo = !!target && (
          target.id === preparedTransition.left.id || target.id === preparedTransition.right.id
        )
        prepareTransitionVideoBuffers(preparedTransition, clampedTime, ownsPreparedVideo)
      }
      syncAudioForTime(clampedTime, playing)
      if (playing) {
        startTimeLoop()
      }
      setCurrentTime(clampedTime)
    },
    [
      activateVideoBuffer,
      findClipAtTime,
      findActiveTransitionAtTime,
      findPreparedTransitionAtTime,
      playing,
      prepareUpcomingVideoCut,
      prepareTransitionVideoBuffers,
      seekVideoBuffer,
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
  const onLoadedMetadata = useCallback((index: VideoBufferIndex = 0) => {
    const video = getVideoBuffer(index)
    if (!video) return
    const pending = pendingVideoSeeksRef.current.get(index)
    if (pending) {
      video.currentTime = pending.mediaTime
      pendingVideoSeeksRef.current.delete(index)
      if (index === activeVideoBufferRef.current) {
        lastVideoClockRef.current = {
          clipId: pending.clipId,
          mediaTime: pending.mediaTime
        }
      }
      if (pending.autoPlay) {
        void video.play().catch(() => pendingVideoSeeksRef.current.set(index, pending))
        setPlaying(true)
        startTimeLoop()
      }
      return
    }

    if (index !== activeVideoBufferRef.current) return
    const active = findClipAtTime(currentTimeRef.current)
    if (active?.track !== 'video' || bufferClipIdsRef.current[index] !== active.id) return
    const targetTime = timelineTimeToMediaTime(active, operationsByClip, currentTimeRef.current)
    if (Number.isFinite(targetTime)) video.currentTime = targetTime
  }, [findClipAtTime, getVideoBuffer, setPlaying, startTimeLoop, operationsByClip])

  // Keep paused video frame in sync when source/clip structure changes.
  useEffect(() => {
    if (playingRef.current) return
    const active = findClipAtTime(currentTimeRef.current)
    if (!active || active.track !== 'video') return
    seekVideoForTime(active, currentTimeRef.current, false)
  }, [clips, operationsByClip, findClipAtTime, seekVideoForTime])

  // Prime the next incoming source while it is off-screen. The active decoder
  // is never repointed at a transition boundary; buffers rotate instead.
  useEffect(() => {
    const timing = findNextTransitionAtTime(currentTimeRef.current)
    if (!timing) return
    const active = findClipAtTime(currentTimeRef.current)
    const ownsActiveVideo = !!active && (
      active.id === timing.left.id || active.id === timing.right.id
    )
    prepareTransitionVideoBuffers(timing, currentTimeRef.current, ownsActiveVideo)
  }, [activeVideoBuffer, clips, findClipAtTime, findNextTransitionAtTime, operationsByClip, prepareTransitionVideoBuffers, transitions])

  // Apply the same off-screen decode policy to ordinary touching cuts. This
  // removes the first-play-only black frame that used to disappear merely
  // because adding and deleting a transition happened to leave a spare source
  // loaded by accident.
  useEffect(() => {
    prepareUpcomingVideoCut(currentTimeRef.current)
  }, [activeVideoBuffer, clips, operationsByClip, prepareUpcomingVideoCut, transitions])

  // Handle video ended
  const onEnded = useCallback((index: VideoBufferIndex = 0) => {
    if (index !== activeVideoBufferRef.current) return
    const boundaryAssignment = transitionVideoBuffersRef.current
    const assignedTransition = boundaryAssignment
      ? transitions.find((transition) => transition.id === boundaryAssignment.transitionId)
      : null
    const boundaryTransition = assignedTransition
      ? getTimelineTransitionTiming(assignedTransition, clips, operationsByClip)
      : null
    if (
      boundaryTransition &&
      boundaryAssignment?.transitionId === boundaryTransition.transition.id &&
      boundaryAssignment.leftIndex === index &&
      currentTimeRef.current >= boundaryTransition.start - 0.01 &&
      currentTimeRef.current <= boundaryTransition.end + 0.05
    ) {
      const boundaryTime = Math.min(
        boundaryTransition.end - 0.0001,
        Math.max(currentTimeRef.current, boundaryTransition.boundary)
      )
      syncTransitionVideoBuffers(boundaryTransition, boundaryTime, true)
      // The two transition buffers continue to own composition on both sides
      // of the edit point. Promote the incoming buffer only at effect exit.
      activeTransitionClockRef.current = {
        id: boundaryTransition.transition.id,
        phase: 'after'
      }
      currentTimeRef.current = boundaryTime
      setCurrentTime(boundaryTime)
      syncAudioForTime(boundaryTime, true)
      return
    }
    const active = findClipAtTime(currentTimeRef.current)
    if (!active || active.track !== 'video') return
    const range = getClipRange(active)
    if (!range) return
    const safeEnd = timelineDuration > 0 ? Math.max(0, timelineDuration - 0.0001) : 0
    const target = Math.min(range.end, safeEnd)
    lastVideoClockRef.current = { clipId: active.id, mediaTime: range.trimEnd }
    currentTimeRef.current = target
    setCurrentTime(target)
    const immediateNextClip = findClipAtTime(target + 0.001)
    const nextClip = immediateNextClip || findNextClipAfter(target + 0.001)
    if (!nextClip) {
      setPlaying(false)
      playingRef.current = false
      stopAllAudio()
      stopTimeLoop()
      syncAudioForTime(target, false)
      return
    }
    if (immediateNextClip?.track === 'video') {
      seekVideoForTime(immediateNextClip, target + 0.001, true)
    }
    syncAudioForTime(target, true)
  }, [
    clips,
    findClipAtTime,
    findNextClipAfter,
    getClipRange,
    seekVideoForTime,
    setCurrentTime,
    setPlaying,
    stopAllAudio,
    stopTimeLoop,
    syncAudioForTime,
    syncTransitionVideoBuffers,
    timelineDuration,
    operationsByClip,
    transitions
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
    videoBufferRefs: [videoRef, videoBuffer1Ref, videoBuffer2Ref] as const,
    activeVideoBuffer,
    videoBufferClipIds,
    transitionVideoBuffers,
    togglePlay,
    seekTo,
    step,
    onLoadedMetadata,
    onEnded,
    playing,
    selectedClip
  }
}
