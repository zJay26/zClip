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
  /** Current visible snap line position (time), or null */
  snapLineTime: number | null
  /** Clear snap line */
  clearSnapLine: () => void
}

export function useSnap(): SnapEngine {
  const { clips, currentTime, operationsByClip } = useProjectStore()
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null)

  // Collect all snap points: clip edges + playhead
  const snapPoints = useMemo(() => {
    const points: number[] = [currentTime]

    for (const clip of clips) {
      const range = getClipTimelineRange(clip, operationsByClip)
      points.push(range.start, range.end)
    }

    // Deduplicate & sort
    return [...new Set(points)].sort((a, b) => a - b)
  }, [clips, currentTime, operationsByClip])

  const checkSnap = useCallback(
    (time: number, pixelsPerSecond: number, excludeClipId?: string): SnapResult => {
      const threshold = SNAP_THRESHOLD_PX / pixelsPerSecond

      // Build filtered snap points excluding the dragged clip's own edges
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

      let bestDist = Infinity
      let bestTime = time

      for (const point of filteredPoints) {
        const dist = Math.abs(time - point)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist
          bestTime = point
        }
      }

      const snapped = bestDist < threshold
      setSnapLineTime(snapped ? bestTime : null)
      return { time: snapped ? bestTime : time, snapped }
    },
    [snapPoints, clips, operationsByClip]
  )

  const clearSnapLine = useCallback(() => setSnapLineTime(null), [])

  return { checkSnap, snapLineTime, clearSnapLine }
}
