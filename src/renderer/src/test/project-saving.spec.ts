import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useProjectStore } from '../stores/project-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('project save lifecycle', () => {
  const api = {
    showProjectSaveDialog: vi.fn(), saveProjectFile: vi.fn(), saveAutosave: vi.fn(),
    clearAutosave: vi.fn(), getRecentProjects: vi.fn()
  }
  beforeEach(() => {
    useProjectStore.getState().reset()
    Object.values(api).forEach((mock) => mock.mockReset())
    api.showProjectSaveDialog.mockResolvedValue('D:\\edit.zclip')
    api.saveProjectFile.mockResolvedValue({ success: true })
    api.saveAutosave.mockResolvedValue({ success: true })
    api.clearAutosave.mockResolvedValue({ success: true })
    api.getRecentProjects.mockResolvedValue([])
    Object.defineProperty(window, 'api', { value: api, configurable: true })
  })
  afterEach(() => useProjectStore.getState().reset())

  test('saves and autosaves an empty edited project', async () => {
    useProjectStore.getState().setProjectSettings({ frameRate: 60 })
    await useProjectStore.getState().autosaveNow()
    expect(api.saveAutosave).toHaveBeenCalledWith(expect.objectContaining({ clips: [], projectSettings: expect.objectContaining({ frameRate: 60 }) }))
    expect(await useProjectStore.getState().saveProject()).toBe(true)
    expect(useProjectStore.getState()).toMatchObject({ projectDirty: false, projectFilePath: 'D:\\edit.zclip', autosaveReady: false })
  })

  test('subtitle edits survive save, autosave, restore, undo and redo', async () => {
    const store = useProjectStore.getState
    useProjectStore.setState({ timelineDuration: 4 })
    const cue = { id: 'cue', startTime: 1, endTime: 3, text: '你好' }
    expect(store().saveSubtitle(cue)).toBe(true)
    expect(store()).toMatchObject({ projectDirty: true, documentRevision: 1 })
    expect(store().saveSubtitle({ ...cue, id: 'overlap' })).toBe(false)
    const revised = { ...cue, startTime: 1.5, endTime: 2.5, text: '你好，世界' }
    expect(store().saveSubtitle(revised)).toBe(true)
    store().deleteSubtitle(cue.id)
    store().undo()
    expect(store().subtitles).toEqual([revised])
    store().undo()
    expect(store().subtitles).toEqual([cue])
    store().redo()
    expect(store().subtitles).toEqual([revised])
    await store().autosaveNow()
    expect(await store().saveProject()).toBe(true)
    const saved = api.saveProjectFile.mock.calls[0][1]
    expect(saved.subtitles).toEqual([revised])
    expect(api.saveAutosave.mock.calls[0][0].subtitles).toEqual([revised])
    store().reset()
    store().restoreProjectData(saved)
    expect(store().subtitles).toEqual([revised])
    delete saved.subtitles
    store().restoreProjectData(saved)
    expect(store().subtitles).toEqual([])
  })

  test('repeated saves share one picker and capture edits made while the picker is open', async () => {
    const picker = deferred<string>()
    api.showProjectSaveDialog.mockReturnValue(picker.promise)
    const first = useProjectStore.getState().saveProject()
    const second = useProjectStore.getState().saveProject()
    await Promise.resolve()
    useProjectStore.getState().setProjectSettings({ frameRate: 24 })
    picker.resolve('D:\\picked.zclip')
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(api.showProjectSaveDialog).toHaveBeenCalledTimes(1)
    expect(api.saveProjectFile).toHaveBeenCalledTimes(1)
    expect(api.saveProjectFile.mock.calls[0][1].projectSettings.frameRate).toBe(24)
  })

  test('edits made during a disk write stay dirty and retain recovery data', async () => {
    const write = deferred<{ success: boolean }>()
    api.saveProjectFile.mockReturnValue(write.promise)
    useProjectStore.setState({ projectFilePath: 'D:\\edit.zclip' })
    const save = useProjectStore.getState().saveProject()
    await Promise.resolve()
    useProjectStore.getState().setProjectSettings({ frameRate: 48 })
    write.resolve({ success: true })
    expect(await save).toBe(true)
    expect(useProjectStore.getState().projectDirty).toBe(true)
    expect(api.clearAutosave).not.toHaveBeenCalled()
  })

  test('finishing an old save cannot mark a new project saved or attach its path', async () => {
    const write = deferred<{ success: boolean }>()
    api.saveProjectFile.mockReturnValue(write.promise)
    useProjectStore.setState({ projectFilePath: 'D:\\old.zclip' })
    const save = useProjectStore.getState().saveProject()
    await Promise.resolve()
    const replacement = useProjectStore.getState().buildProjectData()
    useProjectStore.getState().restoreProjectData(replacement, 'D:\\new.zclip')
    useProjectStore.getState().setProjectSettings({ frameRate: 24 })
    write.resolve({ success: true })
    expect(await save).toBe(false)
    expect(useProjectStore.getState()).toMatchObject({ projectFilePath: 'D:\\new.zclip', projectDirty: true })
    expect(api.clearAutosave).not.toHaveBeenCalled()
  })

  test('a picker completed after reset does not write a stale document', async () => {
    const picker = deferred<string>()
    api.showProjectSaveDialog.mockReturnValue(picker.promise)
    const save = useProjectStore.getState().saveProject()
    await Promise.resolve()
    useProjectStore.getState().reset()
    picker.resolve('D:\\old.zclip')
    expect(await save).toBe(false)
    expect(api.saveProjectFile).not.toHaveBeenCalled()
  })

  test('write failure keeps dirty state and allows retry', async () => {
    useProjectStore.getState().setProjectSettings({ frameRate: 24 })
    api.saveProjectFile.mockRejectedValueOnce(new Error('disk full'))
    expect(await useProjectStore.getState().saveProject()).toBe(false)
    expect(useProjectStore.getState().projectDirty).toBe(true)
    expect(await useProjectStore.getState().saveProject()).toBe(true)
  })
})
