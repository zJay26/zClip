// ============================================================
// AppLayout — 顶部工具栏 + 主内容区布局
// ============================================================

import React, { useState, useCallback, useEffect } from 'react'
import { useProjectStore } from '../../stores/project-store'
import VideoPreview from '../Preview/VideoPreview'
import Timeline from '../Timeline/Timeline'
import TrimControl from '../Controls/TrimControl'
import SpeedControl from '../Controls/SpeedControl'
import VolumeControl from '../Controls/VolumeControl'
import PitchControl from '../Controls/PitchControl'
import ExportDialog from '../Export/ExportDialog'
import { useVideoPlayer } from '../../hooks/useVideoPlayer'
import { formatFileSize } from '../../lib/utils'

const AppLayout: React.FC = () => {
  const {
    clips,
    sourceFile,
    mediaInfo,
    loading,
    error,
    toast,
    clearToast,
    showToast,
    openFiles,
    loadFiles,
    splitClipAtPlayhead,
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
    const handler = (e: KeyboardEvent): void => {
      switch (e.code) {
        case 'KeyZ':
          if (e.ctrlKey) {
            e.preventDefault()
            undo()
          }
          break
        case 'KeyY':
          if (e.ctrlKey) {
            e.preventDefault()
            redo()
          }
          break
        case 'Space':
          e.preventDefault()
          togglePlay()
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
          // Razor tool: split at playhead
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
          splitClipAtPlayhead()
          break
        case 'Delete':
        case 'Backspace':
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return
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
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, step, splitClipAtPlayhead, deleteSelectedClips, selectedClipIds, undo, redo])

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

  // Extract filename from path
  const fileName = sourceFile ? sourceFile.split(/[\\/]/).pop() : null

  return (
    <div
      className="flex flex-col h-screen bg-surface"
      onDragOver={handleDragOver}
      onDragOverCapture={handleDragOverCapture}
      onDrop={handleDrop}
      onDropCapture={handleDropCapture}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {/* ===== Top toolbar ===== */}
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-light border-b border-surface-border shrink-0">
        {/* App name */}
        <span className="text-sm font-bold text-accent tracking-tight">zClip</span>

        <div className="w-px h-4 bg-surface-border" />

        {/* Open file */}
        <button
          onClick={openFiles}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary
                     rounded-md hover:bg-surface-lighter border border-surface-border transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          打开文件
        </button>

        {/* File info */}
        {fileName && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="text-text-secondary font-medium max-w-[200px] truncate">
              {fileName}
            </span>
            {mediaInfo && (
              <span className="text-text-muted">
                ({formatFileSize(mediaInfo.fileSize)})
              </span>
            )}
            {clips.length > 1 && (
              <span className="text-text-muted">· {clips.length} 段</span>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Export button */}
        <button
          onClick={() => setShowExport(true)}
          disabled={!sourceFile || loading}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white
                     bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed
                     rounded-md transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7,10 12,15 17,10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出
        </button>
      </header>

      {/* ===== Main content ===== */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Video preview */}
        <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
          <VideoPreview
            videoRef={videoRef as React.RefObject<HTMLVideoElement>}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            togglePlay={togglePlay}
            step={step}
          />
        </div>

        {/* Right: Parameter controls panel */}
        {clips.length > 0 && (
          <aside className="w-[280px] shrink-0 border-l border-surface-border bg-surface-light overflow-y-auto">
            <div className="p-4 space-y-5">
              <TrimControl />
              <div className="h-px bg-surface-border" />
              <SpeedControl />
              <div className="h-px bg-surface-border" />
              <VolumeControl />
              <div className="h-px bg-surface-border" />
              <PitchControl />
            </div>
          </aside>
        )}
      </div>

      {/* ===== Bottom: Timeline ===== */}
      {clips.length > 0 && (
        <div className="shrink-0 px-3 pb-3">
          <Timeline seekTo={seekTo} />
        </div>
      )}
      {dragActive && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="px-5 py-3 rounded-xl border border-accent/40 bg-surface-light text-text-secondary text-sm">
            松开鼠标以导入多个视频/音频
          </div>
        </div>
      )}


      {/* ===== Loading overlay ===== */}
      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="flex items-center gap-3 bg-surface-light px-6 py-4 rounded-xl border border-surface-border">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">加载中...</span>
          </div>
        </div>
      )}

      {/* ===== Error display ===== */}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ===== Toast ===== */}
      {toast && (
        <div
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm border
            ${
              toast.type === 'success'
                ? 'bg-green-500/20 border-green-500/40 text-green-300'
                : toast.type === 'error'
                  ? 'bg-red-500/20 border-red-500/40 text-red-300'
                  : 'bg-accent/20 border-accent/40 text-accent'
            }`}
          onClick={clearToast}
        >
          {toast.message}
        </div>
      )}

      {/* ===== Export dialog ===== */}
      <ExportDialog open={showExport} onClose={() => setShowExport(false)} />
    </div>
  )
}

export default AppLayout
