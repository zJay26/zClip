// ============================================================
// useSnap — 磁吸引擎
// 收集所有 snap 点，阈值判定，返回吸附结果
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { SNAP_THRESHOLD_PX } from './timeline-constants'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'

export interface SnapResult {
  /** The snapped time (or original time if no snap) */
  time: number
  /** Whether a snap occurred */
  snapped: boolean
}

export interface SnapEngine {
  /** Check if a time should snap, returns snapped time */
  checkSnap: (time: number, pixelsPerSecond: number, excludeClipId?: string) => SnapResult
  /** Check snap for moving clip (start/end edges) */
  checkMoveSnap: (startTime: number, duration: number, pixelsPerSecond: number, excludeClipId?: string) => SnapResult
  /** Current visible snap line position (time), or null */
  snapLineTime: number | null
  /** Clear snap line */
  clearSnapLine: () => void
}

export function useSnap(): SnapEngine {
  const { clips, currentTime, operationsByClip } = useProjectStore()
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null)
  const [lockedSnapTime, setLockedSnapTime] = useState<number | null>(null)

  // Collect all snap points: clip edges + playhead
  const snapPoints = useMemo(() => {
    const points: number[] = [currentTime]

    for (const clip of clips) {
      const range = getClipTimelineRange(clip, operationsByClip)
      points.push(range.start, range.end)
    }

    // Deduplicate & sort
    return points.filter((point, idx, list) => list.indexOf(point) === idx).sort((a, b) => a - b)
  }, [clips, currentTime, operationsByClip])

  const getFilteredPoints = useCallback(
    (excludeClipId?: string): number[] => {
      let filteredPoints = snapPoints
      if (excludeClipId) {
        const clip = clips.find((c) => c.id === excludeClipId)
        if (clip) {
          const range = getClipTimelineRange(clip, operationsByClip)
          filteredPoints = snapPoints.filter(
            (p) => Math.abs(p - range.start) > 0.001 && Math.abs(p - range.end) > 0.001
          )
        }
      }
      return filteredPoints
    },
    [snapPoints, clips, operationsByClip]
  )

  const checkSnap = useCallback(
    (time: number, pixelsPerSecond: number, excludeClipId?: string): SnapResult => {
      const enterThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond
      const exitThreshold = (SNAP_THRESHOLD_PX * 1.5) / pixelsPerSecond
      const filteredPoints = getFilteredPoints(excludeClipId)

      let bestDist = Infinity
      let bestTime = time

      for (const point of filteredPoints) {
        const dist = Math.abs(time - point)
        if (dist < enterThreshold && dist < bestDist) {
          bestDist = dist
          bestTime = point
        }
      }

      const hasCandidate = bestDist < enterThreshold

      if (lockedSnapTime !== null) {
        const lockedDist = Math.abs(time - lockedSnapTime)
        const canSwitch = hasCandidate && bestTime !== lockedSnapTime && bestDist <= lockedDist + 1e-6
        if (canSwitch) {
          setLockedSnapTime(bestTime)
          setSnapLineTime(bestTime)
          return { time: bestTime, snapped: true }
        }
        if (lockedDist <= exitThreshold) {
          setSnapLineTime(lockedSnapTime)
          return { time: lockedSnapTime, snapped: true }
        }
        setLockedSnapTime(null)
      }

      if (hasCandidate) {
        setLockedSnapTime(bestTime)
        setSnapLineTime(bestTime)
        return { time: bestTime, snapped: true }
      }

      setSnapLineTime(null)
      return { time, snapped: false }
    },
    [getFilteredPoints, lockedSnapTime]
  )

  const checkMoveSnap = useCallback(
    (startTime: number, duration: number, pixelsPerSecond: number, excludeClipId?: string): SnapResult => {
      const enterThreshold = SNAP_THRESHOLD_PX / pixelsPerSecond
      const exitThreshold = (SNAP_THRESHOLD_PX * 1.5) / pixelsPerSecond
      const filteredPoints = getFilteredPoints(excludeClipId)
      const endTime = startTime + duration

      let bestDist = Infinity
      let bestTime = startTime
      let bestIsEnd = false

      for (const point of filteredPoints) {
        const distStart = Math.abs(startTime - point)
        if (distStart < enterThreshold && distStart < bestDist) {
          bestDist = distStart
          bestTime = point
          bestIsEnd = false
        }
        const distEnd = Math.abs(endTime - point)
        if (distEnd < enterThreshold && distEnd < bestDist) {
          bestDist = distEnd
          bestTime = point
          bestIsEnd = true
        }
      }

      const hasCandidate = bestDist < enterThreshold

      if (lockedSnapTime !== null) {
        const distStart = Math.abs(startTime - lockedSnapTime)
        const distEnd = Math.abs(endTime - lockedSnapTime)
        const lockedDist = Math.min(distStart, distEnd)
        const canSwitch = hasCandidate && bestTime !== lockedSnapTime && bestDist <= lockedDist + 1e-6
        if (canSwitch) {
          setLockedSnapTime(bestTime)
          setSnapLineTime(bestTime)
          const nextStart = bestIsEnd ? bestTime - duration : bestTime
          return { time: nextStart, snapped: true }
        }
        if (lockedDist <= exitThreshold) {
          const nextStart = distEnd < distStart ? lockedSnapTime - duration : lockedSnapTime
          setSnapLineTime(lockedSnapTime)
          return { time: nextStart, snapped: true }
        }
        setLockedSnapTime(null)
      }

      if (hasCandidate) {
        setLockedSnapTime(bestTime)
        setSnapLineTime(bestTime)
        const nextStart = bestIsEnd ? bestTime - duration : bestTime
        return { time: nextStart, snapped: true }
      }

      setSnapLineTime(null)
      return { time: startTime, snapped: false }
    },
    [getFilteredPoints, lockedSnapTime]
  )

  const clearSnapLine = useCallback(() => {
    setSnapLineTime(null)
    setLockedSnapTime(null)
  }, [])

  return { checkSnap, checkMoveSnap, snapLineTime, clearSnapLine }
}
