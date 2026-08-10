import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import VolumeControl from '@renderer/components/Controls/VolumeControl'
import { useProjectStore } from '@renderer/stores/project-store'
import type { MediaInfo, MediaOperation, TimelineClip } from '@shared/types'

const mediaInfo: MediaInfo = {
  duration: 10,
  width: 1920,
  height: 1080,
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
    groupId: 'linked-pair',
    filePath: `D:\\${id}.mp4`,
    startTime: 0,
    duration: 10,
    trimBoundStart: 0,
    trimBoundEnd: 10,
    track,
    trackIndex: 0,
    mediaInfo
  }
}

function volumeOperation(percent: number): MediaOperation {
  return {
    id: 'audio-volume',
    type: 'volume',
    enabled: percent !== 100,
    params: { percent }
  }
}

describe('audio control subscriptions', () => {
  beforeEach(() => {
    useProjectStore.getState().reset()
    const video = clip('video', 'video')
    const audio = clip('audio', 'audio')
    useProjectStore.setState({
      clips: [video, audio],
      selectedClipId: video.id,
      selectedClipIds: [video.id],
      linkedGroups: { [video.groupId]: true },
      operations: [],
      operationsByClip: {
        [video.id]: [],
        [audio.id]: [volumeOperation(125)]
      }
    })
  })

  test('rerenders when a linked audio operation changes', () => {
    render(<VolumeControl hideHeader />)
    expect(screen.getByRole('slider')).toHaveValue('125')

    act(() => {
      useProjectStore.setState((state) => ({
        operationsByClip: {
          ...state.operationsByClip,
          audio: [volumeOperation(240)]
        }
      }))
    })

    expect(screen.getByRole('slider')).toHaveValue('240')
  })
})
