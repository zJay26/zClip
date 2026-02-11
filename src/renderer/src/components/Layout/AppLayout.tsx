// ============================================================
// AppLayout — 顶部工具栏 + 主内容区布局
// ============================================================

import React, { useState, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../stores/project-store'
import VideoPreview from '../Preview/VideoPreview'
import Timeline from '../Timeline/Timeline'
import ExportDialog from '../Export/ExportDialog'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import TopToolbar from './TopToolbar'
import InspectorPanel from './InspectorPanel'
import OverlayStack from './OverlayStack'

const AppLayout: React.FC = () => {
  const {
    clips,
    sourceFile,
    mediaInfo,
    loading,
    merging,
    error,
    toast,
    clearToast,
    showToast,
    openFiles,
    loadFiles,
    splitClipAtPlayhead,
    copySelectedClips,
    cutSelectedClips,
    pasteCopiedClips,
    deleteSelectedClips,
    selectedClipIds,
    undo,
    redo
  } = useProjectStore()

  const [showExport, setShowExport] = useState(false)

  const {
    videoRef,
    togglePlay,
    seekTo,
    step,
    onLoadedMetadata,
    onEnded,
    playing
  } = useVideoPlayer()

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const isTextEditableTarget = (target: EventTarget | null): boolean => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
      if (target instanceof HTMLElement && target.isContentEditable) return true
      return false
    }
    const handler = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
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
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(e.shiftKey ? -1 : -0.04) // frame step ~25fps
          break
        case 'ArrowRight':
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          step(e.shiftKey ? 1 : 0.04)
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
    merging
  ])

  // ---- Drag & Drop ----
  const [dragActive, setDragActive] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
    setDragActive(true)
  }, [])

  const handleDragOverCapture = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDropCapture = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      
      let filePaths: string[] = []
  
      // 方式1: 从 files 获取
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length > 0) {
        filePaths = files
          .map((file) => {
            // 浏览器环境直接使用 file.path (Electron)
            if ('path' in file && file.path) {
              return file.path as string
            }
            // 或使用自定义 API
            return window.api?.getPathForFile?.(file) || ''
          })
          .filter(Boolean)
      }
      // 方式2: 从 URI 列表获取（拖拽文件资源管理器的情况）
      if (filePaths.length === 0) {
        const uriList = e.dataTransfer.getData('text/uri-list') || 
                        e.dataTransfer.getData('text/plain')
        if (uriList) {
          filePaths = uriList
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
              try {
                if (line.startsWith('file://')) {
                  const url = new URL(line)
                  let path = decodeURIComponent(url.pathname)
                  // Windows: /C:/path -> C:/path
                  if (/^\/[A-Za-z]:/.test(path)) {
                    path = path.substring(1)
                  }
                  return path.replace(/\//g, '\\') // Windows 路径格式
                }
                return line
              } catch (error) {
                console.error('URI 解析失败:', line, error)
                return ''
              }
            })
            .filter(Boolean)
        }
      }
      if (filePaths.length > 0) {
        loadFiles(filePaths)
      } else {
        showToast?.('未检测到可导入的文件，请从资源管理器拖入', 'error')
      }
    },
    [loadFiles, showToast]
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
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
      loadFiles(filePaths)
    })
    return () => unsubscribe()
  }, [loadFiles])

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
        onOpenFiles={openFiles}
        onOpenExport={() => setShowExport(true)}
      />

      {/* ===== Main content ===== */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Parameter controls panel */}
        {clips.length > 0 && <InspectorPanel />}

        {/* Right: Video preview */}
        <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
          <VideoPreview
            videoRef={videoRef as React.RefObject<HTMLVideoElement>}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            togglePlay={togglePlay}
            step={step}
          />
        </div>
      </div>

      {/* ===== Bottom: Timeline ===== */}
      {clips.length > 0 && (
        <div className="shrink-0 px-3 pb-3">
          <Timeline seekTo={seekTo} />
        </div>
      )}
      <OverlayStack
        dragActive={dragActive}
        loading={loading}
        merging={merging}
        error={error}
        toast={toast}
        clearToast={clearToast}
      />

      {/* ===== Export dialog ===== */}
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} />
    </div>
  )
}

export default AppLayout
