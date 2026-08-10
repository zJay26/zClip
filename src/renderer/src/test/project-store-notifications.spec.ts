import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useProjectStore } from '@renderer/stores/project-store'

describe('project store notifications and save races', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useProjectStore.getState().reset()
  })

  afterEach(() => {
    useProjectStore.getState().clearToast()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('a repeated toast keeps its full visibility window', () => {
    useProjectStore.getState().showToast('Saved', 'success')
    vi.advanceTimersByTime(3_000)
    useProjectStore.getState().showToast('Saved', 'success')
    vi.advanceTimersByTime(600)

    expect(useProjectStore.getState().toast).toEqual({ message: 'Saved', type: 'success' })

    vi.advanceTimersByTime(2_900)
    expect(useProjectStore.getState().toast).toBeNull()
  })

  test('keeps the document dirty when it changes during save', async () => {
    let finishSave: ((value: { success: boolean }) => void) | undefined
    const saveProjectFile = vi.fn(() => new Promise<{ success: boolean }>((resolve) => {
      finishSave = resolve
    }))
    const clearAutosave = vi.fn(async () => ({ success: true }))
    const getRecentProjects = vi.fn(async () => [])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { saveProjectFile, clearAutosave, getRecentProjects }
    })

    useProjectStore.setState({
      projectFilePath: 'D:\\video\\draft.zclip',
      projectDirty: true,
      documentRevision: 1
    })
    const saving = useProjectStore.getState().saveProject()
    useProjectStore.setState({ projectDirty: true, documentRevision: 2 })
    finishSave?.({ success: true })

    await saving

    expect(useProjectStore.getState().projectDirty).toBe(true)
    expect(clearAutosave).not.toHaveBeenCalled()
    expect(useProjectStore.getState().toast?.type).toBe('info')
  })

  test('serializes overlapping imports so neither result is lost', async () => {
    let finishFirstProbe: ((value: { success: boolean; data: Record<string, unknown> }) => void) | undefined
    const mediaInfo = (filePath: string) => ({
      duration: 10,
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: null,
      sampleRate: null,
      fileSize: 1,
      filePath,
      hasVideo: true,
      hasAudio: false
    })
    const getMediaInfo = vi.fn((filePath: string) => {
      if (filePath.endsWith('first.mp4')) {
        return new Promise<{ success: boolean; data: Record<string, unknown> }>((resolve) => {
          finishFirstProbe = resolve
        })
      }
      return Promise.resolve({ success: true, data: mediaInfo(filePath) })
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getMediaInfo,
        preparePlayback: vi.fn(async () => ({ success: false }))
      }
    })

    const first = useProjectStore.getState().loadFiles(['D:\\media\\first.mp4'])
    const second = useProjectStore.getState().loadFiles(['D:\\media\\second.mp4'])
    await Promise.resolve()
    await Promise.resolve()

    expect(getMediaInfo).toHaveBeenCalledTimes(1)
    finishFirstProbe?.({ success: true, data: mediaInfo('D:\\media\\first.mp4') })
    await Promise.all([first, second])

    expect(new Set(useProjectStore.getState().clips.map((clip) => clip.filePath))).toEqual(new Set([
      'D:\\media\\first.mp4',
      'D:\\media\\second.mp4'
    ]))
  })
})
