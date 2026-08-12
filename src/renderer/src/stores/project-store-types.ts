import type {
  AudioFadeKind,
  AudioFadeSegment,
  ExportProgress,
  FadeParams,
  MediaInfo,
  MediaOperation,
  ProjectData,
  ProjectSettings,
  RecentProject,
  TimelineClip,
  TimelineTransition,
  TransitionEffectType,
  TransformParams,
  TrimParams
} from '../../../shared/types'

export interface ProjectSnapshot {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  transitions: TimelineTransition[]
  audioFades: AudioFadeSegment[]
  selectedTransitionId: string | null
  selectedClipId: string | null
  selectedClipIds: string[]
  lastSelectedClipId: string | null
  linkedGroups: Record<string, boolean>
  timelineDuration: number
  videoTrackCount: number
  audioTrackCount: number
  currentTime: number
  projectSettings: ProjectSettings
}

export interface HistoryEditOptions {
  recordHistory?: boolean
}

export interface ProjectStore {
  clips: TimelineClip[]
  transitions: TimelineTransition[]
  audioFades: AudioFadeSegment[]
  selectedTransitionId: string | null
  selectedClipId: string | null
  selectedClipIds: string[]
  lastSelectedClipId: string | null
  linkedGroups: Record<string, boolean>
  clipboard: {
    clips: TimelineClip[]
    operationsByClip: Record<string, MediaOperation[]>
    linkedGroups: Record<string, boolean>
    minStartTime: number
  } | null
  historyPast: ProjectSnapshot[]
  historyFuture: ProjectSnapshot[]
  timelineDuration: number
  videoTrackCount: number
  audioTrackCount: number
  projectSettings: ProjectSettings
  projectFilePath: string | null
  projectDirty: boolean
  documentRevision: number
  recentProjects: RecentProject[]
  autosaveReady: boolean
  missingMediaPaths: string[]

  sourceFile: string | null
  mediaInfo: MediaInfo | null
  loading: boolean
  error: string | null

  operations: MediaOperation[]
  operationsByClip: Record<string, MediaOperation[]>

  currentTime: number
  playing: boolean
  duration: number

  exporting: boolean
  exportProgress: ExportProgress | null
  merging: boolean

  toast: { message: string; type: 'info' | 'success' | 'error' } | null

  openFiles: () => Promise<void>
  loadFiles: (filePaths: string[]) => Promise<void>
  openFile: () => Promise<void>
  loadFile: (filePath: string) => Promise<void>
  selectClip: (clipId: string, mode?: 'single' | 'toggle' | 'range') => void
  selectTransition: (transitionId: string) => void
  addVideoTrack: () => void
  removeVideoTrack: () => void
  addAudioTrack: () => void
  removeAudioTrack: () => void
  moveClip: (
    clipId: string,
    patch: Partial<Pick<TimelineClip, 'startTime' | 'trackIndex'>>,
    options?: { recordHistory?: boolean }
  ) => void
  trimClipEdge: (
    clipId: string,
    edge: 'start' | 'end',
    deltaSeconds: number,
    options?: { recordHistory?: boolean }
  ) => void
  splitClipAtPlayhead: () => void
  copySelectedClips: () => void
  cutSelectedClips: () => void
  pasteCopiedClips: () => void
  mergeSelectedClips: () => Promise<void>
  deleteClip: (clipId: string) => void
  deleteSelectedClips: () => void
  undo: () => void
  redo: () => void
  beginHistoryTransaction: () => void
  commitHistoryTransaction: () => void
  setCurrentTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  setClipDuration: (clipId: string, duration: number) => void
  activateClip: (clipId: string) => void
  toggleGroupLink: (groupId: string) => void

  updateOperation: (id: string, patch: Partial<MediaOperation>) => void
  setTrim: (params: Partial<TrimParams>) => void
  setSpeed: (rate: number, options?: HistoryEditOptions) => void
  setVolume: (percent: number, options?: HistoryEditOptions) => void
  setPitch: (percent: number, options?: HistoryEditOptions) => void
  setTransform: (params: Partial<TransformParams>, options?: HistoryEditOptions) => void
  setFade: (params: Partial<FadeParams>, options?: HistoryEditOptions) => void
  addTransitionAtTime: (type: TransitionEffectType, time: number, trackIndex: number) => boolean
  applyTransition: (type: TransitionEffectType) => boolean
  updateTransition: (
    id: string,
    patch: Partial<Pick<TimelineTransition, 'startOffset' | 'endOffset'>>,
    options?: HistoryEditOptions
  ) => void
  deleteTransition: (id: string) => void
  addAudioFade: (kind: AudioFadeKind) => boolean
  updateAudioFade: (
    id: string,
    patch: Partial<Pick<AudioFadeSegment, 'startOffset' | 'endOffset'>>,
    options?: HistoryEditOptions
  ) => void
  deleteAudioFade: (id: string) => void
  setProjectSettings: (settings: Partial<ProjectSettings>, options?: HistoryEditOptions) => void
  toggleOperation: (type: string, enabled: boolean) => void

  setExporting: (exporting: boolean) => void
  setExportProgress: (progress: ExportProgress | null) => void

  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  clearToast: () => void
  clearError: () => void

  saveProject: () => Promise<boolean>
  saveProjectAs: () => Promise<boolean>
  openProject: () => Promise<boolean>
  openProjectFromPath: (filePath: string) => Promise<boolean>
  refreshRecentProjects: () => Promise<void>
  removeRecentProject: (filePath: string) => Promise<void>
  restoreProjectData: (data: ProjectData, filePath?: string | null) => void
  recoverAutosave: (data: ProjectData) => Promise<void>
  relinkMissingMedia: () => Promise<boolean>
  buildProjectData: () => ProjectData
  autosaveNow: () => Promise<void>
  clearAutosave: () => Promise<void>
  markProjectDirty: () => void

  getClipTrim: (clipId: string) => { trimStart: number; trimEnd: number }
  getAudioOperationsForSelection: () => MediaOperation[]
  getMergeSelectionState: () => {
    canMerge: boolean
    disabledReason: string | null
    logicalSelectionCount: number
    hasVideoSelection: boolean
    hasAudioSelection: boolean
  }

  reset: () => void
}
