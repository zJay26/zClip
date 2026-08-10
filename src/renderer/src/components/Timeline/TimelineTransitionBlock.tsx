import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaOperation, TimelineClip, TimelineTransition } from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { TRANSITION_EFFECTS } from '../Controls/TransitionControl'
import { usePreferences } from '../../contexts/preferences'

interface TimelineTransitionBlockProps {
  transition: TimelineTransition
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  trackTopY: number
  trackHeight: number
  timeToX: (time: number) => number
  pixelsPerSecond: number
  onDragStateChange?: (dragging: boolean) => void
}

type Edge = 'start' | 'end'

const TimelineTransitionBlock: React.FC<TimelineTransitionBlockProps> = ({
  transition,
  clips,
  operationsByClip,
  trackTopY,
  trackHeight,
  timeToX,
  pixelsPerSecond,
  onDragStateChange
}) => {
  const { t } = usePreferences()
  const { updateTransition, deleteTransition, beginHistoryTransaction, commitHistoryTransaction } = useProjectStore(useShallow((state) => ({
    updateTransition: state.updateTransition,
    deleteTransition: state.deleteTransition,
    beginHistoryTransaction: state.beginHistoryTransaction,
    commitHistoryTransaction: state.commitHistoryTransaction
  })))
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
  const verticalInset = Math.min(8, Math.max(1, trackHeight * 0.16))
  const effect = TRANSITION_EFFECTS.find((item) => item.type === transition.type)
  const label = effect ? t(effect.label, effect.labelEn) : t('转场', 'Transition')

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
      role="group"
      tabIndex={0}
      data-local-delete
      aria-label={t(`${label}，按 Delete 删除`, `${label}; press Delete to remove`)}
      className="absolute z-30 overflow-hidden rounded-sm border border-violet-300/80 bg-violet-500/45 text-[10px] text-white shadow-[0_0_10px_rgba(139,92,246,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{
        top: trackTopY + verticalInset,
        left,
        width,
        height: Math.max(2, trackHeight - verticalInset * 2)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        deleteTransition(transition.id)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        deleteTransition(transition.id)
      }}
      title={t('双击删除转场', 'Double-click to delete transition')}
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
        {label}
      </div>
    </div>
  )
}

export default React.memo(TimelineTransitionBlock)
