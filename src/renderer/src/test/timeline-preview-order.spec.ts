import { describe, expect, test } from 'vitest'
import { compareVideoOverlayOrder, getTopmostVideoClipAtTime } from '@shared/timeline-utils'
import type { MediaInfo, MediaOperation, TimelineClip } from '@shared/types'

const mediaInfo: MediaInfo = {
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  sampleRate: 48000,
  fileSize: 1,
  filePath: 'D:\\video.mp4',
  hasVideo: true,
  hasAudio: true
}

function clip(id: string, trackIndex: number, startTime = 0): TimelineClip {
  return {
    id,
    groupId: id,
    filePath: `D:\\${id}.mp4`,
    startTime,
    duration: 10,
    trimBoundStart: 0,
    trimBoundEnd: 10,
    track: 'video',
    trackIndex,
    mediaInfo
  }
}

function trimOps(duration: number): MediaOperation[] {
  return [
    {
      id: `trim-${duration}`,
      type: 'trim',
      enabled: true,
      params: { startTime: 0, endTime: duration }
    }
  ]
}

describe('preview/export video ordering', () => {
  test('uses the same topmost video track as export overlay order', () => {
    const clips = [clip('lower', 0), clip('upper', 2), clip('middle', 1)]
    const operationsByClip = Object.fromEntries(clips.map((item) => [item.id, trimOps(item.duration)]))

    const topmost = getTopmostVideoClipAtTime(clips, operationsByClip, 1)
    const exportOrdered = [...clips].sort(compareVideoOverlayOrder)
    const exportTopmost = exportOrdered[exportOrdered.length - 1]

    expect(topmost?.id).toBe('upper')
    expect(topmost?.id).toBe(exportTopmost?.id)
  })
})
