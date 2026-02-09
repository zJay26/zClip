// ============================================================
// TimelineClipBlock — 单个 Clip 块
// 包含：左右边缘裁剪手柄 + 整体拖拽移动 + snap 集成
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime, clamp } from '../../lib/utils'
import { TRACK_HEIGHT, TRACK_GAP, HANDLE_WIDTH } from './timeline-constants'
import type { SnapEngine } from './useSnap'
import type { TrimParams, TimelineClip, SpeedParams, VolumeParams, PitchParams } from '../../../../shared/types'
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
}

type DragMode = 'move' | 'trim-start' | 'trim-end' | null

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
  onDragStateChange
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
  const dragStartRef = useRef({ clientX: 0, startTime: 0, visibleDuration: 0 })
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
    ? 'bg-gradient-to-r from-indigo-600/30 to-blue-500/20'
    : 'bg-gradient-to-r from-emerald-600/30 to-green-500/20'
  const bgSelected = isVideo
    ? 'bg-gradient-to-r from-indigo-500/50 to-blue-400/35'
    : 'bg-gradient-to-r from-emerald-500/50 to-green-400/35'
  const borderNormal = isVideo
    ? 'border-indigo-500/30'
    : 'border-emerald-500/30'
  const borderSelected = isVideo
    ? 'border-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.3)]'
    : 'border-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)]'
  const textColor = isSelected
    ? (isVideo ? 'text-indigo-200' : 'text-emerald-200')
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

  const toFileUrl = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/')
    return `file:///${encodeURI(normalized)}`
  }

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
        video: res.data.videoStripPath ? toFileUrl(res.data.videoStripPath) : undefined,
        audio: res.data.audioWaveformPath ? toFileUrl(res.data.audioWaveformPath) : undefined
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

  // Drag start for move
  const handleMoveStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      // Ignore if near edges (trim handles take priority)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const localX = e.clientX - rect.left
      if (localX < HANDLE_WIDTH + 2 || localX > rect.width - HANDLE_WIDTH - 2) return

      e.preventDefault()
      e.stopPropagation()
      if (!selectedClipIds.includes(clip.id)) {
        selectClip(clip.id, 'single')
      }
      setDragMode('move')
      dragStartRef.current = {
        clientX: e.clientX,
        startTime: clip.startTime,
        visibleDuration
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, selectClip, trimStart, trimEnd, selectedClipIds]
  )

  // Drag start for trim
  const handleTrimStart = useCallback(
    (e: React.MouseEvent, edge: 'trim-start' | 'trim-end') => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      if (!selectedClipIds.includes(clip.id)) {
        selectClip(clip.id, 'single')
      }
      setDragMode(edge)
      dragStartRef.current = {
        clientX: e.clientX,
        startTime: clip.startTime,
        visibleDuration
      }
      setDragOriginTime(clip.startTime)
    },
    [clip.id, clip.startTime, selectClip, trimStart, trimEnd, selectedClipIds]
  )

  // Global drag handling
  useEffect(() => {
    if (!dragMode) return

    const handleMove = (e: MouseEvent): void => {
      const deltaPx = e.clientX - dragStartRef.current.clientX
      const deltaSec = deltaPx / pixelsPerSecond

      if (dragMode === 'move') {
        const rawTime = dragStartRef.current.startTime + deltaSec
        const snapped = snap.checkSnap(rawTime, pixelsPerSecond, clip.id)
        const newStart = Math.max(0, snapped.time)

        // Calculate track index from mouse Y
        if (containerRect) {
          const y = e.clientY - containerRect.top
          const relativeY = y - baseTrackTop
          let nextTrackIndex = Math.floor(relativeY / (TRACK_HEIGHT + TRACK_GAP))
          nextTrackIndex = clamp(nextTrackIndex, 0, Math.max(trackCount - 1, 0))
          moveClip(clip.id, { startTime: newStart, trackIndex: nextTrackIndex })
        } else {
          moveClip(clip.id, { startTime: newStart })
        }
      } else if (dragMode === 'trim-start') {
        // Snap the left edge position (timeline time)
        const rawEdgeTime = dragStartRef.current.startTime + deltaSec
        const snapped = snap.checkSnap(rawEdgeTime, pixelsPerSecond, clip.id)
        const deltaTimeline = snapped.time - clip.startTime
        trimClipEdge(clip.id, 'start', deltaTimeline)
      } else if (dragMode === 'trim-end') {
        const currentVisEnd = clip.startTime + visibleDuration
        const rawEdgeTime = dragStartRef.current.startTime + dragStartRef.current.visibleDuration + deltaSec
        const snapped = snap.checkSnap(rawEdgeTime, pixelsPerSecond, clip.id)
        const deltaTimeline = snapped.time - currentVisEnd
        trimClipEdge(clip.id, 'end', deltaTimeline)
      }
    }

    const handleUp = (): void => {
      setDragMode(null)
      setDragOriginTime(null)
      snap.clearSnapLine()
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [
    dragMode,
    pixelsPerSecond,
    clip.id,
    clip.startTime,
    snap,
    moveClip,
    trimClipEdge,
    containerRect,
    baseTrackTop,
    trackCount,
    trimStart,
    trimEnd
  ])

  useEffect(() => {
    if (!onDragStateChange) return
    onDragStateChange(dragMode !== null)
  }, [dragMode, onDragStateChange])

  const dragDelta = dragMode === 'move'
    ? clip.startTime - dragStartRef.current.startTime
    : 0

  return (
    <div
      className={`absolute rounded-sm border overflow-hidden select-none
        ${isSelected ? bgSelected : bgNormal}
        ${isSelected ? borderSelected : borderNormal}
        ${dragMode === 'move' ? 'opacity-80' : ''}
        transition-shadow duration-150
      `}
      style={{
        top: trackTopY,
        left: clipX,
        width: clipWidth,
        height: TRACK_HEIGHT,
        zIndex: isPrimary ? 11 : isSelected ? 10 : 5
      }}
      onClick={handleClick}
      onMouseDown={handleMoveStart}
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
        onMouseDown={(e) => handleTrimStart(e, 'trim-start')}
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
        onMouseDown={(e) => handleTrimStart(e, 'trim-end')}
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
