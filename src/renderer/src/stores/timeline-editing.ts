import type { MediaOperation, TimelineClip } from '../../../shared/types'
import { getClipTimelineRange } from '../../../shared/timeline-utils'

export interface TimeInterval { start: number; end: number }
const EPSILON = 1e-6

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  const merged: TimeInterval[] = []
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    if (interval.end - interval.start <= EPSILON) continue
    const previous = merged[merged.length - 1]
    if (previous && interval.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ start: interval.start, end: interval.end })
    }
  }
  return merged
}

/** Only remove time that is empty on every track, preserving audio/video sync. */
export function findEmptyIntervals(
  clips: TimelineClip[],
  operations: Record<string, MediaOperation[]>,
  candidates?: TimeInterval[]
): TimeInterval[] {
  const occupied = mergeIntervals(clips.map((clip) => getClipTimelineRange(clip, operations)))
  const ranges = candidates
    ? mergeIntervals(candidates)
    : [{ start: 0, end: occupied[occupied.length - 1]?.end ?? 0 }]
  const gaps: TimeInterval[] = []
  let occupiedIndex = 0
  for (const range of ranges) {
    let cursor = range.start
    while (occupiedIndex < occupied.length && occupied[occupiedIndex].end <= cursor) occupiedIndex++
    for (let index = occupiedIndex; index < occupied.length; index++) {
      const interval = occupied[index]
      if (interval.start >= range.end) break
      if (interval.start > cursor + EPSILON) gaps.push({ start: cursor, end: interval.start })
      cursor = Math.max(cursor, interval.end)
      if (cursor >= range.end) break
    }
    if (range.end > cursor + EPSILON) gaps.push({ start: cursor, end: range.end })
  }
  return gaps
}

export function createGapTimeMapper(intervals: TimeInterval[]): (time: number) => number {
  const prefix = [0]
  intervals.forEach((interval, index) => prefix.push(prefix[index] + interval.end - interval.start))
  return (time) => {
    let low = 0
    let high = intervals.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (intervals[mid].end <= time) low = mid + 1
      else high = mid
    }
    const partial = low < intervals.length ? Math.max(0, time - intervals[low].start) : 0
    return Math.max(0, time - prefix[low] - partial)
  }
}

export function getAdjacentClipBoundary(
  clips: TimelineClip[], operations: Record<string, MediaOperation[]>,
  time: number, direction: -1 | 1, frameRate: number
): number {
  const tolerance = 0.5 / frameRate
  const boundaries = clips.flatMap((clip) => {
    const range = getClipTimelineRange(clip, operations)
    return [range.start, range.end]
  })
  if (direction < 0) return Math.max(0, ...boundaries.filter((boundary) => boundary < time - tolerance))
  const after = boundaries.filter((boundary) => boundary > time + tolerance)
  return after.length ? Math.min(...after) : Math.max(0, ...boundaries)
}
