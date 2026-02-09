// ============================================================
// useTimelineZoom — 时间轴缩放/滚动 hook
// Ctrl+滚轮以光标为中心缩放，普通滚轮水平滚动
// ============================================================

import { useState, useCallback, useEffect, useRef, type RefObject } from 'react'
import { clamp } from '../../lib/utils'
import { MIN_ZOOM, MAX_ZOOM, TIMELINE_TAIL_PX } from './timeline-constants'

export interface TimelineZoomState {
  zoom: number
  setZoom: (z: number) => void
  pixelsPerSecond: number
  totalWidth: number
  handleWheel: (e: React.WheelEvent) => void
  zoomToFit: () => void
  timeToX: (time: number) => number
  xToTime: (x: number) => number
}

export function useTimelineZoom(
  containerRef: RefObject<HTMLDivElement | null>,
  timelineDuration: number
): TimelineZoomState {
  const [zoom, setZoomRaw] = useState(1)
  const basePpsRef = useRef<number | null>(null)

  const containerWidth = containerRef.current?.clientWidth ?? 800
  const basePPS = basePpsRef.current ?? Math.max(1, containerWidth / Math.max(timelineDuration, 0.1))
  const pixelsPerSecond = basePPS * zoom
  const totalWidth = Math.max(containerWidth, timelineDuration * pixelsPerSecond + TIMELINE_TAIL_PX)

  useEffect(() => {
    if (timelineDuration <= 0) {
      basePpsRef.current = null
      return
    }
    if (basePpsRef.current === null) {
      basePpsRef.current = Math.max(1, containerWidth / Math.max(timelineDuration, 0.1))
    }
  }, [timelineDuration, containerWidth])

  const setZoom = useCallback((z: number) => {
    setZoomRaw(clamp(z, MIN_ZOOM * 0.5, MAX_ZOOM))
  }, [])

  const timeToX = useCallback(
    (time: number) => time * pixelsPerSecond,
    [pixelsPerSecond]
  )

  const xToTime = useCallback(
    (x: number) => clamp(x / pixelsPerSecond, 0, timelineDuration),
    [pixelsPerSecond, timelineDuration]
  )

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const container = containerRef.current
      if (!container) return

      if (e.ctrlKey || e.metaKey) {
        // Zoom centered on cursor
        if (e.cancelable) {
          e.preventDefault()
          e.stopPropagation()
        }

        const rect = container.getBoundingClientRect()
        const cursorX = e.clientX - rect.left + container.scrollLeft
        const timeAtCursor = cursorX / pixelsPerSecond

        const factor = e.deltaY > 0 ? 0.85 : 1.18
        const newZoom = clamp(zoom * factor, MIN_ZOOM * 0.5, MAX_ZOOM)
        const newPPS = basePPS * newZoom
        const newScrollLeft = timeAtCursor * newPPS - (e.clientX - rect.left)

        setZoomRaw(newZoom)
        // Defer scroll adjustment to next frame so layout updates first
        requestAnimationFrame(() => {
          container.scrollLeft = Math.max(0, newScrollLeft)
        })
      } else {
        // Normal scroll = horizontal scroll
        if (e.cancelable) {
          e.preventDefault()
        }
        container.scrollLeft += e.deltaY
      }
    },
    [containerRef, pixelsPerSecond, zoom, basePPS]
  )

  const zoomToFit = useCallback(() => {
    basePpsRef.current = Math.max(1, containerWidth / Math.max(timelineDuration, 0.1))
    setZoomRaw(1)
    const container = containerRef.current
    if (container) {
      container.scrollLeft = 0
    }
  }, [containerRef, containerWidth, timelineDuration])

  return {
    zoom,
    setZoom,
    pixelsPerSecond,
    totalWidth,
    handleWheel,
    zoomToFit,
    timeToX,
    xToTime
  }
}
