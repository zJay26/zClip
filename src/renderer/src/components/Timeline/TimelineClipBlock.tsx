// ============================================================
// TimelineClipBlock — 单个 Clip 块
// 包含：左右边缘裁剪手柄 + 整体拖拽移动 + snap 集成
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { formatTime, clamp, toMediaUrl } from '../../lib/utils'
import { DRAG_THRESHOLD_PX, HANDLE_WIDTH, hasPassedDragThreshold } from './timeline-constants'
import type { SnapEngine } from './useSnap'
import type {
  TrimParams,
  TimelineClip,
  MediaOperation,
  SpeedParams,
  VolumeParams,
  PitchParams,
  TransformParams
} from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { usePreferences } from '../../contexts/preferences'

interface TimelineClipBlockProps {
  clip: TimelineClip
  trackTopY: number
  timeToX: (time: number) => number
  pixelsPerSecond: number
  snap: SnapEngine
  containerRect: DOMRect | null
  trackType: 'video' | 'audio'
  trackCount: number
  baseTrackTop: number
  trackHeight: number
  trackGap: number
  onDragStateChange?: (dragging: boolean) => void
  onClipContextMenu?: (clipId: string, x: number, y: number) => void
  clipOperations: MediaOperation[]
  isSelected: boolean
  isPrimary: boolean
  isLinked: boolean
  groupClipCount: number
}

type DragMode = 'move' | 'trim-start' | 'trim-end' | null
const DRAG_EPSILON_SECONDS = 0.0001

interface PendingClipMove {
  startTime: number
  trackIndex: number
}

const TimelineClipBlock: React.FC<TimelineClipBlockProps> = ({
  clip,
  trackTopY,
  timeToX,
  pixelsPerSecond,
  snap,
  containerRect,
  trackType,
  trackCount,
  baseTrackTop,
  trackHeight,
  trackGap,
  onDragStateChange,
  onClipContextMenu,
  clipOperations,
  isSelected,
  isPrimary,
  isLinked,
  groupClipCount
}) => {
  const { t } = usePreferences()
  const { selectClip, moveClip, trimClipEdge, toggleGroupLink } = useProjectStore(useShallow((state) => ({
    selectClip: state.selectClip,
    moveClip: state.moveClip,
    trimClipEdge: state.trimClipEdge,
    toggleGroupLink: state.toggleGroupLink
  })))
  const operationsByClip = useMemo(() => ({ [clip.id]: clipOperations }), [clip.id, clipOperations])

  const [dragMode, setDragMode] = useState<DragMode>(null)
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    startTime: 0,
    trackIndex: 0,
    visibleDuration: 0,
    pointerId: -1
  })
  const dragThresholdPassedRef = useRef(false)
  const historyCapturedRef = useRef(false)
  const pendingMoveRef = useRef<PendingClipMove | null>(null)
  const lastAppliedMoveRef = useRef<PendingClipMove | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  const [dragOriginTime, setDragOriginTime] = useState<number | null>(null)
  const [previewUrls, setPreviewUrls] = useState<{ video?: string; audio?: string }>({})
  // Get trim values for this clip
  const ops = clipOperations
  const trimOp = ops?.find((op) => op.type === 'trim')
  const trimParams = trimOp?.params as TrimParams | undefined
  const range = getClipTimelineRange(clip, operationsByClip)
  const trimStart = trimParams?.startTime ?? range.trimStart
  const trimEnd = trimParams?.endTime ?? range.trimEnd
  const visibleDuration = range.visibleDuration

  // Position & size
  const clipX = timeToX(clip.startTime)
  const clipWidth = Math.max(12, visibleDuration * pixelsPerSecond)
  const fileName = clip.filePath.split(/[\\/]/).pop() || 'Clip'

  // Colors
  const isVideo = trackType === 'video'
  const showLinkToggle = groupClipCount > 1 && trackHeight >= 24
  const bgNormal = isVideo
    ? 'bg-timeline-video/15'
    : 'bg-timeline-audio/15'
  const bgSelected = isVideo
    ? 'bg-timeline-video/45'
    : 'bg-timeline-audio/42'
  const borderNormal = isVideo
    ? 'border-timeline-video/30'
    : 'border-timeline-audio/30'
  const borderSelected = isVideo
    ? 'border-timeline-video'
    : 'border-timeline-audio'
  const selectionShadow = !isSelected
    ? ''
    : isPrimary
      ? 'shadow-[0_0_0_2px_rgb(var(--accent-soft)/0.92),0_0_0_4px_rgb(var(--accent)/0.24),0_10px_24px_rgb(0_0_0/0.34)]'
      : isVideo
        ? 'shadow-[0_0_0_1px_rgb(var(--timeline-video)/0.72),0_8px_18px_rgb(0_0_0/0.25)]'
        : 'shadow-[0_0_0_1px_rgb(var(--timeline-audio)/0.72),0_8px_18px_rgb(0_0_0/0.25)]'
  const textColor = isSelected ? 'text-text-primary' : 'text-text-secondary'


  const formatRate = (rate: number): string => {
    const str = rate.toFixed(2).replace(/\.?0+$/, '')
    return `${str}x`
  }

  const buildBadges = (): string[] => {
    const opsForClip = clipOperations
    const speedOp = opsForClip.find((op) => op.type === 'speed' && op.enabled)
    const volumeOp = opsForClip.find((op) => op.type === 'volume' && op.enabled)
    const pitchOp = opsForClip.find((op) => op.type === 'pitch' && op.enabled)
    const transformOp = opsForClip.find((op) => op.type === 'transform' && op.enabled)
    const badges: string[] = []
    if (speedOp) {
      badges.push(t(`速 ${formatRate((speedOp.params as SpeedParams).rate)}`, `Speed ${formatRate((speedOp.params as SpeedParams).rate)}`))
    }
    if (volumeOp) {
      const percent = (volumeOp.params as VolumeParams).percent
      badges.push(t(`音量 ${Math.round(percent)}%`, `Volume ${Math.round(percent)}%`))
    }
    if (pitchOp) {
      const percent = (pitchOp.params as PitchParams).percent
      badges.push(t(`音调 ${Math.round(percent)}%`, `Pitch ${Math.round(percent)}%`))
    }
    if (transformOp && isVideo) {
      const transform = transformOp.params as TransformParams
      if (
        transform.fit !== 'contain' ||
        transform.scale !== 1 ||
        transform.x !== 0 ||
        transform.y !== 0 ||
        transform.rotation !== 0 ||
        transform.opacity !== 100 ||
        transform.flipX ||
        transform.flipY
      ) {
        badges.push(t('构图', 'Framing'))
      }
    }
    return badges
  }

  const badges = buildBadges()

  const previewStyle = useMemo(() => {
    const duration = Math.max(0.01, clip.duration)
    const trimmedDuration = Math.max(0.01, trimEnd - trimStart)
    const imageWidth = Math.max(1, clipWidth * (duration / trimmedDuration))
    const shiftPx = (trimStart / duration) * imageWidth
    return {
      backgroundSize: `${imageWidth}px 100%`,
      backgroundPositionX: `${-shiftPx}px`
    }
  }, [clip.duration, trimStart, trimEnd, clipWidth])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!window.api?.getTimelinePreview) return
      const options = isVideo
        ? { video: { height: 72, frames: 12 } }
        : { audio: { width: 800, height: 56 } }
      const res = await window.api.getTimelinePreview(clip.filePath, options)
      if (cancelled || !res?.success || !res.data) return
      const next = {
        video: res.data.videoStripPath ? toMediaUrl(res.data.videoStripPath) : undefined,
        audio: res.data.audioWaveformPath ? toMediaUrl(res.data.audioWaveformPath) : undefined
      }
      setPreviewUrls(next)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [clip.filePath, isVideo])

  const flushPendingMove = useCallback((): void => {
    moveFrameRef.current = null
    const pending = pendingMoveRef.current
    pendingMoveRef.current = null
    if (!pending) return
    const recordHistory = !historyCapturedRef.current
    moveClip(clip.id, pending, { recordHistory })
    historyCapturedRef.current = true
    lastAppliedMoveRef.current = pending
  }, [clip.id, moveClip])

  const queueMove = useCallback((pending: PendingClipMove): void => {
    const latest = pendingMoveRef.current || lastAppliedMoveRef.current
    if (
      latest &&
      Math.abs(latest.startTime - pending.startTime) <= DRAG_EPSILON_SECONDS &&
      latest.trackIndex === pending.trackIndex
    ) return
    pendingMoveRef.current = pending
    if (moveFrameRef.current !== null) return
    moveFrameRef.current = requestAnimationFrame(flushPendingMove)
  }, [flushPendingMove])

  useEffect(() => () => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current)
  }, [])

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.currentTarget.focus({ preventScroll: true })
      const mode = e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey ? 'toggle' : 'single')
      selectClip(clip.id, mode)
    },
    [selectClip, clip.id]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.focus({ preventScroll: true })
      if (!isSelected) {
        selectClip(clip.id, 'single')
      }
      onClipContextMenu?.(clip.id, e.clientX, e.clientY)
    },
    [clip.id, isSelected, onClipContextMenu, selectClip]
  )

  // Drag start for move
  const handleMoveStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.currentTarget.focus({ preventScroll: true })
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      // Ignore if near edges (trim handles take priority)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const localX = e.clientX - rect.left
      if (localX < HANDLE_WIDTH + 2 || localX > rect.width - HANDLE_WIDTH - 2) return

      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      if (!isSelected) {
        selectClip(clip.id, 'single')
      }
      setDragMode('move')
      dragThresholdPassedRef.current = false
      historyCapturedRef.current = false
      pendingMoveRef.current = null
      lastAppliedMoveRef.current = { startTime: clip.startTime, trackIndex: clip.trackIndex }
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startTime: clip.startTime,
        trackIndex: clip.trackIndex,
        visibleDuration,
        pointerId: e.pointerId
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, clip.trackIndex, isSelected, selectClip, visibleDuration]
  )

  // Drag start for trim
  const handleTrimStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, edge: 'trim-start' | 'trim-end') => {
      if (e.button !== 0) return
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.closest<HTMLElement>('[data-timeline-clip]')?.focus({ preventScroll: true })
      e.currentTarget.setPointerCapture(e.pointerId)
      if (!isSelected) {
        selectClip(clip.id, 'single')
      }
      setDragMode(edge)
      dragThresholdPassedRef.current = false
      historyCapturedRef.current = false
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startTime: clip.startTime,
        trackIndex: clip.trackIndex,
        visibleDuration,
        pointerId: e.pointerId
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, clip.trackIndex, isSelected, selectClip, visibleDuration]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragMode || e.pointerId !== dragStartRef.current.pointerId) return
      const deltaPx = e.clientX - dragStartRef.current.clientX
      const deltaYPx = e.clientY - dragStartRef.current.clientY
      if (!dragThresholdPassedRef.current) {
        if (!hasPassedDragThreshold(deltaPx, deltaYPx, DRAG_THRESHOLD_PX)) return
        dragThresholdPassedRef.current = true
      }
      const deltaSec = deltaPx / pixelsPerSecond

      if (dragMode === 'move') {
        const rawTime = dragStartRef.current.startTime + deltaSec
        const snapped = snap.checkMoveSnap(
          rawTime,
          dragStartRef.current.visibleDuration,
          pixelsPerSecond,
          clip.id
        )
        const newStart = Math.max(0, snapped.time)

        // Calculate track index from mouse Y
        if (containerRect) {
          const y = e.clientY - containerRect.top
          const relativeY = y - baseTrackTop
          let nextTrackIndex = Math.floor(relativeY / (trackHeight + trackGap))
          nextTrackIndex = clamp(nextTrackIndex, 0, Math.max(trackCount - 1, 0))
          queueMove({ startTime: newStart, trackIndex: nextTrackIndex })
        } else {
          queueMove({ startTime: newStart, trackIndex: dragStartRef.current.trackIndex })
        }
      } else if (dragMode === 'trim-start') {
        // Snap the left edge position (timeline time)
        const rawEdgeTime = dragStartRef.current.startTime + deltaSec
        const snapped = snap.checkSnap(rawEdgeTime, pixelsPerSecond, clip.id)
        const deltaTimeline = snapped.time - clip.startTime
        if (Math.abs(deltaTimeline) <= DRAG_EPSILON_SECONDS) return
        const recordHistory = !historyCapturedRef.current
        trimClipEdge(clip.id, 'start', deltaTimeline, { recordHistory })
        historyCapturedRef.current = true
      } else if (dragMode === 'trim-end') {
        const currentVisEnd = clip.startTime + visibleDuration
        const rawEdgeTime = dragStartRef.current.startTime + dragStartRef.current.visibleDuration + deltaSec
        const snapped = snap.checkSnap(rawEdgeTime, pixelsPerSecond, clip.id)
        const deltaTimeline = snapped.time - currentVisEnd
        if (Math.abs(deltaTimeline) <= DRAG_EPSILON_SECONDS) return
        const recordHistory = !historyCapturedRef.current
        trimClipEdge(clip.id, 'end', deltaTimeline, { recordHistory })
        historyCapturedRef.current = true
      }
    }, [
      dragMode, pixelsPerSecond, clip.id, clip.startTime, clip.trackIndex, visibleDuration,
      snap, trimClipEdge, containerRect, baseTrackTop, trackCount,
      trackHeight, trackGap, queueMove
    ])

    const finishPointerDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragMode || e.pointerId !== dragStartRef.current.pointerId) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current)
      flushPendingMove()
      setDragMode(null)
      setDragOriginTime(null)
      historyCapturedRef.current = false
      pendingMoveRef.current = null
      lastAppliedMoveRef.current = null
      dragThresholdPassedRef.current = false
      snap.clearSnapLine()
    }, [dragMode, flushPendingMove, snap])

  useEffect(() => {
    if (!onDragStateChange) return
    onDragStateChange(dragMode !== null)
  }, [dragMode, onDragStateChange])

  const dragDelta = dragMode === 'move'
    ? clip.startTime - dragStartRef.current.startTime
    : 0

  return (
    <div
      role="button"
      tabIndex={0}
      data-timeline-clip
      data-editor-shortcut-surface
      data-selected={isSelected}
      data-primary={isPrimary}
      aria-pressed={isSelected}
      aria-label={t(
        `${isVideo ? '视频' : '音频'}片段 ${fileName}，时长 ${formatTime(visibleDuration)}`,
        `${isVideo ? 'Video' : 'Audio'} clip ${fileName}, duration ${formatTime(visibleDuration)}`
      )}
      className={`absolute overflow-hidden rounded-sm select-none outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${isSelected ? 'border-2' : 'border'}
        ${isSelected ? bgSelected : bgNormal}
        ${isSelected ? borderSelected : borderNormal}
        ${selectionShadow}
        ${dragMode === 'move' && dragThresholdPassedRef.current ? '-translate-y-0.5 scale-[1.01] opacity-90 shadow-floating' : ''}
        will-change-transform transition-[transform,box-shadow,opacity] duration-fast
      `}
      style={{
        top: trackTopY,
        left: clipX,
        width: clipWidth,
        height: trackHeight,
        zIndex: isPrimary ? 11 : isSelected ? 10 : 5
      }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          selectClip(clip.id, event.shiftKey ? 'range' : 'single')
        }
      }}
      onPointerDown={handleMoveStart}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onContextMenu={handleContextMenu}
    >
      {/* Preview layer */}
      {isVideo && previewUrls.video && (
        <div
          className="absolute inset-0 opacity-60 pointer-events-none"
          style={{
            backgroundImage: `url("${previewUrls.video}")`,
            backgroundRepeat: 'no-repeat',
            ...previewStyle
          }}
        />
      )}
      {!isVideo && previewUrls.audio && (
        <div
          className="absolute inset-0 opacity-70 pointer-events-none"
          style={{
            backgroundImage: `url("${previewUrls.audio}")`,
            backgroundRepeat: 'no-repeat',
            ...previewStyle
          }}
        />
      )}
      {/* Drag origin ghost */}
      {dragMode === 'move' && dragOriginTime !== null && (
        <div
          className="absolute top-0 h-full border border-dashed border-text-muted/40 bg-transparent pointer-events-none"
          style={{
            left: timeToX(dragOriginTime) - clipX,
            width: clipWidth
          }}
        />
      )}
      {/* Link toggle */}
      {showLinkToggle && (
        <button
          type="button"
          aria-pressed={isLinked}
          aria-label={isLinked ? t('取消链接', 'Unlink') : t('链接音画', 'Link audio and video')}
          className={`absolute left-1 top-1 z-20 rounded px-1 py-[1px] text-[9px] font-semibold pointer-events-auto
                     ${isLinked
                       ? 'bg-accent/28 text-white ring-1 ring-inset ring-accent-soft/55 hover:bg-accent/42'
                       : 'bg-black/45 text-white/80 ring-1 ring-inset ring-white/20 hover:bg-black/65 hover:text-white'}`}
          title={isLinked ? t('取消链接', 'Unlink') : t('链接音画', 'Link audio and video')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            toggleGroupLink(clip.groupId)
          }}
        >
          {isLinked ? 'LINKED' : 'UNLINKED'}
        </button>
      )}
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 z-10 cursor-ew-resize group"
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={(e) => handleTrimStart(e, 'trim-start')}
      >
        <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-sm
          bg-white/10 group-hover:bg-white/40 transition-colors" />
        {/* Grip lines */}
        <div className="absolute inset-y-0 left-0 w-[3px] flex flex-col items-center justify-center gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-[1px] h-2 bg-white/60 rounded" />
          <div className="w-[1px] h-2 bg-white/60 rounded" />
        </div>
      </div>

      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 z-10 cursor-ew-resize group"
        style={{ width: HANDLE_WIDTH }}
        onPointerDown={(e) => handleTrimStart(e, 'trim-end')}
      >
        <div className="absolute inset-y-0 right-0 w-[3px] rounded-r-sm
          bg-white/10 group-hover:bg-white/40 transition-colors" />
        <div className="absolute inset-y-0 right-0 w-[3px] flex flex-col items-center justify-center gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-[1px] h-2 bg-white/60 rounded" />
          <div className="w-[1px] h-2 bg-white/60 rounded" />
        </div>
      </div>

      {/* Clip content */}
      <div
        className="flex h-full items-center overflow-hidden pointer-events-none"
        style={{
          paddingLeft: showLinkToggle ? 52 : trackHeight < 18 ? 5 : 10,
          paddingRight: trackHeight < 18 ? 5 : 10
        }}
      >
        <div className="flex flex-col min-w-0">
          <span
            className={`truncate font-medium leading-none ${textColor}`}
            style={{ fontSize: Math.max(6, Math.min(11, trackHeight * 0.36)) }}
          >
            {fileName}
          </span>
          {trackHeight >= 28 && (
            <span className="truncate font-mono text-[9px] leading-tight text-text-muted/70">
              {formatTime(visibleDuration)}
            </span>
          )}
        </div>
      </div>

      {/* Drag delta badge */}
      {dragMode === 'move' && trackHeight >= 22 && (
        <div className="absolute left-1 bottom-1 z-20 px-1 py-[1px] rounded bg-black/40 text-white/80 text-[9px] pointer-events-none">
          {dragDelta >= 0 ? '+' : ''}
          {formatTime(Math.abs(dragDelta))}
        </div>
      )}

      {/* Operation badges */}
      {badges.length > 0 && trackHeight >= 24 && (
        <div className="absolute right-1 top-1 z-20 flex gap-1 pointer-events-none">
          {badges.map((badge) => (
            <span
              key={badge}
              className="px-1 py-[1px] rounded bg-black/40 text-white/80 text-[9px]"
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {/* Top highlight line */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] ${
        isVideo
          ? isSelected ? 'bg-indigo-200/95' : 'bg-indigo-400/40'
          : isSelected ? 'bg-emerald-200/95' : 'bg-emerald-400/40'
      }`} />

      {isPrimary && clipWidth >= 24 && trackHeight >= 18 && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
          <span className="absolute left-0 top-0 h-2 w-2 border-l-2 border-t-2 border-text-primary" />
          <span className="absolute right-0 top-0 h-2 w-2 border-r-2 border-t-2 border-text-primary" />
          <span className="absolute bottom-0 left-0 h-2 w-2 border-b-2 border-l-2 border-text-primary" />
          <span className="absolute bottom-0 right-0 h-2 w-2 border-b-2 border-r-2 border-text-primary" />
        </div>
      )}
    </div>
  )
}

export default React.memo(TimelineClipBlock)
