import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaOperation, TimelineClip, TimelineTransition } from '../../../../shared/types'
import { getTimelineTransitionTiming } from '../../../../shared/transition-utils'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { TRANSITION_EFFECTS } from '../Controls/TransitionControl'
import { usePreferences } from '../../contexts/preferences'
import { X } from 'lucide-react'

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
  const {
    selectedTransitionId,
    selectTransition,
    updateTransition,
    deleteTransition,
    beginHistoryTransaction,
    commitHistoryTransaction
  } = useProjectStore(useShallow((state) => ({
    selectedTransitionId: state.selectedTransitionId,
    selectTransition: state.selectTransition,
    updateTransition: state.updateTransition,
    deleteTransition: state.deleteTransition,
    beginHistoryTransaction: state.beginHistoryTransaction,
    commitHistoryTransaction: state.commitHistoryTransaction
  })))
  const [dragging, setDragging] = useState<Edge | null>(null)
  const dragRef = useRef({ clientX: 0, startOffset: 0, endOffset: 0 })

  const timing = useMemo(() => {
    return getTimelineTransitionTiming(transition, clips, operationsByClip)
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
  const isSelected = selectedTransitionId === transition.id
  const durationLabel = `${(timing.end - timing.start).toFixed(2)} s`

  const startDrag = (event: React.MouseEvent, edge: Edge): void => {
    event.preventDefault()
    event.stopPropagation()
    selectTransition(transition.id)
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
      data-selected={isSelected ? 'true' : 'false'}
      aria-label={isSelected
        ? t(`${label}，已选中，按 Delete 删除`, `${label}; selected; press Delete to remove`)
        : t(`${label}，点击选择`, `${label}; click to select`)}
      className={`group absolute z-30 overflow-hidden rounded-sm text-[10px] text-white outline-none transition-[border-color,background-color,box-shadow,transform] duration-fast focus-visible:ring-2 focus-visible:ring-white ${
        isSelected
          ? 'border-2 border-white bg-accent/85 shadow-[0_0_0_2px_rgb(var(--accent)/0.5),0_0_18px_rgb(var(--accent)/0.55)]'
          : 'border border-violet-300/80 bg-violet-500/55 shadow-[0_0_9px_rgba(139,92,246,0.28)] hover:border-white/90 hover:bg-violet-500/70'
      }`}
      style={{
        top: trackTopY + verticalInset,
        left,
        width,
        height: Math.max(2, trackHeight - verticalInset * 2)
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        selectTransition(transition.id)
        event.currentTarget.focus({ preventScroll: true })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectTransition(transition.id)
          return
        }
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        deleteTransition(transition.id)
      }}
      title={t('点击选择；拖动两端调整时长；按 Delete 删除', 'Click to select; drag the edges to resize; press Delete to remove')}
    >
      <div
        className={`absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-white/15 hover:bg-white/40 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onMouseDown={(event) => startDrag(event, 'start')}
      />
      <div
        className={`absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-white/15 hover:bg-white/40 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onMouseDown={(event) => startDrag(event, 'end')}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-white/80"
        style={{ left: boundaryX }}
      />
      <div
        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white/90 bg-white/35"
        style={{ left: boundaryX }}
      />
      {isSelected && (
        <button
          type="button"
          aria-label={t('删除转场', 'Delete transition')}
          className="absolute right-1 top-1 z-20 flex h-4 w-4 items-center justify-center rounded-sm bg-black/35 text-white outline-none hover:bg-black/60 focus-visible:ring-1 focus-visible:ring-white"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            deleteTransition(transition.id)
          }}
        >
          <X aria-hidden size={11} strokeWidth={2.2} />
        </button>
      )}
      <div className="flex h-full items-center justify-center gap-1.5 px-3 font-semibold">
        <span className="truncate">{label}</span>
        {isSelected && <span className="font-mono text-[9px] font-medium tabular-nums text-white/75">{durationLabel}</span>}
      </div>
    </div>
  )
}

export default React.memo(TimelineTransitionBlock)
