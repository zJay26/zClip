// ============================================================
// Timeline — 多轨时间轴主容器 (PR-style overhaul)
// 组合 Ruler、TrackHeader、ClipBlock、Playhead、Snap
// ============================================================

import React, { useRef, useState, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'
import { Combine, Scissors, ScanLine } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime } from '../../lib/utils'
import {
  RULER_HEIGHT,
  MAX_ZOOM,
  MIN_ZOOM,
  HEADER_WIDTH,
  getAdaptiveTrackLayout
} from './timeline-constants'
import { useTimelineZoom } from './useTimelineZoom'
import { useSnap } from './useSnap'
import TimelineRuler from './TimelineRuler'
import TimelineTrackHeader from './TimelineTrackHeader'
import TimelineClipBlock from './TimelineClipBlock'
import TimelineTransitionBlock from './TimelineTransitionBlock'
import TimelineAudioFadeBlock from './TimelineAudioFadeBlock'
import TimelinePlayhead from './TimelinePlayhead'
import type { TransitionEffectType, TrimParams } from '../../../../shared/types'
import { TRANSITION_DRAG_MIME } from '../Controls/TransitionControl'
import { Badge, Button, Panel } from '../ui'

interface TimelineProps {
  seekTo: (time: number) => void
}

const CONTEXT_MENU_MARGIN = 8
const CONTEXT_MENU_ESTIMATED_WIDTH = 190
const CONTEXT_MENU_ESTIMATED_HEIGHT = 244

function hasDragType(types: DOMStringList | readonly string[], type: string): boolean {
  const typeList = types as unknown as { contains?: (targetType: string) => boolean }
  if (typeof typeList.contains === 'function') {
    return typeList.contains(type)
  }
  return Array.from(types).includes(type)
}

function getContextMenuPosition(
  x: number,
  y: number,
  width = CONTEXT_MENU_ESTIMATED_WIDTH,
  height = CONTEXT_MENU_ESTIMATED_HEIGHT
): { left: number; top: number } {
  const maxLeft = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - width - CONTEXT_MENU_MARGIN)
  const maxTop = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - height - CONTEXT_MENU_MARGIN)
  const left = Math.min(Math.max(CONTEXT_MENU_MARGIN, x), maxLeft)
  const preferredTop = y - height - CONTEXT_MENU_MARGIN
  const fallbackTop = Math.min(Math.max(CONTEXT_MENU_MARGIN, y + CONTEXT_MENU_MARGIN), maxTop)
  const top = preferredTop >= CONTEXT_MENU_MARGIN ? preferredTop : fallbackTop
  return { left, top }
}

const Timeline: React.FC<TimelineProps> = ({ seekTo }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const {
    clips,
    selectedClipId,
    timelineDuration,
    videoTrackCount,
    audioTrackCount,
    currentTime,
    playing,
    operationsByClip,
    transitions,
    audioFades,
    selectClip,
    addVideoTrack,
    removeVideoTrack,
    addAudioTrack,
    removeAudioTrack,
    splitClipAtPlayhead,
    mergeSelectedClips,
    getMergeSelectionState,
    selectedClipIds,
    copySelectedClips,
    cutSelectedClips,
    pasteCopiedClips,
    deleteSelectedClips,
    addTransitionAtTime,
    toggleGroupLink
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
  const [contextMenu, setContextMenu] = useState<{ clipId: string; x: number; y: number } | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ left: 0, top: 0 })
  const [transitionDropActive, setTransitionDropActive] = useState(false)

  // Track container rect (update on scroll / resize)
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  const updateContainerRect = useCallback(() => {
    const el = containerRef.current
    if (el) {
      setContainerRect(el.getBoundingClientRect())
      setScrollLeft(el.scrollLeft)
      setContainerHeight(el.clientHeight)
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
  const trackLayout = useMemo(
    () => getAdaptiveTrackLayout(containerHeight, videoTrackCount, audioTrackCount),
    [audioTrackCount, containerHeight, videoTrackCount]
  )
  const { trackHeight, trackGap, groupGap, videoAreaHeight, trackAreaHeight } = trackLayout
  const trackAreaTop = RULER_HEIGHT
  const audioTrackTop = trackAreaTop + videoAreaHeight + groupGap

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

  const getVideoTrackIndexFromClientY = useCallback(
    (clientY: number): number | null => {
      if (!containerRect) return null
      const y = clientY - containerRect.top
      const relativeY = y - trackAreaTop
      if (relativeY < 0 || relativeY > videoAreaHeight) return null
      return Math.max(0, Math.min(videoTrackCount - 1, Math.floor(relativeY / (trackHeight + trackGap))))
    },
    [containerRect, trackAreaTop, trackGap, trackHeight, videoAreaHeight, videoTrackCount]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!hasDragType(event.dataTransfer.types, TRANSITION_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setTransitionDropActive(true)
  }, [])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const rawType =
        event.dataTransfer.getData(TRANSITION_DRAG_MIME) ||
        event.dataTransfer.getData('text/plain').replace(/^zclip-transition:/, '')
      const type = rawType as TransitionEffectType
      if (!type) return
      setTransitionDropActive(false)
      event.preventDefault()
      event.stopPropagation()
      const el = containerRef.current
      const trackIndex = getVideoTrackIndexFromClientY(event.clientY)
      if (!el || trackIndex === null) return
      const rect = el.getBoundingClientRect()
      const x = event.clientX - rect.left + el.scrollLeft
      addTransitionAtTime(type, xToTime(x), trackIndex)
    },
    [addTransitionAtTime, getVideoTrackIndexFromClientY, xToTime]
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

  const contextClip = contextMenu
    ? clips.find((clip) => clip.id === contextMenu.clipId) || null
    : null

  const openContextMenu = useCallback((clipId: string, x: number, y: number) => {
    setContextMenu({ clipId, x, y })
    setContextMenuPosition(getContextMenuPosition(x, y))
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && contextMenuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return
    const rect = contextMenuRef.current.getBoundingClientRect()
    const next = getContextMenuPosition(contextMenu.x, contextMenu.y, rect.width, rect.height)
    setContextMenuPosition((current) =>
      Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5
        ? current
        : next
    )
  }, [contextMenu])

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
    <Panel className="flex h-full min-h-0 flex-col overflow-hidden bg-panel">
      <div className="flex min-h-11 items-center gap-2 border-b border-border-subtle bg-panel px-3 py-1.5">
        <span className="text-xs font-semibold tracking-[-0.01em] text-text-primary">时间线</span>
        <div className="mx-1 h-4 w-px bg-border-subtle" />
        <span className="text-[11px] text-text-muted">缩放</span>
        <input
          aria-label="时间线缩放"
          type="range"
          min={MIN_ZOOM * 0.5}
          max={MAX_ZOOM}
          step={0.1}
          value={zoom}
          onChange={(event) => setZoom(parseFloat(event.target.value))}
          className="w-20 accent-accent"
        />
        <Button onClick={zoomToFit} size="sm" leadingIcon={<ScanLine aria-hidden size={13} strokeWidth={1.75} />} title="适配全部片段">适配</Button>
        <div className="mx-1 h-4 w-px bg-border-subtle" />
        <Button onClick={splitClipAtPlayhead} size="sm" leadingIcon={<Scissors aria-hidden size={13} strokeWidth={1.75} />} title="在播放头位置分割 (C)">分割</Button>
        <Button
          onClick={mergeSelectedClips}
          disabled={!mergeSelectionState.canMerge}
          size="sm"
          variant={mergeSelectionState.canMerge ? 'primary' : 'secondary'}
          leadingIcon={<Combine aria-hidden size={13} strokeWidth={1.75} />}
          title={mergeSelectionState.canMerge ? '合并所选片段' : (mergeSelectionState.disabledReason || '当前选区不可合并')}
        >
          合并
        </Button>
        <div className="flex-1" />
        {selectedClipTrimInfo && (
          <span className="hidden font-mono text-[10px] tabular-nums text-text-muted xl:inline">
            入点 {formatTime(selectedClipTrimInfo.trimStart)} · 出点 {formatTime(selectedClipTrimInfo.trimEnd)}
          </span>
        )}
        <Badge className="font-mono tabular-nums text-text-primary">{formatTime(currentTime)}</Badge>
      </div>
      {/* Main area: header + scrollable tracks */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Track headers */}
        <TimelineTrackHeader
          videoTrackCount={videoTrackCount}
          audioTrackCount={audioTrackCount}
          addVideoTrack={addVideoTrack}
          removeVideoTrack={removeVideoTrack}
          addAudioTrack={addAudioTrack}
          removeAudioTrack={removeAudioTrack}
          trackHeight={trackHeight}
          trackGap={trackGap}
          groupGap={groupGap}
        />

        {/* Right: Scrollable timeline area */}
        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden select-none"
          style={{ height: '100%' }}
          onWheel={handleWheelWithLock}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTransitionDropActive(false)
          }}
          onDrop={handleDrop}
        >
          {transitionDropActive && (
            <div className="pointer-events-none absolute inset-1 z-40 flex items-center justify-center rounded-md border-2 border-dashed border-accent/60 bg-accent/10">
              <span className="ui-material rounded-full px-3 py-1.5 text-xs font-medium text-text-primary">放到相邻视频片段的交界处</span>
            </div>
          )}
          <div
            className="relative"
            style={{ width: totalWidth, height: '100%' }}
          >
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
                    top: i * (trackHeight + trackGap),
                    height: trackHeight
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
                    top: videoAreaHeight + groupGap + i * (trackHeight + trackGap),
                    height: trackHeight
                  }}
                />
              ))}

              {/* Group separator line */}
              <div
                className="absolute left-0 right-0 h-px bg-surface-border/40"
                style={{ top: videoAreaHeight + groupGap / 2 }}
              />
            </div>

            {/* Video clips */}
            {videoClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={trackAreaTop + clip.trackIndex * (trackHeight + trackGap)}
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
                trackHeight={trackHeight}
                trackGap={trackGap}
                onDragStateChange={setIsDragging}
                onClipContextMenu={openContextMenu}
              />
            ))}

            {/* Audio clips */}
            {audioClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={audioTrackTop + clip.trackIndex * (trackHeight + trackGap)}
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
                trackHeight={trackHeight}
                trackGap={trackGap}
                onDragStateChange={setIsDragging}
                onClipContextMenu={openContextMenu}
              />
            ))}

            {transitions.map((transition) => {
              const leftClip = clips.find((clip) => clip.id === transition.leftClipId)
              if (!leftClip) return null
              return (
                <TimelineTransitionBlock
                  key={transition.id}
                  transition={transition}
                  clips={clips}
                  operationsByClip={operationsByClip}
                  trackTopY={trackAreaTop + leftClip.trackIndex * (trackHeight + trackGap)}
                  trackHeight={trackHeight}
                  timeToX={timeToX}
                  pixelsPerSecond={pixelsPerSecond}
                  onDragStateChange={setIsDragging}
                />
              )
            })}

            {audioFades.map((fade) => {
              const audioClip = clips.find((clip) => clip.id === fade.clipId)
              if (!audioClip) return null
              return (
                <TimelineAudioFadeBlock
                  key={fade.id}
                  fade={fade}
                  clips={clips}
                  operationsByClip={operationsByClip}
                  trackTopY={audioTrackTop + audioClip.trackIndex * (trackHeight + trackGap)}
                  trackHeight={trackHeight}
                  timeToX={timeToX}
                  pixelsPerSecond={pixelsPerSecond}
                  onDragStateChange={setIsDragging}
                />
              )
            })}

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

      {contextMenu && contextClip && (
        <div
          ref={contextMenuRef}
          role="menu"
          className="ui-material fixed z-50 max-h-[min(80vh,280px)] min-w-[180px] overflow-y-auto rounded-md p-1.5"
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {[
            { label: '在播放头处分割', action: splitClipAtPlayhead },
            { label: '复制', action: copySelectedClips },
            { label: '剪切', action: cutSelectedClips },
            { label: '粘贴', action: pasteCopiedClips },
            { label: '删除', action: deleteSelectedClips },
            {
              label: contextClip.groupId && '音画链接/取消链接',
              action: () => toggleGroupLink(contextClip.groupId)
            }
          ].map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              role="menuitem"
              className="block min-h-8 w-full rounded-sm px-3 py-1.5 text-left text-xs text-text-secondary outline-none hover:bg-panel-hover hover:text-text-primary focus-visible:bg-panel-hover focus-visible:text-text-primary"
              onClick={() => {
                item.action()
                setContextMenu(null)
              }}
              onKeyDown={(event) => {
                const buttons = Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setContextMenu(null)
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}

export default Timeline
