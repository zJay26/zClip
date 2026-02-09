// ============================================================
// TimelineRuler — 标尺刻度 + 拖拽跳转播放头
// ============================================================

import React, { useCallback, useEffect, useState } from 'react'
import { formatTime } from '../../lib/utils'
import { RULER_HEIGHT, TIMELINE_TAIL_PX, getTickInterval } from './timeline-constants'

interface TimelineRulerProps {
  totalWidth: number
  pixelsPerSecond: number
  timelineDuration: number
  timeToX: (time: number) => number
  xToTime: (x: number) => number
  seekTo: (time: number) => void
  scrollLeft: number
  containerRect: DOMRect | null
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({
  totalWidth,
  pixelsPerSecond,
  timelineDuration,
  timeToX,
  xToTime,
  seekTo,
  scrollLeft,
  containerRect
}) => {
  const [scrubbing, setScrubbing] = useState(false)

  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRect) return 0
      const x = clientX - containerRect.left + scrollLeft
      return xToTime(x)
    },
    [containerRect, scrollLeft, xToTime]
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setScrubbing(true)
      const time = getTimeFromClientX(e.clientX)
      seekTo(time)
    },
    [getTimeFromClientX, seekTo]
  )

  useEffect(() => {
    if (!scrubbing) return

    const handleMove = (e: MouseEvent): void => {
      const time = getTimeFromClientX(e.clientX)
      seekTo(time)
    }
    const handleUp = (): void => setScrubbing(false)

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [scrubbing, getTimeFromClientX, seekTo])

  // Generate tick marks (use index steps to avoid float drift)
  const tickInterval = getTickInterval(timelineDuration, pixelsPerSecond)
  const tailSeconds = TIMELINE_TAIL_PX / Math.max(1, pixelsPerSecond)
  const effectiveDuration = timelineDuration + tailSeconds
  const ticks: { time: number; major: boolean }[] = []
  const minor = tickInterval.minor
  const major = tickInterval.major
  const majorStepCount = Math.max(1, Math.round(major / minor))
  const totalSteps = Math.ceil((effectiveDuration + minor) / minor)
  for (let i = 0; i <= totalSteps; i++) {
    const time = i * minor
    const isMajor = i % majorStepCount === 0
    ticks.push({ time, major: isMajor })
  }

  return (
    <div
      className="relative select-none"
      style={{
        width: totalWidth,
        height: RULER_HEIGHT,
        cursor: scrubbing ? 'col-resize' : 'pointer'
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Ruler background */}
      <div className="absolute inset-0 bg-surface-light border-b border-surface-border" />

      {/* Tick marks */}
      {ticks.map((tick, i) => (
        <div
          key={i}
          className="absolute bottom-0"
          style={{ left: timeToX(tick.time) }}
        >
          <div
            className={`w-px ${
              tick.major
                ? 'h-3 bg-text-muted/40'
                : 'h-1.5 bg-text-muted/20'
            }`}
          />
          {tick.major && (
            <span
              className="absolute bottom-3 -translate-x-1/2 text-[10px] text-text-muted font-mono whitespace-nowrap pointer-events-none"
            >
              {formatTime(tick.time)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

export default React.memo(TimelineRuler)
