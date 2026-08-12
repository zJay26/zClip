// ============================================================
// zClip-Opus 共享类型定义
// 主进程 & 渲染进程共用
// ============================================================

/** 支持的媒体操作类型 */
export type OperationType = 'trim' | 'speed' | 'volume' | 'pitch' | 'transform' | 'fade'

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

export type FitMode = 'contain' | 'cover' | 'stretch'

export interface TransformParams {
  fit: FitMode
  scale: number
  x: number
  y: number
  rotation: 0 | 90 | 180 | 270
  opacity: number
  flipX: boolean
  flipY: boolean
}

export interface FadeParams {
  fadeIn: number
  fadeOut: number
}

export type TransitionEffectType =
  | 'crossfade'
  | 'fadeblack'
  | 'fadewhite'
  | 'wipeleft'
  | 'wiperight'
  | 'slideleft'
  | 'slideright'

export interface TimelineTransition {
  id: string
  type: TransitionEffectType
  leftClipId: string
  rightClipId: string
  /** 相对衔接点的起点，通常为负数。 */
  startOffset: number
  /** 相对衔接点的终点，通常为正数。 */
  endOffset: number
}

export type AudioFadeKind = 'in' | 'out'

export interface AudioFadeSegment {
  id: string
  clipId: string
  kind: AudioFadeKind
  /** 相对音频片段可见起点的起点。 */
  startOffset: number
  /** 相对音频片段可见起点的终点。 */
  endOffset: number
}

export type OperationParams =
  | TrimParams
  | SpeedParams
  | VolumeParams
  | PitchParams
  | TransformParams
  | FadeParams

/** 统一的媒体操作抽象 — 所有编辑行为都可描述为此结构 */
interface OperationBase<T extends OperationType, P extends OperationParams> {
  id: string
  type: T
  enabled: boolean
  params: P
}

export type TypedMediaOperation =
  | OperationBase<'trim', TrimParams>
  | OperationBase<'speed', SpeedParams>
  | OperationBase<'volume', VolumeParams>
  | OperationBase<'pitch', PitchParams>
  | OperationBase<'transform', TransformParams>
  | OperationBase<'fade', FadeParams>

/**
 * 可编辑操作保留宽类型以支持通用 patch API；在解析、导出等边界使用
 * TypedMediaOperation/runtime schema 收窄，避免把不可信联合参数直接送入 FFmpeg。
 */
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
  /** 可裁剪媒体区间起点（秒）。未设置时默认为 0。 */
  trimBoundStart?: number
  /** 可裁剪媒体区间终点（秒）。未设置时默认为 duration。 */
  trimBoundEnd?: number
  track: ClipTrack
  trackIndex: number
  /** Whether a video clip may use the source file's embedded audio stream. */
  embeddedAudioEnabled?: boolean
  mediaInfo: MediaInfo
}

/** ffprobe 解析出的媒体信息 */
export interface MediaInfo {
  duration: number    // seconds
  containerFormat?: string
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
  /** Display rotation from stream metadata/display matrix. */
  rotation?: 0 | 90 | 180 | 270
  /** Whether average and real frame rates materially differ. */
  isVariableFrameRate?: boolean
  sampleAspectRatio?: string
  colorSpace?: string
  playbackPath?: string
  playbackIsProxy?: boolean
  playbackProxyFailed?: boolean
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
export type QualityPreset = 'ultra_high' | 'high' | 'medium' | 'low' | 'ultra_low' | 'custom'
export type H264Preset =
  | 'ultrafast'
  | 'superfast'
  | 'veryfast'
  | 'faster'
  | 'fast'
  | 'medium'
  | 'slow'
  | 'slower'
  | 'veryslow'

export type PcmBitDepth = 16 | 24 | 32
export type GifDither = 'bayer' | 'floyd_steinberg' | 'sierra2_4a'

export interface ExportCustomOptions {
  crf?: number
  videoBitrateKbps?: number
  audioBitrateKbps?: number
  h264Preset?: H264Preset
  vp9CpuUsed?: number
  animatedFps?: number
  webpQuality?: number
  webpCompressionLevel?: number
  gifColors?: number
  gifDither?: GifDither
  audioSampleRate?: number
  pcmBitDepth?: PcmBitDepth
  flacCompressionLevel?: number
}

export type ExportFormat = 'mp4' | 'mov' | 'mkv' | 'webm' | 'gif' | 'webp' | 'mp3' | 'wav' | 'flac' | 'aac' | 'opus'
export type AnimatedLoopMode = 'infinite' | 'once'
export type GifLoopMode = AnimatedLoopMode

export type CanvasPreset = 'source' | 'landscape' | 'portrait' | 'square' | 'social' | 'custom'

export interface CanvasSettings {
  preset: CanvasPreset
  width: number
  height: number
  backgroundColor: string
}

export interface ProjectSettings {
  canvas: CanvasSettings
  /** Project/output frame rate. Older projects omit it and default to 30. */
  frameRate?: number
}

export interface ExportRange {
  startTime: number
  endTime: number
}

export interface ExportOptions {
  format: ExportFormat
  resolution: ResolutionPreset
  quality: QualityPreset
  customOptions?: ExportCustomOptions
  outputPath: string
  range?: ExportRange
  projectSettings?: ProjectSettings
  /** 循环模式：用于 gif/webp 等动图格式 */
  gifLoop?: AnimatedLoopMode
}

export interface TimelineExportPayload {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  transitions?: TimelineTransition[]
  audioFades?: AudioFadeSegment[]
  exportOptions: ExportOptions
}

/** 导出进度 */
export interface ProjectData {
  schemaVersion: 1
  savedAt: string
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  transitions?: TimelineTransition[]
  audioFades?: AudioFadeSegment[]
  linkedGroups: Record<string, boolean>
  videoTrackCount: number
  audioTrackCount: number
  currentTime: number
  projectSettings: ProjectSettings
}

export interface RecentProject {
  filePath: string
  name: string
  updatedAt: string
}

export interface ExportProgress {
  percent: number      // 0–100
  currentTime: number  // seconds processed
  speed: string        // e.g. "1.5x"
  eta: string          // estimated remaining
}

export interface CacheStats {
  bytes: number
  files: number
}

export type AppCloseDecision = 'close' | 'cancel'

/** IPC channel 名称常量 */
export const IPC_CHANNELS = {
  // Media
  OPEN_FILE: 'media:open-file',
  AUTHORIZE_DROPPED_FILES: 'media:authorize-dropped-files',
  GET_MEDIA_INFO: 'media:get-info',
  PREPARE_PLAYBACK: 'media:prepare-playback',
  PREPARE_AUDIO_PITCH: 'media:prepare-audio-pitch',
  GET_TIMELINE_PREVIEW: 'media:get-timeline-preview',
  CACHE_GET_STATS: 'cache:get-stats',
  CACHE_CLEAR: 'cache:clear',
  APP_CLOSE_REQUEST: 'app:close-request',
  APP_CLOSE_RESPONSE: 'app:close-response',
  RENDERER_READY: 'app:renderer-ready',
  // Project
  PROJECT_SHOW_SAVE_DIALOG: 'project:show-save-dialog',
  PROJECT_SHOW_OPEN_DIALOG: 'project:show-open-dialog',
  PROJECT_SAVE: 'project:save',
  PROJECT_OPEN: 'project:open',
  PROJECT_GET_RECENTS: 'project:get-recents',
  PROJECT_REMOVE_RECENT: 'project:remove-recent',
  PROJECT_SAVE_AUTOSAVE: 'project:save-autosave',
  PROJECT_GET_AUTOSAVE: 'project:get-autosave',
  PROJECT_CLEAR_AUTOSAVE: 'project:clear-autosave',
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
