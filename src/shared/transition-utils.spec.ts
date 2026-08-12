import { describe, expect, test } from 'vitest'
import type { MediaInfo, MediaOperation, TimelineClip, TimelineTransition } from './types'
import {
  getEligibleTransitionCuts,
  getTimelineTransitionTiming,
  normalizeTimelineTransitions,
  transitionTimelineTimeToMediaTime
} from './transition-utils'
import { timelineTimeToMediaTime } from './timeline-utils'

const mediaInfo: MediaInfo = {
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: '',
  sampleRate: 0,
  fileSize: 1,
  filePath: 'D:\\clip.mp4',
  hasVideo: true,
  hasAudio: false
}

function clip(id: string, startTime: number, trackIndex = 0, duration = 10): TimelineClip {
  const filePath = `D:\\${id}.mp4`
  return {
    id,
    groupId: `${id}-group`,
    filePath,
    startTime,
    duration,
    track: 'video',
    trackIndex,
    mediaInfo: { ...mediaInfo, duration, filePath }
  }
}

function operations(...ids: string[]): Record<string, MediaOperation[]> {
  return Object.fromEntries(ids.map((id) => [id, [
    { id: `${id}-trim`, type: 'trim', enabled: true, params: { startTime: 0, endTime: 10 } },
    { id: `${id}-speed`, type: 'speed', enabled: false, params: { rate: 1 } }
  ]]))
}

function transition(): TimelineTransition {
  return {
    id: 'transition',
    type: 'crossfade',
    leftClipId: 'left',
    rightClipId: 'right',
    startOffset: -0.5,
    endOffset: 0.5
  }
}

describe('timeline transition invariants', () => {
  test('accepts only a touching cut between consecutive clips on the same track', () => {
    const left = clip('left', 0)
    const right = clip('right', 10)
    expect(getEligibleTransitionCuts([left, right], operations('left', 'right'))).toHaveLength(1)

    expect(getEligibleTransitionCuts(
      [left, { ...right, startTime: 10.25 }],
      operations('left', 'right')
    )).toHaveLength(0)
    expect(getEligibleTransitionCuts(
      [left, { ...right, trackIndex: 1 }],
      operations('left', 'right')
    )).toHaveLength(0)
    expect(getEligibleTransitionCuts(
      [left, { ...right, startTime: 9.75 }],
      operations('left', 'right')
    )).toHaveLength(0)
  })

  test('drops stale transitions and clamps their duration to visible clip capacity', () => {
    const left = clip('left', 0)
    const right = clip('right', 10)
    const oversized = { ...transition(), startOffset: -30, endOffset: 30 }
    expect(normalizeTimelineTransitions(
      [oversized],
      [left, right],
      operations('left', 'right')
    )[0]).toMatchObject({ startOffset: -10, endOffset: 10 })

    expect(normalizeTimelineTransitions(
      [transition()],
      [left, { ...right, startTime: 11 }],
      operations('left', 'right')
    )).toEqual([])
  })

  test('keeps media time continuous at transition entry and exit', () => {
    const left = clip('left', 0)
    const right = clip('right', 10)
    const ops = operations('left', 'right')
    const timing = getTimelineTransitionTiming(transition(), [left, right], ops)
    expect(timing).not.toBeNull()
    if (!timing) return

    const leftAtEntry = transitionTimelineTimeToMediaTime(timing, 'left', timing.start)
    const ordinaryLeftAtEntry = timelineTimeToMediaTime(left, ops, timing.start)
    expect(leftAtEntry).toBeCloseTo(ordinaryLeftAtEntry, 6)

    const rightAtExit = transitionTimelineTimeToMediaTime(timing, 'right', timing.end)
    const ordinaryRightAtExit = timelineTimeToMediaTime(right, ops, timing.end)
    expect(rightAtExit).toBeCloseTo(ordinaryRightAtExit, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.start)).toBe(0)
    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.end)).toBe(10)

    // With no media handles, both sources must still advance through the
    // center instead of holding an edge frame on opposite half-transitions.
    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.boundary)).toBeCloseTo(9.75, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.boundary)).toBeCloseTo(0.25, 6)
  })

  test('uses source handles continuously when trimmed clips meet', () => {
    const left = clip('left', 0)
    const right = clip('right', 5)
    const ops = operations('left', 'right')
    ops.left[0] = { ...ops.left[0], params: { startTime: 0, endTime: 5 } }
    ops.right[0] = { ...ops.right[0], params: { startTime: 5, endTime: 10 } }
    const timing = getTimelineTransitionTiming(transition(), [left, right], ops)
    expect(timing).not.toBeNull()
    if (!timing) return

    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.start)).toBeCloseTo(4.5, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.end)).toBeCloseTo(5.5, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.start)).toBeCloseTo(4.5, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.end)).toBeCloseTo(5.5, 6)
  })

  test('does not read beyond hard trim bounds while smoothing a transition', () => {
    const left = { ...clip('left', 0), trimBoundStart: 0, trimBoundEnd: 5 }
    const right = { ...clip('right', 5), trimBoundStart: 5, trimBoundEnd: 10 }
    const ops = operations('left', 'right')
    ops.left[0] = { ...ops.left[0], params: { startTime: 0, endTime: 5 } }
    ops.right[0] = { ...ops.right[0], params: { startTime: 5, endTime: 10 } }
    const timing = getTimelineTransitionTiming(transition(), [left, right], ops)
    expect(timing).not.toBeNull()
    if (!timing) return

    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.end)).toBe(5)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.start)).toBe(5)
    expect(transitionTimelineTimeToMediaTime(timing, 'left', timing.boundary)).toBeCloseTo(4.75, 6)
    expect(transitionTimelineTimeToMediaTime(timing, 'right', timing.boundary)).toBeCloseTo(5.25, 6)
  })

  test('shortens adjacent transitions so their regions never overlap inside a middle clip', () => {
    const left = clip('left', 0, 0, 1)
    const middle = clip('middle', 1, 0, 0.3)
    const right = clip('right', 1.3, 0, 1)
    const ops: Record<string, MediaOperation[]> = Object.fromEntries(
      [left, middle, right].map((item) => [item.id, [
        {
          id: `${item.id}-trim`,
          type: 'trim',
          enabled: true,
          params: { startTime: 0, endTime: item.duration }
        }
      ]])
    )
    const normalized = normalizeTimelineTransitions([
      {
        id: 'incoming',
        type: 'crossfade',
        leftClipId: 'left',
        rightClipId: 'middle',
        startOffset: -0.3,
        endOffset: 0.3
      },
      {
        id: 'outgoing',
        type: 'crossfade',
        leftClipId: 'middle',
        rightClipId: 'right',
        startOffset: -0.3,
        endOffset: 0.3
      }
    ], [left, middle, right], ops)

    expect(normalized).toHaveLength(2)
    const incoming = normalized.find((item) => item.id === 'incoming')
    const outgoing = normalized.find((item) => item.id === 'outgoing')
    expect((incoming?.endOffset ?? 0) - (outgoing?.startOffset ?? 0)).toBeCloseTo(0.3, 6)
  })
})
