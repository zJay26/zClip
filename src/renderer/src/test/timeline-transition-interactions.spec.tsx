import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import TimelineTransitionBlock from '@renderer/components/Timeline/TimelineTransitionBlock'
import TransitionControl from '@renderer/components/Controls/TransitionControl'
import { createDefaultOperations } from '@renderer/stores/project-store-helpers'
import { useProjectStore } from '@renderer/stores/project-store'
import type { MediaInfo, TimelineClip, TimelineTransition } from '@shared/types'

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

function clip(id: string, startTime: number): TimelineClip {
  const filePath = `D:\\${id}.mp4`
  return {
    id,
    groupId: `${id}-group`,
    filePath,
    startTime,
    duration: 10,
    track: 'video',
    trackIndex: 0,
    mediaInfo: { ...mediaInfo, filePath }
  }
}

const transition: TimelineTransition = {
  id: 'transition',
  type: 'crossfade',
  leftClipId: 'left',
  rightClipId: 'right',
  startOffset: -0.5,
  endOffset: 0.5
}

describe('timeline transition selection', () => {
  const clips = [clip('left', 0), clip('right', 10)]
  const operationsByClip = {
    left: createDefaultOperations(10),
    right: createDefaultOperations(10)
  }

  beforeEach(() => {
    useProjectStore.getState().reset()
    useProjectStore.setState({
      clips,
      operationsByClip,
      operations: operationsByClip.left,
      transitions: [transition],
      selectedTransitionId: null,
      selectedClipId: 'left',
      selectedClipIds: ['left'],
      lastSelectedClipId: 'left'
    })
  })

  afterEach(() => {
    cleanup()
    useProjectStore.getState().reset()
  })

  test('selecting the transition clears clip selection and exposes a strong selected state', () => {
    render(
      <TimelineTransitionBlock
        transition={transition}
        clips={clips}
        operationsByClip={operationsByClip}
        trackTopY={28}
        trackHeight={48}
        timeToX={(time) => time * 100}
        pixelsPerSecond={100}
      />
    )

    const block = screen.getByRole('group', { name: /叠化|Crossfade/ })
    fireEvent.pointerDown(block, { button: 0, pointerId: 1 })

    const state = useProjectStore.getState()
    expect(state.selectedTransitionId).toBe('transition')
    expect(state.selectedClipId).toBeNull()
    expect(state.selectedClipIds).toEqual([])
    expect(block).toHaveAttribute('data-selected', 'true')
    expect(block).toHaveAccessibleName(/已选中|selected/)
    expect(screen.getByRole('button', { name: /删除转场|Delete transition/ })).toBeInTheDocument()
  })

  test('exposes duration and cut-position parameters for the selected transition', () => {
    useProjectStore.setState({
      selectedTransitionId: transition.id,
      selectedClipId: null,
      selectedClipIds: []
    })
    render(<TransitionControl />)

    const duration = screen.getByRole('slider', { name: /转场时长|Duration/ })
    expect(duration).toHaveValue('1')
    fireEvent.change(duration, { target: { value: '1.5' } })
    expect(
      useProjectStore.getState().transitions[0].endOffset -
      useProjectStore.getState().transitions[0].startOffset
    ).toBeCloseTo(1.5, 6)

    fireEvent.click(screen.getByRole('button', { name: /前段更长|More before/ }))
    const updated = useProjectStore.getState().transitions[0]
    expect(-updated.startOffset).toBeGreaterThan(updated.endOffset)
  })
})
