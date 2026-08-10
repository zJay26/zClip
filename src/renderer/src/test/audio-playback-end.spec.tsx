import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useVideoPlayer } from '@renderer/hooks/useVideoPlayer'
import { useProjectStore } from '@renderer/stores/project-store'
import type { MediaInfo, TimelineClip } from '@shared/types'

const audioEngine = vi.hoisted(() => ({
  resumeAudioContext: vi.fn(),
  syncAudioForTime: vi.fn(),
  stopAllAudio: vi.fn()
}))

vi.mock('@renderer/hooks/useAudioPlaybackEngine', () => ({
  useAudioPlaybackEngine: () => audioEngine
}))

const mediaInfo: MediaInfo = {
  duration: 1,
  width: 0,
  height: 0,
  fps: 0,
  videoCodec: '',
  audioCodec: 'aac',
  sampleRate: 48_000,
  fileSize: 1,
  filePath: 'D:\\audio-only.m4a',
  hasVideo: false,
  hasAudio: true
}

const audioClip: TimelineClip = {
  id: 'audio-only',
  groupId: 'audio-only-group',
  filePath: mediaInfo.filePath,
  startTime: 0,
  duration: 1,
  trimBoundStart: 0,
  trimBoundEnd: 1,
  track: 'audio',
  trackIndex: 0,
  mediaInfo
}

describe('audio-only playback end', () => {
  let animationFrameId = 0
  let animationFrames = new Map<number, FrameRequestCallback>()

  beforeEach(() => {
    animationFrameId = 0
    animationFrames = new Map()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++animationFrameId
      animationFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id)
    })

    useProjectStore.getState().reset()
    useProjectStore.setState({
      clips: [audioClip],
      selectedClipId: audioClip.id,
      selectedClipIds: [audioClip.id],
      lastSelectedClipId: audioClip.id,
      linkedGroups: { [audioClip.groupId]: false },
      operations: [],
      operationsByClip: { [audioClip.id]: [] },
      timelineDuration: 1,
      currentTime: 0,
      duration: 1,
      playing: false
    })
  })

  afterEach(() => {
    cleanup()
    useProjectStore.getState().reset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  test('stops at the clamped timeline end without a video ended event', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0)
    const { result } = renderHook(() => useVideoPlayer())

    act(() => result.current.seekTo(0.9998))
    act(() => result.current.togglePlay())
    expect(useProjectStore.getState().playing).toBe(true)

    const runNextFrame = (timestamp: number): void => {
      const entry = Array.from(animationFrames.entries())[0]
      expect(entry).toBeDefined()
      const [id, callback] = entry
      animationFrames.delete(id)
      now.mockReturnValue(timestamp)
      act(() => callback(timestamp))
    }

    runNextFrame(1_000)
    runNextFrame(1_016)
    expect(useProjectStore.getState().currentTime).toBeCloseTo(0.9999, 4)
    runNextFrame(1_032)

    expect(useProjectStore.getState().playing).toBe(false)
    expect(useProjectStore.getState().currentTime).toBeCloseTo(0.9999, 4)
    expect(audioEngine.stopAllAudio).toHaveBeenCalled()
    expect(animationFrames).toHaveLength(0)
  })
})
