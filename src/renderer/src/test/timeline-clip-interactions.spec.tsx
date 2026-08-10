import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import TimelineClipBlock from '@renderer/components/Timeline/TimelineClipBlock'
import type { SnapEngine } from '@renderer/components/Timeline/useSnap'
import { useProjectStore } from '@renderer/stores/project-store'
import type { MediaInfo, TimelineClip } from '@shared/types'

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

const snap: SnapEngine = {
  checkSnap: (time) => ({ time, snapped: false }),
  checkMoveSnap: (time) => ({ time, snapped: false }),
  snapLineTime: null,
  clearSnapLine: vi.fn()
}

function makeClip(id: string, track: 'video' | 'audio'): TimelineClip {
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

function ClipHarness(): React.JSX.Element | null {
  const clip = useProjectStore((state) => state.clips.find((item) => item.id === 'video'))
  const selectedClipId = useProjectStore((state) => state.selectedClipId)
  const selectedClipIds = useProjectStore((state) => state.selectedClipIds)
  const linkedGroups = useProjectStore((state) => state.linkedGroups)
  const operationsByClip = useProjectStore((state) => state.operationsByClip)
  if (!clip) return null

  return (
    <TimelineClipBlock
      clip={clip}
      trackTopY={28 + clip.trackIndex * 52}
      timeToX={(time) => time * 100}
      pixelsPerSecond={100}
      snap={snap}
      containerRect={new DOMRect(0, 0, 800, 300)}
      trackType="video"
      trackCount={2}
      baseTrackTop={28}
      trackHeight={48}
      trackGap={4}
      clipOperations={operationsByClip[clip.id] || []}
      isSelected={selectedClipIds.includes(clip.id)}
      isPrimary={selectedClipId === clip.id}
      isLinked={linkedGroups[clip.groupId] !== false}
      groupClipCount={2}
    />
  )
}

function getClipElement(): HTMLElement {
  return screen.getByRole('button', { name: /视频片段/ })
}

describe('timeline clip interactions', () => {
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
    const video = makeClip('video', 'video')
    const audio = makeClip('audio', 'audio')
    useProjectStore.setState({
      clips: [video, audio],
      selectedClipId: video.id,
      selectedClipIds: [video.id, audio.id],
      lastSelectedClipId: video.id,
      linkedGroups: { [video.groupId]: true },
      operations: [],
      operationsByClip: {
        [video.id]: [],
        [audio.id]: []
      },
      videoTrackCount: 2,
      audioTrackCount: 2,
      timelineDuration: 10
    })
  })

  afterEach(() => {
    cleanup()
    useProjectStore.getState().reset()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  test('Link button unlinks without starting the parent clip drag', () => {
    render(<ClipHarness />)

    const unlink = screen.getByRole('button', { name: '取消链接' })
    expect(unlink).toHaveTextContent('LINKED')
    fireEvent.pointerDown(unlink, { button: 0, pointerId: 1, clientX: 12, clientY: 34 })
    fireEvent.click(unlink)

    expect(useProjectStore.getState().linkedGroups['linked-pair']).toBe(false)
    expect(useProjectStore.getState().selectedClipIds).toEqual(['video'])
    expect(screen.getByRole('button', { name: '链接音画' })).toHaveTextContent('UNLINKED')
    expect(animationFrames).toHaveLength(0)

    act(() => useProjectStore.getState().moveClip('video', { startTime: 2 }))
    expect(useProjectStore.getState().clips.find((item) => item.id === 'video')?.startTime).toBe(2)
    expect(useProjectStore.getState().clips.find((item) => item.id === 'audio')?.startTime).toBe(0)
  })

  test('pointer selection takes focus away from an inspector control and exposes a strong primary state', () => {
    const inspectorButton = document.createElement('button')
    document.body.append(inspectorButton)
    inspectorButton.focus()
    render(<ClipHarness />)

    const clip = getClipElement()
    Object.defineProperty(clip, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 28, 1000, 48)
    })
    Object.assign(clip, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn()
    })
    fireEvent.pointerDown(clip, { button: 0, pointerId: 2, clientX: 100, clientY: 48 })

    expect(document.activeElement).toBe(clip)
    expect(clip).toHaveAttribute('data-selected', 'true')
    expect(clip).toHaveAttribute('data-primary', 'true')
    expect(clip).toHaveAttribute('aria-pressed', 'true')
    expect(clip).toHaveClass('border-2')
    inspectorButton.remove()
  })

  test('pure vertical motion changes track and coalesces the store update to an animation frame', () => {
    render(<ClipHarness />)
    const clip = getClipElement()
    Object.defineProperty(clip, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(0, 28, 1000, 48)
    })
    Object.assign(clip, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn()
    })

    fireEvent.pointerDown(clip, { button: 0, pointerId: 3, clientX: 100, clientY: 48 })
    fireEvent.pointerMove(clip, { pointerId: 3, clientX: 100, clientY: 96 })
    fireEvent.pointerMove(clip, { pointerId: 3, clientX: 100, clientY: 104 })

    expect(useProjectStore.getState().clips.find((item) => item.id === 'video')?.trackIndex).toBe(0)
    expect(animationFrames).toHaveLength(1)

    const callback = Array.from(animationFrames.values())[0]
    expect(callback).toBeDefined()
    act(() => callback(16))

    expect(useProjectStore.getState().clips.find((item) => item.id === 'video')?.trackIndex).toBe(1)
    expect(useProjectStore.getState().historyPast).toHaveLength(1)
  })
})
