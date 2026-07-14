// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { MediaInfo, MediaOperation, TimelineClip } from '../../shared/types'
import { buildTimelineFFmpegArgs, sliceTimelineForRange } from './export-service'

function createDefaultOperations(duration: number): MediaOperation[] {
  return [
    { id: 'trim', type: 'trim', enabled: true, params: { startTime: 0, endTime: duration } },
    { id: 'speed', type: 'speed', enabled: true, params: { rate: 1 } },
    { id: 'volume', type: 'volume', enabled: true, params: { percent: 100 } }
  ]
}

function info(filePath: string, hasVideo: boolean, hasAudio: boolean): MediaInfo {
  return {
    duration: 10,
    width: hasVideo ? 1920 : 0,
    height: hasVideo ? 1080 : 0,
    fps: hasVideo ? 30 : 0,
    videoCodec: hasVideo ? 'h264' : '',
    audioCodec: hasAudio ? 'aac' : '',
    sampleRate: hasAudio ? 48_000 : 0,
    fileSize: 1024,
    filePath,
    hasVideo,
    hasAudio
  }
}

function clip(id: string, track: 'video' | 'audio', startTime = 0): TimelineClip {
  const filePath = `C:\\media\\${id}.mp4`
  return {
    id,
    groupId: `group-${id}`,
    filePath,
    startTime,
    duration: 10,
    track,
    trackIndex: 0,
    mediaInfo: info(filePath, track === 'video', track === 'audio')
  }
}

describe('timeline export compiler', () => {
  it('slices clips and trim operations to the requested range', () => {
    const video = clip('video', 'video', 2)
    const operations = { video: createDefaultOperations(10) }
    const sliced = sliceTimelineForRange([video], operations, { startTime: 4, endTime: 8 })
    expect(sliced.duration).toBe(4)
    expect(sliced.clips[0].startTime).toBe(0)
    const trim = sliced.operationsByClip.video.find((operation) => operation.type === 'trim')
    expect(trim?.params).toMatchObject({ startTime: 2, endTime: 6 })
  })

  it('builds a deterministic video and audio filter graph', () => {
    const video = clip('video', 'video')
    const audio = clip('audio', 'audio')
    const operations = {
      video: createDefaultOperations(10),
      audio: createDefaultOperations(10)
    }
    const args = buildTimelineFFmpegArgs(
      [video, audio], operations, 'C:\\output.mp4', { w: 1280, h: 720 }, 10, [], [],
      { crf: 23, h264Preset: 'medium' }, 'mp4', 'infinite',
      { canvas: { preset: 'landscape', width: 1280, height: 720, backgroundColor: '#000000' } }
    )
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('overlay=')
    expect(graph).toContain('atrim=start=0:end=10')
    expect(args).toContain('[aout]')
    expect(args[args.length - 1]).toBe('C:\\output.mp4')
  })
})
