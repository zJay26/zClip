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
  getTrimParams,
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
  moveClip: (clipId: string, patch: Partial<Pick<TimelineClip, 'startTime' | 'trackIndex'>>) => void
  trimClipEdge: (clipId: string, edge: 'start' | 'end', deltaSeconds: number) => void
  splitClipAtPlayhead: () => void
  mergeSelectedClips: () => void
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

/** Get trim in/out points for a clip from its operations */
function getClipTrimValues(
  clip: TimelineClip,
  operationsByClip?: Record<string, MediaOperation[]>
): { trimStart: number; trimEnd: number } {
  const ops = operationsByClip?.[clip.id] || []
  return getTrimParams(clip.duration, ops)
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
    set({ loading: true, error: null })
    try {
      const existingClips = get().clips
      let timelineEnd = getTimelineDuration(existingClips, get().operationsByClip)
      const { videoTrackCount, audioTrackCount } = get()
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
      const nextSelectedClipId =
        get().selectedClipId ||
        newClips.find((clip) => clip.track === 'video')?.id ||
        newClips[0]?.id ||
        null
      const selectedClip = getSelectedClip(mergedClips, nextSelectedClipId)

      set({
        clips: mergedClips,
        selectedClipId: nextSelectedClipId,
        selectedClipIds: nextSelectedClipId ? [nextSelectedClipId] : [],
        lastSelectedClipId: nextSelectedClipId,
        timelineDuration: getTimelineDuration(mergedClips, { ...get().operationsByClip, ...newOperationsByClip }),
        operationsByClip: { ...get().operationsByClip, ...newOperationsByClip },
        linkedGroups: { ...get().linkedGroups, ...newLinkedGroups },
        historyPast: [],
        historyFuture: [],
        operations: selectedClip
          ? (get().operationsByClip[selectedClip.id] || newOperationsByClip[selectedClip.id] || [])
          : [],
        sourceFile: selectedClip?.filePath ?? null,
        mediaInfo: selectedClip?.mediaInfo ?? null,
        duration: selectedClip?.duration ?? 0,
        currentTime: selectedClip ? selectedClip.startTime : get().currentTime,
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

  moveClip: (clipId, patch) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const clip = state.clips.find((c) => c.id === clipId)
      if (!clip) return state

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
      const nextTimelineDuration = getTimelineDuration(updatedClips, state.operationsByClip)

      return {
        clips: updatedClips,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
      }
    }),

  trimClipEdge: (clipId, edge, deltaSeconds) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const clip = state.clips.find((c) => c.id === clipId)
      if (!clip) return state

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
        const params = trimOp.params as TrimParams
        const speedRate = getSpeedRate(ops)
        const deltaMedia = deltaSeconds * speedRate
        const minVisibleMedia = MIN_VISIBLE * speedRate

        let newTrimStart = params.startTime
        let newTrimEnd = params.endTime
        let newStartTime = target.startTime

        if (edge === 'start') {
          newTrimStart = Math.max(0, Math.min(params.startTime + deltaMedia, newTrimEnd - minVisibleMedia))
          const actualDeltaMedia = newTrimStart - params.startTime
          const actualDeltaTimeline = actualDeltaMedia / speedRate
          newStartTime = target.startTime + actualDeltaTimeline
        } else {
          newTrimEnd = Math.min(target.duration, Math.max(params.endTime + deltaMedia, newTrimStart + minVisibleMedia))
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
      const nextTimelineDuration = getTimelineDuration(updatedClips, newOperationsByClip)

      return {
        clips: updatedClips,
        operationsByClip: newOperationsByClip,
        operations: state.selectedClipId ? (newOperationsByClip[state.selectedClipId] || state.operations) : state.operations,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
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

      for (const clip of clipsToSplit) {
        if (!groupIdMap.has(clip.groupId)) {
          groupIdMap.set(clip.groupId, { groupA: uid(), groupB: uid() })
        }
        const groups = groupIdMap.get(clip.groupId)
        if (!groups) continue

        const localSplitTime = timelineTimeToMediaTime(clip, operationsByClip, currentTime)

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
        newClips = newClips.map((c) => (c.id === clip.id ? { ...c, groupId: groups.groupA } : c))
        const clipIndex = newClips.findIndex((c) => c.id === clip.id)
        newClips.splice(clipIndex + 1, 0, clipB)

        newOpsByClip[clip.id] = fixedOpsA
        newOpsByClip[clipBId] = opsB
        newLinkedGroups[groups.groupA] = true
        newLinkedGroups[groups.groupB] = true
      }

      return {
        clips: newClips,
        operationsByClip: newOpsByClip,
        operations: state.selectedClipId ? (newOpsByClip[state.selectedClipId] || state.operations) : state.operations,
        timelineDuration: getTimelineDuration(newClips, newOpsByClip),
        linkedGroups: newLinkedGroups,
        historyPast,
        historyFuture: []
      }
    }),

  mergeSelectedClips: () =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (state.selectedClipIds.length < 2) {
        get().showToast('请先选择至少两段以合并', 'info')
        return state
      }

      const selectedClips = state.clips.filter((c) => state.selectedClipIds.includes(c.id))
      const base = selectedClips[0]
      if (!base) return state
      const sameTrack = selectedClips.every(
        (c) => c.track === base.track && c.trackIndex === base.trackIndex && c.groupId === base.groupId
      )
      if (!sameTrack) {
        get().showToast('仅支持同一轨道且同一来源的片段合并', 'error')
        return state
      }

      const ordered = [...selectedClips].sort((a, b) => a.startTime - b.startTime)
      const baseOps = state.operationsByClip[base.id] || createDefaultOperations(base.duration)
      const eps = 0.02
      for (let i = 0; i < ordered.length; i++) {
        const clip = ordered[i]
        const ops = state.operationsByClip[clip.id] || createDefaultOperations(clip.duration)
        if (!areOpsCompatibleForMerge(baseOps, ops)) {
          get().showToast('片段参数不一致，无法合并', 'error')
          return state
        }
        if (i > 0) {
          const prev = ordered[i - 1]
          const prevDuration = getClipVisibleDuration(prev, state.operationsByClip)
          const prevEnd = prev.startTime + prevDuration
          if (Math.abs(clip.startTime - prevEnd) > eps) {
            get().showToast('片段不相邻，无法合并', 'error')
            return state
          }
        }
      }

      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      const firstTrim = getClipTrimValues(first, state.operationsByClip)
      const lastTrim = getClipTrimValues(last, state.operationsByClip)
      const mergedOps = (state.operationsByClip[first.id] || createDefaultOperations(first.duration)).map((op) =>
        op.type === 'trim'
          ? { ...op, enabled: true, params: { startTime: firstTrim.trimStart, endTime: lastTrim.trimEnd } as TrimParams }
          : op
      )

      const remainingClips = state.clips.filter((c) => !state.selectedClipIds.includes(c.id) || c.id === first.id)
      const updatedClips = remainingClips.map((c) =>
        c.id === first.id ? { ...c, startTime: first.startTime } : c
      )
      const newOpsByClip = { ...state.operationsByClip, [first.id]: mergedOps }
      ordered.slice(1).forEach((c) => {
        delete newOpsByClip[c.id]
      })

      return {
        clips: updatedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: first.id,
        selectedClipIds: [first.id],
        lastSelectedClipId: first.id,
        operations: mergedOps,
        timelineDuration: getTimelineDuration(updatedClips, newOpsByClip),
        historyPast,
        historyFuture: []
      }
    }),

  deleteClip: (clipId) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      const updatedClips = state.clips.filter((c) => c.id !== clipId)
      const newOpsByClip = { ...state.operationsByClip }
      delete newOpsByClip[clipId]

      const needNewSelection = state.selectedClipId === clipId
      const nextSelectedId = needNewSelection
        ? (updatedClips[0]?.id ?? null)
        : state.selectedClipId
      const nextClip = updatedClips.find((c) => c.id === nextSelectedId) ?? null
      const nextSelectedIds = state.selectedClipIds.filter((id) => id !== clipId)

      return {
        clips: updatedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: nextSelectedId,
        selectedClipIds: nextSelectedIds.length > 0 ? nextSelectedIds : nextSelectedId ? [nextSelectedId] : [],
        lastSelectedClipId: nextSelectedId,
        sourceFile: nextClip?.filePath ?? null,
        mediaInfo: nextClip?.mediaInfo ?? null,
        duration: nextClip?.duration ?? 0,
        operations: nextSelectedId ? (newOpsByClip[nextSelectedId] || []) : [],
        timelineDuration: getTimelineDuration(updatedClips, newOpsByClip),
        historyPast,
        historyFuture: []
      }
    }),

  deleteSelectedClips: () =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (state.selectedClipIds.length === 0) return state
      const removeSet = new Set(state.selectedClipIds)
      const updatedClips = state.clips.filter((c) => !removeSet.has(c.id))
      const newOpsByClip = { ...state.operationsByClip }
      state.selectedClipIds.forEach((id) => delete newOpsByClip[id])

      const nextSelectedId = updatedClips[0]?.id ?? null
      const nextClip = updatedClips.find((c) => c.id === nextSelectedId) ?? null

      return {
        clips: updatedClips,
        operationsByClip: newOpsByClip,
        selectedClipId: nextSelectedId,
        selectedClipIds: nextSelectedId ? [nextSelectedId] : [],
        lastSelectedClipId: nextSelectedId,
        sourceFile: nextClip?.filePath ?? null,
        mediaInfo: nextClip?.mediaInfo ?? null,
        duration: nextClip?.duration ?? 0,
        operations: nextSelectedId ? (newOpsByClip[nextSelectedId] || []) : [],
        timelineDuration: getTimelineDuration(updatedClips, newOpsByClip),
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
    const nextClips = clips.map((c) => (c.id === clipId ? { ...c, duration } : c))
    const nextOperations = clipId === selectedClipId ? nextOps : get().operations
    const nextTimelineDuration = getTimelineDuration(nextClips, nextOpsByClip)
    set({
      clips: nextClips,
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
      return {
        operations: updated,
        operationsByClip: {
          ...state.operationsByClip,
          [state.selectedClipId]: updated
        }
      }
    }),

  setTrim: (params) =>
    set((state) => {
      const historyPast = [...state.historyPast, takeSnapshot(state)]
      if (!state.selectedClipId) return state
      const updated = state.operations.map((op) =>
        op.type === 'trim'
          ? { ...op, enabled: true, params: { ...op.params, ...params } }
          : op
      )
      const newOpsByClip = {
        ...state.operationsByClip,
        [state.selectedClipId]: updated
      }
      const nextTimelineDuration = getTimelineDuration(state.clips, newOpsByClip)
      return {
        operations: updated,
        operationsByClip: newOpsByClip,
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
      const updated = newOpsByClip[state.selectedClipId] || state.operations
      const nextTimelineDuration = getTimelineDuration(state.clips, newOpsByClip)
      return {
        operations: updated,
        operationsByClip: newOpsByClip,
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
      const nextTimelineDuration = shouldUpdateTimeline
        ? getTimelineDuration(state.clips, newOpsByClip)
        : state.timelineDuration
      return {
        operations: targetId === state.selectedClipId ? updated : state.operations,
        operationsByClip: newOpsByClip,
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

  reset: () => {
    set({
      clips: [],
      selectedClipId: null,
      selectedClipIds: [],
      lastSelectedClipId: null,
      linkedGroups: {},
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
      exportProgress: null
    })
    setDocumentTitle(null, 0)
  }
}))
