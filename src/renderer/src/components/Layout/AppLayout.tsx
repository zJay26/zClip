// ============================================================
// AppLayout — 顶部工具栏 + 主内容区布局
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import VideoPreview from '../Preview/VideoPreview'
import Timeline from '../Timeline/Timeline'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import TopToolbar from './TopToolbar'
import InspectorPanel from './InspectorPanel'
import OverlayStack from './OverlayStack'
import { Button, Dialog } from '../ui'
import { clamp } from '../../lib/utils'
import { translate, usePreferences } from '../../contexts/preferences'
import type { AppCloseDecision, CacheStats, ProjectData } from '../../../../shared/types'

interface LayoutSizeState {
  inspectorWidth: number
  timelineHeight: number
}

const LAYOUT_STORAGE_KEY = 'zclip.layout.sizes.v2'
const LEGACY_LAYOUT_STORAGE_KEY = 'zclip.layout.sizes.v1'
const DEFAULT_LAYOUT_SIZES: LayoutSizeState = {
  inspectorWidth: 310,
  timelineHeight: 260
}
const INSPECTOR_MIN_WIDTH = 240
const INSPECTOR_MAX_WIDTH = 520
const PREVIEW_MIN_WIDTH = 380
const TIMELINE_MIN_HEIGHT = 170
const TIMELINE_MAX_HEIGHT = 520
const PREVIEW_MIN_HEIGHT = 230
const TRANSITION_DRAG_MIME = 'application/x-zclip-transition'
const ExportDialog = React.lazy(() => import('../Export/ExportDialog'))

function formatCacheSize(stats: CacheStats | null): string {
  if (!stats || stats.bytes <= 0) return ''
  if (stats.bytes < 1024 ** 2) return `${Math.round(stats.bytes / 1024)} KB`
  if (stats.bytes < 1024 ** 3) return `${Math.round(stats.bytes / 1024 ** 2)} MB`
  return `${(stats.bytes / 1024 ** 3).toFixed(1)} GB`
}

function isInternalTimelineDrag(event: React.DragEvent): boolean {
  const { types } = event.dataTransfer
  const typeList = types as unknown as { contains?: (type: string) => boolean }
  if (typeof typeList.contains === 'function') {
    return typeList.contains(TRANSITION_DRAG_MIME)
  }
  return Array.from(types).includes(TRANSITION_DRAG_MIME)
}

function getInspectorMaxWidth(): number {
  if (typeof window === 'undefined') return INSPECTOR_MAX_WIDTH
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    Math.min(INSPECTOR_MAX_WIDTH, window.innerWidth - PREVIEW_MIN_WIDTH)
  )
}

function getTimelineMaxHeight(): number {
  if (typeof window === 'undefined') return TIMELINE_MAX_HEIGHT
  return Math.max(
    TIMELINE_MIN_HEIGHT,
    Math.min(TIMELINE_MAX_HEIGHT, window.innerHeight - PREVIEW_MIN_HEIGHT)
  )
}

function normalizeLayoutSizes(value: Partial<LayoutSizeState> | null | undefined): LayoutSizeState {
  const inspectorWidth = value?.inspectorWidth
  const timelineHeight = value?.timelineHeight
  return {
    inspectorWidth: clamp(
      typeof inspectorWidth === 'number' && Number.isFinite(inspectorWidth)
        ? inspectorWidth
        : DEFAULT_LAYOUT_SIZES.inspectorWidth,
      INSPECTOR_MIN_WIDTH,
      getInspectorMaxWidth()
    ),
    timelineHeight: clamp(
      typeof timelineHeight === 'number' && Number.isFinite(timelineHeight)
        ? timelineHeight
        : DEFAULT_LAYOUT_SIZES.timelineHeight,
      TIMELINE_MIN_HEIGHT,
      getTimelineMaxHeight()
    )
  }
}

function readLayoutSizes(): LayoutSizeState {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT_SIZES
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_LAYOUT_STORAGE_KEY)
    return normalizeLayoutSizes(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_LAYOUT_SIZES
  }
}

const AppLayout: React.FC = () => {
  const { t } = usePreferences()
  const {
    clips,
    sourceFile,
    mediaInfo,
    loading,
    merging,
    exporting,
    error,
    toast,
    projectFilePath,
    projectDirty,
    documentRevision,
    projectSettings,
    missingMediaPaths,
    recentProjects,
    clearToast,
    showToast,
    openFiles,
    loadFiles,
    saveProject,
    saveProjectAs,
    openProject,
    openProjectFromPath,
    refreshRecentProjects,
    recoverAutosave,
    autosaveNow,
    clearAutosave,
    relinkMissingMedia,
    reset,
    splitClipAtPlayhead,
    copySelectedClips,
    cutSelectedClips,
    pasteCopiedClips,
    deleteSelectedClips,
    selectedClipIds,
    undo,
    redo,
    historyPast,
    historyFuture
  } = useProjectStore(useShallow((state) => ({
    clips: state.clips,
    sourceFile: state.sourceFile,
    mediaInfo: state.mediaInfo,
    loading: state.loading,
    merging: state.merging,
    exporting: state.exporting,
    error: state.error,
    toast: state.toast,
    projectFilePath: state.projectFilePath,
    projectDirty: state.projectDirty,
    documentRevision: state.documentRevision,
    projectSettings: state.projectSettings,
    missingMediaPaths: state.missingMediaPaths,
    recentProjects: state.recentProjects,
    clearToast: state.clearToast,
    showToast: state.showToast,
    openFiles: state.openFiles,
    loadFiles: state.loadFiles,
    saveProject: state.saveProject,
    saveProjectAs: state.saveProjectAs,
    openProject: state.openProject,
    openProjectFromPath: state.openProjectFromPath,
    refreshRecentProjects: state.refreshRecentProjects,
    recoverAutosave: state.recoverAutosave,
    autosaveNow: state.autosaveNow,
    clearAutosave: state.clearAutosave,
    relinkMissingMedia: state.relinkMissingMedia,
    reset: state.reset,
    splitClipAtPlayhead: state.splitClipAtPlayhead,
    copySelectedClips: state.copySelectedClips,
    cutSelectedClips: state.cutSelectedClips,
    pasteCopiedClips: state.pasteCopiedClips,
    deleteSelectedClips: state.deleteSelectedClips,
    selectedClipIds: state.selectedClipIds,
    undo: state.undo,
    redo: state.redo,
    historyPast: state.historyPast,
    historyFuture: state.historyFuture
  })))

  const [showExport, setShowExport] = useState(false)
  const [autosavePrompt, setAutosavePrompt] = useState<ProjectData | null>(null)
  const [closePrompt, setClosePrompt] = useState(false)
  const [closeSaving, setCloseSaving] = useState(false)
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null)
  const [layoutSizes, setLayoutSizes] = useState<LayoutSizeState>(readLayoutSizes)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const closeResolverRef = useRef<((decision: AppCloseDecision) => void) | null>(null)

  const {
    videoRef,
    togglePlay,
    seekTo,
    step,
    onLoadedMetadata,
    onEnded,
    playing
  } = useVideoPlayer()
  const frameStep = 1 / Math.max(1, projectSettings.frameRate ?? mediaInfo?.fps ?? 30)

  const newProject = useCallback(() => {
    if (useProjectStore.getState().projectDirty && !window.confirm(translate('新建项目会放弃当前未保存的更改，是否继续？', 'Creating a new project will discard unsaved changes. Continue?'))) return
    void clearAutosave()
      .then(() => {
        reset()
        showToast(translate('已新建空项目', 'New empty project created'), 'success')
      })
      .catch((error) => {
        showToast(error instanceof Error
          ? translate(`无法清理旧自动保存：${error.message}`, `Could not clear the previous autosave: ${error.message}`)
          : translate('无法清理旧自动保存', 'Could not clear the previous autosave'), 'error')
      })
  }, [clearAutosave, reset, showToast])

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layoutSizes))
    } catch {
      // Layout persistence is best-effort; resizing should still work.
    }
  }, [layoutSizes])

  useEffect(() => {
    const handleWindowResize = (): void => {
      setLayoutSizes((current) => normalizeLayoutSizes(current))
    }
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
    }
  }, [])

  const beginResize = useCallback(
    (type: 'inspector' | 'timeline', e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      resizeCleanupRef.current?.()

      const session = {
        startX: e.clientX,
        startY: e.clientY,
        inspectorWidth: layoutSizes.inspectorWidth,
        timelineHeight: layoutSizes.timelineHeight
      }
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let finished = false

      document.body.style.cursor = type === 'inspector' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (event: PointerEvent): void => {
        event.preventDefault()
        if (type === 'inspector') {
          const nextWidth = clamp(
            session.inspectorWidth + session.startX - event.clientX,
            INSPECTOR_MIN_WIDTH,
            getInspectorMaxWidth()
          )
          setLayoutSizes((current) => ({ ...current, inspectorWidth: nextWidth }))
          return
        }

        const nextHeight = clamp(
          session.timelineHeight + session.startY - event.clientY,
          TIMELINE_MIN_HEIGHT,
          getTimelineMaxHeight()
        )
        setLayoutSizes((current) => ({ ...current, timelineHeight: nextHeight }))
      }

      const finishResize = (): void => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', finishResize)
        window.removeEventListener('pointercancel', finishResize)
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        resizeCleanupRef.current = null
      }

      window.addEventListener('pointermove', handleMove, { passive: false })
      window.addEventListener('pointerup', finishResize)
      window.addEventListener('pointercancel', finishResize)
      resizeCleanupRef.current = finishResize
    },
    [layoutSizes.inspectorWidth, layoutSizes.timelineHeight]
  )

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const isTextEditableTarget = (target: EventTarget | null): boolean => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
      if (target instanceof HTMLElement && target.isContentEditable) return true
      return false
    }
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyS') {
          e.preventDefault()
          if (clips.length > 0) void (e.shiftKey ? saveProjectAs() : saveProject())
          return
        }
        if (e.code === 'KeyO') {
          e.preventDefault()
          void openProject()
          return
        }
        if (e.code === 'KeyN') {
          e.preventDefault()
          newProject()
          return
        }
      }
      if (e.code === 'Space') {
        if (isTextEditableTarget(e.target)) return
        // Capture and override browser/button default "Space triggers click".
        e.preventDefault()
        e.stopPropagation()
        const activeEl = document.activeElement
        if (activeEl instanceof HTMLButtonElement) {
          activeEl.blur()
        }
        if (!e.repeat && !merging) {
          togglePlay()
        }
        return
      }
      if (merging) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      switch (e.code) {
        case 'KeyZ':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            if (e.shiftKey) {
              redo()
            } else {
              undo()
            }
          }
          break
        case 'KeyY':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            redo()
          }
          break
        case 'KeyJ':
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(-5)
          break
        case 'KeyK':
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          togglePlay()
          break
        case 'KeyL':
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(5)
          break
        case 'KeyC':
          if (e.ctrlKey || e.metaKey) {
            if (isTextEditableTarget(e.target)) return
            e.preventDefault()
            copySelectedClips()
            return
          }
          // Razor tool: split at playhead
          if (isTextEditableTarget(e.target)) return
          splitClipAtPlayhead()
          break
        case 'KeyX':
          if (!(e.ctrlKey || e.metaKey)) break
          if (isTextEditableTarget(e.target)) return
          e.preventDefault()
          cutSelectedClips()
          break
        case 'KeyV':
          if (!(e.ctrlKey || e.metaKey)) break
          if (isTextEditableTarget(e.target)) return
          e.preventDefault()
          pasteCopiedClips()
          break
        case 'Delete':
        case 'Backspace':
          if (isTextEditableTarget(e.target)) return
          deleteSelectedClips()
          break
        case 'ArrowLeft':
          if (e.target instanceof HTMLElement && e.target.closest('[data-preview-transform-handle]')) return
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(e.shiftKey ? -1 : -frameStep)
          break
        case 'ArrowRight':
          if (e.target instanceof HTMLElement && e.target.closest('[data-preview-transform-handle]')) return
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(e.shiftKey ? 1 : frameStep)
          break
      }
    }
    const keyupHandler = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        const activeEl = document.activeElement
        if (activeEl instanceof HTMLElement) {
          activeEl.blur()
        }
      }
    }
    window.addEventListener('keydown', handler, true)
    window.addEventListener('keyup', keyupHandler, true)
    return () => {
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('keyup', keyupHandler, true)
    }
  }, [
    togglePlay,
    step,
    splitClipAtPlayhead,
    copySelectedClips,
    cutSelectedClips,
    pasteCopiedClips,
    deleteSelectedClips,
    selectedClipIds,
    undo,
    redo,
    merging,
    frameStep,
    clips.length,
    saveProject,
    saveProjectAs,
    openProject,
    newProject
  ])

  // ---- Drag & Drop ----
  const [dragActive, setDragActive] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (isInternalTimelineDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
    setDragActive(true)
  }, [])

  const handleDragOverCapture = useCallback((e: React.DragEvent) => {
    if (isInternalTimelineDrag(e)) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDropCapture = useCallback((e: React.DragEvent) => {
    if (isInternalTimelineDrag(e)) return
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (isInternalTimelineDrag(e)) return
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      
      const files = Array.from(e.dataTransfer.files || [])
      const filePaths = files.length > 0
        ? await window.api.resolveDroppedFiles(files).catch(() => [])
        : []
      if (filePaths.length > 0) {
        await loadFiles(filePaths)
      } else {
        showToast?.(translate('未检测到可导入的文件，请从资源管理器拖入', 'No importable files found. Drag files from File Explorer.'), 'error')
      }
    },
    [loadFiles, showToast]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (isInternalTimelineDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (isInternalTimelineDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setDragActive(false)
    }
  }, [])

  useEffect(() => {
    const preventDefaults = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    const clearDrag = (): void => setDragActive(false)
    window.addEventListener('dragover', preventDefaults)
    window.addEventListener('drop', preventDefaults)
    window.addEventListener('dragleave', clearDrag)
    window.addEventListener('dragend', clearDrag)
    return () => {
      window.removeEventListener('dragover', preventDefaults)
      window.removeEventListener('drop', preventDefaults)
      window.removeEventListener('dragleave', clearDrag)
      window.removeEventListener('dragend', clearDrag)
    }
  }, [])

  useEffect(() => {
    if (!window.api?.onOpenFile) return
    const unsubscribe = window.api.onOpenFile((filePaths) => {
      if (!filePaths || filePaths.length === 0) return
      const projectFiles = filePaths.filter((filePath) => filePath.toLowerCase().endsWith('.zclip'))
      const mediaFiles = filePaths.filter((filePath) => !filePath.toLowerCase().endsWith('.zclip'))
      void (async () => {
        if (projectFiles.length > 0) {
          const opened = await openProjectFromPath(projectFiles[0])
          if (!opened) return
          if (projectFiles.length > 1) showToast(translate('一次只能打开一个项目文件', 'Only one project file can be opened at a time'), 'info')
        }
        if (mediaFiles.length > 0) await loadFiles(mediaFiles)
      })()
    })
    const readyTimer = window.setTimeout(() => window.api.rendererReady(), 0)
    return () => {
      window.clearTimeout(readyTimer)
      unsubscribe()
    }
  }, [loadFiles, openProjectFromPath, showToast])

  useEffect(() => {
    const unsubscribe = window.api.onAppCloseRequest(async () => {
      const state = useProjectStore.getState()
      if (!state.projectDirty) return 'close'
      try {
        await state.autosaveNow()
      } catch (error) {
        state.showToast(error instanceof Error
          ? translate(`退出前自动保存失败：${error.message}`, `Autosave before exit failed: ${error.message}`)
          : translate('退出前自动保存失败', 'Autosave before exit failed'), 'error')
      }
      return new Promise<AppCloseDecision>((resolve) => {
        closeResolverRef.current = resolve
        setClosePrompt(true)
      })
    })
    return () => {
      unsubscribe()
      closeResolverRef.current?.('cancel')
      closeResolverRef.current = null
    }
  }, [])

  const resolveCloseRequest = useCallback((decision: AppCloseDecision): void => {
    setClosePrompt(false)
    setCloseSaving(false)
    closeResolverRef.current?.(decision)
    closeResolverRef.current = null
  }, [])

  useEffect(() => {
    refreshRecentProjects()
    window.api.getCacheStats().then(setCacheStats).catch(() => {})
    window.api.getAutosave().then((data) => {
      if (data && data.clips.length > 0 && clips.length === 0) {
        setAutosavePrompt(data)
      }
    }).catch(() => {})
  }, [])

  const clearCaches = useCallback(async () => {
    if (!window.confirm(translate('确定清理代理视频和时间线预览缓存吗？原始素材不会被删除。', 'Clear proxy videos and timeline preview cache? Original media will not be deleted.'))) return
    try {
      setCacheStats(await window.api.clearMediaCaches())
      useProjectStore.setState((state) => ({
        clips: state.clips.map((clip) => ({
          ...clip,
          mediaInfo: { ...clip.mediaInfo, playbackPath: clip.filePath, playbackIsProxy: false }
        })),
        mediaInfo: state.mediaInfo
          ? { ...state.mediaInfo, playbackPath: state.mediaInfo.filePath, playbackIsProxy: false }
          : null
      }))
      showToast(translate('媒体缓存已清理', 'Media cache cleared'), 'success')
    } catch {
      showToast(translate('缓存清理失败，请稍后重试', 'Could not clear the cache. Try again later.'), 'error')
    }
  }, [showToast])

  useEffect(() => {
    if (!projectDirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [projectDirty])

  useEffect(() => {
    if (clips.length === 0 || !projectDirty) return
    const handle = window.setTimeout(() => {
      autosaveNow().catch((error) => {
        showToast(error instanceof Error
          ? translate(`自动保存失败：${error.message}`, `Autosave failed: ${error.message}`)
          : translate('自动保存失败', 'Autosave failed'), 'error')
      })
    }, 900)
    return () => window.clearTimeout(handle)
  }, [
    documentRevision,
    projectDirty,
    autosaveNow,
    clips.length,
    showToast
  ])

  return (
    <div
      className="flex flex-col h-screen bg-bg-base"
      onDragOver={handleDragOver}
      onDragOverCapture={handleDragOverCapture}
      onDrop={handleDrop}
      onDropCapture={handleDropCapture}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      <TopToolbar
        loading={loading}
        sourceFile={sourceFile}
        mediaInfo={mediaInfo}
        clips={clips}
        projectFilePath={projectFilePath}
        projectDirty={projectDirty}
        recentProjects={recentProjects}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        onUndo={undo}
        onRedo={redo}
        onOpenFiles={openFiles}
        onNewProject={newProject}
        onOpenProject={openProject}
        onSaveProject={saveProject}
        onSaveProjectAs={saveProjectAs}
        onOpenRecentProject={openProjectFromPath}
        onClearCache={clearCaches}
        cacheLabel={formatCacheSize(cacheStats)}
        missingMediaCount={missingMediaPaths.length}
        onRelinkMissingMedia={() => { void relinkMissingMedia() }}
        onOpenExport={() => setShowExport(true)}
        exportButtonRef={exportButtonRef}
      />

      {/* ===== Main content ===== */}
      <div className="flex min-h-0 flex-1 bg-bg-elevated">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          <VideoPreview
            videoRef={videoRef as React.RefObject<HTMLVideoElement>}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            togglePlay={togglePlay}
            step={step}
            onOpenFiles={openFiles}
          />
        </div>
        {clips.length > 0 && (
          <div className="relative min-h-0 shrink-0" style={{ width: layoutSizes.inspectorWidth }}>
            <div
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              aria-label={t('调整检查器宽度', 'Resize inspector')}
              aria-valuemin={INSPECTOR_MIN_WIDTH}
              aria-valuemax={getInspectorMaxWidth()}
              aria-valuenow={Math.round(layoutSizes.inspectorWidth)}
              title={t('拖动调整检查器宽度，双击恢复默认', 'Drag to resize the inspector; double-click to reset')}
              className="group absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize outline-none"
              onPointerDown={(event) => beginResize('inspector', event)}
              onDoubleClick={() => setLayoutSizes((current) => ({ ...current, inspectorWidth: DEFAULT_LAYOUT_SIZES.inspectorWidth }))}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
                event.preventDefault()
                setLayoutSizes((current) => ({
                  ...current,
                  inspectorWidth: event.key === 'Home'
                    ? DEFAULT_LAYOUT_SIZES.inspectorWidth
                    : clamp(current.inspectorWidth + (event.key === 'ArrowLeft' ? 8 : -8), INSPECTOR_MIN_WIDTH, getInspectorMaxWidth())
                }))
              }}
            >
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border-subtle transition-colors group-hover:bg-accent group-focus:bg-accent" />
            </div>
            <InspectorPanel />
          </div>
        )}
      </div>

      {/* ===== Bottom: Timeline ===== */}
      {clips.length > 0 && (
        <>
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-label={t('调整时间轴高度', 'Resize timeline')}
            aria-valuemin={TIMELINE_MIN_HEIGHT}
            aria-valuemax={getTimelineMaxHeight()}
            aria-valuenow={Math.round(layoutSizes.timelineHeight)}
            title={t('拖动调整时间轴高度，双击恢复默认', 'Drag to resize the timeline; double-click to reset')}
            className="group relative h-2 shrink-0 cursor-row-resize bg-bg-elevated outline-none"
            onPointerDown={(event) => beginResize('timeline', event)}
            onDoubleClick={() => setLayoutSizes((current) => ({ ...current, timelineHeight: DEFAULT_LAYOUT_SIZES.timelineHeight }))}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') return
              event.preventDefault()
              setLayoutSizes((current) => ({
                ...current,
                timelineHeight: event.key === 'Home'
                  ? DEFAULT_LAYOUT_SIZES.timelineHeight
                  : clamp(current.timelineHeight + (event.key === 'ArrowUp' ? 8 : -8), TIMELINE_MIN_HEIGHT, getTimelineMaxHeight())
              }))
            }}
          >
            <div className="absolute left-3 right-3 top-1/2 h-px -translate-y-1/2 bg-border-subtle transition-colors group-hover:bg-accent group-focus:bg-accent" />
          </div>
          <div
            className="min-h-0 shrink-0 bg-bg-elevated px-3 pb-3"
            style={{ height: layoutSizes.timelineHeight }}
          >
            <Timeline seekTo={seekTo} />
          </div>
        </>
      )}
      <OverlayStack
        dragActive={dragActive}
        loading={loading}
        merging={merging}
        error={error}
        toast={toast}
        clearToast={clearToast}
      />

      {autosavePrompt && (
        <Dialog
          open
          title={t('发现自动保存项目', 'Autosaved project found')}
          description={t('上次编辑可能没有正常保存。你可以恢复自动保存的内容，或忽略并从空项目开始。', 'Your last edit may not have saved correctly. Restore the autosave or ignore it and start with an empty project.')}
          closeOnBackdrop={false}
        >
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  void clearAutosave()
                    .then(() => setAutosavePrompt(null))
                    .catch((error) => showToast(
                      error instanceof Error
                        ? translate(`忽略自动保存失败：${error.message}`, `Could not ignore autosave: ${error.message}`)
                        : translate('忽略自动保存失败', 'Could not ignore autosave'),
                      'error'
                    ))
                }}
              >
                {t('忽略', 'Ignore')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void recoverAutosave(autosavePrompt).then(() => setAutosavePrompt(null))
                }}
              >
                {t('恢复', 'Restore')}
              </Button>
            </div>
        </Dialog>
      )}

      <Dialog
        open={closePrompt}
        title={t('保存更改后退出？', 'Save changes before exiting?')}
        description={exporting || merging
          ? t('当前后台任务会在退出时安全取消。保存项目只保存编辑结构，不会保留未完成的导出文件。', 'The current background task will be canceled safely on exit. Saving preserves the edit structure, not an unfinished export.')
          : t('项目包含尚未保存的更改。退出前可以保存、放弃这些更改，或继续编辑。', 'This project has unsaved changes. Save or discard them before exiting, or keep editing.')}
        closeOnBackdrop={false}
        onClose={() => resolveCloseRequest('cancel')}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={closeSaving} onClick={() => resolveCloseRequest('cancel')}>{t('继续编辑', 'Keep editing')}</Button>
          <Button
            disabled={closeSaving}
            onClick={() => {
              setCloseSaving(true)
              void clearAutosave()
                .then(() => resolveCloseRequest('close'))
                .catch((error) => {
                  setCloseSaving(false)
                  showToast(error instanceof Error
                    ? translate(`放弃更改失败：${error.message}`, `Could not discard changes: ${error.message}`)
                    : translate('放弃更改失败', 'Could not discard changes'), 'error')
                })
            }}
          >
            {t('不保存', "Don't save")}
          </Button>
          <Button
            variant="primary"
            disabled={closeSaving}
            onClick={() => {
              setCloseSaving(true)
              void saveProject().then((saved) => {
                if (saved) resolveCloseRequest('close')
                else setCloseSaving(false)
              })
            }}
          >
            {closeSaving ? t('正在保存…', 'Saving…') : t('保存并退出', 'Save and exit')}
          </Button>
        </div>
      </Dialog>

      {/* ===== Export dialog ===== */}
      <React.Suspense fallback={null}>
        <ExportDialog open={showExport} onClose={() => setShowExport(false)} originRef={exportButtonRef} />
      </React.Suspense>
    </div>
  )
}

export default AppLayout
