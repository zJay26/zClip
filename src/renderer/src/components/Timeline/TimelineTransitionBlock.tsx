import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaOperation, TimelineClip, TimelineTransition } from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { useProjectStore } from '../../stores/project-store'
import { TRANSITION_EFFECTS } from '../Controls/TransitionControl'

interface TimelineTransitionBlockProps {
  transition: TimelineTransition
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  trackTopY: number
  timeToX: (time: number) => number
  pixelsPerSecond: number
  onDragStateChange?: (dragging: boolean) => void
}

type Edge = 'start' | 'end'

const labelByType = Object.fromEntries(
  TRANSITION_EFFECTS.map((item) => [item.type, item.label])
) as Record<TimelineTransition['type'], string>

const TimelineTransitionBlock: React.FC<TimelineTransitionBlockProps> = ({
  transition,
  clips,
  operationsByClip,
  trackTopY,
  timeToX,
  pixelsPerSecond,
  onDragStateChange
}) => {
  const { updateTransition, deleteTransition, beginHistoryTransaction, commitHistoryTransaction } = useProjectStore()
  const [dragging, setDragging] = useState<Edge | null>(null)
  const dragRef = useRef({ clientX: 0, startOffset: 0, endOffset: 0 })

  const timing = useMemo(() => {
    const left = clips.find((clip) => clip.id === transition.leftClipId)
    const right = clips.find((clip) => clip.id === transition.rightClipId)
    if (!left || !right) return null
    const leftRange = getClipTimelineRange(left, operationsByClip)
    const rightRange = getClipTimelineRange(right, operationsByClip)
    const boundary = (leftRange.end + rightRange.start) / 2
    const start = boundary + transition.startOffset
    const end = boundary + transition.endOffset
    if (end <= start) return null
    return { start, end, boundary }
  }, [clips, operationsByClip, transition])

  useEffect(() => {
    if (!onDragStateChange) return
    onDragStateChange(dragging !== null)
  }, [dragging, onDragStateChange])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (event: MouseEvent): void => {
      const delta = (event.clientX - dragRef.current.clientX) / pixelsPerSecond
      if (dragging === 'start') {
        updateTransition(
          transition.id,
          { startOffset: dragRef.current.startOffset + delta },
          { recordHistory: false }
        )
      } else {
        updateTransition(
          transition.id,
          { endOffset: dragRef.current.endOffset + delta },
          { recordHistory: false }
        )
      }
    }
    const handleUp = (): void => {
      setDragging(null)
      commitHistoryTransaction()
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [commitHistoryTransaction, dragging, pixelsPerSecond, transition.id, updateTransition])

  if (!timing) return null

  const left = timeToX(timing.start)
  const width = Math.max(16, (timing.end - timing.start) * pixelsPerSecond)
  const boundaryX = timeToX(timing.boundary) - left

  const startDrag = (event: React.MouseEvent, edge: Edge): void => {
    event.preventDefault()
    event.stopPropagation()
    beginHistoryTransaction()
    dragRef.current = {
      clientX: event.clientX,
      startOffset: transition.startOffset,
      endOffset: transition.endOffset
    }
    setDragging(edge)
  }

  return (
    <div
      className="absolute z-30 overflow-hidden rounded-sm border border-violet-300/80 bg-violet-500/45 text-[10px] text-white shadow-[0_0_10px_rgba(139,92,246,0.35)]"
      style={{
        top: trackTopY + 8,
        left,
        width,
        height: 34
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        deleteTransition(transition.id)
      }}
      title="双击删除转场"
    >
      <div
        className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/15 hover:bg-white/35"
        onMouseDown={(event) => startDrag(event, 'start')}
      />
      <div
        className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/15 hover:bg-white/35"
        onMouseDown={(event) => startDrag(event, 'end')}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-white/70"
        style={{ left: boundaryX }}
      />
      <div className="flex h-full items-center justify-center px-3 font-semibold">
        {labelByType[transition.type] || '转场'}
      </div>
    </div>
  )
}

export default TimelineTransitionBlock
