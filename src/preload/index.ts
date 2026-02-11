// ============================================================
// Preload Script — contextBridge 暴露安全 API 给渲染进程
// ============================================================

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  MediaInfo,
  MediaOperation,
  ExportOptions,
  ExportProgress,
  TimelineClip,
  TimelinePreviewOptions,
  TimelinePreviewResult
} from '../shared/types'

export interface ElectronAPI {
  // File operations
  openFile: () => Promise<string | null>
  openFiles: () => Promise<string[] | null>
  getPathForFile: (file: File) => string
  getMediaInfo: (filePath: string) => Promise<{ success: boolean; data?: MediaInfo; error?: string }>
  getTimelinePreview: (filePath: string, options: TimelinePreviewOptions) => Promise<{ success: boolean; data?: TimelinePreviewResult; error?: string }>
  // Export
  showSaveDialog: (defaultName: string) => Promise<string | null>
  startExport: (payload: {
    mediaInfo?: MediaInfo
    operations?: MediaOperation[]
    clips?: TimelineClip[]
    operationsByClip?: Record<string, MediaOperation[]>
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

  getTimelinePreview: (filePath: string, options: TimelinePreviewOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_TIMELINE_PREVIEW, filePath, options),

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
