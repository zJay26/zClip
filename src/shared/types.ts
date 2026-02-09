// ============================================================
// zClip-Opus 共享类型定义
// 主进程 & 渲染进程共用
// ============================================================

/** 支持的媒体操作类型 */
export type OperationType = 'trim' | 'speed' | 'volume' | 'pitch'

export interface TrimParams {
  startTime: number // seconds
  endTime: number   // seconds
}

export interface SpeedParams {
  rate: number // 0.1 – 16
}

export interface VolumeParams {
  percent: number // 0% – 1000%
}

export interface PitchParams {
  percent: number // 25% – 400%
}

export type OperationParams = TrimParams | SpeedParams | VolumeParams | PitchParams

/** 统一的媒体操作抽象 — 所有编辑行为都可描述为此结构 */
export interface MediaOperation {
  id: string
  type: OperationType
  enabled: boolean
  params: OperationParams
}

/** 时间轴轨道类型 */
export type ClipTrack = 'video' | 'audio'

/** 时间轴片段 */
export interface TimelineClip {
  id: string
  groupId: string
  filePath: string
  startTime: number
  duration: number
  track: ClipTrack
  trackIndex: number
  mediaInfo: MediaInfo
}

/** ffprobe 解析出的媒体信息 */
export interface MediaInfo {
  duration: number    // seconds
  width: number
  height: number
  fps: number
  videoCodec: string
  pixelFormat?: string
  audioCodec: string
  sampleRate: number
  fileSize: number    // bytes
  filePath: string
  hasVideo: boolean   // 是否包含视频流
  hasAudio: boolean   // 是否包含音频流
}

/** 时间轴预览生成选项 */
export interface TimelinePreviewOptions {
  video?: { height: number; frames: number }
  audio?: { width: number; height: number }
}

/** 时间轴预览结果 */
export interface TimelinePreviewResult {
  videoStripPath?: string
  audioWaveformPath?: string
}

/** 导出选项 */
export type ResolutionPreset = 'original' | '1080p' | '720p' | '480p'
export type QualityPreset = 'high' | 'medium' | 'low'

export interface ExportOptions {
  format: 'mp4'
  resolution: ResolutionPreset
  quality: QualityPreset
  outputPath: string
}

export interface TimelineExportPayload {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  exportOptions: ExportOptions
}

/** 导出进度 */
export interface ExportProgress {
  percent: number      // 0–100
  currentTime: number  // seconds processed
  speed: string        // e.g. "1.5x"
  eta: string          // estimated remaining
}

/** IPC channel 名称常量 */
export const IPC_CHANNELS = {
  // Media
  OPEN_FILE: 'media:open-file',
  GET_MEDIA_INFO: 'media:get-info',
  GET_TIMELINE_PREVIEW: 'media:get-timeline-preview',
  // Export
  EXPORT_START: 'export:start',
  EXPORT_PROGRESS: 'export:progress',
  EXPORT_COMPLETE: 'export:complete',
  EXPORT_ERROR: 'export:error',
  EXPORT_CANCEL: 'export:cancel',
  // Dialog
  SHOW_SAVE_DIALOG: 'dialog:save',
  SHOW_OPEN_DIALOG: 'dialog:open',
  SHOW_OPEN_DIALOG_MULTI: 'dialog:open-multi'
} as const
