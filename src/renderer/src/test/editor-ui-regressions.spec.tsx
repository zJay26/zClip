import React from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import Dialog from '../components/ui/Dialog'
import { useTimelineZoom } from '../components/Timeline/useTimelineZoom'
import { TIMELINE_TAIL_PX } from '../components/Timeline/timeline-constants'
import TimelineRuler from '../components/Timeline/TimelineRuler'
import { formatTime } from '../lib/utils'
import Timeline from '../components/Timeline/Timeline'
import { useProjectStore } from '../stores/project-store'

afterEach(() => { cleanup(); useProjectStore.getState().reset(); vi.unstubAllGlobals() })

describe('editor focus and timeline fit', () => {
  test('late clips remain visible when a multi-hour timeline is fitted', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    useProjectStore.getState().reset()
    useProjectStore.setState({ timelineDuration: 7200, clips: [0, 7000].map((startTime, index) => ({
      id: `clip-${index}`, groupId: `group-${index}`, startTime, duration: 200,
      filePath: `D:\\${index === 1 ? 'late' : 'early'}.mp4`, track: 'video' as const, trackIndex: 0,
      mediaInfo: { filePath: 'D:\\video.mp4', duration: 200, width: 640, height: 360, fps: 30,
        videoCodec: 'h264', audioCodec: '', hasVideo: true, hasAudio: false, sampleRate: 0, fileSize: 1 }
    })) })
    render(<Timeline seekTo={() => {}} />)
    expect(screen.getByRole('button', { name: /late.mp4/ })).toBeInTheDocument()
  })
  test('a fitted multi-hour timeline renders ruler labels through its visible end', () => {
    render(<TimelineRuler totalWidth={800} pixelsPerSecond={0.1} timelineDuration={7200}
      timeToX={(time) => time * 0.1} xToTime={(x) => x / 0.1} seekTo={() => {}}
      scrollLeft={0} containerRect={new DOMRect(0, 0, 800, 260)} />)
    expect(screen.getByText(formatTime(7200))).toBeInTheDocument()
  })
  test('dialog state updates retain typed-input focus and Escape uses the latest callback', () => {
    const oldClose = vi.fn()
    const newClose = vi.fn()
    const { rerender } = render(<Dialog open title="Export" onClose={oldClose}><input aria-label="Range" /></Dialog>)
    const input = screen.getByRole('textbox', { name: 'Range' })
    input.focus()
    fireEvent.change(input, { target: { value: '00:03' } })
    rerender(<Dialog open title="Export" onClose={newClose}><input aria-label="Range" /></Dialog>)
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(newClose).toHaveBeenCalledTimes(1)
    expect(oldClose).not.toHaveBeenCalled()
  })

  test('a dialog without controls retains Tab focus and restores the origin on unmount', () => {
    const origin = document.createElement('button')
    document.body.append(origin)
    origin.focus()
    const { unmount } = render(<Dialog open title="Working">Please wait</Dialog>)
    const focused = document.activeElement
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focused)
    unmount()
    expect(document.activeElement).toBe(origin)
    origin.remove()
  })

  test('fit updates immediately at zoom 1 after duration changes, including multi-hour timelines', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 800 })
    const ref = { current: container }
    const { result, rerender } = renderHook(({ duration }) => useTimelineZoom(ref, duration), { initialProps: { duration: 8 } })
    const before = result.current.pixelsPerSecond
    rerender({ duration: 7200 })
    expect(result.current.zoom).toBe(1)
    act(() => result.current.zoomToFit())
    expect(result.current.pixelsPerSecond).toBeLessThan(before)
    expect(result.current.pixelsPerSecond * 7200).toBeCloseTo(800 - TIMELINE_TAIL_PX)
    expect(result.current.totalWidth).toBeCloseTo(800)
  })
})
