// ============================================================
// Timeline — 多轨时间轴主容器 (PR-style overhaul)
// 组合 Ruler、TrackHeader、ClipBlock、Playhead、Snap
// ============================================================

import React, { useRef, useState, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'
import { Combine, Scissors, ScanLine } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
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
import type { MediaOperation, TrimParams } from '../../../../shared/types'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { getEligibleTransitionCuts } from '../../../../shared/transition-utils'
import type { TransitionCut } from '../../../../shared/transition-utils'
import { TRANSITION_DRAG_MIME, TRANSITION_EFFECTS } from '../Controls/TransitionControl'
import {
  clearActiveTransitionDragGeometry,
  dragRectIntersectsCut,
  getTransitionDragGeometry,
  getTransitionDragRect
} from '../../lib/transition-drag'
import { Badge, Button, Panel } from '../ui'
import { usePreferences } from '../../contexts/preferences'

interface TimelineProps {
  seekTo: (time: number) => void
}

const CONTEXT_MENU_MARGIN = 8
const CONTEXT_MENU_ESTIMATED_WIDTH = 190
const CONTEXT_MENU_ESTIMATED_HEIGHT = 244
const EMPTY_OPERATIONS: MediaOperation[] = []

const CurrentTimeBadge: React.FC = () => {
  const currentTime = useProjectStore((state) => state.currentTime)
  return <Badge className="font-mono tabular-nums text-text-primary">{formatTime(currentTime)}</Badge>
}

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
  const { t } = usePreferences()
  const containerRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const {
    clips,
    selectedTransitionId,
    selectedClipId,
    timelineDuration,
    videoTrackCount,
    audioTrackCount,
    operationsByClip,
    linkedGroups,
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
    showToast,
    toggleGroupLink
  } = useProjectStore(useShallow((state) => ({
    clips: state.clips,
    selectedTransitionId: state.selectedTransitionId,
    selectedClipId: state.selectedClipId,
    timelineDuration: state.timelineDuration,
    videoTrackCount: state.videoTrackCount,
    audioTrackCount: state.audioTrackCount,
    operationsByClip: state.operationsByClip,
    linkedGroups: state.linkedGroups,
    transitions: state.transitions,
    audioFades: state.audioFades,
    selectClip: state.selectClip,
    addVideoTrack: state.addVideoTrack,
    removeVideoTrack: state.removeVideoTrack,
    addAudioTrack: state.addAudioTrack,
    removeAudioTrack: state.removeAudioTrack,
    splitClipAtPlayhead: state.splitClipAtPlayhead,
    mergeSelectedClips: state.mergeSelectedClips,
    getMergeSelectionState: state.getMergeSelectionState,
    selectedClipIds: state.selectedClipIds,
    copySelectedClips: state.copySelectedClips,
    cutSelectedClips: state.cutSelectedClips,
    pasteCopiedClips: state.pasteCopiedClips,
    deleteSelectedClips: state.deleteSelectedClips,
    addTransitionAtTime: state.addTransitionAtTime,
    showToast: state.showToast,
    toggleGroupLink: state.toggleGroupLink
  })))

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
  const [transitionDrop, setTransitionDrop] = useState<{
    target: TransitionCut | null
    trackIndex: number | null
  } | null>(null)

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

    let scrollFrame = 0
    const handleScroll = (): void => {
      if (scrollFrame) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0
        setScrollLeft(el.scrollLeft)
      })
    }
    el.addEventListener('scroll', handleScroll, { passive: true })

    const resizeObserver = new ResizeObserver(updateContainerRect)
    resizeObserver.observe(el)

    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (scrollFrame) cancelAnimationFrame(scrollFrame)
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
  const visibleClips = useMemo(() => {
    const overscanPixels = 800
    const start = Math.max(0, (scrollLeft - overscanPixels) / Math.max(1, pixelsPerSecond))
    const end = (scrollLeft + (containerRect?.width || 1200) + overscanPixels) / Math.max(1, pixelsPerSecond)
    const selected = new Set(selectedClipIds)
    return clips.filter((clip) => {
      if (isDragging && selected.has(clip.id)) return true
      const range = getClipTimelineRange(clip, operationsByClip)
      return range.end >= start && range.start <= end
    })
  }, [clips, containerRect?.width, isDragging, operationsByClip, pixelsPerSecond, scrollLeft, selectedClipIds])
  const videoClips = useMemo(() => visibleClips.filter((clip) => clip.track === 'video'), [visibleClips])
  const audioClips = useMemo(() => visibleClips.filter((clip) => clip.track === 'audio'), [visibleClips])
  const visibleClipIds = useMemo(() => new Set(visibleClips.map((clip) => clip.id)), [visibleClips])
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds])
  const clipById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips])
  const selectedTimelineTransition = useMemo(
    () => transitions.find((transition) => transition.id === selectedTransitionId) ?? null,
    [selectedTransitionId, transitions]
  )
  const eligibleTransitionCuts = useMemo(
    () => getEligibleTransitionCuts(clips, operationsByClip),
    [clips, operationsByClip]
  )
  const groupClipCounts = useMemo(() => {
    const counts = new Map<string, number>()
    clips.forEach((clip) => counts.set(clip.groupId, (counts.get(clip.groupId) || 0) + 1))
    return counts
  }, [clips])

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

  const getTransitionDropTarget = useCallback((
    clientX: number,
    clientY: number,
    dataTransfer?: DataTransfer | null
  ): {
    target: TransitionCut | null
    trackIndex: number | null
  } => {
    const el = containerRef.current
    if (!el || !containerRect) return { target: null, trackIndex: null }
    const rect = el.getBoundingClientRect()
    const dragRect = getTransitionDragRect(
      clientX,
      clientY,
      getTransitionDragGeometry(dataTransfer)
    )
    const candidates = eligibleTransitionCuts
      .filter((cut) => {
        const cutClientX = rect.left + timeToX(cut.boundary) - el.scrollLeft
        const trackTop = rect.top + trackAreaTop + cut.trackIndex * (trackHeight + trackGap)
        return dragRectIntersectsCut(
          dragRect,
          cutClientX,
          trackTop,
          trackTop + trackHeight
        )
      })
      .sort((a, b) =>
        Math.hypot(
          rect.left + timeToX(a.boundary) - el.scrollLeft - dragRect.centerX,
          rect.top + trackAreaTop + a.trackIndex * (trackHeight + trackGap) + trackHeight / 2 - dragRect.centerY
        ) - Math.hypot(
          rect.left + timeToX(b.boundary) - el.scrollLeft - dragRect.centerX,
          rect.top + trackAreaTop + b.trackIndex * (trackHeight + trackGap) + trackHeight / 2 - dragRect.centerY
        )
      )
    const target = candidates[0] ?? null
    const pointerTrackIndex = getVideoTrackIndexFromClientY(clientY)
    return { target, trackIndex: target?.trackIndex ?? pointerTrackIndex }
  }, [containerRect, eligibleTransitionCuts, getVideoTrackIndexFromClientY, timeToX, trackAreaTop, trackGap, trackHeight])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    if (!hasDragType(event.dataTransfer.types, TRANSITION_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    const nextDrop = getTransitionDropTarget(event.clientX, event.clientY, event.dataTransfer)
    event.dataTransfer.dropEffect = nextDrop.target ? 'copy' : 'none'
    setTransitionDrop(nextDrop)
  }, [getTransitionDropTarget])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      const rawType =
        event.dataTransfer.getData(TRANSITION_DRAG_MIME) ||
        event.dataTransfer.getData('text/plain').replace(/^zclip-transition:/, '')
      const type = TRANSITION_EFFECTS.find((effect) => effect.type === rawType)?.type
      if (!type) return
      const drop = getTransitionDropTarget(event.clientX, event.clientY, event.dataTransfer)
      setTransitionDrop(null)
      clearActiveTransitionDragGeometry()
      event.preventDefault()
      event.stopPropagation()
      if (!drop.target) {
        showToast(
          t('无法放置：转场只支持同轨且首尾紧贴的视频剪辑点', 'Cannot drop: transitions require touching clips on the same video track'),
          'info'
        )
        return
      }
      addTransitionAtTime(type, drop.target.boundary, drop.target.trackIndex)
    },
    [addTransitionAtTime, getTransitionDropTarget, showToast, t]
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
    [getMergeSelectionState, clips, selectedClipId, selectedClipIds, t]
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

  const focusTimelineSurface = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-timeline-clip], [data-local-delete], button, input, select, textarea, [role="menuitem"]')) return
    event.currentTarget.focus({ preventScroll: true })
  }, [])

  if (timelineDuration <= 0) return null

  return (
    <Panel className="flex h-full min-h-0 flex-col overflow-hidden bg-panel">
      <div className="flex min-h-11 items-center gap-2 border-b border-border-subtle bg-panel px-3 py-1.5">
        <span className="text-xs font-semibold tracking-[-0.01em] text-text-primary">{t('时间线', 'Timeline')}</span>
        <div className="mx-1 h-4 w-px bg-border-subtle" />
        <span className="text-[11px] text-text-muted">{t('缩放', 'Zoom')}</span>
        <input
          aria-label={t('时间线缩放', 'Timeline zoom')}
          type="range"
          min={MIN_ZOOM * 0.5}
          max={MAX_ZOOM}
          step={0.1}
          value={zoom}
          onChange={(event) => setZoom(parseFloat(event.target.value))}
          className="w-20 accent-accent"
        />
        <Button onClick={zoomToFit} size="sm" leadingIcon={<ScanLine aria-hidden size={13} strokeWidth={1.75} />} title={t('适配全部片段', 'Fit all clips')}>{t('适配', 'Fit')}</Button>
        <div className="mx-1 h-4 w-px bg-border-subtle" />
        <Button onClick={splitClipAtPlayhead} size="sm" leadingIcon={<Scissors aria-hidden size={13} strokeWidth={1.75} />} title={t('在播放头位置分割 (C)', 'Split at playhead (C)')}>{t('分割', 'Split')}</Button>
        <Button
          onClick={mergeSelectedClips}
          disabled={!mergeSelectionState.canMerge}
          size="sm"
          variant={mergeSelectionState.canMerge ? 'primary' : 'secondary'}
          leadingIcon={<Combine aria-hidden size={13} strokeWidth={1.75} />}
          title={mergeSelectionState.canMerge ? t('合并所选片段', 'Merge selected clips') : (mergeSelectionState.disabledReason || t('当前选区不可合并', 'The current selection cannot be merged'))}
        >
          {t('合并', 'Merge')}
        </Button>
        <div className="flex-1" />
        {selectedClipTrimInfo && (
          <span className="hidden font-mono text-[10px] tabular-nums text-text-muted xl:inline">
            {t(`入点 ${formatTime(selectedClipTrimInfo.trimStart)} · 出点 ${formatTime(selectedClipTrimInfo.trimEnd)}`, `In ${formatTime(selectedClipTrimInfo.trimStart)} · Out ${formatTime(selectedClipTrimInfo.trimEnd)}`)}
          </span>
        )}
        {selectedTimelineTransition && (
          <Badge className="border-accent/55 bg-accent/15 text-accent-soft">
            {t('转场已选中', 'Transition selected')}
          </Badge>
        )}
        <CurrentTimeBadge />
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
          tabIndex={-1}
          data-editor-shortcut-surface
          aria-label={t('时间线编辑区', 'Timeline editor')}
          className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden select-none outline-none"
          style={{ height: '100%' }}
          onPointerDown={focusTimelineSurface}
          onWheel={handleWheelWithLock}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTransitionDrop(null)
          }}
          onDrop={handleDrop}
        >
          {transitionDrop && (
            <div
              data-transition-drop-hint
              className="pointer-events-none absolute top-2 z-50 rounded-full border border-border-subtle bg-panel/95 px-3.5 py-1.5 text-[13px] font-semibold leading-5 shadow-lg"
              style={{ left: scrollLeft + 12 }}
            >
              <span className={transitionDrop.target ? 'text-accent-soft' : 'text-text-muted'}>
                {transitionDrop.target
                  ? t('方框已碰到剪辑点，松手应用', 'The card touches the cut — release to apply')
                  : t('让方框碰到同轨、无空隙的剪辑点', 'Move the card onto a touching cut on the same track')}
              </span>
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

            {transitionDrop && eligibleTransitionCuts.map((cut) => {
              const isTarget = transitionDrop.target?.left.id === cut.left.id &&
                transitionDrop.target?.right.id === cut.right.id
              const cutX = timeToX(cut.boundary)
              const cutTop = trackAreaTop + cut.trackIndex * (trackHeight + trackGap)
              return (
                <div
                  key={`transition-cut-${cut.left.id}-${cut.right.id}`}
                  className="pointer-events-none absolute z-40"
                  style={{
                    left: cutX,
                    top: cutTop + 3,
                    height: Math.max(2, trackHeight - 6)
                  }}
                >
                  <div className={`absolute left-1/2 top-0 h-full -translate-x-1/2 ${
                    isTarget
                      ? 'w-1 bg-accent shadow-[0_0_12px_rgb(var(--accent)/0.9)]'
                      : 'w-0.5 bg-accent/55'
                  }`} />
                  <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
                    isTarget
                      ? 'h-4 w-4 border-white bg-accent shadow-[0_0_14px_rgb(var(--accent)/0.9)]'
                      : 'h-2.5 w-2.5 border-accent/70 bg-panel'
                  }`} />
                </div>
              )
            })}

            {/* Video clips */}
            {videoClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={trackAreaTop + clip.trackIndex * (trackHeight + trackGap)}
                timeToX={timeToX}
                pixelsPerSecond={pixelsPerSecond}
                snap={snap}
                containerRect={containerRect}
                trackType="video"
                trackCount={videoTrackCount}
                baseTrackTop={trackAreaTop}
                trackHeight={trackHeight}
                trackGap={trackGap}
                onDragStateChange={setIsDragging}
                onClipContextMenu={openContextMenu}
                clipOperations={operationsByClip[clip.id] || EMPTY_OPERATIONS}
                isSelected={selectedClipIdSet.has(clip.id)}
                isPrimary={selectedClipId === clip.id}
                isLinked={linkedGroups[clip.groupId] !== false}
                groupClipCount={groupClipCounts.get(clip.groupId) || 1}
              />
            ))}

            {/* Audio clips */}
            {audioClips.map((clip) => (
              <TimelineClipBlock
                key={clip.id}
                clip={clip}
                trackTopY={audioTrackTop + clip.trackIndex * (trackHeight + trackGap)}
                timeToX={timeToX}
                pixelsPerSecond={pixelsPerSecond}
                snap={snap}
                containerRect={containerRect}
                trackType="audio"
                trackCount={audioTrackCount}
                baseTrackTop={audioTrackTop}
                trackHeight={trackHeight}
                trackGap={trackGap}
                onDragStateChange={setIsDragging}
                onClipContextMenu={openContextMenu}
                clipOperations={operationsByClip[clip.id] || EMPTY_OPERATIONS}
                isSelected={selectedClipIdSet.has(clip.id)}
                isPrimary={selectedClipId === clip.id}
                isLinked={linkedGroups[clip.groupId] !== false}
                groupClipCount={groupClipCounts.get(clip.groupId) || 1}
              />
            ))}

            {transitions.filter((transition) => visibleClipIds.has(transition.leftClipId) || visibleClipIds.has(transition.rightClipId)).map((transition) => {
              const leftClip = clipById.get(transition.leftClipId)
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

            {audioFades.filter((fade) => visibleClipIds.has(fade.clipId)).map((fade) => {
              const audioClip = clipById.get(fade.clipId)
              if (!audioClip) return null
              const fadeTrackTop = audioClip.track === 'audio'
                ? audioTrackTop + audioClip.trackIndex * (trackHeight + trackGap)
                : trackAreaTop + audioClip.trackIndex * (trackHeight + trackGap)
              return (
                <TimelineAudioFadeBlock
                  key={fade.id}
                  fade={fade}
                  clips={clips}
                  operationsByClip={operationsByClip}
                  trackTopY={fadeTrackTop}
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
              timeToX={timeToX}
              xToTime={xToTime}
              seekTo={seekTo}
              trackAreaHeight={trackAreaHeight}
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
            { label: t('在播放头处分割', 'Split at playhead'), action: splitClipAtPlayhead },
            { label: t('复制', 'Copy'), action: copySelectedClips },
            { label: t('剪切', 'Cut'), action: cutSelectedClips },
            { label: t('粘贴', 'Paste'), action: pasteCopiedClips },
            { label: t('删除', 'Delete'), action: deleteSelectedClips },
            {
              label: contextClip.groupId && t('音画链接/取消链接', 'Link/unlink audio and video'),
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
