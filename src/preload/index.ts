// ============================================================
// Preload Script — contextBridge 暴露安全 API 给渲染进程
// ============================================================

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  MediaInfo,
  MediaOperation,
  AudioFadeSegment,
  CacheStats,
  ExportOptions,
  ExportProgress,
  ProjectData,
  RecentProject,
  TimelineClip,
  TimelineTransition,
  TimelinePreviewOptions,
  TimelinePreviewResult
} from '../shared/types'

export interface ElectronAPI {
  // File operations
  openFile: () => Promise<string | null>
  openFiles: () => Promise<string[] | null>
  getPathForFile: (file: File) => string
  getMediaInfo: (filePath: string) => Promise<{ success: boolean; data?: MediaInfo; error?: string }>
  preparePlayback: (filePath: string) => Promise<{ success: boolean; playbackPath?: string; playbackIsProxy?: boolean; error?: string }>
  getTimelinePreview: (filePath: string, options: TimelinePreviewOptions) => Promise<{ success: boolean; data?: TimelinePreviewResult; error?: string }>
  // Project
  showProjectSaveDialog: (defaultName: string) => Promise<string | null>
  showProjectOpenDialog: () => Promise<string | null>
  saveProjectFile: (filePath: string, data: ProjectData) => Promise<{ success: boolean; error?: string }>
  openProjectFile: (filePath: string) => Promise<{ success: boolean; data?: ProjectData; error?: string }>
  getRecentProjects: () => Promise<RecentProject[]>
  removeRecentProject: (filePath: string) => Promise<RecentProject[]>
  saveAutosave: (data: ProjectData) => Promise<{ success: boolean; error?: string }>
  getAutosave: () => Promise<ProjectData | null>
  clearAutosave: () => Promise<{ success: boolean; error?: string }>
  getCacheStats: () => Promise<CacheStats>
  clearMediaCaches: () => Promise<CacheStats>
  // Export
  showSaveDialog: (defaultName: string) => Promise<string | null>
  startExport: (payload: {
    mediaInfo?: MediaInfo
    operations?: MediaOperation[]
    clips?: TimelineClip[]
    operationsByClip?: Record<string, MediaOperation[]>
    transitions?: TimelineTransition[]
    audioFades?: AudioFadeSegment[]
    exportOptions: ExportOptions
  }) => Promise<{ success: boolean; error?: string }>
  cancelExport: () => void
  onExportProgress: (callback: (progress: ExportProgress) => void) => () => void
  onExportComplete: (callback: (outputPath: string) => void) => () => void
  onExportError: (callback: (error: string) => void) => () => void
  onOpenFile: (callback: (filePaths: string[]) => void) => () => void
}

const api: ElectronAPI = {
  openFile: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_OPEN_DIALOG),
  openFiles: () => ipcRenderer.invoke(IPC_CHANNELS.SHOW_OPEN_DIALOG_MULTI),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  getMediaInfo: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MEDIA_INFO, filePath),

  preparePlayback: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PREPARE_PLAYBACK, filePath),

  getTimelinePreview: (filePath: string, options: TimelinePreviewOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_TIMELINE_PREVIEW, filePath, options),

  showProjectSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SHOW_SAVE_DIALOG, defaultName),

  showProjectOpenDialog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SHOW_OPEN_DIALOG),

  saveProjectFile: (filePath: string, data: ProjectData) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SAVE, { filePath, data }),

  openProjectFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_OPEN, filePath),

  getRecentProjects: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET_RECENTS),

  removeRecentProject: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_REMOVE_RECENT, filePath),

  saveAutosave: (data: ProjectData) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_SAVE_AUTOSAVE, data),

  getAutosave: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_GET_AUTOSAVE),

  clearAutosave: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_CLEAR_AUTOSAVE),

  getCacheStats: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_GET_STATS),
  clearMediaCaches: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_CLEAR),

  showSaveDialog: (defaultName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHOW_SAVE_DIALOG, defaultName),

  startExport: (payload) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXPORT_START, payload),

  cancelExport: () =>
    ipcRenderer.send(IPC_CHANNELS.EXPORT_CANCEL),

  onExportProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExportProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.EXPORT_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_PROGRESS, handler)
  },

  onExportComplete: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, outputPath: string): void => {
      callback(outputPath)
    }
    ipcRenderer.on(IPC_CHANNELS.EXPORT_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_COMPLETE, handler)
  },

  onExportError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => {
      callback(error)
    }
    ipcRenderer.on(IPC_CHANNELS.EXPORT_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXPORT_ERROR, handler)
  },

  onOpenFile: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, filePaths: string[]): void => {
      callback(filePaths)
    }
    ipcRenderer.on(IPC_CHANNELS.OPEN_FILE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OPEN_FILE, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
