// ============================================================
// Zustand Store — 项目状态管理
// 单一 store 覆盖项目、播放、操作、导出所有状态
// ============================================================

import { create } from 'zustand'
import type {
  MediaInfo,
  MediaOperation,
  ExportProgress,
  TrimParams,
  SpeedParams,
  VolumeParams,
  PitchParams,
  TimelineClip,
  OperationType
} from '../../../shared/types'
import {
  getClipTimelineRange,
  getClipVisibleDuration,
  getSpeedRate,
  getTimelineDuration as getTimelineDurationShared,
  timelineTimeToMediaTime
} from '../../../shared/timeline-utils'
import { uid } from '../lib/utils'

interface ProjectStore {
  // --- Timeline ---
  clips: TimelineClip[]
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

  // --- Source (selected clip) ---
  sourceFile: string | null
  mediaInfo: MediaInfo | null
  loading: boolean
  error: string | null

  // --- Operations (selected clip) ---
  operations: MediaOperation[]
  operationsByClip: Record<string, MediaOperation[]>

  // --- Playback ---
  currentTime: number
  playing: boolean
  duration: number

  // --- Export ---
  exporting: boolean
  exportProgress: ExportProgress | null
  merging: boolean

  // --- Toast / notifications ---
  toast: { message: string; type: 'info' | 'success' | 'error' } | null

  // --- Actions ---
  openFiles: () => Promise<void>
  loadFiles: (filePaths: string[]) => Promise<void>
  openFile: () => Promise<void>
  loadFile: (filePath: string) => Promise<void>
  selectClip: (clipId: string, mode?: 'single' | 'toggle' | 'range') => void
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
  setCurrentTime: (time: number) => void
  setPlaying: (playing: boolean) => void
  setClipDuration: (clipId: string, duration: number) => void
  activateClip: (clipId: string) => void
  toggleGroupLink: (groupId: string) => void

  // Operation CRUD
  updateOperation: (id: string, patch: Partial<MediaOperation>) => void
  setTrim: (params: Partial<TrimParams>) => void
  setSpeed: (rate: number) => void
  setVolume: (percent: number) => void
  setPitch: (percent: number) => void
  toggleOperation: (type: string, enabled: boolean) => void

  // Export
  setExporting: (exporting: boolean) => void
  setExportProgress: (progress: ExportProgress | null) => void

  // Toast
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void
  clearToast: () => void

  // Helper: get clip trim info
  getClipTrim: (clipId: string) => { trimStart: number; trimEnd: number }
  getAudioOperationsForSelection: () => MediaOperation[]
  getMergeSelectionState: () => {
    canMerge: boolean
    disabledReason: string | null
    logicalSelectionCount: number
    hasVideoSelection: boolean
    hasAudioSelection: boolean
  }

  // Reset
  reset: () => void
}

interface ProjectSnapshot {
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  selectedClipId: string | null
  selectedClipIds: string[]
  lastSelectedClipId: string | null
  linkedGroups: Record<string, boolean>
  timelineDuration: number
  videoTrackCount: number
  audioTrackCount: number
  currentTime: number
}

/** Create default operations for a new clip */
function createDefaultOperations(duration: number): MediaOperation[] {
  return [
    {
      id: uid(),
      type: 'trim',
      enabled: true,
      params: { startTime: 0, endTime: duration } as TrimParams
    },
    {
      id: uid(),
      type: 'speed',
      enabled: false,
      params: { rate: 1.0 } as SpeedParams
    },
    {
      id: uid(),
      type: 'volume',
      enabled: false,
      params: { percent: 100 } as VolumeParams
    },
    {
      id: uid(),
      type: 'pitch',
      enabled: false,
      params: { percent: 100 } as PitchParams
    }
  ]
}

function getTimelineDuration(clips: TimelineClip[], operationsByClip?: Record<string, MediaOperation[]>): number {
  return getTimelineDurationShared(clips, operationsByClip || {})
}

function clampTimelineTime(time: number, timelineDuration: number): number {
  if (timelineDuration <= 0) return 0
  return Math.max(0, Math.min(time, timelineDuration - 0.0001))
}

function getClipTrimBounds(clip: TimelineClip): { min: number; max: number } {
  const min = Math.max(0, Math.min(clip.trimBoundStart ?? 0, clip.duration))
  const max = Math.max(min, Math.min(clip.trimBoundEnd ?? clip.duration, clip.duration))
  return { min, max }
}

/** Get trim in/out points for a clip from its operations */
function getClipTrimValues(
  clip: TimelineClip,
  operationsByClip?: Record<string, MediaOperation[]>
): { trimStart: number; trimEnd: number } {
  const range = getClipTimelineRange(clip, operationsByClip)
  return { trimStart: range.trimStart, trimEnd: range.trimEnd }
}

function getSelectedClip(clips: TimelineClip[], selectedClipId: string | null): TimelineClip | null {
  if (!selectedClipId) return null
  return clips.find((clip) => clip.id === selectedClipId) || null
}

function getLinkedAudioClipId(
  clips: TimelineClip[],
  linkedGroups: Record<string, boolean>,
  selectedClipId: string | null
): string | null {
  if (!selectedClipId) return null
  const selected = clips.find((clip) => clip.id === selectedClipId)
  if (!selected) return null
  if (selected.track === 'audio') return selected.id
  const isLinked = linkedGroups[selected.groupId] !== false
  if (!isLinked) return null
  const audioClip = clips.find((clip) => clip.groupId === selected.groupId && clip.track === 'audio')
  return audioClip?.id || null
}

function takeSnapshot(state: ProjectStore): ProjectSnapshot {
  return {
    clips: structuredClone(state.clips),
    operationsByClip: structuredClone(state.operationsByClip),
    selectedClipId: state.selectedClipId,
    selectedClipIds: [...state.selectedClipIds],
    lastSelectedClipId: state.lastSelectedClipId,
    linkedGroups: { ...state.linkedGroups },
    timelineDuration: state.timelineDuration,
    videoTrackCount: state.videoTrackCount,
    audioTrackCount: state.audioTrackCount,
    currentTime: state.currentTime
  }
}

function applySnapshot(state: ProjectStore, snapshot: ProjectSnapshot): Partial<ProjectStore> {
  const selectedClip = getSelectedClip(snapshot.clips, snapshot.selectedClipId)
  return {
    clips: snapshot.clips,
    operationsByClip: snapshot.operationsByClip,
    selectedClipId: snapshot.selectedClipId,
    selectedClipIds: snapshot.selectedClipIds,
    lastSelectedClipId: snapshot.lastSelectedClipId,
    linkedGroups: snapshot.linkedGroups,
    timelineDuration: snapshot.timelineDuration,
    videoTrackCount: snapshot.videoTrackCount,
    audioTrackCount: snapshot.audioTrackCount,
    currentTime: snapshot.currentTime,
    sourceFile: selectedClip?.filePath ?? null,
    mediaInfo: selectedClip?.mediaInfo ?? null,
    duration: selectedClip?.duration ?? 0,
    operations: selectedClip ? (snapshot.operationsByClip[selectedClip.id] || []) : [],
    playing: false
  }
}

function getOrderedClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime
    if (a.track !== b.track) return a.track === 'video' ? -1 : 1
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
    return a.id.localeCompare(b.id)
  })
}

type OverlapEntry = {
  id: string
  track: TimelineClip['track']
  trackIndex: number
  groupId: string
  linked: boolean
  originalStart: number
  start: number
  duration: number
  end: number
  active: boolean
}

const OVERLAP_EPS = 0.0001
const OVERLAP_MIN_DURATION = 0.01
let mergeOutputSequence = 1

type MergeSelectionMeta = {
  selectedClips: TimelineClip[]
  logicalSelectionCount: number
  hasVideoSelection: boolean
  hasAudioSelection: boolean
  canMerge: boolean
  disabledReason: string | null
}

function getMergeSelectionMeta(clips: TimelineClip[], selectedClipIds: string[]): MergeSelectionMeta {
  const selectedIdSet = new Set(selectedClipIds)
  const selectedClips = clips.filter((clip) => selectedIdSet.has(clip.id))
  const logicalSelectionCount = new Set(selectedClips.map((clip) => clip.groupId)).size
  const groupTrackMap = new Map<string, { hasVideo: boolean; hasAudio: boolean }>()
  selectedClips.forEach((clip) => {
    const entry = groupTrackMap.get(clip.groupId) || { hasVideo: false, hasAudio: false }
    if (clip.track === 'video') entry.hasVideo = true
    if (clip.track === 'audio') entry.hasAudio = true
    groupTrackMap.set(clip.groupId, entry)
  })

  const groupSelections = Array.from(groupTrackMap.values())
  const hasVideoSelection = groupSelections.some((group) => group.hasVideo)
  const hasAudioSelection = groupSelections.some((group) => group.hasAudio)
  const allGroupsHaveVideo = groupSelections.length > 0 && groupSelections.every((group) => group.hasVideo)
  const allGroupsHaveAudio = groupSelections.length > 0 && groupSelections.every((group) => group.hasAudio)
  const isUniformTrackSelection =
    (allGroupsHaveVideo && !hasAudioSelection) || // pure video groups
    (allGroupsHaveAudio && !hasVideoSelection) || // pure audio groups
    (allGroupsHaveVideo && allGroupsHaveAudio) // full AV groups

  let disabledReason: string | null = null
  if (selectedClips.length === 0) {
    disabledReason = '请先选择片段'
  } else if (!isUniformTrackSelection) {
    disabledReason = '请仅选择同类型逻辑片段（纯视频、纯音频或完整音画段）'
  } else if (logicalSelectionCount < 2) {
    disabledReason = '请至少选择两个逻辑片段以合并'
  }

  return {
    selectedClips,
    logicalSelectionCount,
    hasVideoSelection,
    hasAudioSelection,
    canMerge: disabledReason === null,
    disabledReason
  }
}

function buildOverlapEntries(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  activeClipIds: Set<string>,
  linkedGroups: Record<string, boolean>
): OverlapEntry[] {
  return clips.map((clip) => {
    const duration = Math.max(OVERLAP_MIN_DURATION, getClipVisibleDuration(clip, operationsByClip))
    const start = Math.max(0, clip.startTime)
    return {
      id: clip.id,
      track: clip.track,
      trackIndex: clip.trackIndex,
      groupId: clip.groupId,
      linked: linkedGroups[clip.groupId] !== false,
      originalStart: start,
      start,
      duration,
      end: start + duration,
      active: activeClipIds.has(clip.id)
    }
  })
}

function moveEntryRight(entry: OverlapEntry, targetStart: number): void {
  entry.start = Math.max(0, targetStart)
  entry.end = entry.start + entry.duration
}

function moveEntryLeft(entry: OverlapEntry, targetStart: number): boolean {
  let nextStart = targetStart - entry.duration
  if (nextStart < 0) {
    nextStart = 0
    if (nextStart + entry.duration > targetStart + OVERLAP_EPS) {
      return false
    }
  }
  entry.start = nextStart
  entry.end = entry.start + entry.duration
  return true
}

function resolveTrackOverlaps(entries: OverlapEntry[]): void {
  if (entries.length <= 1) return
  let changed = true
  let guard = entries.length * entries.length + 8
  while (changed && guard > 0) {
    guard -= 1
    changed = false
    entries.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start
      return a.id.localeCompare(b.id)
    })
    for (let i = 0; i < entries.length - 1; i++) {
      const current = entries[i]
      const next = entries[i + 1]
      if (current.end <= next.start + OVERLAP_EPS) continue

      if (current.active && !next.active) {
        moveEntryRight(next, current.end)
      } else if (!current.active && next.active) {
        const moved = moveEntryLeft(current, next.start)
        if (!moved) {
          moveEntryRight(next, current.end)
        }
      } else {
        moveEntryRight(next, current.end)
      }
      changed = true
    }
  }
}

function resolveClipOverlaps(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  activeClipIds: Set<string>,
  linkedGroups: Record<string, boolean>
): TimelineClip[] {
  const entries = buildOverlapEntries(clips, operationsByClip, activeClipIds, linkedGroups)
  const entriesByTrack = new Map<string, OverlapEntry[]>()
  entries.forEach((entry) => {
    const key = `${entry.track}-${entry.trackIndex}`
    const list = entriesByTrack.get(key)
    if (list) {
      list.push(entry)
    } else {
      entriesByTrack.set(key, [entry])
    }
  })

  entriesByTrack.forEach((group) => resolveTrackOverlaps(group))

  const linkedMovedIds = new Set<string>()
  const groupEntriesMap = new Map<string, OverlapEntry[]>()
  entries.forEach((entry) => {
    if (!entry.linked) return
    const list = groupEntriesMap.get(entry.groupId)
    if (list) {
      list.push(entry)
    } else {
      groupEntriesMap.set(entry.groupId, [entry])
    }
  })
  groupEntriesMap.forEach((groupEntries) => {
    const movedRef = groupEntries.find(
      (entry) => Math.abs(entry.start - entry.originalStart) > OVERLAP_EPS
    )
    if (!movedRef) return
    const delta = movedRef.start - movedRef.originalStart
    groupEntries.forEach((entry) => {
      entry.start = Math.max(0, entry.originalStart + delta)
      entry.end = entry.start + entry.duration
      linkedMovedIds.add(entry.id)
    })
  })

  if (linkedMovedIds.size > 0) {
    const reinforcedActiveIds = new Set(activeClipIds)
    linkedMovedIds.forEach((id) => reinforcedActiveIds.add(id))
    entries.forEach((entry) => {
      entry.active = reinforcedActiveIds.has(entry.id)
    })
    entriesByTrack.forEach((group) => resolveTrackOverlaps(group))
  }

  const startMap = new Map(entries.map((entry) => [entry.id, entry.start]))
  return clips.map((clip) => {
    const nextStart = startMap.get(clip.id)
    if (nextStart === undefined || nextStart === clip.startTime) return clip
    return { ...clip, startTime: nextStart }
  })
}

function areOpsCompatibleForMerge(
  baseOps: MediaOperation[],
  candidateOps: MediaOperation[]
): boolean {
  const typesToCompare: OperationType[] = ['speed', 'volume', 'pitch']
  return typesToCompare.every((type) => {
    const a = baseOps.find((op) => op.type === type)
    const b = candidateOps.find((op) => op.type === type)
    if (!a || !b) return false
    if (a.enabled !== b.enabled) return false
    return JSON.stringify(a.params) === JSON.stringify(b.params)
  })
}

function setDocumentTitle(filePath: string | null, totalClips: number): void {
  if (!filePath) {
    document.title = 'zClip'
    return
  }
  const fileName = filePath.split(/[\\/]/).pop() || 'zClip'
  const suffix = totalClips > 1 ? ` · ${totalClips} 段` : ''
  document.title = `${fileName}${suffix} — zClip`
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Initial state
  clips: [],
  selectedClipId: null,
  selectedClipIds: [],
  lastSelectedClipId: null,
  linkedGroups: {},
  clipboard: null,
  historyPast: [],
  historyFuture: [],
  timelineDuration: 0,
  videoTrackCount: 2,
  audioTrackCount: 2,
  sourceFile: null,
  mediaInfo: null,
  loading: false,
  error: null,
  operations: [],
  operationsByClip: {},
  currentTime: 0,
  playing: false,
  duration: 0,
  exporting: false,
  exportProgress: null,
  merging: false,
  toast: null,

  openFiles: async () => {
    try {
      const filePaths = await window.api.openFiles()
      if (!filePaths || filePaths.length === 0) return
      await get().loadFiles(filePaths)
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to open files',
        loading: false
      })
    }
  },

  loadFiles: async (filePaths: string[]) => {
    const stateBeforeImport = get()
    set({ loading: true, error: null })
    try {
      const existingClips = stateBeforeImport.clips
      let timelineEnd = getTimelineDuration(existingClips, stateBeforeImport.operationsByClip)
      const { videoTrackCount, audioTrackCount } = stateBeforeImport
      let videoClipCounter = existingClips.filter((clip) => clip.track === 'video').length
      let audioClipCounter = existingClips.filter((clip) => clip.track === 'audio').length
      const newClips: TimelineClip[] = []
      const newOperationsByClip: Record<string, MediaOperation[]> = {}
      const newLinkedGroups: Record<string, boolean> = {}

      for (const filePath of filePaths) {
        const result = await window.api.getMediaInfo(filePath)
        if (!result.success || !result.data) {
          throw new Error(result.error || 'Failed to get media info')
        }
        const info = result.data
        const groupId = uid()
        newLinkedGroups[groupId] = true
        const startTime = timelineEnd
        const duration = info.duration

        if (info.hasVideo) {
          const trackIndex = videoTrackCount > 0 ? videoClipCounter % videoTrackCount : 0
          const clip: TimelineClip = {
            id: uid(),
            groupId,
            filePath,
            startTime,
            duration,
            trimBoundStart: 0,
            trimBoundEnd: duration,
            track: 'video',
            trackIndex,
            mediaInfo: info
          }
          newClips.push(clip)
          newOperationsByClip[clip.id] = createDefaultOperations(duration)
          videoClipCounter += 1
        }
        if (info.hasAudio) {
          const trackIndex = audioTrackCount > 0 ? audioClipCounter % audioTrackCount : 0
          const clip: TimelineClip = {
            id: uid(),
            groupId,
            filePath,
            startTime,
            duration,
            trimBoundStart: 0,
            trimBoundEnd: duration,
            track: 'audio',
            trackIndex,
            mediaInfo: info
          }
          newClips.push(clip)
          newOperationsByClip[clip.id] = createDefaultOperations(duration)
          audioClipCounter += 1
        }

        timelineEnd = Math.max(timelineEnd, startTime + duration)
      }

      const mergedClips = [...existingClips, ...newClips]
      if (newClips.length === 0) {
        set({ loading: false, error: null })
        return
      }

      const combinedOps = { ...stateBeforeImport.operationsByClip, ...newOperationsByClip }
      const resolvedClips = resolveClipOverlaps(
        mergedClips,
        combinedOps,
        new Set(newClips.map((clip) => clip.id)),
        { ...stateBeforeImport.linkedGroups, ...newLinkedGroups }
      )
      const nextSelectedClipId =
        stateBeforeImport.selectedClipId ||
        newClips.find((clip) => clip.track === 'video')?.id ||
        newClips[0]?.id ||
        null
      const selectedClip = getSelectedClip(resolvedClips, nextSelectedClipId)
      const historyPast = [...stateBeforeImport.historyPast, takeSnapshot(stateBeforeImport)]

      set({
        clips: resolvedClips,
        selectedClipId: nextSelectedClipId,
        selectedClipIds: nextSelectedClipId ? [nextSelectedClipId] : [],
        lastSelectedClipId: nextSelectedClipId,
        timelineDuration: getTimelineDuration(resolvedClips, combinedOps),
        operationsByClip: combinedOps,
        linkedGroups: { ...stateBeforeImport.linkedGroups, ...newLinkedGroups },
        historyPast,
        historyFuture: [],
        operations: selectedClip ? (combinedOps[selectedClip.id] || []) : [],
        sourceFile: selectedClip?.filePath ?? null,
        mediaInfo: selectedClip?.mediaInfo ?? null,
        duration: selectedClip?.duration ?? 0,
        currentTime: selectedClip ? selectedClip.startTime : stateBeforeImport.currentTime,
        playing: false,
        loading: false,
        error: null
      })

      setDocumentTitle(selectedClip?.filePath ?? null, mergedClips.length)
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load files',
        loading: false
      })
    }
  },

  openFile: async () => {
    try {
      const filePath = await window.api.openFile()
      if (!filePath) return
      await get().loadFile(filePath)
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to open file',
        loading: false
      })
    }
  },

  loadFile: async (filePath: string) => {
    await get().loadFiles([filePath])
  },

  selectClip: (clipId, mode = 'single') => {
    const { clips, operationsByClip, selectedClipIds, lastSelectedClipId, linkedGroups } = get()
    const clip = getSelectedClip(clips, clipId)
    if (!clip) return

    const clipOperations =
      operationsByClip[clipId] || createDefaultOperations(clip.duration)

    const expandLinked = (ids: string[]): string[] => {
      const expanded = new Set(ids)
      ids.forEach((id) => {
        const base = clips.find((c) => c.id === id)
        if (!base) return
        const isLinked = linkedGroups[base.groupId] !== false
        if (!isLinked) return
        clips.forEach((c) => {
          if (c.groupId === base.groupId) expanded.add(c.id)
        })
      })
      return Array.from(expanded)
    }

    let nextSelectedIds = selectedClipIds
    if (mode === 'single') {
      nextSelectedIds = expandLinked([clipId])
    } else if (mode === 'toggle') {
      const isLinked = linkedGroups[clip.groupId] !== false
      const groupIds = isLinked
        ? clips.filter((c) => c.groupId === clip.groupId).map((c) => c.id)
        : [clipId]
      const hasAny = groupIds.some((id) => selectedClipIds.includes(id))
      nextSelectedIds = hasAny
        ? selectedClipIds.filter((id) => !groupIds.includes(id))
        : [...selectedClipIds, ...groupIds]
      if (nextSelectedIds.length === 0) {
        nextSelectedIds = expandLinked([clipId])
      }
    } else if (mode === 'range') {
      const ordered = getOrderedClips(clips)
      const anchorId = lastSelectedClipId || clipId
      const startIndex = ordered.findIndex((c) => c.id === anchorId)
      const endIndex = ordered.findIndex((c) => c.id === clipId)
      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
        nextSelectedIds = expandLinked(ordered.slice(from, to + 1).map((c) => c.id))
      } else {
        nextSelectedIds = expandLinked([clipId])
      }
    }

    set({
      selectedClipId: clipId,
      selectedClipIds: nextSelectedIds,
      lastSelectedClipId: clipId,
      sourceFile: clip.filePath,
      mediaInfo: clip.mediaInfo,
      duration: clip.duration,
      operations: clipOperations,
      operationsByClip: {
        ...operationsByClip,
        [clipId]: clipOperations
      }
    })

    setDocumentTitle(clip.filePath, clips.length)
  },

  addVideoTrack: () =>
    set((state) => ({ videoTrackCount: Math.min(state.videoTrackCount + 1, 8) })),
  removeVideoTrack: () =>
    set((state) => {
      const nextCount = Math.max(state.videoTrackCount - 1, 1)
      if (nextCount === state.videoTrackCount) return state
      const updatedClips = state.clips.map((clip) =>
        clip.track === 'video' && clip.trackIndex >= nextCount
          ? { ...clip, trackIndex: nextCount - 1 }
          : clip
      )
      return { videoTrackCount: nextCount, clips: updatedClips }
    }),
  addAudioTrack: () =>
    set((state) => ({ audioTrackCount: Math.min(state.audioTrackCount + 1, 8) })),
  removeAudioTrack: () =>
    set((state) => {
      const nextCount = Math.max(state.audioTrackCount - 1, 1)
      if (nextCount === state.audioTrackCount) return state
      const updatedClips = state.clips.map((clip) =>
        clip.track === 'audio' && clip.trackIndex >= nextCount
          ? { ...clip, trackIndex: nextCount - 1 }
          : clip
      )
      return { audioTrackCount: nextCount, clips: updatedClips }
    }),

  moveClip: (clipId, patch, options) =>
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId)
      if (!clip) return state
      const shouldRecordHistory = options?.recordHistory !== false
      const historyPast = shouldRecordHistory
        ? [...state.historyPast, takeSnapshot(state)]
        : state.historyPast

      const nextStartTime = patch.startTime ?? clip.startTime
      const delta = nextStartTime - clip.startTime
      const isMulti = state.selectedClipIds.includes(clipId) && state.selectedClipIds.length > 1

      const affectedIds = new Set<string>()
      const addLinkedGroup = (baseClip: TimelineClip): void => {
        const isLinked = state.linkedGroups[baseClip.groupId] !== false
        if (!isLinked) return
        state.clips.forEach((c) => {
          if (c.groupId === baseClip.groupId) affectedIds.add(c.id)
        })
      }

      if (isMulti && delta !== 0) {
        state.selectedClipIds.forEach((id) => affectedIds.add(id))
        state.selectedClipIds.forEach((id) => {
          const base = state.clips.find((c) => c.id === id)
          if (base) addLinkedGroup(base)
        })
      } else {
        affectedIds.add(clipId)
        addLinkedGroup(clip)
      }

      const activeClipIds = new Set(affectedIds)
      const updatedClips = state.clips.map((c) => {
        if (!affectedIds.has(c.id)) return c
        const next: TimelineClip = {
          ...c,
          startTime: c.id === clipId || delta !== 0 ? Math.max(0, c.startTime + delta) : c.startTime
        }
        if (c.id === clipId && patch.trackIndex !== undefined) {
          next.trackIndex = patch.trackIndex
        }
        return next
      })
      const resolvedClips = resolveClipOverlaps(
        updatedClips,
        state.operationsByClip,
        activeClipIds,
        state.linkedGroups
      )
      const nextTimelineDuration = getTimelineDuration(resolvedClips, state.operationsByClip)

      return {
        clips: resolvedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: shouldRecordHistory ? [] : state.historyFuture
      }
    }),

  trimClipEdge: (clipId, edge, deltaSeconds, options) =>
    set((state) => {
      const clip = state.clips.find((c) => c.id === clipId)
      if (!clip) return state
      const shouldRecordHistory = options?.recordHistory !== false
      const historyPast = shouldRecordHistory
        ? [...state.historyPast, takeSnapshot(state)]
        : state.historyPast

      const isLinked = state.linkedGroups[clip.groupId] !== false
      const affectedClips = isLinked
        ? state.clips.filter((c) => c.groupId === clip.groupId)
        : [clip]

      const newOperationsByClip = { ...state.operationsByClip }
      const updatedClips = [...state.clips]
      const MIN_VISIBLE = 0.05

      for (const target of affectedClips) {
        const ops = newOperationsByClip[target.id] || createDefaultOperations(target.duration)
        const trimOp = ops.find((op) => op.type === 'trim')
        if (!trimOp) continue
        const bounds = getClipTrimBounds(target)
        const params = trimOp.params as TrimParams
        const speedRate = getSpeedRate(ops)
        const deltaMedia = deltaSeconds * speedRate
        const minVisibleMedia = MIN_VISIBLE * speedRate

        let newTrimStart = Math.max(bounds.min, Math.min(params.startTime, bounds.max))
        let newTrimEnd = Math.max(newTrimStart, Math.min(params.endTime, bounds.max))
        let newStartTime = target.startTime

        if (edge === 'start') {
          newTrimStart = Math.max(bounds.min, Math.min(params.startTime + deltaMedia, newTrimEnd - minVisibleMedia))
          const actualDeltaMedia = newTrimStart - params.startTime
          const actualDeltaTimeline = actualDeltaMedia / speedRate
          newStartTime = target.startTime + actualDeltaTimeline
        } else {
          newTrimEnd = Math.min(bounds.max, Math.max(params.endTime + deltaMedia, newTrimStart + minVisibleMedia))
        }

        const updatedOps = ops.map((op) =>
          op.type === 'trim'
            ? { ...op, enabled: true, params: { startTime: newTrimStart, endTime: newTrimEnd } as TrimParams }
            : op
        )

        newOperationsByClip[target.id] = updatedOps
        const idx = updatedClips.findIndex((c) => c.id === target.id)
        if (idx >= 0) {
          updatedClips[idx] = { ...updatedClips[idx], startTime: newStartTime }
        }
      }
      const activeClipIds = new Set(affectedClips.map((clipItem) => clipItem.id))
      const resolvedClips = resolveClipOverlaps(
        updatedClips,
        newOperationsByClip,
        activeClipIds,
        state.linkedGroups
      )
      const nextTimelineDuration = getTimelineDuration(resolvedClips, newOperationsByClip)

      return {
        clips: resolvedClips,
        operationsByClip: newOperationsByClip,
        operations: state.selectedClipId ? (newOperationsByClip[state.selectedClipId] || state.operations) : state.operations,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: shouldRecordHistory ? [] : state.historyFuture
      }
    }),

  splitClipAtPlayhead: () =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const { currentTime, clips, operationsByClip } = state

      // Find clips that span the playhead position
      const clipsToSplit: TimelineClip[] = []
      for (const clip of clips) {
        const range = getClipTimelineRange(clip, operationsByClip)
        if (currentTime > range.start + 0.01 && currentTime < range.end - 0.01) {
          clipsToSplit.push(clip)
        }
      }

      if (clipsToSplit.length === 0) return state

      let newClips = [...clips]
      const newOpsByClip = { ...operationsByClip }
      const newLinkedGroups = { ...state.linkedGroups }
      const groupIdMap = new Map<string, { groupA: string; groupB: string }>()
      const activeClipIds = new Set<string>()

      for (const clip of clipsToSplit) {
        if (!groupIdMap.has(clip.groupId)) {
          groupIdMap.set(clip.groupId, { groupA: uid(), groupB: uid() })
        }
        const groups = groupIdMap.get(clip.groupId)
        if (!groups) continue

        const clipBounds = getClipTrimBounds(clip)
        const localSplitTime = Math.max(
          clipBounds.min,
          Math.min(timelineTimeToMediaTime(clip, operationsByClip, currentTime), clipBounds.max)
        )
        const trim = getClipTrimValues(clip, operationsByClip)

        // Clip A: original clip, trimEnd = localSplitTime
        const opsA = (operationsByClip[clip.id] || createDefaultOperations(clip.duration)).map((op) =>
          op.type === 'trim'
            ? { ...op, params: { startTime: trim.trimStart, endTime: localSplitTime } as TrimParams }
            : { ...op, id: uid() }
        )
        // Fix: keep original id for trim op in clip A
        const fixedOpsA = opsA.map((op, i) => {
          const orig = operationsByClip[clip.id]?.[i]
          return op.type === 'trim' ? { ...op, id: orig?.id || uid() } : op
        })

        // Clip B: new clip
        const clipBId = uid()
        const clipB: TimelineClip = {
          id: clipBId,
          groupId: groups.groupB,
          filePath: clip.filePath,
          startTime: currentTime,
          duration: clip.duration,
          trimBoundStart: localSplitTime,
          trimBoundEnd: clipBounds.max,
          track: clip.track,
          trackIndex: clip.trackIndex,
          mediaInfo: clip.mediaInfo
        }

        const opsB = (operationsByClip[clip.id] || createDefaultOperations(clip.duration)).map((op) => ({
          ...op,
          id: uid(),
          ...(op.type === 'trim'
            ? { params: { startTime: localSplitTime, endTime: trim.trimEnd } as TrimParams }
            : {})
        }))

        // Update clips array
        newClips = newClips.map((c) =>
          c.id === clip.id
            ? { ...c, groupId: groups.groupA, trimBoundStart: clipBounds.min, trimBoundEnd: localSplitTime }
            : c
        )
        const clipIndex = newClips.findIndex((c) => c.id === clip.id)
        newClips.splice(clipIndex + 1, 0, clipB)

        newOpsByClip[clip.id] = fixedOpsA
        newOpsByClip[clipBId] = opsB
        newLinkedGroups[groups.groupA] = true
        newLinkedGroups[groups.groupB] = true
        activeClipIds.add(clip.id)
        activeClipIds.add(clipBId)
      }

      const resolvedClips = resolveClipOverlaps(
        newClips,
        newOpsByClip,
        activeClipIds,
        newLinkedGroups
      )
      return {
        clips: resolvedClips,
        operationsByClip: newOpsByClip,
        operations: state.selectedClipId ? (newOpsByClip[state.selectedClipId] || state.operations) : state.operations,
        timelineDuration: getTimelineDuration(resolvedClips, newOpsByClip),
        linkedGroups: newLinkedGroups,
        historyPast,
        historyFuture: []
      }
    }),

  copySelectedClips: () =>
    set((state) => {
      if (state.selectedClipIds.length === 0) {
        return state
      }
      const selectedIdSet = new Set(state.selectedClipIds)
      const selectedClips = state.clips.filter((clip) => selectedIdSet.has(clip.id))
      if (selectedClips.length === 0) {
        return state
      }
      const minStartTime = Math.min(...selectedClips.map((clip) => clip.startTime))
      const copiedClips = structuredClone(selectedClips)
      const copiedOps: Record<string, MediaOperation[]> = {}
      const copiedLinkedGroups: Record<string, boolean> = {}
      copiedClips.forEach((clip) => {
        copiedOps[clip.id] = structuredClone(
          state.operationsByClip[clip.id] || createDefaultOperations(clip.duration)
        )
        copiedLinkedGroups[clip.groupId] = state.linkedGroups[clip.groupId] !== false
      })
      return {
        clipboard: {
          clips: copiedClips,
          operationsByClip: copiedOps,
          linkedGroups: copiedLinkedGroups,
          minStartTime
        }
      }
    }),

  cutSelectedClips: () => {
    const { selectedClipIds, copySelectedClips, deleteSelectedClips } = get()
    if (selectedClipIds.length === 0) {
      return
    }
    copySelectedClips()
    deleteSelectedClips()
  },

  pasteCopiedClips: () =>
    set((state) => {
      const clipboard = state.clipboard
      if (!clipboard || clipboard.clips.length === 0) {
        return state
      }

      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const groupMap = new Map<string, string>()
      const oldClipIdByNewClipId = new Map<string, string>()
      clipboard.clips.forEach((clip) => {
        if (!groupMap.has(clip.groupId)) {
          groupMap.set(clip.groupId, uid())
        }
      })

      const pastedClips = clipboard.clips.map((clip) => {
        const newId = uid()
        oldClipIdByNewClipId.set(newId, clip.id)
        const mappedGroupId = groupMap.get(clip.groupId) || uid()
        const offset = clip.startTime - clipboard.minStartTime
        return {
          ...clip,
          id: newId,
          groupId: mappedGroupId,
          startTime: Math.max(0, state.currentTime + offset)
        }
      })

      const pastedOpsByClip: Record<string, MediaOperation[]> = {}
      pastedClips.forEach((clip) => {
        const sourceClipId = oldClipIdByNewClipId.get(clip.id)
        if (!sourceClipId) {
          pastedOpsByClip[clip.id] = createDefaultOperations(clip.duration)
          return
        }
        const sourceOps = clipboard.operationsByClip[sourceClipId] || createDefaultOperations(clip.duration)
        pastedOpsByClip[clip.id] = sourceOps.map((op) => ({ ...op, id: uid(), params: structuredClone(op.params) }))
      })

      const nextOpsByClip = { ...state.operationsByClip, ...pastedOpsByClip }
      const nextLinkedGroups = { ...state.linkedGroups }
      groupMap.forEach((newGroupId, oldGroupId) => {
        nextLinkedGroups[newGroupId] = clipboard.linkedGroups[oldGroupId] !== false
      })

      const resolvedClips = resolveClipOverlaps(
        [...state.clips, ...pastedClips],
        nextOpsByClip,
        new Set(pastedClips.map((clip) => clip.id)),
        nextLinkedGroups
      )
      const nextTimelineDuration = getTimelineDuration(resolvedClips, nextOpsByClip)
      const nextSelectedClipId =
        pastedClips.find((clip) => clip.track === 'video')?.id ||
        pastedClips[0]?.id ||
        null
      const nextSelectedClipIds = pastedClips.map((clip) => clip.id)
      const selectedClip = nextSelectedClipId
        ? resolvedClips.find((clip) => clip.id === nextSelectedClipId) || null
        : null

      return {
        clips: resolvedClips,
        operationsByClip: nextOpsByClip,
        linkedGroups: nextLinkedGroups,
        selectedClipId: nextSelectedClipId,
        selectedClipIds: nextSelectedClipIds,
        lastSelectedClipId: nextSelectedClipId,
        operations: selectedClip ? (nextOpsByClip[selectedClip.id] || []) : [],
        sourceFile: selectedClip?.filePath ?? null,
        mediaInfo: selectedClip?.mediaInfo ?? null,
        duration: selectedClip?.duration ?? 0,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
      }
    }),

  mergeSelectedClips: async () => {
    const state = get()
    const mergeSelection = getMergeSelectionMeta(state.clips, state.selectedClipIds)
    if (!mergeSelection.canMerge) {
      get().showToast(mergeSelection.disabledReason || '当前选区不可合并', 'info')
      return
    }

    const selectedIdSet = new Set(state.selectedClipIds)
    const selectedClips = mergeSelection.selectedClips
      .sort((a, b) => a.startTime - b.startTime)

    const minStart = selectedClips[0]?.startTime ?? 0
    const normalizedClips = selectedClips.map((clip) => ({
      ...clip,
      startTime: Math.max(0, clip.startTime - minStart)
    }))
    const normalizedOpsByClip: Record<string, MediaOperation[]> = {}
    normalizedClips.forEach((clip) => {
      normalizedOpsByClip[clip.id] = state.operationsByClip[clip.id] || createDefaultOperations(clip.duration)
    })

    const hasVideoSelection = normalizedClips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
    const hasAudioSelection = normalizedClips.some((clip) => clip.track === 'audio' && clip.mediaInfo.hasAudio)
    if (!hasVideoSelection && !hasAudioSelection) {
      get().showToast('所选片段不包含可合并的音视频流', 'error')
      return
    }

    const firstClip = selectedClips[0]
    if (!firstClip) return
    const slashIdx = Math.max(firstClip.filePath.lastIndexOf('/'), firstClip.filePath.lastIndexOf('\\'))
    const baseDir = slashIdx >= 0 ? firstClip.filePath.slice(0, slashIdx) : '.'
    const sep = firstClip.filePath.includes('\\') ? '\\' : '/'
    const outputFormat = hasVideoSelection ? 'mp4' : 'wav'
    const outputName = `zclip_merge_${mergeOutputSequence}`
    const suggestedPath = `${baseDir}${sep}${outputName}.${outputFormat}`
    const outputPath = await window.api.showSaveDialog(suggestedPath)
    if (!outputPath) return
    mergeOutputSequence += 1

    set({ exporting: true, exportProgress: null, merging: true })
    try {
      const exportResult = await window.api.startExport({
        clips: normalizedClips,
        operationsByClip: normalizedOpsByClip,
        exportOptions: {
          format: outputFormat,
          resolution: 'original',
          quality: 'high',
          outputPath
        }
      })
      if (!exportResult.success) {
        throw new Error(exportResult.error || '合并导出失败')
      }

      const infoResult = await window.api.getMediaInfo(outputPath)
      if (!infoResult.success || !infoResult.data) {
        throw new Error(infoResult.error || '无法读取合并后的媒体信息')
      }
      const mergedInfo = infoResult.data

      const latest = get()
      const unchangedSelection =
        latest.selectedClipIds.length === state.selectedClipIds.length &&
        latest.selectedClipIds.every((id) => selectedIdSet.has(id))
      if (!unchangedSelection) {
        get().showToast('合并期间选区已变化，结果文件已生成但未自动替换', 'info')
        return
      }

      const historyPast = [...latest.historyPast, takeSnapshot(latest)]
      const firstVideo = selectedClips.find((clip) => clip.track === 'video')
      const firstAudio = selectedClips.find((clip) => clip.track === 'audio')
      const mergedGroupId = uid()
      const createdClips: TimelineClip[] = []

      if (hasVideoSelection && mergedInfo.hasVideo && firstVideo) {
        createdClips.push({
          id: uid(),
          groupId: mergedGroupId,
          filePath: outputPath,
          startTime: minStart,
          duration: mergedInfo.duration,
          trimBoundStart: 0,
          trimBoundEnd: mergedInfo.duration,
          track: 'video',
          trackIndex: firstVideo.trackIndex,
          mediaInfo: mergedInfo
        })
      }
      if (hasAudioSelection && mergedInfo.hasAudio && firstAudio) {
        createdClips.push({
          id: uid(),
          groupId: mergedGroupId,
          filePath: outputPath,
          startTime: minStart,
          duration: mergedInfo.duration,
          trimBoundStart: 0,
          trimBoundEnd: mergedInfo.duration,
          track: 'audio',
          trackIndex: firstAudio.trackIndex,
          mediaInfo: mergedInfo
        })
      }

      if (createdClips.length === 0) {
        throw new Error('合并输出未包含可用的音视频流')
      }

      const newOpsByClip = { ...latest.operationsByClip }
      selectedIdSet.forEach((id) => {
        delete newOpsByClip[id]
      })
      createdClips.forEach((clip) => {
        newOpsByClip[clip.id] = createDefaultOperations(clip.duration)
      })

      const remainingClips = latest.clips.filter((clip) => !selectedIdSet.has(clip.id))
      const linkedGroups = { ...latest.linkedGroups, [mergedGroupId]: true }
      const resolvedClips = resolveClipOverlaps(
        [...remainingClips, ...createdClips],
        newOpsByClip,
        new Set(createdClips.map((clip) => clip.id)),
        linkedGroups
      )
      const nextSelectedClipId =
        createdClips.find((clip) => clip.track === 'video')?.id ||
        createdClips[0]?.id ||
        null
      const selectedClip = nextSelectedClipId
        ? resolvedClips.find((clip) => clip.id === nextSelectedClipId) || null
        : null
      const nextTimelineDuration = getTimelineDuration(resolvedClips, newOpsByClip)
      const nextCurrentTime = selectedClip
        ? clampTimelineTime(selectedClip.startTime, nextTimelineDuration)
        : clampTimelineTime(latest.currentTime, nextTimelineDuration)

      set({
        clips: resolvedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: nextSelectedClipId,
        selectedClipIds: nextSelectedClipId ? [nextSelectedClipId] : [],
        lastSelectedClipId: nextSelectedClipId,
        operations: selectedClip ? (newOpsByClip[selectedClip.id] || []) : [],
        sourceFile: selectedClip?.filePath ?? null,
        mediaInfo: selectedClip?.mediaInfo ?? null,
        duration: selectedClip?.duration ?? 0,
        timelineDuration: nextTimelineDuration,
        currentTime: nextCurrentTime,
        linkedGroups,
        historyPast,
        historyFuture: []
      })
      setDocumentTitle(selectedClip?.filePath ?? null, resolvedClips.length)
      get().showToast('合并完成', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '片段合并失败'
      get().showToast(`片段合并失败: ${message}`, 'error')
    } finally {
      set({ exporting: false, exportProgress: null, merging: false })
    }
  },

  deleteClip: (clipId) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const updatedClips = state.clips.filter((c) => c.id !== clipId)
      const newOpsByClip = { ...state.operationsByClip }
      delete newOpsByClip[clipId]
      const resolvedClips = resolveClipOverlaps(updatedClips, newOpsByClip, new Set(), state.linkedGroups)

      const needNewSelection = state.selectedClipId === clipId
      const nextSelectedId = needNewSelection
        ? (resolvedClips[0]?.id ?? null)
        : state.selectedClipId
      const nextClip = resolvedClips.find((c) => c.id === nextSelectedId) ?? null
      const nextSelectedIds = state.selectedClipIds.filter((id) => id !== clipId)

      return {
        clips: resolvedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: nextSelectedId,
        selectedClipIds: nextSelectedIds.length > 0 ? nextSelectedIds : nextSelectedId ? [nextSelectedId] : [],
        lastSelectedClipId: nextSelectedId,
        sourceFile: nextClip?.filePath ?? null,
        mediaInfo: nextClip?.mediaInfo ?? null,
        duration: nextClip?.duration ?? 0,
        operations: nextSelectedId ? (newOpsByClip[nextSelectedId] || []) : [],
        timelineDuration: getTimelineDuration(resolvedClips, newOpsByClip),
        historyPast,
        historyFuture: []
      }
    }),

  deleteSelectedClips: () =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (state.selectedClipIds.length === 0) return state
      const removeSet = new Set(state.selectedClipIds)
      state.selectedClipIds.forEach((id) => {
        const base = state.clips.find((clip) => clip.id === id)
        if (!base) return
        const isLinked = state.linkedGroups[base.groupId] !== false
        if (!isLinked) return
        state.clips.forEach((clip) => {
          if (clip.groupId === base.groupId) removeSet.add(clip.id)
        })
      })
      const updatedClips = state.clips.filter((c) => !removeSet.has(c.id))
      const newOpsByClip = { ...state.operationsByClip }
      removeSet.forEach((id) => delete newOpsByClip[id])
      const resolvedClips = resolveClipOverlaps(updatedClips, newOpsByClip, new Set(), state.linkedGroups)

      const nextSelectedId = resolvedClips[0]?.id ?? null
      const nextClip = resolvedClips.find((c) => c.id === nextSelectedId) ?? null

      return {
        clips: resolvedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: nextSelectedId,
        selectedClipIds: nextSelectedId ? [nextSelectedId] : [],
        lastSelectedClipId: nextSelectedId,
        sourceFile: nextClip?.filePath ?? null,
        mediaInfo: nextClip?.mediaInfo ?? null,
        duration: nextClip?.duration ?? 0,
        operations: nextSelectedId ? (newOpsByClip[nextSelectedId] || []) : [],
        timelineDuration: getTimelineDuration(resolvedClips, newOpsByClip),
        historyPast,
        historyFuture: []
      }
    }),

  setCurrentTime: (time) =>
    set((state) => ({
      currentTime: Math.max(0, Math.min(time, state.timelineDuration))
    })),
  setPlaying: (playing) => set({ playing }),
  setClipDuration: (clipId, duration) => {
    const { clips, operationsByClip, selectedClipId } = get()
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return

    const ops = operationsByClip[clipId] || createDefaultOperations(clip.duration)
    const nextOps = ops.map((op) =>
      op.type === 'trim'
        ? { ...op, params: { ...op.params, endTime: Math.min((op.params as TrimParams).endTime, duration) } }
        : op
    )
    const nextOpsByClip = { ...operationsByClip, [clipId]: nextOps }
    const nextClips = clips.map((c) => {
      if (c.id !== clipId) return c
      const nextBoundStart = Math.max(0, Math.min(c.trimBoundStart ?? 0, duration))
      const nextBoundEnd = Math.max(nextBoundStart, Math.min(c.trimBoundEnd ?? duration, duration))
      return { ...c, duration, trimBoundStart: nextBoundStart, trimBoundEnd: nextBoundEnd }
    })
    const nextOperations = clipId === selectedClipId ? nextOps : get().operations
    const resolvedClips = resolveClipOverlaps(
      nextClips,
      nextOpsByClip,
      new Set([clipId]),
      get().linkedGroups
    )
    const nextTimelineDuration = getTimelineDuration(resolvedClips, nextOpsByClip)
    set({
      clips: resolvedClips,
      duration: clipId === selectedClipId ? duration : get().duration,
      operations: nextOperations,
      operationsByClip: nextOpsByClip,
      timelineDuration: nextTimelineDuration,
      currentTime: clampTimelineTime(get().currentTime, nextTimelineDuration)
    })
  },

  activateClip: (clipId) => {
    const { clips, operationsByClip } = get()
    const clip = getSelectedClip(clips, clipId)
    if (!clip) return

    const clipOperations =
      operationsByClip[clipId] || createDefaultOperations(clip.duration)

    set({
      selectedClipId: clipId,
      selectedClipIds: [clipId],
      lastSelectedClipId: clipId,
      sourceFile: clip.filePath,
      mediaInfo: clip.mediaInfo,
      duration: clip.duration,
      operations: clipOperations,
      operationsByClip: {
        ...operationsByClip,
        [clipId]: clipOperations
      }
    })

    setDocumentTitle(clip.filePath, clips.length)
  },

  toggleGroupLink: (groupId) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      return {
        linkedGroups: {
          ...state.linkedGroups,
          [groupId]: !(state.linkedGroups[groupId] !== false)
        },
        historyPast,
        historyFuture: []
      }
    }),

  updateOperation: (id, patch) =>
    set((state) => {
      if (!state.selectedClipId) return state
      const updated = state.operations.map((op) =>
        op.id === id ? { ...op, ...patch } : op
      )
      const targetOp = updated.find((op) => op.id === id)
      const shouldUpdateTimeline = targetOp?.type === 'speed' || targetOp?.type === 'trim'
      const nextOpsByClip = {
        ...state.operationsByClip,
        [state.selectedClipId]: updated
      }
      const resolvedClips = shouldUpdateTimeline
        ? resolveClipOverlaps(state.clips, nextOpsByClip, new Set([state.selectedClipId]), state.linkedGroups)
        : state.clips
      const nextTimelineDuration = shouldUpdateTimeline
        ? getTimelineDuration(resolvedClips, nextOpsByClip)
        : state.timelineDuration
      return {
        operations: updated,
        operationsByClip: nextOpsByClip,
        clips: resolvedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: shouldUpdateTimeline
          ? clampTimelineTime(state.currentTime, nextTimelineDuration)
          : state.currentTime
      }
    }),

  setTrim: (params) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (!state.selectedClipId) return state
      const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId)
      if (!selectedClip) return state
      const bounds = getClipTrimBounds(selectedClip)
      const MIN_VISIBLE = 0.05
      const updated = state.operations.map((op) =>
        op.type !== 'trim'
          ? op
          : (() => {
              const current = op.params as TrimParams
              const startCandidate = params.startTime ?? current.startTime
              const endCandidate = params.endTime ?? current.endTime
              let nextStart = Math.max(bounds.min, Math.min(startCandidate, bounds.max))
              let nextEnd = Math.max(nextStart, Math.min(endCandidate, bounds.max))
              if (nextEnd - nextStart < MIN_VISIBLE) {
                if (params.startTime !== undefined && params.endTime === undefined) {
                  nextStart = Math.max(bounds.min, nextEnd - MIN_VISIBLE)
                } else {
                  nextEnd = Math.min(bounds.max, nextStart + MIN_VISIBLE)
                }
              }
              return { ...op, enabled: true, params: { startTime: nextStart, endTime: nextEnd } as TrimParams }
            })()
      )
      const newOpsByClip = {
        ...state.operationsByClip,
        [state.selectedClipId]: updated
      }
      const resolvedClips = resolveClipOverlaps(
        state.clips,
        newOpsByClip,
        new Set([state.selectedClipId]),
        state.linkedGroups
      )
      const nextTimelineDuration = getTimelineDuration(resolvedClips, newOpsByClip)
      return {
        operations: updated,
        operationsByClip: newOpsByClip,
        clips: resolvedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
      }
    }),

  setSpeed: (rate) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (!state.selectedClipId) return state
      const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId)
      if (!selectedClip) return state
      const isLinked = state.linkedGroups[selectedClip.groupId] !== false
      const targetClips = isLinked
        ? state.clips.filter((clip) => clip.groupId === selectedClip.groupId)
        : [selectedClip]

      const newOpsByClip = { ...state.operationsByClip }
      targetClips.forEach((clip) => {
        const ops = newOpsByClip[clip.id] || createDefaultOperations(clip.duration)
        const nextOps = ops.map((op) =>
          op.type === 'speed'
            ? { ...op, enabled: rate !== 1.0, params: { rate } }
            : op
        )
        newOpsByClip[clip.id] = nextOps
      })
      const activeClipIds = new Set(targetClips.map((clip) => clip.id))
      const resolvedClips = resolveClipOverlaps(
        state.clips,
        newOpsByClip,
        activeClipIds,
        state.linkedGroups
      )
      const updated = newOpsByClip[state.selectedClipId] || state.operations
      const nextTimelineDuration = getTimelineDuration(resolvedClips, newOpsByClip)
      return {
        operations: updated,
        operationsByClip: newOpsByClip,
        clips: resolvedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
      }
    }),

  setVolume: (percent) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const targetId = getLinkedAudioClipId(state.clips, state.linkedGroups, state.selectedClipId)
      if (!targetId) return state
      const targetClip = state.clips.find((clip) => clip.id === targetId)
      if (!targetClip) return state
      const ops = state.operationsByClip[targetId] || createDefaultOperations(targetClip.duration)
      const updated = ops.map((op) =>
        op.type === 'volume'
          ? { ...op, enabled: percent !== 100, params: { percent } }
          : op
      )
      const newOpsByClip = {
        ...state.operationsByClip,
        [targetId]: updated
      }
      return {
        operations: targetId === state.selectedClipId ? updated : state.operations,
        operationsByClip: newOpsByClip,
        historyPast,
        historyFuture: []
      }
    }),

  setPitch: (percent) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const targetId = getLinkedAudioClipId(state.clips, state.linkedGroups, state.selectedClipId)
      if (!targetId) return state
      const targetClip = state.clips.find((clip) => clip.id === targetId)
      if (!targetClip) return state
      const ops = state.operationsByClip[targetId] || createDefaultOperations(targetClip.duration)
      const updated = ops.map((op) =>
        op.type === 'pitch'
          ? { ...op, enabled: percent !== 100, params: { percent } }
          : op
      )
      const newOpsByClip = {
        ...state.operationsByClip,
        [targetId]: updated
      }
      return {
        operations: targetId === state.selectedClipId ? updated : state.operations,
        operationsByClip: newOpsByClip,
        historyPast,
        historyFuture: []
      }
    }),

  toggleOperation: (type, enabled) =>
    set((state) => {
      if (!state.selectedClipId) return state
      const isAudioOnly = type === 'volume' || type === 'pitch'
      const targetId = isAudioOnly
        ? getLinkedAudioClipId(state.clips, state.linkedGroups, state.selectedClipId)
        : state.selectedClipId
      if (!targetId) return state
      const targetClip = state.clips.find((clip) => clip.id === targetId)
      if (!targetClip) return state
      const ops = state.operationsByClip[targetId] || createDefaultOperations(targetClip.duration)
      const updated = ops.map((op) =>
        op.type === type ? { ...op, enabled } : op
      )
      const newOpsByClip = {
        ...state.operationsByClip,
        [targetId]: updated
      }
      const shouldUpdateTimeline = type === 'speed' || type === 'trim'
      const resolvedClips = shouldUpdateTimeline
        ? resolveClipOverlaps(state.clips, newOpsByClip, new Set([targetId]), state.linkedGroups)
        : state.clips
      const nextTimelineDuration = shouldUpdateTimeline
        ? getTimelineDuration(resolvedClips, newOpsByClip)
        : state.timelineDuration
      return {
        operations: targetId === state.selectedClipId ? updated : state.operations,
        operationsByClip: newOpsByClip,
        clips: resolvedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: shouldUpdateTimeline
          ? clampTimelineTime(state.currentTime, nextTimelineDuration)
          : state.currentTime
      }
    }),

  undo: () =>
    set((state) => {
      if (state.historyPast.length === 0) return state
      const prev = state.historyPast[state.historyPast.length - 1]
      const rest = state.historyPast.slice(0, -1)
      const future = [takeSnapshot(state), ...state.historyFuture]
      return {
        ...applySnapshot(state, prev),
        historyPast: rest,
        historyFuture: future
      }
    }),

  redo: () =>
    set((state) => {
      if (state.historyFuture.length === 0) return state
      const next = state.historyFuture[0]
      const rest = state.historyFuture.slice(1)
      const past = [...state.historyPast, takeSnapshot(state)]
      return {
        ...applySnapshot(state, next),
        historyPast: past,
        historyFuture: rest
      }
    }),

  setExporting: (exporting) =>
    set({ exporting, exportProgress: exporting ? null : get().exportProgress }),
  setExportProgress: (exportProgress) => set({ exportProgress }),

  showToast: (message, type = 'info') => {
    set({ toast: { message, type } })
    setTimeout(() => {
      set((state) => (state.toast?.message === message ? { toast: null } : state))
    }, 3500)
  },
  clearToast: () => set({ toast: null }),

  getClipTrim: (clipId: string) => {
    const { clips, operationsByClip } = get()
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return { trimStart: 0, trimEnd: 0 }
    return getClipTrimValues(clip, operationsByClip)
  },

  getAudioOperationsForSelection: () => {
    const { clips, linkedGroups, selectedClipId, operationsByClip, operations } = get()
    const targetId = getLinkedAudioClipId(clips, linkedGroups, selectedClipId)
    if (!targetId || targetId === selectedClipId) return operations
    return operationsByClip[targetId] || []
  },

  getMergeSelectionState: () => {
    const { clips, selectedClipIds } = get()
    const meta = getMergeSelectionMeta(clips, selectedClipIds)
    return {
      canMerge: meta.canMerge,
      disabledReason: meta.disabledReason,
      logicalSelectionCount: meta.logicalSelectionCount,
      hasVideoSelection: meta.hasVideoSelection,
      hasAudioSelection: meta.hasAudioSelection
    }
  },

  reset: () => {
    set({
      clips: [],
      selectedClipId: null,
      selectedClipIds: [],
      lastSelectedClipId: null,
      linkedGroups: {},
      clipboard: null,
      historyPast: [],
      historyFuture: [],
      timelineDuration: 0,
      videoTrackCount: 2,
      audioTrackCount: 2,
      sourceFile: null,
      mediaInfo: null,
      loading: false,
      error: null,
      operations: [],
      operationsByClip: {},
      currentTime: 0,
      playing: false,
      duration: 0,
      exporting: false,
      exportProgress: null,
      merging: false
    })
    setDocumentTitle(null, 0)
  }
}))
