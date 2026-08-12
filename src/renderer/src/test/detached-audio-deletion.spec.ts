import { beforeEach, describe, expect, test } from 'vitest'
import type { MediaInfo, TimelineClip } from '@shared/types'
import { getEffectiveTimelineAudioClips } from '@shared/audio-utils'
import { createDefaultOperations } from '@renderer/stores/project-store-helpers'
import { useProjectStore } from '@renderer/stores/project-store'

const mediaInfo: MediaInfo = {
  duration: 5,
  width: 1280,
  height: 720,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48_000,
  fileSize: 1,
  filePath: 'D:\\linked.mp4',
  hasVideo: true,
  hasAudio: true
}

function clip(id: string, track: 'video' | 'audio'): TimelineClip {
  return {
    id,
    groupId: 'media-group',
    filePath: mediaInfo.filePath,
    startTime: 0,
    duration: 5,
    track,
    trackIndex: 0,
    mediaInfo
  }
}

describe('detached audio deletion', () => {
  beforeEach(() => {
    useProjectStore.getState().reset()
    const video = clip('video', 'video')
    const audio = clip('audio', 'audio')
    useProjectStore.setState({
      clips: [video, audio],
      operationsByClip: {
        video: createDefaultOperations(5),
        audio: createDefaultOperations(5)
      },
      operations: createDefaultOperations(5),
      linkedGroups: { 'media-group': false },
      selectedClipId: 'audio',
      selectedClipIds: ['audio'],
      lastSelectedClipId: 'audio',
      sourceFile: audio.filePath,
      mediaInfo,
      duration: 5,
      timelineDuration: 5
    })
  })

  test('does not reactivate the video embedded stream after deleting detached audio', () => {
    useProjectStore.getState().deleteSelectedClips()

    const state = useProjectStore.getState()
    expect(state.clips.map((item) => item.id)).toEqual(['video'])
    expect(state.clips[0].embeddedAudioEnabled).toBe(false)
    expect(getEffectiveTimelineAudioClips(state.clips)).toEqual([])
    state.activateClip('video')
    const firstEmptySelection = useProjectStore.getState().getAudioOperationsForSelection()
    const secondEmptySelection = useProjectStore.getState().getAudioOperationsForSelection()
    expect(firstEmptySelection).toEqual([])
    expect(secondEmptySelection).toBe(firstEmptySelection)
  })

  test('undo restores the separate audio clip and its previous video state', () => {
    useProjectStore.getState().deleteSelectedClips()
    useProjectStore.getState().undo()

    const state = useProjectStore.getState()
    expect(state.clips.map((item) => item.id)).toEqual(['video', 'audio'])
    expect(state.clips.find((item) => item.id === 'video')?.embeddedAudioEnabled).toBeUndefined()
    expect(getEffectiveTimelineAudioClips(state.clips).map((item) => item.id)).toEqual(['audio'])
  })
})
