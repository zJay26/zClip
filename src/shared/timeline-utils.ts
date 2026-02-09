// ============================================================
// Timeline utils — shared time model helpers
// ============================================================

import type { MediaOperation, SpeedParams, TrimParams, TimelineClip } from './types'

export interface ClipTimelineRange {
  trimStart: number
  trimEnd: number
  speedRate: number
  visibleDuration: number
  start: number
  end: number
}

export function getTrimParams(
  duration: number,
  operations?: MediaOperation[]
): { trimStart: number; trimEnd: number } {
  const trimOp = operations?.find((op) => op.type === 'trim' && op.enabled)
  if (!trimOp) {
    return { trimStart: 0, trimEnd: duration }
  }
  const params = trimOp.params as TrimParams
  const trimStart = Math.max(0, Math.min(params.startTime, duration))
  const trimEnd = Math.max(trimStart, Math.min(params.endTime, duration))
  return { trimStart, trimEnd }
}

export function getSpeedRate(operations?: MediaOperation[]): number {
  const speedOp = operations?.find((op) => op.type === 'speed' && op.enabled)
  const rate = speedOp ? (speedOp.params as SpeedParams).rate : 1.0
  return rate > 0 ? rate : 1.0
}

export function getVisibleDurationFromOps(
  duration: number,
  operations?: MediaOperation[]
): number {
  const { trimStart, trimEnd } = getTrimParams(duration, operations)
  const speedRate = getSpeedRate(operations)
  const trimmed = Math.max(0, trimEnd - trimStart)
  return trimmed / speedRate
}

export function getClipVisibleDuration(
  clip: TimelineClip,
  operationsByClip?: Record<string, MediaOperation[]>
): number {
  const ops = operationsByClip?.[clip.id] || []
  return getVisibleDurationFromOps(clip.duration, ops)
}

export function getClipTimelineRange(
  clip: TimelineClip,
  operationsByClip?: Record<string, MediaOperation[]>
): ClipTimelineRange {
  const ops = operationsByClip?.[clip.id] || []
  const { trimStart, trimEnd } = getTrimParams(clip.duration, ops)
  const speedRate = getSpeedRate(ops)
  const visibleDuration = Math.max(0, trimEnd - trimStart) / speedRate
  const start = clip.startTime
  const end = start + visibleDuration
  return { trimStart, trimEnd, speedRate, visibleDuration, start, end }
}

export function timelineTimeToMediaTime(
  clip: TimelineClip,
  operationsByClip: Record<string, MediaOperation[]>,
  timelineTime: number
): number {
  const range = getClipTimelineRange(clip, operationsByClip)
  const local = range.trimStart + (timelineTime - range.start) * range.speedRate
  return Math.min(range.trimEnd, Math.max(range.trimStart, local))
}

export function mediaTimeToTimelineTime(
  clip: TimelineClip,
  operationsByClip: Record<string, MediaOperation[]>,
  mediaTime: number
): number {
  const range = getClipTimelineRange(clip, operationsByClip)
  return range.start + (mediaTime - range.trimStart) / range.speedRate
}

export function getTimelineDuration(
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>
): number {
  return clips.reduce((max, clip) => {
    const duration = getClipVisibleDuration(clip, operationsByClip)
    return Math.max(max, clip.startTime + duration)
  }, 0)
}
