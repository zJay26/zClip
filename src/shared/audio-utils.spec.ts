import { describe, expect, test } from 'vitest'
import type { MediaInfo, TimelineClip } from './types'
import { getEffectiveTimelineAudioClips } from './audio-utils'

const mediaInfo: MediaInfo = {
  duration: 5,
  width: 1280,
  height: 720,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48_000,
  fileSize: 1,
  filePath: 'D:\\media.mp4',
  hasVideo: true,
  hasAudio: true
}

function clip(id: string, track: 'video' | 'audio', embeddedAudioEnabled?: boolean): TimelineClip {
  return {
    id,
    groupId: 'group',
    filePath: mediaInfo.filePath,
    startTime: 0,
    duration: 5,
    track,
    trackIndex: 0,
    embeddedAudioEnabled,
    mediaInfo
  }
}

describe('effective timeline audio', () => {
  test('prefers the explicit audio clip over the video embedded stream', () => {
    const video = clip('video', 'video')
    const audio = clip('audio', 'audio')
    expect(getEffectiveTimelineAudioClips([video, audio]).map((item) => item.id)).toEqual(['audio'])
  })

  test('does not resurrect embedded audio after it has been explicitly disabled', () => {
    const video = clip('video', 'video', false)
    expect(getEffectiveTimelineAudioClips([video])).toEqual([])
  })

  test('keeps legacy standalone video clips audible by default', () => {
    const video = clip('video', 'video')
    expect(getEffectiveTimelineAudioClips([video]).map((item) => item.id)).toEqual(['video'])
  })
})
