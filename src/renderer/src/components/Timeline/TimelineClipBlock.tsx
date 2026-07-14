// ============================================================
// TimelineClipBlock — 单个 Clip 块
// 包含：左右边缘裁剪手柄 + 整体拖拽移动 + snap 集成
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime, clamp, toMediaUrl } from '../../lib/utils'
import { TRACK_HEIGHT, TRACK_GAP, HANDLE_WIDTH } from './timeline-constants'
import type { SnapEngine } from './useSnap'
import type {
  TrimParams,
  TimelineClip,
  SpeedParams,
  VolumeParams,
  PitchParams,
  TransformParams
} from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'

interface TimelineClipBlockProps {
  clip: TimelineClip
  trackTopY: number
  timeToX: (time: number) => number
  xToTime: (x: number) => number
  pixelsPerSecond: number
  seekTo: (time: number) => void
  snap: SnapEngine
  scrollLeft: number
  containerRect: DOMRect | null
  trackType: 'video' | 'audio'
  trackCount: number
  baseTrackTop: number
  onDragStateChange?: (dragging: boolean) => void
  onClipContextMenu?: (clipId: string, x: number, y: number) => void
}

type DragMode = 'move' | 'trim-start' | 'trim-end' | null
const DRAG_EPSILON_SECONDS = 0.0001
const DRAG_THRESHOLD_PX = 8

const TimelineClipBlock: React.FC<TimelineClipBlockProps> = ({
  clip,
  trackTopY,
  timeToX,
  xToTime,
  pixelsPerSecond,
  seekTo,
  snap,
  scrollLeft,
  containerRect,
  trackType,
  trackCount,
  baseTrackTop,
  onDragStateChange,
  onClipContextMenu
}) => {
  const {
    selectedClipId,
    selectedClipIds,
    selectClip,
    moveClip,
    trimClipEdge,
    operationsByClip,
    linkedGroups,
    toggleGroupLink,
    clips
  } = useProjectStore()

  const [dragMode, setDragMode] = useState<DragMode>(null)
  const dragStartRef = useRef({ clientX: 0, startTime: 0, visibleDuration: 0, pointerId: -1 })
  const dragThresholdPassedRef = useRef(false)
  const historyCapturedRef = useRef(false)
  const [dragOriginTime, setDragOriginTime] = useState<number | null>(null)
  const [previewUrls, setPreviewUrls] = useState<{ video?: string; audio?: string }>({})
  const isSelected = selectedClipIds.includes(clip.id)
  const isPrimary = clip.id === selectedClipId

  // Get trim values for this clip
  const ops = operationsByClip[clip.id]
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
  const bgNormal = isVideo
    ? 'bg-timeline-video/15'
    : 'bg-timeline-audio/15'
  const bgSelected = isVideo
    ? 'bg-timeline-video/30'
    : 'bg-timeline-audio/28'
  const borderNormal = isVideo
    ? 'border-timeline-video/30'
    : 'border-timeline-audio/30'
  const borderSelected = isVideo
    ? 'border-timeline-video shadow-[0_0_0_1px_rgb(var(--timeline-video)/0.24),0_8px_18px_rgb(0_0_0/0.24)]'
    : 'border-timeline-audio shadow-[0_0_0_1px_rgb(var(--timeline-audio)/0.22),0_8px_18px_rgb(0_0_0/0.24)]'
  const textColor = isSelected
    ? (isVideo ? 'text-blue-100' : 'text-emerald-100')
    : 'text-text-secondary'

  const groupClipCount = clips.filter((c) => c.groupId === clip.groupId).length
  const isLinked = linkedGroups[clip.groupId] !== false

  const formatRate = (rate: number): string => {
    const str = rate.toFixed(2).replace(/\.?0+$/, '')
    return `${str}x`
  }

  const buildBadges = (): string[] => {
    const opsForClip = operationsByClip[clip.id] || []
    const speedOp = opsForClip.find((op) => op.type === 'speed' && op.enabled)
    const volumeOp = opsForClip.find((op) => op.type === 'volume' && op.enabled)
    const pitchOp = opsForClip.find((op) => op.type === 'pitch' && op.enabled)
    const transformOp = opsForClip.find((op) => op.type === 'transform' && op.enabled)
    const badges: string[] = []
    if (speedOp) {
      badges.push(`速 ${formatRate((speedOp.params as SpeedParams).rate)}`)
    }
    if (volumeOp) {
      const percent = (volumeOp.params as VolumeParams).percent
      badges.push(`音量 ${Math.round(percent)}%`)
    }
    if (pitchOp) {
      const percent = (pitchOp.params as PitchParams).percent
      badges.push(`音调 ${Math.round(percent)}%`)
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
        badges.push('构图')
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
        ? { video: { height: TRACK_HEIGHT - 6, frames: 12 } }
        : { audio: { width: 800, height: TRACK_HEIGHT - 8 } }
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

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const mode = e.shiftKey ? 'range' : (e.ctrlKey || e.metaKey ? 'toggle' : 'single')
      selectClip(clip.id, mode)
    },
    [selectClip, clip.id]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selectedClipIds.includes(clip.id)) {
        selectClip(clip.id, 'single')
      }
      onClipContextMenu?.(clip.id, e.clientX, e.clientY)
    },
    [clip.id, onClipContextMenu, selectClip, selectedClipIds]
  )

  // Drag start for move
  const handleMoveStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      // Ignore if near edges (trim handles take priority)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const localX = e.clientX - rect.left
      if (localX < HANDLE_WIDTH + 2 || localX > rect.width - HANDLE_WIDTH - 2) return

      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      if (!selectedClipIds.includes(clip.id)) {
        selectClip(clip.id, 'single')
      }
      setDragMode('move')
      dragThresholdPassedRef.current = false
      historyCapturedRef.current = false
      dragStartRef.current = {
        clientX: e.clientX,
        startTime: clip.startTime,
        visibleDuration,
        pointerId: e.pointerId
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, selectClip, trimStart, trimEnd, selectedClipIds]
  )

  // Drag start for trim
  const handleTrimStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, edge: 'trim-start' | 'trim-end') => {
      if (e.button !== 0) return
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      if (!selectedClipIds.includes(clip.id)) {
        selectClip(clip.id, 'single')
      }
      setDragMode(edge)
      dragThresholdPassedRef.current = false
      historyCapturedRef.current = false
      dragStartRef.current = {
        clientX: e.clientX,
        startTime: clip.startTime,
        visibleDuration,
        pointerId: e.pointerId
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, selectClip, trimStart, trimEnd, selectedClipIds]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragMode || e.pointerId !== dragStartRef.current.pointerId) return
      const deltaPx = e.clientX - dragStartRef.current.clientX
      if (!dragThresholdPassedRef.current) {
        if (Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
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
          let nextTrackIndex = Math.floor(relativeY / (TRACK_HEIGHT + TRACK_GAP))
          nextTrackIndex = clamp(nextTrackIndex, 0, Math.max(trackCount - 1, 0))
          const hasEffectiveChange =
            Math.abs(newStart - clip.startTime) > DRAG_EPSILON_SECONDS || nextTrackIndex !== clip.trackIndex
          if (!hasEffectiveChange) return
          const recordHistory = !historyCapturedRef.current
          moveClip(clip.id, { startTime: newStart, trackIndex: nextTrackIndex }, { recordHistory })
          historyCapturedRef.current = true
        } else {
          if (Math.abs(newStart - clip.startTime) <= DRAG_EPSILON_SECONDS) return
          const recordHistory = !historyCapturedRef.current
          moveClip(clip.id, { startTime: newStart }, { recordHistory })
          historyCapturedRef.current = true
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
      snap, moveClip, trimClipEdge, containerRect, baseTrackTop, trackCount
    ])

    const finishPointerDrag = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragMode || e.pointerId !== dragStartRef.current.pointerId) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      setDragMode(null)
      setDragOriginTime(null)
      historyCapturedRef.current = false
      dragThresholdPassedRef.current = false
      snap.clearSnapLine()
    }, [dragMode, snap])

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
      aria-pressed={isSelected}
      aria-label={`${isVideo ? '视频' : '音频'}片段 ${fileName}，时长 ${formatTime(visibleDuration)}`}
      className={`absolute overflow-hidden rounded-sm border select-none outline-none focus-visible:ring-2 focus-visible:ring-accent
        ${isSelected ? bgSelected : bgNormal}
        ${isSelected ? borderSelected : borderNormal}
        ${dragMode === 'move' && dragThresholdPassedRef.current ? '-translate-y-0.5 scale-[1.01] opacity-90 shadow-floating' : ''}
        will-change-transform transition-[transform,box-shadow,opacity] duration-fast
      `}
      style={{
        top: trackTopY,
        left: clipX,
        width: clipWidth,
        height: TRACK_HEIGHT,
        zIndex: isPrimary ? 11 : isSelected ? 10 : 5
      }}
      onClick={handleClick}
      onKeyDown={(event) => {
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
      {groupClipCount > 1 && (
        <button
          className="absolute left-1 top-1 z-20 rounded bg-black/40 text-white/80 hover:text-white hover:bg-black/60
                     px-1 py-[1px] text-[9px] pointer-events-auto"
          title={isLinked ? '取消链接' : '链接音画'}
          onClick={(e) => {
            e.stopPropagation()
            toggleGroupLink(clip.groupId)
          }}
        >
          {isLinked ? 'LINK' : 'UNLINK'}
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
      <div className="flex items-center h-full px-2.5 pointer-events-none overflow-hidden">
        <div className="flex flex-col min-w-0">
          <span className={`text-[11px] font-medium truncate leading-tight ${textColor}`}>
            {fileName}
          </span>
          <span className="text-[9px] text-text-muted/70 font-mono truncate leading-tight">
            {formatTime(visibleDuration)}
          </span>
        </div>
      </div>

      {/* Drag delta badge */}
      {dragMode === 'move' && (
        <div className="absolute left-1 bottom-1 z-20 px-1 py-[1px] rounded bg-black/40 text-white/80 text-[9px] pointer-events-none">
          {dragDelta >= 0 ? '+' : ''}
          {formatTime(Math.abs(dragDelta))}
        </div>
      )}

      {/* Operation badges */}
      {badges.length > 0 && (
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
        isVideo ? 'bg-indigo-400/40' : 'bg-emerald-400/40'
      }`} />
    </div>
  )
}

export default React.memo(TimelineClipBlock)
