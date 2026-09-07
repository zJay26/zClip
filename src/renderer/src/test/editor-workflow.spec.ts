import { beforeEach, describe, expect, test } from 'vitest'
import { useProjectStore } from '../stores/project-store'
import { createDefaultOperations } from '../stores/project-store-helpers'
import { getAdjacentClipBoundary } from '../stores/timeline-editing'
import type { TimelineClip } from '@shared/types'

function clip(id: string, startTime: number, duration = 4, track: 'video' | 'audio' = 'video', groupId = id): TimelineClip {
  return {
    id, groupId, startTime, duration, track, trackIndex: 0, filePath: `D:\\${id}.mp4`,
    mediaInfo: { filePath: `D:\\${id}.mp4`, duration, width: 640, height: 360, fps: 30,
      videoCodec: 'h264', audioCodec: 'aac', hasVideo: true, hasAudio: true, sampleRate: 48000, fileSize: 1 }
  }
}

function seed(clips: TimelineClip[]) {
  useProjectStore.setState({
    clips, operationsByClip: Object.fromEntries(clips.map((item) => [item.id, createDefaultOperations(item.duration)])),
    timelineDuration: Math.max(...clips.map((item) => item.startTime + item.duration)),
    selectedClipId: clips[0].id, selectedClipIds: [clips[0].id], currentTime: 0,
    sourceFile: clips[0].filePath, mediaInfo: clips[0].mediaInfo
  })
}

describe('everyday timeline editing', () => {
  beforeEach(() => useProjectStore.getState().reset())

  test('copy/paste preserves internal transitions, fades, links and independent effect IDs through undo/redo', () => {
    seed([clip('left', 0), clip('right', 4), clip('audio', 0, 4, 'audio', 'left')])
    useProjectStore.setState({
      transitions: [{ id: 'cut', leftClipId: 'left', rightClipId: 'right', type: 'wipeleft', startOffset: -0.3, endOffset: 0.7 }],
      audioFades: [{ id: 'fade', clipId: 'audio', kind: 'in', startOffset: 0, endOffset: 1 }]
    })
    const original = useProjectStore.getState().buildProjectData()
    useProjectStore.getState().selectAllClips()
    expect(useProjectStore.getState().projectDirty).toBe(false)
    useProjectStore.getState().copySelectedClips()
    useProjectStore.getState().setCurrentTime(8)
    useProjectStore.getState().pasteCopiedClips()
    const pasted = useProjectStore.getState()
    expect(pasted.clips).toHaveLength(6)
    expect(pasted.transitions).toHaveLength(2)
    expect(pasted.transitions[1]).toMatchObject({ type: 'wipeleft', startOffset: -0.3, endOffset: 0.7 })
    expect(pasted.transitions[1].id).not.toBe('cut')
    expect(pasted.selectedClipIds).toContain(pasted.transitions[1].leftClipId)
    expect(pasted.selectedClipIds).toContain(pasted.transitions[1].rightClipId)
    expect(pasted.audioFades).toHaveLength(2)
    expect(pasted.audioFades[1].id).not.toBe('fade')
    expect(pasted.selectedClipIds).toContain(pasted.audioFades[1].clipId)
    expect(pasted.clips[3].groupId).toBe(pasted.clips[5].groupId)
    pasted.undo()
    expect(useProjectStore.getState().transitions).toEqual(original.transitions)
    expect(useProjectStore.getState().audioFades).toEqual(original.audioFades)
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().transitions).toEqual(pasted.transitions)
  })

  test('partial copy omits transitions whose other clip is not copied', () => {
    seed([clip('left', 0), clip('right', 4)])
    useProjectStore.setState({ transitions: [{ id: 'cut', leftClipId: 'left', rightClipId: 'right', type: 'crossfade', startOffset: -0.5, endOffset: 0.5 }] })
    useProjectStore.getState().copySelectedClips()
    expect(useProjectStore.getState().clipboard?.transitions).toEqual([])
  })

  test('ripple deletion removes a linked pair once and shifts all later tracks together', () => {
    seed([clip('left', 0), clip('audio', 0, 4, 'audio', 'left'), clip('right', 4), clip('tail-audio', 4, 4, 'audio', 'right')])
    useProjectStore.setState({ currentTime: 7, playing: true })
    useProjectStore.getState().deleteSelectedClips({ closeGap: true })
    const result = useProjectStore.getState()
    expect(result.clips.map((item) => [item.id, item.startTime])).toEqual([['right', 0], ['tail-audio', 0]])
    expect(result.currentTime).toBe(3)
    expect(result.playing).toBe(false)
    expect(result.historyPast).toHaveLength(1)
    result.undo()
    expect(useProjectStore.getState().clips).toHaveLength(4)
    expect(useProjectStore.getState().currentTime).toBe(7)
  })

  test('ripple deletion never removes time occupied by background audio or closes unrelated gaps', () => {
    seed([clip('remove', 2), clip('music', 3, 2, 'audio'), clip('later', 10)])
    useProjectStore.getState().deleteSelectedClips({ closeGap: true })
    expect(useProjectStore.getState().clips.map((item) => [item.id, item.startTime])).toEqual([['music', 2], ['later', 8]])
  })

  test('gap removal uses trimmed, speed-adjusted durations and is a no-op without gaps', () => {
    seed([clip('first', 2, 8), clip('second', 9)])
    useProjectStore.setState({ operationsByClip: {
      first: [{ id: 'trim', type: 'trim', enabled: true, params: { startTime: 2, endTime: 6 } },
        { id: 'speed', type: 'speed', enabled: true, params: { rate: 2 } }], second: []
    }, currentTime: 6 })
    useProjectStore.getState().removeTimelineGaps()
    const result = useProjectStore.getState()
    expect(result.clips.map((item) => item.startTime)).toEqual([0, 2])
    expect(result.timelineDuration).toBe(6)
    expect(result.currentTime).toBe(2)
    result.removeTimelineGaps()
    expect(useProjectStore.getState()).toBe(result)
    result.undo()
    expect(useProjectStore.getState().clips.map((item) => item.startTime)).toEqual([2, 9])
  })

  test('deleting everything stops playback, clamps the playhead, and remains undoable', () => {
    seed([clip('only', 0)])
    useProjectStore.setState({ currentTime: 3, playing: true })
    useProjectStore.getState().deleteSelectedClips()
    expect(useProjectStore.getState()).toMatchObject({ clips: [], currentTime: 0, playing: false, timelineDuration: 0, projectDirty: true })
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().clips).toHaveLength(1)
  })

  test('selection changes do not mark a document dirty or add history', () => {
    seed([clip('first', 0), clip('second', 4)])
    useProjectStore.getState().selectAllClips()
    expect(useProjectStore.getState().selectedClipIds).toHaveLength(2)
    useProjectStore.getState().clearSelection()
    expect(useProjectStore.getState()).toMatchObject({ selectedClipIds: [], projectDirty: false, historyPast: [] })
  })

  test('cut navigation skips near-equal boundaries and clamps at both ends', () => {
    const clips = [clip('one', 0), clip('two', 4)]
    expect(getAdjacentClipBoundary(clips, {}, 3.9999, 1, 30)).toBe(8)
    expect(getAdjacentClipBoundary(clips, {}, 4.0001, -1, 30)).toBe(0)
    expect(getAdjacentClipBoundary(clips, {}, 8, 1, 30)).toBe(8)
    expect(getAdjacentClipBoundary(clips, {}, 0, -1, 30)).toBe(0)
  })
})
