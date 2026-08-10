import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioFadeSegment, MediaOperation, TimelineClip } from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { usePreferences } from '../../contexts/preferences'

interface TimelineAudioFadeBlockProps {
  fade: AudioFadeSegment
  clips: TimelineClip[]
  operationsByClip: Record<string, MediaOperation[]>
  trackTopY: number
  trackHeight: number
  timeToX: (time: number) => number
  pixelsPerSecond: number
  onDragStateChange?: (dragging: boolean) => void
}

type Edge = 'start' | 'end'

const TimelineAudioFadeBlock: React.FC<TimelineAudioFadeBlockProps> = ({
  fade,
  clips,
  operationsByClip,
  trackTopY,
  trackHeight,
  timeToX,
  pixelsPerSecond,
  onDragStateChange
}) => {
  const { t } = usePreferences()
  const { updateAudioFade, deleteAudioFade, beginHistoryTransaction, commitHistoryTransaction } = useProjectStore(useShallow((state) => ({
    updateAudioFade: state.updateAudioFade,
    deleteAudioFade: state.deleteAudioFade,
    beginHistoryTransaction: state.beginHistoryTransaction,
    commitHistoryTransaction: state.commitHistoryTransaction
  })))
  const [dragging, setDragging] = useState<Edge | null>(null)
  const dragRef = useRef({ clientX: 0, startOffset: 0, endOffset: 0 })

  const timing = useMemo(() => {
    const clip = clips.find((item) => item.id === fade.clipId)
    if (!clip) return null
    const range = getClipTimelineRange(clip, operationsByClip)
    const start = range.start + fade.startOffset
    const end = range.start + fade.endOffset
    if (end <= start) return null
    return { start, end }
  }, [clips, fade, operationsByClip])

  useEffect(() => {
    onDragStateChange?.(dragging !== null)
  }, [dragging, onDragStateChange])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (event: MouseEvent): void => {
      const delta = (event.clientX - dragRef.current.clientX) / pixelsPerSecond
      updateAudioFade(
        fade.id,
        dragging === 'start'
          ? { startOffset: dragRef.current.startOffset + delta }
          : { endOffset: dragRef.current.endOffset + delta },
        { recordHistory: false }
      )
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
  }, [commitHistoryTransaction, dragging, fade.id, pixelsPerSecond, updateAudioFade])

  if (!timing) return null

  const left = timeToX(timing.start)
  const width = Math.max(14, (timing.end - timing.start) * pixelsPerSecond)
  const verticalInset = Math.min(10, Math.max(1, trackHeight * 0.2))
  const label = fade.kind === 'in' ? t('淡入', 'Fade in') : t('淡出', 'Fade out')

  const startDrag = (event: React.MouseEvent, edge: Edge): void => {
    event.preventDefault()
    event.stopPropagation()
    beginHistoryTransaction()
    dragRef.current = {
      clientX: event.clientX,
      startOffset: fade.startOffset,
      endOffset: fade.endOffset
    }
    setDragging(edge)
  }

  return (
    <div
      role="group"
      tabIndex={0}
      data-local-delete
      aria-label={t(`${label}，按 Delete 删除`, `${label}; press Delete to remove`)}
      className="absolute z-30 overflow-hidden rounded-sm border border-cyan-200/80 bg-cyan-500/35 text-[10px] font-semibold text-white shadow-[0_0_8px_rgba(34,211,238,0.25)] outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{
        top: trackTopY + verticalInset,
        left,
        width,
        height: Math.max(2, trackHeight - verticalInset * 2)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        deleteAudioFade(fade.id)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        deleteAudioFade(fade.id)
      }}
      title={t('双击删除音频淡化', 'Double-click to delete audio fade')}
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
        className={`absolute inset-0 opacity-50 ${
          fade.kind === 'in'
            ? 'bg-gradient-to-r from-transparent to-white/40'
            : 'bg-gradient-to-r from-white/40 to-transparent'
        }`}
      />
      <div className="relative flex h-full items-center justify-center px-3">
        {label}
      </div>
    </div>
  )
}

export default React.memo(TimelineAudioFadeBlock)
