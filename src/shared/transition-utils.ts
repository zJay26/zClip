import type { MediaOperation, TimelineClip, TimelineTransition } from './types'
import { getClipTimelineRange } from './timeline-utils'
import type { ClipTimelineRange } from './timeline-utils'

/**
 * Timeline positions are stored as floating point seconds. Clips that were
 * snapped to the same edit point can still differ by a tiny rounding error.
 */
export const TRANSITION_CUT_EPSILON = 0.002
export const MIN_TRANSITION_SIDE_DURATION = 0.08

export interface TransitionCut {
  left: TimelineClip
  right: TimelineClip
  leftRange: ClipTimelineRange
  rightRange: ClipTimelineRange
  boundary: number
  trackIndex: number
}

export interface TimelineTransitionTiming extends TransitionCut {
  transition: TimelineTransition
  start: number
  end: number
  duration: number
  boundaryProgress: number
}

export interface NormalizeTimelineTransitionOptions {
  /** Transition currently being resized/replaced. Neighbor lengths stay fixed. */
  editedTransitionId?: string
  preserveNeighborDurations?: boolean
}

function isEligibleVideoClip(clip: TimelineClip): boolean {
  return clip.track === 'video' && clip.mediaInfo.hasVideo
}

/**
 * Returns only real edit points: consecutive visible video clips on the same
 * track whose edges touch. Gaps, overlaps and cross-track pairs are excluded.
 */
export function getEligibleTransitionCuts(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  trackIndex?: number
): TransitionCut[] {
  const clipsByTrack = new Map<number, Array<{ clip: TimelineClip; range: ClipTimelineRange }>>()

  clips.forEach((clip) => {
    if (!isEligibleVideoClip(clip) || (trackIndex !== undefined && clip.trackIndex !== trackIndex)) return
    const range = getClipTimelineRange(clip, operationsByClip)
    if (range.visibleDuration < MIN_TRANSITION_SIDE_DURATION) return
    const entries = clipsByTrack.get(clip.trackIndex)
    const entry = { clip, range }
    if (entries) entries.push(entry)
    else clipsByTrack.set(clip.trackIndex, [entry])
  })

  const cuts: TransitionCut[] = []
  clipsByTrack.forEach((entries, currentTrackIndex) => {
    entries.sort((a, b) => a.range.start - b.range.start || a.clip.id.localeCompare(b.clip.id))
    for (let index = 0; index < entries.length - 1; index += 1) {
      const left = entries[index]
      const right = entries[index + 1]
      const gap = right.range.start - left.range.end
      if (Math.abs(gap) > TRANSITION_CUT_EPSILON) continue
      const boundary = (left.range.end + right.range.start) / 2
      if (
        boundary - left.range.start < MIN_TRANSITION_SIDE_DURATION ||
        right.range.end - boundary < MIN_TRANSITION_SIDE_DURATION
      ) continue
      cuts.push({
        left: left.clip,
        right: right.clip,
        leftRange: left.range,
        rightRange: right.range,
        boundary,
        trackIndex: currentTrackIndex
      })
    }
  })

  return cuts.sort((a, b) => a.boundary - b.boundary || a.trackIndex - b.trackIndex)
}

export function findTransitionCut(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  leftClipId: string,
  rightClipId: string
): TransitionCut | null {
  return getEligibleTransitionCuts(clips, operationsByClip).find(
    (cut) => cut.left.id === leftClipId && cut.right.id === rightClipId
  ) ?? null
}

export function clampTimelineTransition(
  transition: TimelineTransition,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): TimelineTransition | null {
  const cut = findTransitionCut(
    clips,
    operationsByClip,
    transition.leftClipId,
    transition.rightClipId
  )
  if (!cut) return null

  const leftCapacity = cut.boundary - cut.leftRange.start
  const rightCapacity = cut.rightRange.end - cut.boundary
  if (
    leftCapacity < MIN_TRANSITION_SIDE_DURATION ||
    rightCapacity < MIN_TRANSITION_SIDE_DURATION
  ) return null

  const rawStart = Number.isFinite(transition.startOffset)
    ? transition.startOffset
    : -MIN_TRANSITION_SIDE_DURATION
  const rawEnd = Number.isFinite(transition.endOffset)
    ? transition.endOffset
    : MIN_TRANSITION_SIDE_DURATION
  const startOffset = Math.max(
    -leftCapacity,
    Math.min(-MIN_TRANSITION_SIDE_DURATION, rawStart)
  )
  const endOffset = Math.max(
    MIN_TRANSITION_SIDE_DURATION,
    Math.min(rightCapacity, rawEnd)
  )

  return { ...transition, startOffset, endOffset }
}

export function normalizeTimelineTransitions(
  transitions: TimelineTransition[] | undefined,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  options?: NormalizeTimelineTransitionOptions
): TimelineTransition[] {
  const seenIds = new Set<string>()
  const seenPairs = new Set<string>()
  const normalized: TimelineTransition[] = []

  for (const transition of transitions ?? []) {
    if (seenIds.has(transition.id)) continue
    const clamped = clampTimelineTransition(transition, clips, operationsByClip)
    if (!clamped) continue
    const pair = `${clamped.leftClipId}\0${clamped.rightClipId}`
    if (seenPairs.has(pair)) continue
    seenIds.add(clamped.id)
    seenPairs.add(pair)
    normalized.push(clamped)
  }

  // A middle clip can own an incoming transition at its head and an outgoing
  // transition at its tail. Their occupied regions must never overlap: the
  // preview can only show one well-defined effect for any track and instant.
  const incomingByClip = new Map<string, number>()
  const outgoingByClip = new Map<string, number>()
  normalized.forEach((transition, index) => {
    incomingByClip.set(transition.rightClipId, index)
    outgoingByClip.set(transition.leftClipId, index)
  })
  const droppedIds = new Set<string>()
  const epsilon = 0.0005

  for (const clip of clips) {
    const incomingIndex = incomingByClip.get(clip.id)
    const outgoingIndex = outgoingByClip.get(clip.id)
    if (incomingIndex === undefined || outgoingIndex === undefined) continue
    const incoming = normalized[incomingIndex]
    const outgoing = normalized[outgoingIndex]
    if (
      incoming.id === outgoing.id ||
      droppedIds.has(incoming.id) ||
      droppedIds.has(outgoing.id)
    ) continue

    const capacity = getClipTimelineRange(clip, operationsByClip).visibleDuration
    if (capacity + epsilon < MIN_TRANSITION_SIDE_DURATION * 2) {
      const editedId = options?.editedTransitionId
      droppedIds.add(
        editedId === incoming.id || editedId === outgoing.id
          ? editedId
          : outgoing.id
      )
      continue
    }

    const incomingExtent = incoming.endOffset
    const outgoingExtent = -outgoing.startOffset
    if (incomingExtent + outgoingExtent <= capacity + epsilon) continue

    if (options?.preserveNeighborDurations && options.editedTransitionId === incoming.id) {
      const available = capacity - outgoingExtent
      if (available + epsilon < MIN_TRANSITION_SIDE_DURATION) {
        droppedIds.add(incoming.id)
        continue
      }
      normalized[incomingIndex] = {
        ...incoming,
        endOffset: Math.max(MIN_TRANSITION_SIDE_DURATION, available)
      }
      continue
    }
    if (options?.preserveNeighborDurations && options.editedTransitionId === outgoing.id) {
      const available = capacity - incomingExtent
      if (available + epsilon < MIN_TRANSITION_SIDE_DURATION) {
        droppedIds.add(outgoing.id)
        continue
      }
      normalized[outgoingIndex] = {
        ...outgoing,
        startOffset: -Math.max(MIN_TRANSITION_SIDE_DURATION, available)
      }
      continue
    }

    const incomingExtra = Math.max(0, incomingExtent - MIN_TRANSITION_SIDE_DURATION)
    const outgoingExtra = Math.max(0, outgoingExtent - MIN_TRANSITION_SIDE_DURATION)
    const totalExtra = incomingExtra + outgoingExtra
    const availableExtra = Math.max(0, capacity - MIN_TRANSITION_SIDE_DURATION * 2)
    const scale = totalExtra > epsilon ? Math.min(1, availableExtra / totalExtra) : 0
    normalized[incomingIndex] = {
      ...incoming,
      endOffset: MIN_TRANSITION_SIDE_DURATION + incomingExtra * scale
    }
    normalized[outgoingIndex] = {
      ...outgoing,
      startOffset: -(MIN_TRANSITION_SIDE_DURATION + outgoingExtra * scale)
    }
  }

  return normalized.filter((transition) => !droppedIds.has(transition.id))
}

export function getTimelineTransitionTiming(
  transition: TimelineTransition,
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): TimelineTransitionTiming | null {
  const clamped = clampTimelineTransition(transition, clips, operationsByClip)
  if (!clamped) return null
  const cut = findTransitionCut(clips, operationsByClip, clamped.leftClipId, clamped.rightClipId)
  if (!cut) return null

  const start = cut.boundary + clamped.startOffset
  const end = cut.boundary + clamped.endOffset
  const duration = end - start
  if (!Number.isFinite(duration) || duration <= 0) return null

  return {
    ...cut,
    transition: clamped,
    start,
    end,
    duration,
    boundaryProgress: (cut.boundary - start) / duration
  }
}

/**
 * Keeps both sources continuous with ordinary timeline playback. When a clip
 * has no media handle beyond its edit point, its edge frame is held instead
 * of remapping a whole source segment and jumping at transition entry/exit.
 */
export function transitionTimelineTimeToMediaTime(
  timing: TimelineTransitionTiming,
  side: 'left' | 'right',
  timelineTime: number
): number {
  const progress = Math.max(0, Math.min(1, (timelineTime - timing.start) / timing.duration))
  const range = side === 'left' ? timing.leftRange : timing.rightRange
  const clip = side === 'left' ? timing.left : timing.right
  const editMediaTime = side === 'left' ? range.trimEnd : range.trimStart
  const sourceStart = Math.max(0, Math.min(clip.trimBoundStart ?? 0, clip.duration))
  const sourceEnd = Math.max(
    sourceStart,
    Math.min(clip.trimBoundEnd ?? clip.duration, clip.duration)
  )
  const clampToSource = (mediaTime: number): number =>
    Math.max(sourceStart, Math.min(sourceEnd, mediaTime))

  // Keep the ordinary frame at effect entry/exit, then distribute every
  // available source frame continuously across the transition. Real media
  // handles are used when present. If an imported clip starts/ends exactly at
  // the edit, the shorter available span is played more slowly instead of
  // freezing one decoder for half of the effect and visibly pausing at the cut.
  const startMediaTime = clampToSource(
    editMediaTime + timing.transition.startOffset * range.speedRate
  )
  const endMediaTime = clampToSource(
    editMediaTime + timing.transition.endOffset * range.speedRate
  )
  return startMediaTime + (endMediaTime - startMediaTime) * progress
}
