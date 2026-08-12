// ============================================================
// Zustand Store — 项目状态管理
// 单一 store 覆盖项目、播放、操作、导出所有状态
// ============================================================

import { create } from 'zustand'
import type {
  AudioFadeKind,
  AudioFadeSegment,
  MediaInfo,
  MediaOperation,
  TrimParams,
  SpeedParams,
  VolumeParams,
  PitchParams,
  TransformParams,
  FadeParams,
  ProjectData,
  ProjectSettings,
  TimelineClip,
  TimelineTransition,
  TransitionEffectType
} from '../../../shared/types'
import {
  getClipTimelineRange,
  getSpeedRate,
  timelineTimeToMediaTime
} from '../../../shared/timeline-utils'
import {
  MIN_TRANSITION_SIDE_DURATION,
  findTransitionCut,
  getEligibleTransitionCuts,
  normalizeTimelineTransitions
} from '../../../shared/transition-utils'
import type {
  NormalizeTimelineTransitionOptions,
  TransitionCut
} from '../../../shared/transition-utils'
import type { HistoryEditOptions, ProjectSnapshot, ProjectStore } from './project-store-types'
import { appendHistory, HISTORY_LIMIT, snapshotsEqual } from './project-history'
import {
  applySnapshot,
  buildProjectData,
  clampTimelineTime,
  createDefaultOperations,
  createDefaultProjectSettings,
  getClipTrimBounds,
  getClipTrimValues,
  getLinkedAudioClipId,
  getOrderedClips,
  getSelectedClip,
  getTimelineDuration,
  setDocumentTitle,
  takeSnapshot
} from './project-store-helpers'
import { getMergeSelectionMeta } from './merge-selection'
import { resolveClipOverlaps } from './timeline-overlap'
import { uid } from '../lib/utils'
import { translate } from '../contexts/preferences'

let mergeOutputSequence = 1
let pendingHistoryTransaction: ProjectSnapshot | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let importQueue: Promise<void> = Promise.resolve()
const EMPTY_MEDIA_OPERATIONS = Object.freeze([]) as unknown as MediaOperation[]

function cancelToastTimer(): void {
  if (!toastTimer) return
  clearTimeout(toastTimer)
  toastTimer = null
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function applyPlaybackResult(
  info: MediaInfo,
  fallbackPath: string,
  playback: { success: boolean; playbackPath?: string; playbackIsProxy?: boolean }
): MediaInfo {
  return {
    ...info,
    playbackPath: playback.success && playback.playbackPath ? playback.playbackPath : fallbackPath,
    playbackIsProxy: Boolean(playback.success && playback.playbackIsProxy),
    playbackProxyFailed: !playback.success
  }
}

function historyPastForEdit(
  state: ProjectStore,
  options?: HistoryEditOptions
): ProjectSnapshot[] {
  return options?.recordHistory === false
    ? state.historyPast
    : appendHistory(state.historyPast, takeSnapshot(state))
}

const MIN_EFFECT_DURATION = 0.08
const DEFAULT_TRANSITION_DURATION = 1
const DEFAULT_AUDIO_FADE_DURATION = 1
const MAX_TRANSITION_DROP_DISTANCE = 2

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(value, max))
}

function getClipRangeById(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  clipId: string
) {
  const clip = clips.find((item) => item.id === clipId)
  if (!clip) return null
  return { clip, range: getClipTimelineRange(clip, operationsByClip) }
}

function disableEmbeddedAudioForRemovedAudioClips(
  originalClips: TimelineClip[],
  remainingClips: TimelineClip[],
  removedIds: Set<string>
): TimelineClip[] {
  const affectedGroups = new Set(
    originalClips
      .filter((clip) => removedIds.has(clip.id) && clip.track === 'audio' && clip.mediaInfo.hasAudio)
      .map((clip) => clip.groupId)
  )
  if (affectedGroups.size === 0) return remainingClips
  return remainingClips.map((clip) =>
    clip.track === 'video' && affectedGroups.has(clip.groupId) && clip.embeddedAudioEnabled !== false
      ? { ...clip, embeddedAudioEnabled: false }
      : clip
  )
}

function normalizeTransitions(
  transitions: TimelineTransition[] | undefined,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  options?: NormalizeTimelineTransitionOptions
): TimelineTransition[] {
  return normalizeTimelineTransitions(transitions, clips, operationsByClip, options)
}

function getAudioFadeBounds(
  fade: AudioFadeSegment,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): { duration: number } | null {
  const target = getClipRangeById(clips, operationsByClip, fade.clipId)
  if (!target || !target.clip.mediaInfo.hasAudio) return null
  return { duration: Math.max(0, target.range.visibleDuration) }
}

function clampAudioFade(
  fade: AudioFadeSegment,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): AudioFadeSegment | null {
  const bounds = getAudioFadeBounds(fade, clips, operationsByClip)
  if (!bounds || bounds.duration <= MIN_EFFECT_DURATION) return null
  let startOffset = clampNumber(fade.startOffset, 0, Math.max(0, bounds.duration - MIN_EFFECT_DURATION))
  let endOffset = clampNumber(fade.endOffset, startOffset + MIN_EFFECT_DURATION, bounds.duration)
  if (fade.kind === 'in') {
    endOffset = Math.min(endOffset, bounds.duration)
  } else {
    startOffset = Math.max(0, startOffset)
  }
  if (endOffset - startOffset < MIN_EFFECT_DURATION) return null
  return { ...fade, startOffset, endOffset }
}

function normalizeAudioFades(
  audioFades: AudioFadeSegment[] | undefined,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): AudioFadeSegment[] {
  const next: AudioFadeSegment[] = []
  const seen = new Set<string>()
  ;(audioFades || []).forEach((fade) => {
    const clamped = clampAudioFade(fade, clips, operationsByClip)
    if (!clamped) return
    const key = `${clamped.clipId}:${clamped.kind}`
    if (seen.has(key)) return
    seen.add(key)
    next.push(clamped)
  })
  return next
}

function findTransitionPair(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  time: number,
  trackIndex: number
): TransitionCut | null {
  let best: TransitionCut | null = null
  let bestDistance = Infinity
  for (const cut of getEligibleTransitionCuts(clips, operationsByClip, trackIndex)) {
    const distance = Math.abs(time - cut.boundary)
    if (distance > MAX_TRANSITION_DROP_DISTANCE || distance >= bestDistance) continue
    best = cut
    bestDistance = distance
  }
  return best
}

function makeDefaultTransition(
  type: TransitionEffectType,
  cut: TransitionCut
): TimelineTransition {
  const halfDuration = Math.max(
    MIN_TRANSITION_SIDE_DURATION,
    Math.min(
      DEFAULT_TRANSITION_DURATION / 2,
      cut.boundary - cut.leftRange.start,
      cut.rightRange.end - cut.boundary
    )
  )
  return {
    id: uid(),
    type,
    leftClipId: cut.left.id,
    rightClipId: cut.right.id,
    startOffset: -halfDuration,
    endOffset: halfDuration
  }
}

function getAudioFadeTargetId(state: ProjectStore): string | null {
  if (!state.selectedClipId) return null
  const selected = state.clips.find((clip) => clip.id === state.selectedClipId)
  if (!selected) return null
  if (selected.track === 'audio') return selected.id
  return getLinkedAudioClipId(state.clips, state.linkedGroups, state.selectedClipId)
}

function makeDefaultAudioFade(
  kind: AudioFadeKind,
  clip: TimelineClip,
  operationsByClip: Record<string, MediaOperation[]>
): AudioFadeSegment {
  const range = getClipTimelineRange(clip, operationsByClip)
  const duration = Math.max(MIN_EFFECT_DURATION, range.visibleDuration)
  const fadeDuration = Math.max(MIN_EFFECT_DURATION, Math.min(DEFAULT_AUDIO_FADE_DURATION, duration / 2))
  return {
    id: uid(),
    clipId: clip.id,
    kind,
    startOffset: kind === 'in' ? 0 : Math.max(0, duration - fadeDuration),
    endOffset: kind === 'in' ? fadeDuration : duration
  }
}

function normalizeProjectSettings(settings?: ProjectSettings): ProjectSettings {
  const defaults = createDefaultProjectSettings()
  return {
    ...defaults,
    ...(settings || {}),
    frameRate: clampNumber(settings?.frameRate ?? defaults.frameRate ?? 30, 1, 240),
    canvas: {
      ...defaults.canvas,
      ...(settings?.canvas || {}),
      width: Math.max(16, Math.round(settings?.canvas?.width || defaults.canvas.width)),
      height: Math.max(16, Math.round(settings?.canvas?.height || defaults.canvas.height)),
      backgroundColor: settings?.canvas?.backgroundColor || defaults.canvas.backgroundColor
    }
  }
}

function normalizeOperationsForClip(
  clip: TimelineClip,
  operations?: MediaOperation[]
): MediaOperation[] {
  const defaults = createDefaultOperations(clip.duration)
  if (!operations || operations.length === 0) return defaults
  return defaults.map((defaultOp) => {
    const existing = operations.find((op) => op.type === defaultOp.type)
    return existing || defaultOp
  })
}

function normalizeProjectData(data: ProjectData): ProjectData {
  const videoTrackCount = Math.max(1, Math.min(data.videoTrackCount || 2, 16))
  const audioTrackCount = Math.max(1, Math.min(data.audioTrackCount || 2, 16))
  const clips = data.clips.map((clip) => ({
    ...clip,
    trackIndex: Math.max(0, Math.min(clip.trackIndex, (clip.track === 'video' ? videoTrackCount : audioTrackCount) - 1))
  }))
  const operationsByClip: Record<string, MediaOperation[]> = {}
  clips.forEach((clip) => {
    operationsByClip[clip.id] = normalizeOperationsForClip(
      clip,
      data.operationsByClip?.[clip.id]
    )
  })
  return {
    ...data,
    operationsByClip,
    clips,
    transitions: normalizeTransitions(data.transitions, clips, operationsByClip),
    audioFades: normalizeAudioFades(data.audioFades, clips, operationsByClip),
    linkedGroups: data.linkedGroups || {},
    videoTrackCount,
    audioTrackCount,
    projectSettings: normalizeProjectSettings(data.projectSettings)
  }
}

function projectNameFromPath(filePath: string | null): string {
  if (!filePath) return translate('未命名项目', 'Untitled project')
  const fileName = filePath.split(/[\\/]/).pop() || translate('未命名项目', 'Untitled project')
  return fileName.replace(/\.zclip$/i, '').replace(/\.[^.]+$/, '') || translate('未命名项目', 'Untitled project')
}

const DOCUMENT_STATE_KEYS: ReadonlyArray<keyof ProjectStore> = [
  'clips', 'operationsByClip', 'transitions', 'audioFades', 'linkedGroups',
  'videoTrackCount', 'audioTrackCount', 'projectSettings'
]

export const useProjectStore = create<ProjectStore>((baseSet, get) => {
  const set = (
    update: Partial<ProjectStore> | ((state: ProjectStore) => Partial<ProjectStore> | ProjectStore)
  ): void => {
    baseSet((state) => {
      const rawPatch = typeof update === 'function' ? update(state) : update
      if (!rawPatch || typeof rawPatch !== 'object') return rawPatch
      let patch = Object.prototype.hasOwnProperty.call(rawPatch, 'transitions') &&
        !Object.prototype.hasOwnProperty.call(rawPatch, 'selectedTransitionId') &&
        state.selectedTransitionId &&
        !(rawPatch.transitions as TimelineTransition[] | undefined)?.some(
          (transition) => transition.id === state.selectedTransitionId
        )
        ? { ...rawPatch, selectedTransitionId: null }
        : rawPatch
      const removedInvalidTransition = Object.prototype.hasOwnProperty.call(rawPatch, 'transitions') &&
        !Object.prototype.hasOwnProperty.call(rawPatch, 'selectedTransitionId') &&
        state.transitions.some((transition) =>
          !(rawPatch.transitions as TimelineTransition[] | undefined)?.some((item) => item.id === transition.id)
        )
      if (removedInvalidTransition && !Object.prototype.hasOwnProperty.call(rawPatch, 'toast')) {
        cancelToastTimer()
        patch = {
          ...patch,
          toast: {
            message: translate(
              '片段不再满足转场条件，相关转场已自动移除（可撤销）',
              'The clips no longer form a valid cut, so the transition was removed (undo is available)'
            ),
            type: 'info'
          }
        }
        toastTimer = setTimeout(() => {
          baseSet({ toast: null })
          toastTimer = null
        }, 3200)
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'projectDirty')) {
        return patch
      }
      const documentChanged = DOCUMENT_STATE_KEYS.some((key) =>
        Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== state[key]
      )
      return documentChanged
        ? { ...patch, projectDirty: true, documentRevision: state.documentRevision + 1 }
        : patch
    })
  }

  const applyTransitionToCut = (type: TransitionEffectType, requestedCut: TransitionCut): boolean => {
    let appliedId: string | null = null
    let replaced = false
    let rejectedForOverlap = false
    set((state) => {
      const cut = findTransitionCut(
        state.clips,
        state.operationsByClip,
        requestedCut.left.id,
        requestedCut.right.id
      )
      if (!cut) return state
      const defaultTransition = makeDefaultTransition(type, cut)
      const existingIndex = state.transitions.findIndex(
        (transition) => transition.leftClipId === cut.left.id && transition.rightClipId === cut.right.id
      )
      const transitions = [...state.transitions]
      let candidateId: string
      if (existingIndex >= 0) {
        replaced = true
        candidateId = transitions[existingIndex].id
        transitions[existingIndex] = {
          ...transitions[existingIndex],
          // Replacing an effect is a type-only operation. Duration and
          // alignment belong to the edit point and must remain untouched.
          type
        }
      } else {
        candidateId = defaultTransition.id
        transitions.push(defaultTransition)
      }
      const normalized = normalizeTransitions(
        transitions,
        state.clips,
        state.operationsByClip,
        existingIndex >= 0
          ? { editedTransitionId: candidateId, preserveNeighborDurations: true }
          : undefined
      )
      const retainedIds = new Set(normalized.map((transition) => transition.id))
      if (
        !retainedIds.has(candidateId) ||
        state.transitions.some((transition) => !retainedIds.has(transition.id))
      ) {
        rejectedForOverlap = true
        return state
      }
      appliedId = candidateId
      return {
        transitions: normalized,
        selectedTransitionId: appliedId,
        selectedClipId: null,
        selectedClipIds: [],
        lastSelectedClipId: null,
        historyPast: appendHistory(state.historyPast, takeSnapshot(state)),
        historyFuture: []
      }
    })
    if (!appliedId) {
      if (rejectedForOverlap) {
        get().showToast(
          translate(
            '无法添加：中间片段太短，两个转场会互相重叠',
            'Cannot add: the middle clip is too short for two non-overlapping transitions'
          ),
          'info'
        )
      }
      return false
    }
    get().showToast(
      replaced
        ? translate('转场效果已更新', 'Transition updated')
        : translate('转场已添加，剪辑点已选中', 'Transition added and selected'),
      'success'
    )
    return true
  }

  return ({
  // Initial state
  clips: [],
  selectedTransitionId: null,
  selectedClipId: null,
  selectedClipIds: [],
  lastSelectedClipId: null,
  linkedGroups: {},
  clipboard: null,
  transitions: [],
  audioFades: [],
  historyPast: [],
  historyFuture: [],
  timelineDuration: 0,
  videoTrackCount: 2,
  audioTrackCount: 2,
  projectSettings: createDefaultProjectSettings(),
  projectFilePath: null,
  projectDirty: false,
  documentRevision: 0,
  recentProjects: [],
  autosaveReady: false,
  missingMediaPaths: [],
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

  loadFiles: (filePaths: string[]) => {
    const requestedPaths = [...filePaths]
    const task = importQueue.catch(() => undefined).then(async () => {
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

        const probed = await mapWithConcurrency(requestedPaths, 3, async (filePath) => ({
          filePath,
          result: await window.api.getMediaInfo(filePath)
        }))
        const failures = probed.filter(({ result }) => !result.success || !result.data)

        for (const { filePath, result } of probed) {
          if (!result.success || !result.data) continue
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
              embeddedAudioEnabled: !info.hasAudio,
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
        const historyPast = appendHistory(stateBeforeImport.historyPast, takeSnapshot(stateBeforeImport))

        set({
          clips: resolvedClips,
          selectedTransitionId: null,
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
        if (failures.length > 0) {
          get().showToast(translate(`已导入素材，但有 ${failures.length} 个文件失败`, `Media imported, but ${failures.length} file(s) failed`), 'error')
        }

        const importedPaths = Array.from(new Set(newClips.map((clip) => clip.filePath)))
        void Promise.all(importedPaths.map(async (filePath) => {
          const playback = await window.api.preparePlayback(filePath).catch(() => ({ success: false }))
          set((state) => {
            return {
              clips: state.clips.map((clip) => clip.filePath === filePath
                ? { ...clip, mediaInfo: applyPlaybackResult(clip.mediaInfo, filePath, playback) }
                : clip),
              mediaInfo: state.mediaInfo?.filePath === filePath
                ? applyPlaybackResult(state.mediaInfo, filePath, playback)
                : state.mediaInfo,
              projectDirty: state.projectDirty
            }
          })
        })).catch(() => {})
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Failed to load files',
          loading: false
        })
      }
    })
    importQueue = task
    return task
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
      selectedTransitionId: null,
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
      },
      projectDirty: get().projectDirty
    })

    setDocumentTitle(clip.filePath, clips.length)
  },

  selectTransition: (transitionId) => {
    if (!get().transitions.some((transition) => transition.id === transitionId)) return
    set({
      selectedTransitionId: transitionId,
      selectedClipId: null,
      selectedClipIds: [],
      lastSelectedClipId: null
    })
  },

  addVideoTrack: () =>
    set((state) => ({ videoTrackCount: Math.min(state.videoTrackCount + 1, 16) })),
  removeVideoTrack: () =>
    set((state) => {
      const nextCount = Math.max(state.videoTrackCount - 1, 1)
      if (nextCount === state.videoTrackCount) return state
      const movedIds = new Set(
        state.clips
          .filter((clip) => clip.track === 'video' && clip.trackIndex >= nextCount)
          .map((clip) => clip.id)
      )
      const updatedClips = state.clips.map((clip) =>
        clip.track === 'video' && clip.trackIndex >= nextCount
          ? { ...clip, trackIndex: nextCount - 1 }
          : clip
      )
      const resolvedClips = resolveClipOverlaps(
        updatedClips,
        state.operationsByClip,
        movedIds,
        state.linkedGroups
      )
      const timelineDuration = getTimelineDuration(resolvedClips, state.operationsByClip)
      return {
        videoTrackCount: nextCount,
        clips: resolvedClips,
        transitions: normalizeTransitions(state.transitions, resolvedClips, state.operationsByClip),
        timelineDuration,
        currentTime: clampTimelineTime(state.currentTime, timelineDuration)
      }
    }),
  addAudioTrack: () =>
    set((state) => ({ audioTrackCount: Math.min(state.audioTrackCount + 1, 16) })),
  removeAudioTrack: () =>
    set((state) => {
      const nextCount = Math.max(state.audioTrackCount - 1, 1)
      if (nextCount === state.audioTrackCount) return state
      const movedIds = new Set(
        state.clips
          .filter((clip) => clip.track === 'audio' && clip.trackIndex >= nextCount)
          .map((clip) => clip.id)
      )
      const updatedClips = state.clips.map((clip) =>
        clip.track === 'audio' && clip.trackIndex >= nextCount
          ? { ...clip, trackIndex: nextCount - 1 }
          : clip
      )
      const resolvedClips = resolveClipOverlaps(
        updatedClips,
        state.operationsByClip,
        movedIds,
        state.linkedGroups
      )
      const timelineDuration = getTimelineDuration(resolvedClips, state.operationsByClip)
      return {
        audioTrackCount: nextCount,
        clips: resolvedClips,
        audioFades: normalizeAudioFades(state.audioFades, resolvedClips, state.operationsByClip),
        timelineDuration,
        currentTime: clampTimelineTime(state.currentTime, timelineDuration)
      }
    }),

  moveClip: (clipId, patch, options) =>
    set((state) => {
      const clipsById = new Map(state.clips.map((item) => [item.id, item]))
      const clipsByGroup = new Map<string, TimelineClip[]>()
      state.clips.forEach((item) => {
        const group = clipsByGroup.get(item.groupId)
        if (group) group.push(item)
        else clipsByGroup.set(item.groupId, [item])
      })
      const clip = clipsById.get(clipId)
      if (!clip) return state
      const shouldRecordHistory = options?.recordHistory !== false
      const historyPast = shouldRecordHistory
        ? appendHistory(state.historyPast, takeSnapshot(state))
        : state.historyPast

      const nextStartTime = patch.startTime ?? clip.startTime
      const delta = nextStartTime - clip.startTime
      const isMulti = state.selectedClipIds.includes(clipId) && state.selectedClipIds.length > 1

      const affectedIds = new Set<string>()
      const addLinkedGroup = (baseClip: TimelineClip): void => {
        const isLinked = state.linkedGroups[baseClip.groupId] !== false
        if (!isLinked) return
        clipsByGroup.get(baseClip.groupId)?.forEach((item) => affectedIds.add(item.id))
      }

      if (isMulti && delta !== 0) {
        state.selectedClipIds.forEach((id) => affectedIds.add(id))
        state.selectedClipIds.forEach((id) => {
          const base = clipsById.get(id)
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
        transitions: normalizeTransitions(state.transitions, resolvedClips, state.operationsByClip),
        audioFades: normalizeAudioFades(state.audioFades, resolvedClips, state.operationsByClip),
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
        ? appendHistory(state.historyPast, takeSnapshot(state))
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
        transitions: normalizeTransitions(state.transitions, resolvedClips, newOperationsByClip),
        audioFades: normalizeAudioFades(state.audioFades, resolvedClips, newOperationsByClip),
        operations: state.selectedClipId ? (newOperationsByClip[state.selectedClipId] || state.operations) : state.operations,
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: shouldRecordHistory ? [] : state.historyFuture
      }
    }),

  splitClipAtPlayhead: () =>
    set((state) => {
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
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
      const splitTailIdBySource = new Map<string, string>()
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
        splitTailIdBySource.set(clip.id, clipBId)

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
      const splitSourceIds = new Set(clipsToSplit.map((clip) => clip.id))
      const remappedTransitions = state.transitions.map((transition) => ({
        ...transition,
        // A transition attached to the split clip's outgoing edge follows the
        // new tail half. An incoming transition remains on the original head.
        leftClipId: splitTailIdBySource.get(transition.leftClipId) ?? transition.leftClipId
      }))
      return {
        clips: resolvedClips,
        transitions: normalizeTransitions(remappedTransitions, resolvedClips, newOpsByClip),
        audioFades: state.audioFades.filter((item) => !splitSourceIds.has(item.clipId)),
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

      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
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
        selectedTransitionId: null,
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
      get().showToast(mergeSelection.disabledReason || translate('当前选区不可合并', 'The current selection cannot be merged'), 'info')
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
      get().showToast(translate('所选片段不包含可合并的音视频流', 'The selected clips do not contain mergeable audio or video streams'), 'error')
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
        throw new Error(exportResult.error || translate('合并导出失败', 'Merge export failed'))
      }

      const infoResult = await window.api.getMediaInfo(outputPath)
      if (!infoResult.success || !infoResult.data) {
        throw new Error(infoResult.error || translate('无法读取合并后的媒体信息', 'Could not read the merged media information'))
      }
      const mergedInfo = infoResult.data

      const latest = get()
      const unchangedSelection =
        latest.selectedClipIds.length === state.selectedClipIds.length &&
        latest.selectedClipIds.every((id) => selectedIdSet.has(id))
      if (!unchangedSelection) {
        get().showToast(translate('合并期间选区已变化，结果文件已生成但未自动替换', 'The selection changed during the merge. The result was created but not inserted automatically.'), 'info')
        return
      }

      const historyPast = appendHistory(latest.historyPast, takeSnapshot(latest))
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
          embeddedAudioEnabled: !(hasAudioSelection && mergedInfo.hasAudio && firstAudio),
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
        throw new Error(translate('合并输出未包含可用的音视频流', 'The merged output contains no usable audio or video streams'))
      }

      const newOpsByClip = { ...latest.operationsByClip }
      selectedIdSet.forEach((id) => {
        delete newOpsByClip[id]
      })
      createdClips.forEach((clip) => {
        newOpsByClip[clip.id] = createDefaultOperations(clip.duration)
      })

      const remainingClips = disableEmbeddedAudioForRemovedAudioClips(
        latest.clips,
        latest.clips.filter((clip) => !selectedIdSet.has(clip.id)),
        selectedIdSet
      )
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
        transitions: latest.transitions.filter(
          (item) => !selectedIdSet.has(item.leftClipId) && !selectedIdSet.has(item.rightClipId)
        ),
        audioFades: latest.audioFades.filter((item) => !selectedIdSet.has(item.clipId)),
        operationsByClip: newOpsByClip,
        selectedTransitionId: null,
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
      get().showToast(translate('合并完成', 'Merge complete'), 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : translate('片段合并失败', 'Clip merge failed')
      get().showToast(translate(`片段合并失败：${message}`, `Clip merge failed: ${message}`), 'error')
    } finally {
      set({ exporting: false, exportProgress: null, merging: false })
    }
  },

  deleteClip: (clipId) =>
    set((state) => {
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
      const updatedClips = disableEmbeddedAudioForRemovedAudioClips(
        state.clips,
        state.clips.filter((c) => c.id !== clipId),
        new Set([clipId])
      )
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
        transitions: state.transitions.filter(
          (item) => item.leftClipId !== clipId && item.rightClipId !== clipId
        ),
        audioFades: state.audioFades.filter((item) => item.clipId !== clipId),
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
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
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
      const updatedClips = disableEmbeddedAudioForRemovedAudioClips(
        state.clips,
        state.clips.filter((c) => !removeSet.has(c.id)),
        removeSet
      )
      const newOpsByClip = { ...state.operationsByClip }
      removeSet.forEach((id) => delete newOpsByClip[id])
      const resolvedClips = resolveClipOverlaps(updatedClips, newOpsByClip, new Set(), state.linkedGroups)

      const nextSelectedId = resolvedClips[0]?.id ?? null
      const nextClip = resolvedClips.find((c) => c.id === nextSelectedId) ?? null

      return {
        clips: resolvedClips,
        transitions: state.transitions.filter(
          (item) => !removeSet.has(item.leftClipId) && !removeSet.has(item.rightClipId)
        ),
        audioFades: state.audioFades.filter((item) => !removeSet.has(item.clipId)),
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
      transitions: normalizeTransitions(get().transitions, resolvedClips, nextOpsByClip),
      audioFades: normalizeAudioFades(get().audioFades, resolvedClips, nextOpsByClip),
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
      selectedTransitionId: null,
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
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
      const nextLinked = !(state.linkedGroups[groupId] !== false)
      const primaryClip = state.selectedClipId
        ? state.clips.find((clip) => clip.id === state.selectedClipId)
        : undefined
      let selectedClipIds = state.selectedClipIds

      if (primaryClip?.groupId === groupId) {
        if (nextLinked) {
          selectedClipIds = Array.from(new Set([
            ...state.selectedClipIds,
            ...state.clips.filter((clip) => clip.groupId === groupId).map((clip) => clip.id)
          ]))
        } else {
          selectedClipIds = state.selectedClipIds.filter((id) => {
            if (id === state.selectedClipId) return true
            return state.clips.find((clip) => clip.id === id)?.groupId !== groupId
          })
        }
      }

      return {
        linkedGroups: {
          ...state.linkedGroups,
          [groupId]: nextLinked
        },
        selectedClipIds,
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
        transitions: shouldUpdateTimeline
          ? normalizeTransitions(state.transitions, resolvedClips, nextOpsByClip)
          : state.transitions,
        audioFades: shouldUpdateTimeline
          ? normalizeAudioFades(state.audioFades, resolvedClips, nextOpsByClip)
          : state.audioFades,
        timelineDuration: nextTimelineDuration,
        currentTime: shouldUpdateTimeline
          ? clampTimelineTime(state.currentTime, nextTimelineDuration)
          : state.currentTime
      }
    }),

  setTrim: (params) =>
    set((state) => {
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
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
        transitions: normalizeTransitions(state.transitions, resolvedClips, newOpsByClip),
        audioFades: normalizeAudioFades(state.audioFades, resolvedClips, newOpsByClip),
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: []
      }
    }),

  setSpeed: (rate, options) =>
    set((state) => {
      const historyPast = historyPastForEdit(state, options)
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
        transitions: normalizeTransitions(state.transitions, resolvedClips, newOpsByClip),
        audioFades: normalizeAudioFades(state.audioFades, resolvedClips, newOpsByClip),
        timelineDuration: nextTimelineDuration,
        currentTime: clampTimelineTime(state.currentTime, nextTimelineDuration),
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  setVolume: (percent, options) =>
    set((state) => {
      const historyPast = historyPastForEdit(state, options)
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
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  setPitch: (percent, options) =>
    set((state) => {
      const historyPast = historyPastForEdit(state, options)
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
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  setTransform: (params, options) =>
    set((state) => {
      if (!state.selectedClipId) return state
      const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId)
      if (!selectedClip || selectedClip.track !== 'video') return state
      const historyPast = historyPastForEdit(state, options)
      const ops = state.operationsByClip[selectedClip.id] || createDefaultOperations(selectedClip.duration)
      const updated = ops.map((op) =>
        op.type === 'transform'
          ? {
              ...op,
              enabled: true,
              params: { ...(op.params as TransformParams), ...params } as TransformParams
            }
          : op
      )
      return {
        operations: updated,
        operationsByClip: {
          ...state.operationsByClip,
          [selectedClip.id]: updated
        },
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  setFade: (params, options) =>
    set((state) => {
      if (!state.selectedClipId) return state
      const selectedClip = state.clips.find((clip) => clip.id === state.selectedClipId)
      if (!selectedClip) return state
      const historyPast = historyPastForEdit(state, options)
      const targetIds =
        state.linkedGroups[selectedClip.groupId] !== false
          ? state.clips.filter((clip) => clip.groupId === selectedClip.groupId).map((clip) => clip.id)
          : [selectedClip.id]
      const newOpsByClip = { ...state.operationsByClip }
      targetIds.forEach((clipId) => {
        const clip = state.clips.find((item) => item.id === clipId)
        if (!clip) return
        const ops = newOpsByClip[clipId] || createDefaultOperations(clip.duration)
        const updated = ops.map((op) => {
          if (op.type !== 'fade') return op
          const nextParams = { ...(op.params as FadeParams), ...params } as FadeParams
          return {
            ...op,
            enabled: nextParams.fadeIn > 0 || nextParams.fadeOut > 0,
            params: nextParams
          }
        })
        newOpsByClip[clipId] = updated
      })
      return {
        operations: newOpsByClip[state.selectedClipId] || state.operations,
        operationsByClip: newOpsByClip,
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  addTransitionAtTime: (type, time, trackIndex) => {
    const state = get()
    const cut = findTransitionPair(state.clips, state.operationsByClip, time, trackIndex)
    if (!cut) {
      get().showToast(
        translate(
          '这里只能放置在同一视频轨上、首尾紧贴的剪辑点',
          'Transitions require a touching cut between clips on the same video track'
        ),
        'info'
      )
      return false
    }
    return applyTransitionToCut(type, cut)
  },

  applyTransition: (type) => {
    const state = get()
    if (state.selectedTransitionId) {
      const selected = state.transitions.find((transition) => transition.id === state.selectedTransitionId)
      if (selected) {
        set((latest) => ({
          transitions: latest.transitions.map((transition) =>
            transition.id === selected.id ? { ...transition, type } : transition
          ),
          historyPast: appendHistory(latest.historyPast, takeSnapshot(latest)),
          historyFuture: []
        }))
        get().showToast(translate('已切换所选转场效果', 'Selected transition effect changed'), 'success')
        return true
      }
    }

    const cuts = getEligibleTransitionCuts(state.clips, state.operationsByClip)
    const selectedClip = state.selectedClipId
      ? state.clips.find((clip) => clip.id === state.selectedClipId && clip.track === 'video')
      : null
    const selectionCuts = selectedClip
      ? cuts.filter((cut) => cut.left.id === selectedClip.id || cut.right.id === selectedClip.id)
      : []
    const candidates = selectionCuts.length > 0
      ? selectionCuts
      : cuts.filter((cut) => Math.abs(cut.boundary - state.currentTime) <= MAX_TRANSITION_DROP_DISTANCE)
    const cut = candidates.sort(
      (a, b) => Math.abs(a.boundary - state.currentTime) - Math.abs(b.boundary - state.currentTime)
    )[0]
    if (!cut) {
      get().showToast(
        translate(
          '先选择剪辑点旁的片段，或将播放头放到同轨相邻片段的剪辑点',
          'Select a clip beside a cut, or move the playhead to a touching same-track cut'
        ),
        'info'
      )
      return false
    }
    return applyTransitionToCut(type, cut)
  },

  updateTransition: (id, patch, options) =>
    set((state) => {
      const target = state.transitions.find((item) => item.id === id)
      if (!target) return state
      const historyPast = historyPastForEdit(state, options)
      const transitions = normalizeTransitions(
        state.transitions.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        state.clips,
        state.operationsByClip,
        { editedTransitionId: id, preserveNeighborDurations: true }
      )
      return {
        transitions,
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  deleteTransition: (id) =>
    set((state) => {
      if (!state.transitions.some((item) => item.id === id)) return state
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
      return {
        transitions: state.transitions.filter((item) => item.id !== id),
        selectedTransitionId: state.selectedTransitionId === id ? null : state.selectedTransitionId,
        historyPast,
        historyFuture: []
      }
    }),

  addAudioFade: (kind) => {
    const state = get()
    const clipId = getAudioFadeTargetId(state)
    const clip = clipId ? state.clips.find((item) => item.id === clipId) : null
    if (!clip || clip.track !== 'audio') {
      get().showToast(translate('请选择一个音频片段添加淡入或淡出', 'Select an audio clip to add a fade in or fade out'), 'info')
      return false
    }
    const nextFade = makeDefaultAudioFade(kind, clip, state.operationsByClip)
    set((latest) => {
      const historyPast = appendHistory(latest.historyPast, takeSnapshot(latest))
      const existingIndex = latest.audioFades.findIndex(
        (item) => item.clipId === clip.id && item.kind === kind
      )
      const audioFades = [...latest.audioFades]
      if (existingIndex >= 0) {
        audioFades[existingIndex] = { ...audioFades[existingIndex], ...nextFade, id: audioFades[existingIndex].id }
      } else {
        audioFades.push(nextFade)
      }
      return {
        audioFades: normalizeAudioFades(audioFades, latest.clips, latest.operationsByClip),
        historyPast,
        historyFuture: []
      }
    })
    return true
  },

  updateAudioFade: (id, patch, options) =>
    set((state) => {
      const target = state.audioFades.find((item) => item.id === id)
      if (!target) return state
      const historyPast = historyPastForEdit(state, options)
      const audioFades = state.audioFades
        .map((item) => (item.id === id ? { ...item, ...patch } : item))
        .map((item) => clampAudioFade(item, state.clips, state.operationsByClip))
        .filter((item): item is AudioFadeSegment => !!item)
      return {
        audioFades,
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
      }
    }),

  deleteAudioFade: (id) =>
    set((state) => {
      if (!state.audioFades.some((item) => item.id === id)) return state
      const historyPast = appendHistory(state.historyPast, takeSnapshot(state))
      return {
        audioFades: state.audioFades.filter((item) => item.id !== id),
        historyPast,
        historyFuture: []
      }
    }),

  setProjectSettings: (settings, options) =>
    set((state) => {
      const historyPast = historyPastForEdit(state, options)
      return {
        projectSettings: {
          ...state.projectSettings,
          ...settings,
          canvas: {
            ...state.projectSettings.canvas,
            ...(settings.canvas || {})
          }
        },
        historyPast,
        historyFuture: options?.recordHistory === false ? state.historyFuture : []
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
        transitions: shouldUpdateTimeline
          ? normalizeTransitions(state.transitions, resolvedClips, newOpsByClip)
          : state.transitions,
        audioFades: shouldUpdateTimeline
          ? normalizeAudioFades(state.audioFades, resolvedClips, newOpsByClip)
          : state.audioFades,
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
      const future = [takeSnapshot(state), ...state.historyFuture].slice(0, HISTORY_LIMIT)
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
      const past = appendHistory(state.historyPast, takeSnapshot(state))
      return {
        ...applySnapshot(state, next),
        historyPast: past,
        historyFuture: rest
      }
    }),

  beginHistoryTransaction: () => {
    if (!pendingHistoryTransaction) {
      pendingHistoryTransaction = takeSnapshot(get())
    }
  },

  commitHistoryTransaction: () =>
    set((state) => {
      if (!pendingHistoryTransaction) return state
      const baseSnapshot = pendingHistoryTransaction
      pendingHistoryTransaction = null
      if (snapshotsEqual(baseSnapshot, takeSnapshot(state))) return state
      return {
        historyPast: appendHistory(state.historyPast, baseSnapshot),
        historyFuture: []
      }
    }),

  setExporting: (exporting) =>
    set({ exporting, exportProgress: exporting ? null : get().exportProgress }),
  setExportProgress: (exportProgress) => set({ exportProgress }),

  showToast: (message, type = 'info') => {
    cancelToastTimer()
    set({ toast: { message, type } })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toast: null })
    }, 3500)
  },
  clearToast: () => {
    cancelToastTimer()
    set({ toast: null })
  },
  clearError: () => set({ error: null }),

  saveProject: async () => {
    try {
      const state = get()
      const savedRevision = state.documentRevision
      const filePath =
        state.projectFilePath ||
        (await window.api.showProjectSaveDialog(`${projectNameFromPath(state.sourceFile)}.zclip`))
      if (!filePath) return false
      const result = await window.api.saveProjectFile(filePath, buildProjectData(state))
      if (!result.success) throw new Error(result.error || translate('未知错误', 'Unknown error'))
      let savedLatestRevision = false
      set((current) => {
        savedLatestRevision = current.documentRevision === savedRevision
        return {
          projectFilePath: filePath,
          projectDirty: savedLatestRevision ? false : current.projectDirty
        }
      })
      let autosaveCleanupFailed = false
      if (savedLatestRevision) {
        await get().clearAutosave().catch(() => { autosaveCleanupFailed = true })
      }
      await get().refreshRecentProjects().catch(() => {})
      get().showToast(
        !savedLatestRevision
          ? translate('项目已保存，但保存期间产生了新改动', 'Project saved, but newer changes still need saving')
          : autosaveCleanupFailed
          ? translate('项目已保存，但旧自动保存未能清理', 'Project saved, but the previous autosave could not be cleared')
          : translate('项目已保存', 'Project saved'),
        !savedLatestRevision || autosaveCleanupFailed ? 'info' : 'success'
      )
      return true
    } catch (error) {
      get().showToast(translate(
        `项目保存失败：${error instanceof Error ? error.message : '未知错误'}`,
        `Project save failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      ), 'error')
      return false
    }
  },

  saveProjectAs: async () => {
    try {
      const state = get()
      const savedRevision = state.documentRevision
      const filePath = await window.api.showProjectSaveDialog(`${projectNameFromPath(get().projectFilePath)}.zclip`)
      if (!filePath) return false
      const result = await window.api.saveProjectFile(filePath, buildProjectData(state))
      if (!result.success) throw new Error(result.error || translate('未知错误', 'Unknown error'))
      let savedLatestRevision = false
      set((current) => {
        savedLatestRevision = current.documentRevision === savedRevision
        return {
          projectFilePath: filePath,
          projectDirty: savedLatestRevision ? false : current.projectDirty
        }
      })
      let autosaveCleanupFailed = false
      if (savedLatestRevision) {
        await get().clearAutosave().catch(() => { autosaveCleanupFailed = true })
      }
      await get().refreshRecentProjects().catch(() => {})
      get().showToast(
        !savedLatestRevision
          ? translate('项目已另存，但保存期间产生了新改动', 'Project saved as a new file, but newer changes still need saving')
          : autosaveCleanupFailed
          ? translate('项目已另存，但旧自动保存未能清理', 'Project saved as a new file, but the previous autosave could not be cleared')
          : translate('项目已另存', 'Project saved as a new file'),
        !savedLatestRevision || autosaveCleanupFailed ? 'info' : 'success'
      )
      return true
    } catch (error) {
      get().showToast(translate(
        `项目另存失败：${error instanceof Error ? error.message : '未知错误'}`,
        `Save as failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      ), 'error')
      return false
    }
  },

  openProject: async () => {
    try {
      const filePath = await window.api.showProjectOpenDialog()
      if (!filePath) return false
      return get().openProjectFromPath(filePath)
    } catch (error) {
      get().showToast(translate(
        `项目打开失败：${error instanceof Error ? error.message : '未知错误'}`,
        `Could not open project: ${error instanceof Error ? error.message : 'Unknown error'}`
      ), 'error')
      return false
    }
  },

  openProjectFromPath: async (filePath) => {
    try {
      if (get().projectDirty && !window.confirm(translate('当前项目有未保存的更改，确定要放弃并打开其他项目吗？', 'The current project has unsaved changes. Discard them and open another project?'))) {
        return false
      }
      const result = await window.api.openProjectFile(filePath)
    if (!result.success || !result.data) {
      get().showToast(translate(`项目打开失败：${result.error || '未知错误'}`, `Could not open project: ${result.error || 'Unknown error'}`), 'error')
      await get().removeRecentProject(filePath)
      return false
    }
    const uniquePaths = Array.from(new Set(result.data.clips.map((clip) => clip.filePath)))
    const refreshed = new Map<string, MediaInfo>()
    const missing: string[] = []
    await mapWithConcurrency(uniquePaths, 3, async (mediaPath) => {
      const mediaResult = await window.api.getMediaInfo(mediaPath)
      if (mediaResult.success && mediaResult.data) refreshed.set(mediaPath, mediaResult.data)
      else missing.push(mediaPath)
    })
    const hydratedData: ProjectData = {
      ...result.data,
      clips: result.data.clips.map((clip) => ({
        ...clip,
        mediaInfo: refreshed.get(clip.filePath) || clip.mediaInfo
      }))
    }
    get().restoreProjectData(hydratedData, filePath)
    void mapWithConcurrency(uniquePaths, 2, async (mediaPath) => {
      if (!refreshed.has(mediaPath)) return
      const playback = await window.api.preparePlayback(mediaPath).catch(() => ({ success: false }))
      set((state) => {
        const clips = state.clips.map((clip) => clip.filePath === mediaPath
          ? { ...clip, mediaInfo: applyPlaybackResult(clip.mediaInfo, mediaPath, playback) }
          : clip)
        const selected = clips.find((clip) => clip.id === state.selectedClipId)
        return {
          clips,
          mediaInfo: selected?.filePath === mediaPath ? selected.mediaInfo : state.mediaInfo,
          projectDirty: state.projectDirty
        }
      })
    }).catch(() => {})
    await get().clearAutosave().catch(() => {})
    await get().refreshRecentProjects().catch(() => {})
    get().showToast(translate('项目已打开', 'Project opened'), 'success')
    if (missing.length > 0) {
      set({ missingMediaPaths: missing, projectDirty: false })
      get().showToast(translate(
        `项目已打开，但有 ${missing.length} 个素材无法访问，请重新定位素材`,
        `Project opened, but ${missing.length} media file(s) are unavailable. Relink them to continue.`
      ), 'error')
    }
      return true
    } catch (error) {
      get().showToast(translate(
        `项目打开失败：${error instanceof Error ? error.message : '未知错误'}`,
        `Could not open project: ${error instanceof Error ? error.message : 'Unknown error'}`
      ), 'error')
      return false
    }
  },

  refreshRecentProjects: async () => {
    try {
      const recentProjects = await window.api.getRecentProjects()
      set({ recentProjects })
    } catch (error) {
      console.error('Failed to refresh recent projects:', error)
    }
  },

  removeRecentProject: async (filePath) => {
    try {
      const recentProjects = await window.api.removeRecentProject(filePath)
      set({ recentProjects })
    } catch (error) {
      get().showToast(error instanceof Error ? error.message : translate('移除最近项目失败', 'Could not remove recent project'), 'error')
    }
  },

  restoreProjectData: (data, filePath = null) => {
    pendingHistoryTransaction = null
    const normalized = normalizeProjectData(data)
    const selectedClipId = normalized.clips[0]?.id ?? null
    const selectedClip = getSelectedClip(normalized.clips, selectedClipId)
    const timelineDuration = getTimelineDuration(normalized.clips, normalized.operationsByClip)
    set({
      clips: normalized.clips,
      transitions: normalized.transitions || [],
      audioFades: normalized.audioFades || [],
      selectedClipId,
      selectedClipIds: selectedClipId ? [selectedClipId] : [],
      lastSelectedClipId: selectedClipId,
      linkedGroups: normalized.linkedGroups,
      clipboard: null,
      historyPast: [],
      historyFuture: [],
      timelineDuration,
      videoTrackCount: normalized.videoTrackCount,
      audioTrackCount: normalized.audioTrackCount,
      projectSettings: normalized.projectSettings,
      projectFilePath: filePath,
      projectDirty: false,
      documentRevision: 0,
      sourceFile: selectedClip?.filePath ?? null,
      mediaInfo: selectedClip?.mediaInfo ?? null,
      loading: false,
      error: null,
      operations: selectedClip ? (normalized.operationsByClip[selectedClip.id] || []) : [],
      operationsByClip: normalized.operationsByClip,
      currentTime: clampTimelineTime(normalized.currentTime, timelineDuration),
      playing: false,
      duration: selectedClip?.duration ?? 0,
      exporting: false,
      exportProgress: null,
      merging: false,
      missingMediaPaths: []
    })
    setDocumentTitle(selectedClip?.filePath ?? null, normalized.clips.length)
  },

  recoverAutosave: async (data) => {
    const uniquePaths = Array.from(new Set(data.clips.map((clip) => clip.filePath)))
    const refreshed = new Map<string, MediaInfo>()
    const missing: string[] = []
    await mapWithConcurrency(uniquePaths, 3, async (mediaPath) => {
      const mediaResult = await window.api.getMediaInfo(mediaPath)
      if (mediaResult.success && mediaResult.data) refreshed.set(mediaPath, mediaResult.data)
      else missing.push(mediaPath)
    })
    const hydratedData: ProjectData = {
      ...data,
      clips: data.clips.map((clip) => ({
        ...clip,
        mediaInfo: refreshed.get(clip.filePath) || clip.mediaInfo
      }))
    }
    get().restoreProjectData(hydratedData, null)
    set({ projectDirty: true, documentRevision: 1, autosaveReady: true })
    void mapWithConcurrency(uniquePaths, 2, async (mediaPath) => {
      if (!refreshed.has(mediaPath)) return
      const playback = await window.api.preparePlayback(mediaPath).catch(() => ({ success: false }))
      set((state) => {
        const clips = state.clips.map((clip) => clip.filePath === mediaPath
          ? { ...clip, mediaInfo: applyPlaybackResult(clip.mediaInfo, mediaPath, playback) }
          : clip)
        const selected = clips.find((clip) => clip.id === state.selectedClipId)
        return {
          clips,
          mediaInfo: selected?.filePath === mediaPath ? selected.mediaInfo : state.mediaInfo,
          projectDirty: state.projectDirty
        }
      })
    }).catch(() => {})
    get().showToast(translate('已恢复自动保存项目', 'Autosaved project restored'), 'success')
    if (missing.length > 0) {
      set({ missingMediaPaths: missing, projectDirty: true })
      get().showToast(translate(
        `已恢复项目，但有 ${missing.length} 个素材需要重新定位`,
        `Project restored, but ${missing.length} media file(s) need to be relinked`
      ), 'error')
    }
  },

  relinkMissingMedia: async () => {
    const currentState = get()
    const oldPath = currentState.missingMediaPaths[0]
    if (!oldPath) return false
    const affectedClips = currentState.clips.filter((clip) => clip.filePath === oldPath)
    if (affectedClips.length === 0) {
      set({ missingMediaPaths: currentState.missingMediaPaths.filter((item) => item !== oldPath) })
      return false
    }
    const replacement = await window.api.openFile()
    if (!replacement) return false
    const result = await window.api.getMediaInfo(replacement)
    if (!result.success || !result.data) {
      get().showToast(translate(`素材重新定位失败：${result.error || '无法读取文件'}`, `Media relink failed: ${result.error || 'Could not read file'}`), 'error')
      return false
    }
    const replacementInfo = result.data
    if (affectedClips.some((clip) => clip.track === 'video') && !replacementInfo.hasVideo) {
      get().showToast(translate('所选文件不包含原片段需要的视频流', 'The selected file does not contain the required video stream'), 'error')
      return false
    }
    if (affectedClips.some((clip) => clip.track === 'audio') && !replacementInfo.hasAudio) {
      get().showToast(translate('所选文件不包含原片段需要的音频流', 'The selected file does not contain the required audio stream'), 'error')
      return false
    }
    const affectedIds = new Set(affectedClips.map((clip) => clip.id))
    set((state) => {
      const clips = state.clips.map((clip) => {
        if (clip.filePath !== oldPath) return clip
        const duration = replacementInfo.duration
        return {
          ...clip,
          filePath: replacement,
          duration,
          trimBoundStart: 0,
          trimBoundEnd: duration,
          mediaInfo: replacementInfo
        }
      })
      const operationsByClip = { ...state.operationsByClip }
      clips.forEach((clip) => {
        if (!affectedIds.has(clip.id)) return
        operationsByClip[clip.id] = (operationsByClip[clip.id] || createDefaultOperations(clip.duration)).map((operation) =>
          operation.type === 'trim'
            ? {
                ...operation,
                enabled: true,
                params: {
                  startTime: Math.min((operation.params as TrimParams).startTime, clip.duration),
                  endTime: Math.min((operation.params as TrimParams).endTime, clip.duration)
                }
              }
            : operation
        )
      })
      return {
        clips,
        operationsByClip,
        missingMediaPaths: state.missingMediaPaths.filter((item) => item !== oldPath),
        timelineDuration: getTimelineDuration(clips, operationsByClip),
        sourceFile: state.sourceFile === oldPath ? replacement : state.sourceFile,
        mediaInfo: state.sourceFile === oldPath ? replacementInfo : state.mediaInfo,
        operations: state.selectedClipId ? (operationsByClip[state.selectedClipId] || state.operations) : state.operations,
        historyPast: appendHistory(state.historyPast, takeSnapshot(state)),
        historyFuture: []
      }
    })
    const playback = await window.api.preparePlayback(replacement).catch(() => ({ success: false }))
    set((state) => {
      const clips = state.clips.map((clip) => affectedIds.has(clip.id)
        ? { ...clip, mediaInfo: applyPlaybackResult(clip.mediaInfo, replacement, playback) }
        : clip)
      const selected = clips.find((clip) => clip.id === state.selectedClipId)
      return {
        clips,
        mediaInfo: selected && affectedIds.has(selected.id) ? selected.mediaInfo : state.mediaInfo,
        projectDirty: state.projectDirty
      }
    })
    if (!playback.success) get().showToast(translate('素材已定位，但兼容代理生成失败', 'Media relinked, but compatible proxy generation failed'), 'error')
    else get().showToast(translate('素材已重新定位', 'Media relinked'), 'success')
    return true
  },

  buildProjectData: () => buildProjectData(get()),

  autosaveNow: async () => {
    const state = get()
    if (state.clips.length === 0) return
    const result = await window.api.saveAutosave(buildProjectData(state))
    if (!result.success) throw new Error(result.error || translate('自动保存失败', 'Autosave failed'))
    set({ autosaveReady: true })
  },

  clearAutosave: async () => {
    const result = await window.api.clearAutosave()
    if (!result.success) throw new Error(result.error || translate('清除自动保存失败', 'Could not clear autosave'))
    set({ autosaveReady: false })
  },

  markProjectDirty: () => set({ projectDirty: true }),

  getClipTrim: (clipId: string) => {
    const { clips, operationsByClip } = get()
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return { trimStart: 0, trimEnd: 0 }
    return getClipTrimValues(clip, operationsByClip)
  },

  getAudioOperationsForSelection: () => {
    const { clips, linkedGroups, selectedClipId, operationsByClip, operations } = get()
    const targetId = getLinkedAudioClipId(clips, linkedGroups, selectedClipId)
    if (!targetId) return EMPTY_MEDIA_OPERATIONS
    if (targetId === selectedClipId) return operations
    return operationsByClip[targetId] || EMPTY_MEDIA_OPERATIONS
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
    pendingHistoryTransaction = null
    cancelToastTimer()
    set({
      clips: [],
      transitions: [],
      audioFades: [],
      selectedTransitionId: null,
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
      projectSettings: createDefaultProjectSettings(),
      projectFilePath: null,
      projectDirty: false,
      documentRevision: 0,
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
      missingMediaPaths: []
    })
    setDocumentTitle(null, 0)
  }
  })
})
