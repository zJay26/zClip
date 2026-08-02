// ============================================================
// TimelinePlayhead — 播放头渲染 + 拖拽 + 自动跟随
// ============================================================

import React, { useEffect, useState } from 'react'
import { RULER_HEIGHT } from './timeline-constants'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { usePreferences } from '../../contexts/preferences'

interface TimelinePlayheadProps {
  timeToX: (time: number) => number
  xToTime: (x: number) => number
  seekTo: (time: number) => void
  trackAreaHeight: number
  containerRef: React.RefObject<HTMLDivElement | null>
  scrollLeft: number
  containerRect: DOMRect | null
}

const TimelinePlayhead: React.FC<TimelinePlayheadProps> = ({
  timeToX,
  xToTime,
  seekTo,
  trackAreaHeight,
  containerRef,
  scrollLeft,
  containerRect
}) => {
  const { t } = usePreferences()
  const { currentTime, playing, frameRate } = useProjectStore(useShallow((state) => ({
    currentTime: state.currentTime,
    playing: state.playing,
    frameRate: state.projectSettings.frameRate ?? 30
  })))
  const [dragging, setDragging] = useState(false)
  const x = Math.round(timeToX(currentTime))

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
        className="absolute pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-danger"
        role="slider"
        tabIndex={0}
        aria-label={t('播放头', 'Playhead')}
        aria-valuemin={0}
        aria-valuenow={currentTime}
        aria-valuetext={t(`${currentTime.toFixed(2)} 秒`, `${currentTime.toFixed(2)} seconds`)}
        style={{
          left: -8,
          width: 16,
          top: 0,
          height: totalHeight,
          cursor: 'col-resize'
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (!dragging || !containerRect) return
          const px = event.clientX - containerRect.left + scrollLeft
          seekTo(xToTime(px))
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const secondsPerPixel = Math.abs(xToTime(x + 1) - xToTime(x))
          seekTo(Math.max(0, currentTime + (event.key === 'ArrowRight' ? 1 : -1) * Math.max(secondsPerPixel, 1 / frameRate)))
        }}
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
          fill="rgb(var(--danger))"
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
          background: 'rgb(var(--danger))',
          boxShadow: '0 0 4px rgb(var(--danger) / 0.42)'
        }}
      />
    </div>
  )
}

export default React.memo(TimelinePlayhead)
