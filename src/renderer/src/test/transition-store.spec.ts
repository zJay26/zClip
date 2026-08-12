import { beforeEach, describe, expect, test } from 'vitest'
import type { MediaInfo, TimelineClip } from '@shared/types'
import { createDefaultOperations } from '@renderer/stores/project-store-helpers'
import { useProjectStore } from '@renderer/stores/project-store'

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

function clip(id: string, startTime: number, trackIndex = 0): TimelineClip {
  const filePath = `D:\\${id}.mp4`
  return {
    id,
    groupId: `${id}-group`,
    filePath,
    startTime,
    duration: 10,
    track: 'video',
    trackIndex,
    mediaInfo: { ...mediaInfo, filePath }
  }
}

function seed(rightStart = 10, rightTrack = 0): void {
  const left = clip('left', 0)
  const right = clip('right', rightStart, rightTrack)
  useProjectStore.setState({
    clips: [left, right],
    operationsByClip: {
      left: createDefaultOperations(10),
      right: createDefaultOperations(10)
    },
    operations: createDefaultOperations(10),
    selectedClipId: left.id,
    selectedClipIds: [left.id],
    lastSelectedClipId: left.id,
    selectedTransitionId: null,
    sourceFile: left.filePath,
    mediaInfo: left.mediaInfo,
    duration: left.duration,
    transitions: [],
    videoTrackCount: 2,
    timelineDuration: Math.max(10, rightStart + 10),
    currentTime: 10
  })
}

describe('transition store interactions', () => {
  beforeEach(() => {
    useProjectStore.getState().reset()
    seed()
  })

  test('adding a transition selects it and visibly clears clip selection', () => {
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)).toBe(true)
    const state = useProjectStore.getState()
    expect(state.transitions).toHaveLength(1)
    expect(state.selectedTransitionId).toBe(state.transitions[0].id)
    expect(state.selectedClipId).toBeNull()
    expect(state.selectedClipIds).toEqual([])

    expect(state.applyTransition('wipeleft')).toBe(true)
    expect(useProjectStore.getState().transitions[0].type).toBe('wipeleft')
  })

  test('replacing a transition preserves its duration and alignment', () => {
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)).toBe(true)
    const original = useProjectStore.getState().transitions[0]
    useProjectStore.getState().updateTransition(original.id, {
      startOffset: -0.2,
      endOffset: 0.8
    })
    const customized = useProjectStore.getState().transitions[0]

    expect(useProjectStore.getState().addTransitionAtTime('wipeleft', 10, 0)).toBe(true)
    expect(useProjectStore.getState().transitions[0]).toMatchObject({
      id: original.id,
      type: 'wipeleft',
      startOffset: customized.startOffset,
      endOffset: customized.endOffset
    })
  })

  test('keeps a usable source after undoing and redoing transition selection', () => {
    useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)
    expect(useProjectStore.getState().sourceFile).toBe('D:\\left.mp4')

    useProjectStore.getState().undo()
    useProjectStore.getState().redo()

    const state = useProjectStore.getState()
    expect(state.selectedTransitionId).toBe(state.transitions[0].id)
    expect(state.selectedClipId).toBeNull()
    expect(state.sourceFile).toBe('D:\\left.mp4')
  })

  test('rejects gaps and cross-track pairs instead of falling back to another track', () => {
    useProjectStore.getState().reset()
    seed(10.2, 0)
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 10.1, 0)).toBe(false)
    expect(useProjectStore.getState().transitions).toEqual([])

    useProjectStore.getState().reset()
    seed(10, 1)
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)).toBe(false)
    expect(useProjectStore.getState().transitions).toEqual([])
  })

  test('balances two transitions on a short middle clip and rejects impossible overlap', () => {
    const seedChain = (middleDuration: number): void => {
      const left = { ...clip('left', 0), duration: 1, mediaInfo: { ...mediaInfo, duration: 1, filePath: 'D:\\left.mp4' } }
      const middle = {
        ...clip('middle', 1),
        duration: middleDuration,
        mediaInfo: { ...mediaInfo, duration: middleDuration, filePath: 'D:\\middle.mp4' }
      }
      const right = {
        ...clip('right', 1 + middleDuration),
        duration: 1,
        mediaInfo: { ...mediaInfo, duration: 1, filePath: 'D:\\right.mp4' }
      }
      useProjectStore.setState({
        clips: [left, middle, right],
        operationsByClip: {
          left: createDefaultOperations(1),
          middle: createDefaultOperations(middleDuration),
          right: createDefaultOperations(1)
        },
        operations: createDefaultOperations(middleDuration),
        selectedClipId: middle.id,
        selectedClipIds: [middle.id],
        lastSelectedClipId: middle.id,
        selectedTransitionId: null,
        sourceFile: middle.filePath,
        mediaInfo: middle.mediaInfo,
        duration: middle.duration,
        transitions: [],
        timelineDuration: 2 + middleDuration,
        currentTime: 1
      })
    }

    seedChain(0.3)
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 1, 0)).toBe(true)
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 1.3, 0)).toBe(true)
    const balanced = useProjectStore.getState().transitions
    expect(balanced).toHaveLength(2)
    const incoming = balanced.find((item) => item.rightClipId === 'middle')
    const outgoing = balanced.find((item) => item.leftClipId === 'middle')
    expect((incoming?.endOffset ?? 0) - (outgoing?.startOffset ?? 0)).toBeCloseTo(0.3, 6)

    useProjectStore.getState().reset()
    seedChain(0.1)
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 1, 0)).toBe(true)
    const existingId = useProjectStore.getState().transitions[0].id
    expect(useProjectStore.getState().addTransitionAtTime('crossfade', 1.1, 0)).toBe(false)
    expect(useProjectStore.getState().transitions.map((item) => item.id)).toEqual([existingId])
    expect(useProjectStore.getState().toast?.message).toMatch(/太短|too short/)
  })

  test('preserves a transition when both clips move together', () => {
    useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)
    useProjectStore.setState({
      selectedClipId: 'left',
      selectedClipIds: ['left', 'right'],
      selectedTransitionId: null
    })
    useProjectStore.getState().moveClip('left', { startTime: 2 })
    const state = useProjectStore.getState()
    expect(state.clips.find((item) => item.id === 'left')?.startTime).toBe(2)
    expect(state.clips.find((item) => item.id === 'right')?.startTime).toBe(12)
    expect(state.transitions).toHaveLength(1)
  })

  test('removes the transition with feedback when speed or track edits break the cut', () => {
    useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)
    useProjectStore.getState().selectClip('left')
    useProjectStore.getState().setSpeed(2)
    expect(useProjectStore.getState().transitions).toEqual([])
    expect(useProjectStore.getState().toast?.message).toMatch(/自动移除|removed/)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().transitions).toHaveLength(1)
    useProjectStore.getState().selectClip('right')
    useProjectStore.getState().moveClip('right', { trackIndex: 1 })
    expect(useProjectStore.getState().transitions).toEqual([])
  })

  test('keeps an outgoing transition attached to the tail half after splitting a clip', () => {
    useProjectStore.getState().addTransitionAtTime('crossfade', 10, 0)
    useProjectStore.getState().setCurrentTime(5)
    useProjectStore.getState().splitClipAtPlayhead()

    const state = useProjectStore.getState()
    expect(state.transitions).toHaveLength(1)
    expect(state.transitions[0].leftClipId).not.toBe('left')
    expect(state.transitions[0].rightClipId).toBe('right')
    expect(state.clips.find((item) => item.id === state.transitions[0].leftClipId)?.startTime).toBe(5)
  })
})
