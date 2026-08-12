import type {
  MediaOperation,
  FadeParams,
  PitchParams,
  ProjectData,
  ProjectSettings,
  SpeedParams,
  TimelineClip,
  TransformParams,
  TrimParams,
  VolumeParams
} from '../../../shared/types'
import { translate } from '../contexts/preferences'
import {
  getClipTimelineRange,
  getTimelineDuration as getTimelineDurationShared
} from '../../../shared/timeline-utils'
import { uid } from '../lib/utils'
import type { ProjectSnapshot, ProjectStore } from './project-store-types'

export function createDefaultOperations(duration: number): MediaOperation[] {
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
    },
    {
      id: uid(),
      type: 'transform',
      enabled: true,
      params: {
        fit: 'contain',
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
        opacity: 100,
        flipX: false,
        flipY: false
      } as TransformParams
    },
    {
      id: uid(),
      type: 'fade',
      enabled: false,
      params: { fadeIn: 0, fadeOut: 0 } as FadeParams
    }
  ]
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    frameRate: 30,
    canvas: {
      preset: 'source',
      width: 1920,
      height: 1080,
      backgroundColor: '#000000'
    }
  }
}

export function buildProjectData(state: ProjectStore): ProjectData {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    clips: structuredClone(state.clips),
    operationsByClip: structuredClone(state.operationsByClip),
    transitions: structuredClone(state.transitions),
    audioFades: structuredClone(state.audioFades),
    linkedGroups: { ...state.linkedGroups },
    videoTrackCount: state.videoTrackCount,
    audioTrackCount: state.audioTrackCount,
    currentTime: state.currentTime,
    projectSettings: structuredClone(state.projectSettings)
  }
}

export function getTimelineDuration(
  clips: TimelineClip[],
  operationsByClip?: Record<string, MediaOperation[]>
): number {
  return getTimelineDurationShared(clips, operationsByClip || {})
}

export function clampTimelineTime(time: number, timelineDuration: number): number {
  if (timelineDuration <= 0) return 0
  return Math.max(0, Math.min(time, timelineDuration - 0.0001))
}

export function getClipTrimBounds(clip: TimelineClip): { min: number; max: number } {
  const min = Math.max(0, Math.min(clip.trimBoundStart ?? 0, clip.duration))
  const max = Math.max(min, Math.min(clip.trimBoundEnd ?? clip.duration, clip.duration))
  return { min, max }
}

export function getClipTrimValues(
  clip: TimelineClip,
  operationsByClip?: Record<string, MediaOperation[]>
): { trimStart: number; trimEnd: number } {
  const range = getClipTimelineRange(clip, operationsByClip)
  return { trimStart: range.trimStart, trimEnd: range.trimEnd }
}

export function getSelectedClip(
  clips: TimelineClip[],
  selectedClipId: string | null
): TimelineClip | null {
  if (!selectedClipId) return null
  return clips.find((clip) => clip.id === selectedClipId) || null
}

export function getLinkedAudioClipId(
  clips: TimelineClip[],
  linkedGroups: Record<string, boolean>,
  selectedClipId: string | null
): string | null {
  if (!selectedClipId) return null
  const selected = clips.find((clip) => clip.id === selectedClipId)
  if (!selected) return null
  if (selected.track === 'audio') return selected.id
  const canUseEmbeddedAudio = selected.mediaInfo.hasAudio && selected.embeddedAudioEnabled !== false
  const isLinked = linkedGroups[selected.groupId] !== false
  if (!isLinked) return canUseEmbeddedAudio ? selected.id : null
  const audioClip = clips.find((clip) => clip.groupId === selected.groupId && clip.track === 'audio')
  return audioClip?.id || (canUseEmbeddedAudio ? selected.id : null)
}

export function takeSnapshot(state: ProjectStore): ProjectSnapshot {
  return {
    clips: structuredClone(state.clips),
    operationsByClip: structuredClone(state.operationsByClip),
    transitions: structuredClone(state.transitions),
    audioFades: structuredClone(state.audioFades),
    selectedTransitionId: state.selectedTransitionId,
    selectedClipId: state.selectedClipId,
    selectedClipIds: [...state.selectedClipIds],
    lastSelectedClipId: state.lastSelectedClipId,
    linkedGroups: { ...state.linkedGroups },
    timelineDuration: state.timelineDuration,
    videoTrackCount: state.videoTrackCount,
    audioTrackCount: state.audioTrackCount,
    currentTime: state.currentTime,
    projectSettings: structuredClone(state.projectSettings)
  }
}

export function applySnapshot(
  state: ProjectStore,
  snapshot: ProjectSnapshot
): Partial<ProjectStore> {
  const selectedClip = getSelectedClip(snapshot.clips, snapshot.selectedClipId)
  const selectedTransition = snapshot.selectedTransitionId
    ? snapshot.transitions.find((transition) => transition.id === snapshot.selectedTransitionId)
    : undefined
  const transitionClips = selectedTransition
    ? snapshot.clips.filter((clip) =>
        clip.id === selectedTransition.leftClipId || clip.id === selectedTransition.rightClipId
      )
    : []
  const activeClip = selectedClip ||
    transitionClips.find((clip) => clip.filePath === state.sourceFile) ||
    transitionClips[0]
  return {
    clips: snapshot.clips,
    operationsByClip: snapshot.operationsByClip,
    transitions: snapshot.transitions,
    audioFades: snapshot.audioFades,
    selectedTransitionId: snapshot.selectedTransitionId && snapshot.transitions.some(
      (transition) => transition.id === snapshot.selectedTransitionId
    ) ? snapshot.selectedTransitionId : null,
    selectedClipId: snapshot.selectedClipId,
    selectedClipIds: snapshot.selectedClipIds,
    lastSelectedClipId: snapshot.lastSelectedClipId,
    linkedGroups: snapshot.linkedGroups,
    timelineDuration: snapshot.timelineDuration,
    videoTrackCount: snapshot.videoTrackCount,
    audioTrackCount: snapshot.audioTrackCount,
    currentTime: snapshot.currentTime,
    projectSettings: structuredClone(snapshot.projectSettings),
    sourceFile: activeClip?.filePath ?? null,
    mediaInfo: activeClip?.mediaInfo ?? null,
    duration: activeClip?.duration ?? 0,
    operations: selectedClip ? (snapshot.operationsByClip[selectedClip.id] || []) : [],
    playing: false
  }
}

export function getOrderedClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime
    if (a.track !== b.track) return a.track === 'video' ? -1 : 1
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
    return a.id.localeCompare(b.id)
  })
}

export function setDocumentTitle(filePath: string | null, totalClips: number): void {
  if (!filePath) {
    document.title = 'zClip'
    return
  }
  const fileName = filePath.split(/[\\/]/).pop() || 'zClip'
  const suffix = totalClips > 1 ? translate(` · ${totalClips} 段`, ` · ${totalClips} clips`) : ''
  document.title = `${fileName}${suffix} — zClip`
}
