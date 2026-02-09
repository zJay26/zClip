// ============================================================
// TimelinePlayhead — 播放头渲染 + 拖拽 + 自动跟随
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { RULER_HEIGHT } from './timeline-constants'

interface TimelinePlayheadProps {
  currentTime: number
  timeToX: (time: number) => number
  xToTime: (x: number) => number
  seekTo: (time: number) => void
  trackAreaHeight: number
  playing: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  scrollLeft: number
  containerRect: DOMRect | null
}

const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
  currentTime,
  timeToX,
  xToTime,
  seekTo,
  trackAreaHeight,
  playing,
  containerRef,
  scrollLeft,
  containerRect
}) => {
  const [dragging, setDragging] = useState(false)
  const x = Math.round(timeToX(currentTime))

  // Drag playhead
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragging(true)
    },
    []
  )

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent): void => {
      if (!containerRect) return
      const px = e.clientX - containerRect.left + scrollLeft
      seekTo(xToTime(px))
    }
    const handleUp = (): void => setDragging(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, containerRect, scrollLeft, xToTime, seekTo])

  // Auto-follow during playback
  useEffect(() => {
    if (!playing || dragging) return
    const container = containerRef.current
    if (!container) return

    const visibleWidth = container.clientWidth
    const playheadX = timeToX(currentTime)
    const relativeX = playheadX - container.scrollLeft

    // If playhead is past 80% of visible area, scroll to keep it at 30%
    if (relativeX > visibleWidth * 0.8) {
      container.scrollLeft = playheadX - visibleWidth * 0.3
    }
    // If playhead scrolled off left
    if (relativeX < 0) {
      container.scrollLeft = playheadX - visibleWidth * 0.1
    }
  }, [currentTime, playing, dragging, containerRef, timeToX])

  const totalHeight = RULER_HEIGHT + trackAreaHeight

  return (
    <div
      className="absolute top-0 z-30 pointer-events-none"
      style={{ transform: `translateX(${x}px)`, height: totalHeight, willChange: 'transform' }}
    >
      {/* Drag target (wider than visual) */}
      <div
        className="absolute pointer-events-auto"
        style={{
          left: -8,
          width: 16,
          top: 0,
          height: totalHeight,
          cursor: 'col-resize'
        }}
        onMouseDown={handleMouseDown}
      />

      {/* Triangle head */}
      <svg
        width="12"
        height="10"
        viewBox="0 0 12 10"
        className="absolute pointer-events-none"
        style={{ left: -6, top: 0 }}
      >
        <polygon
          points="0,0 12,0 6,10"
          fill="#ef4444"
          filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))"
        />
      </svg>

      {/* Line */}
      <div
        className="absolute w-px pointer-events-none"
        style={{
          left: 0,
          top: 10,
          height: totalHeight - 10,
          background: '#ef4444',
          boxShadow: '0 0 4px rgba(239,68,68,0.4)'
        }}
      />
    </div>
  )
}

export default React.memo(TimelinePlayhead)
