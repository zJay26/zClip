// ============================================================
// Timeline — 多轨时间轴主容器 (PR-style overhaul)
// 组合 Ruler、TrackHeader、ClipBlock、Playhead、Snap
// ============================================================

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime } from '../../lib/utils'
import {
  RULER_HEIGHT,
  TRACK_HEIGHT,
  TRACK_GAP,
  GROUP_GAP,
  MAX_ZOOM,
  MIN_ZOOM,
  HEADER_WIDTH
} from './timeline-constants'
import { useTimelineZoom } from './useTimelineZoom'
import { useSnap } from './useSnap'
import TimelineRuler from './TimelineRuler'
import TimelineTrackHeader from './TimelineTrackHeader'
import TimelineClipBlock from './TimelineClipBlock'
import TimelinePlayhead from './TimelinePlayhead'
import type { TrimParams } from '../../../../shared/types'
import { Badge, Button, Panel } from '../ui'

interface TimelineProps {
  seekTo: (time: number) => void
}

const Timeline: React.FC<TimelineProps> = ({ seekTo }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    clips,
    selectedClipId,
    timelineDuration,
    videoTrackCount,
    audioTrackCount,
    currentTime,
    playing,
    operationsByClip,
    selectClip,
    addVideoTrack,
    removeVideoTrack,
    addAudioTrack,
    removeAudioTrack,
    splitClipAtPlayhead,
    mergeSelectedClips,
    getMergeSelectionState,
    selectedClipIds
  } = useProjectStore()

  const snap = useSnap()

  const {
    zoom,
    setZoom,
    pixelsPerSecond,
    totalWidth,
    handleWheel,
    zoomToFit,
    timeToX,
    xToTime
  } = useTimelineZoom(containerRef, timelineDuration)

  const [isDragging, setIsDragging] = useState(false)

  // Track container rect (update on scroll / resize)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  const updateContainerRect = useCallback(() => {
    const el = containerRef.current
    if (el) {
      setContainerRect(el.getBoundingClientRect())
      setScrollLeft(el.scrollLeft)
    }
  }, [])

  useEffect(() => {
    updateContainerRect()
    const el = containerRef.current
    if (!el) return

    const handleScroll = (): void => {
      setScrollLeft(el.scrollLeft)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(updateContainerRect)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [updateContainerRect])

  // Layout calculations
  const videoAreaHeight = videoTrackCount * TRACK_HEIGHT + Math.max(0, videoTrackCount - 1) * TRACK_GAP
  const audioAreaHeight = audioTrackCount * TRACK_HEIGHT + Math.max(0, audioTrackCount - 1) * TRACK_GAP
  const trackAreaTop = RULER_HEIGHT
  const audioTrackTop = trackAreaTop + videoAreaHeight + GROUP_GAP
  const trackAreaHeight = videoAreaHeight + audioAreaHeight + GROUP_GAP

  // Filter clips by track type
  const videoClips = useMemo(() => clips.filter((c) => c.track === 'video'), [clips])
  const audioClips = useMemo(() => clips.filter((c) => c.track === 'audio'), [clips])

  // Click on empty area = seek
  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Only if clicking directly on background (not on clip or handle)
      if (e.target !== e.currentTarget) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left + el.scrollLeft
      seekTo(xToTime(x))
    },
    [seekTo, xToTime]
  )

  // Selected clip trim info for display
  const selectedClipTrimInfo = useMemo(() => {
    if (!selectedClipId) return null
    const clip = clips.find((c) => c.id === selectedClipId)
    if (!clip) return null
    const ops = operationsByClip[clip.id]
    const trimOp = ops?.find((op) => op.type === 'trim')
    const params = trimOp?.params as TrimParams | undefined
    return {
      trimStart: params?.startTime ?? 0,
      trimEnd: params?.endTime ?? clip.duration
    }
  }, [selectedClipId, clips, operationsByClip])

  const mergeSelectionState = useMemo(
    () => getMergeSelectionState(),
    [getMergeSelectionState, clips, selectedClipId, selectedClipIds]
  )

  if (timelineDuration <= 0) return null

  const handleWheelWithLock = useCallback(
    (e: React.WheelEvent) => {
      if (isDragging) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      handleWheel(e)
    },
    [handleWheel, isDragging]
  )

  return (
    <Panel className="flex flex-col bg-panel overflow-hidden">
      {/* Main area: header + scrollable tracks */}
      <div className="flex">
        {/* Left: Track headers */}
        <TimelineTrackHeader
          videoTrackCount={videoTrackCount}
          audioTrackCount={audioTrackCount}
          addVideoTrack={addVideoTrack}
          removeVideoTrack={removeVideoTrack}
          addAudioTrack={addAudioTrack}
          removeAudioTrack={removeAudioTrack}
        />

        {/* Right: Scrollable timeline area */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-x-auto overflow-y-hidden select-none"
          style={{ height: RULER_HEIGHT + trackAreaHeight + 4 }}
          onWheel={handleWheelWithLock}
        >
          <div className="relative" style={{ width: totalWidth, height: '100%' }}>
            {/* Ruler */}
            <TimelineRuler
              totalWidth={totalWidth}
              pixelsPerSecond={pixelsPerSecond}
              timelineDuration={timelineDuration}
              timeToX={timeToX}
              xToTime={xToTime}
              seekTo={seekTo}
              scrollLeft={scrollLeft}
              containerRect={containerRect}
            />

            {/* Track backgrounds - clickable empty area */}
            <div
              className="absolute left-0 right-0"
              style={{
                top: trackAreaTop,
                height: trackAreaHeight
              }}
              onClick={handleBackgroundClick}
            >
              {/* Video track backgrounds */}
              {Array.from({ length: videoTrackCount }).map((_, i) => (
                <div
                  key={`vbg-${i}`}
                  className={`absolute left-0 right-0 rounded-sm border border-surface-border/20
                    ${i % 2 === 0 ? 'bg-surface/30' : 'bg-surface/50'}`}
                  style={{
                    top: i * (TRACK_HEIGHT + TRACK_GAP),
                    height: TRACK_HEIGHT
                  }}
                />
              ))}

              {/* Audio track backgrounds */}
              {Array.from({ length: audioTrackCount }).map((_, i) => (
                <div
                  key={`abg-${i}`}
                  className={`absolute left-0 right-0 rounded-sm border border-surface-border/20
                    ${i % 2 === 0 ? 'bg-surface/30' : 'bg-surface/50'}`}
                  style={{
                    top: videoAreaHeight + GROUP_GAP + i * (TRACK_HEIGHT + TRACK_GAP),
                    height: TRACK_HEIGHT
                  }}
                />
              ))}

              {/* Group separator line */}
              <div
                className="absolute left-0 right-0 h-px bg-surface-border/40"
                style={{ top: videoAreaHeight + GROUP_GAP / 2 }}
              />
            </div>

            {/* Video clips */}
            {videoClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={trackAreaTop + clip.trackIndex * (TRACK_HEIGHT + TRACK_GAP)}
                timeToX={timeToX}
                xToTime={xToTime}
                pixelsPerSecond={pixelsPerSecond}
                seekTo={seekTo}
                snap={snap}
                scrollLeft={scrollLeft}
                containerRect={containerRect}
                trackType="video"
                trackCount={videoTrackCount}
                baseTrackTop={trackAreaTop}
                onDragStateChange={setIsDragging}
              />
            ))}

            {/* Audio clips */}
            {audioClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={audioTrackTop + clip.trackIndex * (TRACK_HEIGHT + TRACK_GAP)}
                timeToX={timeToX}
                xToTime={xToTime}
                pixelsPerSecond={pixelsPerSecond}
                seekTo={seekTo}
                snap={snap}
                scrollLeft={scrollLeft}
                containerRect={containerRect}
                trackType="audio"
                trackCount={audioTrackCount}
                baseTrackTop={audioTrackTop}
                onDragStateChange={setIsDragging}
              />
            ))}

            {/* Snap line */}
            {snap.snapLineTime !== null && (
              <div
                className="absolute top-0 w-px pointer-events-none z-20"
                style={{
                  left: timeToX(snap.snapLineTime),
                  height: RULER_HEIGHT + trackAreaHeight,
                  background: '#facc15',
                  boxShadow: '0 0 6px rgba(250,204,21,0.5)'
                }}
              />
            )}

            {/* Playhead */}
            <TimelinePlayhead
              currentTime={currentTime}
              timeToX={timeToX}
              xToTime={xToTime}
              seekTo={seekTo}
              trackAreaHeight={trackAreaHeight}
              playing={playing}
              containerRef={containerRef}
              scrollLeft={scrollLeft}
              containerRect={containerRect}
            />
          </div>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-panel">
        {/* Zoom controls */}
        <Badge className="uppercase tracking-wider font-mono">缩放</Badge>
        <input
          type="range"
          min={MIN_ZOOM * 0.5}
          max={MAX_ZOOM}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="w-20 accent-accent"
        />
        {/* Zoom to fit */}
        <Button onClick={zoomToFit} size="sm" variant="secondary" className="text-[10px]" title="适配全部">
          适配
        </Button>

        {/* Separator */}
        <div className="w-px h-3 bg-surface-border" />

        {/* Razor / Split button */}
        <Button onClick={splitClipAtPlayhead} size="sm" variant="secondary" className="text-[10px]" title="在播放头位置分割 (C)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="2" x2="12" y2="22" />
            <path d="M4 12h4M16 12h4" />
          </svg>
          分割
        </Button>

        {/* Merge button */}
        <Button
          onClick={mergeSelectedClips}
          disabled={!mergeSelectionState.canMerge}
          size="sm"
          variant={mergeSelectionState.canMerge ? 'primary' : 'secondary'}
          className="text-[10px]"
          title={mergeSelectionState.canMerge ? '合并所选片段' : (mergeSelectionState.disabledReason || '当前选区不可合并')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v6a4 4 0 0 0 4 4h4" />
            <path d="M16 21v-6a4 4 0 0 0-4-4H8" />
          </svg>
          合并
        </Button>

        <div className="flex-1" />

        {/* Current time display */}
        <span className="text-[11px] font-mono text-text-secondary">
          {formatTime(currentTime)}
        </span>

        {/* Trim info for selected clip */}
        {selectedClipTrimInfo && (
          <>
            <div className="w-px h-3 bg-surface-border" />
            <span className="text-[10px] font-mono text-text-muted px-1">
              入点/出点: {formatTime(selectedClipTrimInfo.trimStart)} – {formatTime(selectedClipTrimInfo.trimEnd)}
            </span>
          </>
        )}
      </div>
    </Panel>
  )
}

export default Timeline
