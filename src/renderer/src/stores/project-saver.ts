import type { ProjectStore } from './project-store-types'
import { buildProjectData } from './project-store-helpers'
import { translate } from '../contexts/preferences'

/** Coalesce repeated saves and never attach an old save to a different document. */
export function createProjectSaver(
  get: () => ProjectStore,
  set: (patch: Partial<ProjectStore>) => void,
  generation: () => number
): (saveAs?: boolean) => Promise<boolean> {
  let pending: { generation: number; promise: Promise<boolean> } | null = null
  return (saveAs = false) => {
    const documentGeneration = generation()
    if (pending?.generation === documentGeneration) return pending.promise
    const perform = async (): Promise<boolean> => {
      try {
        if (generation() !== documentGeneration) return false
        const initial = get()
        const name = (initial.projectFilePath || initial.sourceFile || 'Untitled')
          .split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '')
        const filePath = !saveAs && initial.projectFilePath
          ? initial.projectFilePath
          : await window.api.showProjectSaveDialog(`${name}.zclip`)
        if (!filePath || generation() !== documentGeneration) return false
        const snapshot = get()
        const revision = snapshot.documentRevision
        const result = await window.api.saveProjectFile(filePath, buildProjectData(snapshot))
        if (!result.success) throw new Error(result.error || translate('未知错误', 'Unknown error'))
        if (generation() !== documentGeneration) return false
        const savedLatest = get().documentRevision === revision
        set({ projectFilePath: filePath, projectDirty: savedLatest ? false : get().projectDirty })
        let cleanupFailed = false
        if (savedLatest) await get().clearAutosave().catch(() => { cleanupFailed = true })
        if (generation() !== documentGeneration) return false
        await get().refreshRecentProjects()
        if (generation() !== documentGeneration) return false
        const newerChanges = get().documentRevision !== revision
        get().showToast(newerChanges
          ? translate('项目已保存，但保存期间产生了新改动', 'Project saved, but newer changes still need saving')
          : cleanupFailed
            ? translate('项目已保存，但旧自动保存未能清理', 'Project saved, but the previous autosave could not be cleared')
            : translate('项目已保存', 'Project saved'), newerChanges || cleanupFailed ? 'info' : 'success')
        return true
      } catch (error) {
        if (generation() === documentGeneration) {
          const detail = error instanceof Error ? error.message : translate('未知错误', 'Unknown error')
          get().showToast(translate(`项目保存失败：${detail}`, `Project save failed: ${detail}`), 'error')
        }
        return false
      }
    }
    // Schedule after assigning pending, including APIs that throw synchronously.
    const promise = Promise.resolve().then(perform).finally(() => {
      if (pending?.promise === promise) pending = null
    })
    pending = { generation: documentGeneration, promise }
    return promise
  }
}
