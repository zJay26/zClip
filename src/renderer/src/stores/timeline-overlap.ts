import type { MediaOperation, TimelineClip } from '../../../shared/types'
import { getClipVisibleDuration } from '../../../shared/timeline-utils'

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

export function resolveClipOverlaps(
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
