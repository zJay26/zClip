import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useExport } from '../hooks/useExport'
import { useProjectStore } from '../stores/project-store'

describe('export lifecycle', () => {
  const api = { showSaveDialog: vi.fn(), startExport: vi.fn(), cancelExport: vi.fn(),
    onExportComplete: vi.fn(), onExportError: vi.fn(), onExportProgress: vi.fn() }
  let complete: (path: string) => void
  let error: (message: string) => void
  let finish: (result: { success: boolean; error?: string }) => void
  beforeEach(() => {
    vi.useFakeTimers()
    useProjectStore.getState().reset()
    Object.values(api).forEach((mock) => mock.mockReset())
    api.showSaveDialog.mockResolvedValue('D:\\output.mp4')
    api.startExport.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    api.onExportComplete.mockImplementation((callback) => { complete = callback; return () => {} })
    api.onExportError.mockImplementation((callback) => { error = callback; return () => {} })
    api.onExportProgress.mockReturnValue(() => {})
    Object.defineProperty(window, 'api', { value: api, configurable: true })
    useProjectStore.setState({ mediaInfo: {
      filePath: 'D:\\input.mp4', duration: 4, width: 640, height: 360, fps: 30, videoCodec: 'h264',
      audioCodec: '', hasVideo: true, hasAudio: false, sampleRate: 0, fileSize: 1
    }, timelineDuration: 4 })
  })
  afterEach(() => {
    cleanup()
    useProjectStore.getState().reset()
    vi.useRealTimers()
  })

  test('picker exceptions reset busy state and permit retry', async () => {
    api.showSaveDialog.mockRejectedValueOnce(new Error('picker failed'))
    const { result } = renderHook(() => useExport())
    await act(async () => { expect(await result.current.startExport('original', 'high', 'mp4')).toBe(false) })
    expect(result.current.exporting).toBe(false)
    expect(useProjectStore.getState().toast?.message).toContain('picker failed')
    api.showSaveDialog.mockResolvedValue(null)
    await act(async () => { expect(await result.current.startExport('original', 'high', 'mp4')).toBe(false) })
    expect(api.showSaveDialog).toHaveBeenCalledTimes(2)
  })

  test('IPC rejection resets busy state without an unhandled promise', async () => {
    api.startExport.mockRejectedValueOnce(new Error('channel closed'))
    const { result } = renderHook(() => useExport())
    await act(async () => { expect(await result.current.startExport('original', 'high', 'mp4')).toBe(false) })
    expect(result.current.exporting).toBe(false)
    expect(useProjectStore.getState().toast?.message).toContain('channel closed')
  })

  test('duplicate requests are ignored while a native export is active', async () => {
    const { result } = renderHook(() => useExport())
    let job!: Promise<boolean>
    await act(async () => { job = result.current.startExport('original', 'high', 'mp4') })
    await act(async () => { expect(await result.current.startExport('original', 'high', 'mp4')).toBe(false) })
    expect(api.showSaveDialog).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ success: true }); await job })
  })

  test('cancel keeps the lock through native cleanup and suppresses late errors and completion', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useExport({ onComplete }))
    let job!: Promise<boolean>
    await act(async () => { job = result.current.startExport('original', 'high', 'mp4') })
    act(() => result.current.cancelExport())
    expect(result.current.exporting).toBe(true)
    act(() => { error('canceled process'); complete('D:\\output.mp4') })
    expect(useProjectStore.getState().toast?.type).toBe('info')
    await act(async () => { finish({ success: true }); expect(await job).toBe(false) })
    act(() => vi.advanceTimersByTime(1000))
    expect(onComplete).not.toHaveBeenCalled()
    expect(result.current.exporting).toBe(false)
    expect(api.cancelExport).toHaveBeenCalledTimes(1)
  })

  test('successful completion shows 100% and closes only after native completion', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useExport({ onComplete }))
    let job!: Promise<boolean>
    await act(async () => { job = result.current.startExport('original', 'high', 'mp4') })
    act(() => complete('D:\\output.mp4'))
    expect(result.current.exporting).toBe(true)
    await act(async () => { finish({ success: true }); expect(await job).toBe(true) })
    expect(result.current.exportProgress?.percent).toBe(100)
    act(() => vi.advanceTimersByTime(600))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  test('ignores events from merge jobs when this hook has no active export', () => {
    const { result } = renderHook(() => useExport())
    act(() => { error('other job'); complete('D:\\merge.mp4') })
    expect(useProjectStore.getState().toast).toBeNull()
    expect(result.current.exportProgress).toBeNull()
  })

  test.each([[NaN, 2], [0, Infinity], [-1, 2], [0, 5], [3, 2]])('rejects invalid range %s..%s before opening a picker', async (startTime, endTime) => {
    const { result } = renderHook(() => useExport())
    await act(async () => {
      expect(await result.current.startExport('original', 'high', 'mp4', 'infinite', { mode: 'range', startTime, endTime })).toBe(false)
    })
    expect(api.showSaveDialog).not.toHaveBeenCalled()
  })
})
