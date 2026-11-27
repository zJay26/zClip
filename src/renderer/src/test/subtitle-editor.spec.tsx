import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import InspectorPanel from '../components/Layout/InspectorPanel'
import VideoPreview from '../components/Preview/VideoPreview'
import { useProjectStore } from '../stores/project-store'

afterEach(() => { cleanup(); useProjectStore.getState().reset() })

it('adds and retimes multiline text at the playhead and previews the half-open interval', () => {
  const mediaInfo = { filePath: 'C:\\clip.mp4', duration: 4, width: 320, height: 180, fps: 25,
    videoCodec: 'h264', audioCodec: '', hasVideo: true, hasAudio: false, sampleRate: 0, fileSize: 1 }
  useProjectStore.setState({ clips: [{ id: 'v', groupId: 'v', mediaInfo, filePath: mediaInfo.filePath,
    track: 'video', trackIndex: 0, startTime: 0, duration: 4 }], currentTime: 1, timelineDuration: 4 })
  const seek = (time: number) => useProjectStore.getState().setCurrentTime(time)
  const preview = render(<VideoPreview videoBufferRefs={[React.createRef(), React.createRef(), React.createRef()]}
    activeVideoBuffer={0} videoBufferClipIds={['v', null, null]} transitionVideoBuffers={null}
    onLoadedMetadata={vi.fn()} onEnded={vi.fn()} togglePlay={vi.fn()} step={vi.fn()} onOpenFiles={vi.fn()} />)
  render(<InspectorPanel seekTo={seek} />)
  fireEvent.click(screen.getByRole('tab', { name: '字幕' }))
  fireEvent.click(screen.getByText('在播放头添加字幕'))
  expect(screen.getByLabelText('开始（秒）')).toHaveValue(1)
  fireEvent.change(screen.getByLabelText('字幕文字'), { target: { value: '第一行\n第二行' } })
  fireEvent.click(screen.getByText('应用字幕'))
  const overlay = within(preview.container)
  expect(overlay.getByText('第一行 第二行')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /00:01.00.*第一行/ }))
  fireEvent.change(screen.getByLabelText('字幕文字'), { target: { value: '100% <plain>' } })
  fireEvent.change(screen.getByLabelText('开始（秒）'), { target: { value: '1.5' } })
  fireEvent.change(screen.getByLabelText('结束（秒）'), { target: { value: '2' } })
  fireEvent.click(screen.getByText('应用字幕'))
  expect(overlay.getByText('100% <plain>')).toBeVisible()
  act(() => seek(1.49))
  expect(overlay.queryByText('100% <plain>')).toBeNull()
  act(() => seek(1.99))
  expect(overlay.getByText('100% <plain>')).toBeVisible()
  act(() => seek(2))
  expect(overlay.queryByText('100% <plain>')).toBeNull()
})
