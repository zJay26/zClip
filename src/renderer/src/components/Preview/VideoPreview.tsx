// ============================================================
// VideoPreview — 视频/音频预览区域
// 自动识别纯音频文件，展示不同 UI
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Film, Pause, Play, SkipBack, SkipForward, Upload } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { formatTime, mediaUrlToPath, toMediaUrl } from '../../lib/utils'
import {
  compareVideoOverlayOrder,
  getClipTimelineRange,
  getTopmostVideoClipAtTime,
  timelineTimeToMediaTime
} from '../../../../shared/timeline-utils'
import { Badge, Button, IconButton } from '../ui'
import type { ClipTimelineRange } from '../../../../shared/timeline-utils'
import type {
  MediaOperation,
  TimelineClip,
  TimelineTransition,
  TransformParams,
  TransitionEffectType
} from '../../../../shared/types'
import { translate, usePreferences } from '../../contexts/preferences'

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>
  onLoadedMetadata: () => void
  onEnded: () => void
  togglePlay: () => void
  step: (seconds: number) => void
  onOpenFiles: () => void
}

function getSourceFrameRect(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fit: TransformParams['fit']
): { left: number; top: number; width: number; height: number } {
  if (fit === 'stretch' || sourceWidth <= 0 || sourceHeight <= 0) {
    return { left: 0, top: 0, width: canvasWidth, height: canvasHeight }
  }

  const canvasAspect = canvasWidth / canvasHeight
  const sourceAspect = sourceWidth / sourceHeight
  const useCanvasWidth =
    fit === 'cover'
      ? sourceAspect < canvasAspect
      : sourceAspect > canvasAspect
  const width = useCanvasWidth ? canvasWidth : canvasHeight * sourceAspect
  const height = useCanvasWidth ? canvasWidth / sourceAspect : canvasHeight
  return {
    left: (canvasWidth - width) / 2,
    top: (canvasHeight - height) / 2,
    width,
    height
  }
}

type TransitionSide = 'left' | 'right'

interface ActiveTransitionPreview {
  transition: TimelineTransition
  leftClip: TimelineClip
  rightClip: TimelineClip
  leftRange: ClipTimelineRange
  rightRange: ClipTimelineRange
  start: number
  end: number
  boundary: number
  progress: number
}

const DEFAULT_TRANSFORM: TransformParams = {
  fit: 'contain',
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 100,
  flipX: false,
  flipY: false
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clamp01(value: number): number {
  return clampValue(Number.isFinite(value) ? value : 0, 0, 1)
}

function getClipTransform(
  clip: TimelineClip | null,
  operationsByClip: Record<string, MediaOperation[]>
): TransformParams {
  if (!clip) return DEFAULT_TRANSFORM
  const transformOp = operationsByClip[clip.id]?.find((op) => op.type === 'transform' && op.enabled)
  return {
    ...DEFAULT_TRANSFORM,
    ...(transformOp?.params as Partial<TransformParams> | undefined)
  }
}

function buildVideoLayerStyle(
  transform: TransformParams,
  canvasWidth: number,
  canvasHeight: number,
  opacityMultiplier = 1,
  transformPrefix = ''
): React.CSSProperties {
  const objectFit =
    transform.fit === 'cover' ? 'cover' : transform.fit === 'stretch' ? 'fill' : 'contain'
  const flipX = transform.flipX ? -1 : 1
  const flipY = transform.flipY ? -1 : 1
  const translateX = canvasWidth > 0 ? (transform.x / canvasWidth) * 100 : 0
  const translateY = canvasHeight > 0 ? (transform.y / canvasHeight) * 100 : 0
  const baseTransform = `translate(${translateX}%, ${translateY}%) scale(${transform.scale * flipX}, ${transform.scale * flipY}) rotate(${transform.rotation}deg)`

  return {
    width: '100%',
    height: '100%',
    objectFit,
    opacity: clamp01(transform.opacity / 100) * clamp01(opacityMultiplier),
    transform: `${transformPrefix}${baseTransform}`.trim(),
    transformOrigin: 'center center'
  }
}

function findActiveTransitionPreview(
  transitions: TimelineTransition[],
  clips: TimelineClip[],
  operationsByClip: Record<string, MediaOperation[]>,
  currentTime: number
): ActiveTransitionPreview | null {
  let active: ActiveTransitionPreview | null = null
  transitions.forEach((transition) => {
    const leftClip = clips.find((clip) => clip.id === transition.leftClipId)
    const rightClip = clips.find((clip) => clip.id === transition.rightClipId)
    if (!leftClip || !rightClip) return
    if (leftClip.track !== 'video' || rightClip.track !== 'video') return
    if (!leftClip.mediaInfo.hasVideo || !rightClip.mediaInfo.hasVideo) return

    const leftRange = getClipTimelineRange(leftClip, operationsByClip)
    const rightRange = getClipTimelineRange(rightClip, operationsByClip)
    const boundary = (leftRange.end + rightRange.start) / 2
    const start = boundary + transition.startOffset
    const end = boundary + transition.endOffset
    if (end <= start + 0.001) return
    if (currentTime < start || currentTime > end) return

    const progress = clamp01((currentTime - start) / (end - start))
    if (!active || start > active.start) {
      active = {
        transition,
        leftClip,
        rightClip,
        leftRange,
        rightRange,
        start,
        end,
        boundary,
        progress
      }
    }
  })
  return active
}

function getTransitionLayerOpacity(
  type: TransitionEffectType,
  side: TransitionSide,
  progress: number
): number {
  if (type === 'fadeblack' || type === 'fadewhite') {
    if (side === 'left') {
      return progress < 0.5 ? 1 - progress * 2 : 0
    }
    return progress > 0.5 ? (progress - 0.5) * 2 : 0
  }
  if (type === 'crossfade') {
    return side === 'left' ? 1 - progress : progress
  }
  return 1
}

function getTransitionMatteStyle(
  type: TransitionEffectType,
  progress: number
): React.CSSProperties | null {
  if (type !== 'fadeblack' && type !== 'fadewhite') return null
  return {
    backgroundColor: type === 'fadewhite' ? '#fff' : '#000',
    opacity: 1 - Math.abs(progress * 2 - 1)
  }
}

function getTransitionLayerEffect(
  type: TransitionEffectType,
  side: TransitionSide,
  progress: number
): { clipPath?: string; transformPrefix?: string } {
  if (side !== 'right') return {}
  const hidden = (1 - progress) * 100

  if (type === 'wipeleft') {
    return { clipPath: `inset(0 0 0 ${hidden}%)` }
  }
  if (type === 'wiperight') {
    return { clipPath: `inset(0 ${hidden}% 0 0)` }
  }
  if (type === 'slideleft') {
    return { transformPrefix: `translateX(${hidden}%) ` }
  }
  if (type === 'slideright') {
    return { transformPrefix: `translateX(${-hidden}%) ` }
  }
  return {}
}

function getTransitionMediaTime(
  preview: ActiveTransitionPreview,
  side: TransitionSide
): number {
  const duration = preview.end - preview.start
  if (side === 'left') {
    const raw = preview.leftRange.trimEnd - (1 - preview.progress) * duration * preview.leftRange.speedRate
    return clampValue(raw, preview.leftRange.trimStart, preview.leftRange.trimEnd)
  }
  const raw = preview.rightRange.trimStart + preview.progress * duration * preview.rightRange.speedRate
  return clampValue(raw, preview.rightRange.trimStart, preview.rightRange.trimEnd)
}

function getClipPlaybackPath(clip: TimelineClip): string {
  return clip.mediaInfo.playbackPath || clip.filePath
}

function normalizeMediaSource(value: string): string {
  return mediaUrlToPath(value).replace(/\\/g, '/')
}

function isSameMediaSource(currentSrc: string, expectedSrc: string): boolean {
  if (!currentSrc) return false
  const current = normalizeMediaSource(currentSrc)
  const expected = normalizeMediaSource(expectedSrc)
  return current === expected || current.endsWith(expected)
}

function syncTransitionVideo(
  video: HTMLVideoElement | null,
  clip: TimelineClip,
  mediaTime: number,
  speedRate: number,
  shouldPlay: boolean,
  cleanup: Array<() => void>
): void {
  if (!video) return

  const expectedSrc = toMediaUrl(getClipPlaybackPath(clip))
  const currentSrc = video.currentSrc || video.src || ''
  if (!isSameMediaSource(currentSrc, expectedSrc)) {
    video.pause()
    video.src = expectedSrc
    video.load()
  }

  video.muted = true
  const speed = Math.max(0.05, speedRate)
  if (video.playbackRate !== speed) {
    video.playbackRate = speed
  }

  const seek = (): void => {
    if (!Number.isFinite(mediaTime)) return
    const threshold = shouldPlay ? 0.12 : 0.01
    if (Math.abs(video.currentTime - mediaTime) > threshold) {
      try {
        video.currentTime = mediaTime
      } catch {
        // The media may still be loading. The next sync pass will seek again.
      }
    }
  }

  if (video.readyState >= 1) {
    seek()
  } else {
    const handleLoaded = (): void => seek()
    video.addEventListener('loadedmetadata', handleLoaded, { once: true })
    cleanup.push(() => video.removeEventListener('loadedmetadata', handleLoaded))
  }

  if (shouldPlay) {
    video.play().catch(() => undefined)
  } else {
    video.pause()
  }
}

const PreviewVideoLayer: React.FC<{
  clip: TimelineClip
  operationsByClip: Record<string, MediaOperation[]>
  currentTime: number
  playing: boolean
  style: React.CSSProperties
}> = ({ clip, operationsByClip, currentTime, playing, style }) => {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const cleanup: Array<() => void> = []
    const range = getClipTimelineRange(clip, operationsByClip)
    syncTransitionVideo(
      ref.current,
      clip,
      timelineTimeToMediaTime(clip, operationsByClip, currentTime),
      range.speedRate,
      playing,
      cleanup
    )
    return () => cleanup.forEach((dispose) => dispose())
  }, [clip, currentTime, operationsByClip, playing])
  return <video ref={ref} className="pointer-events-none absolute inset-0" style={style} muted playsInline aria-hidden="true" />
}

const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoRef,
  onLoadedMetadata,
  onEnded,
  togglePlay,
  step,
  onOpenFiles
}) => {
  const { t } = usePreferences()
  const {
    playing,
    currentTime,
    timelineDuration,
    clips,
    operationsByClip,
    transitions,
    projectSettings,
    selectedClipId,
    showToast,
    activateClip,
    setTransform,
    beginHistoryTransaction,
    commitHistoryTransaction
  } = useProjectStore(useShallow((state) => ({
    playing: state.playing,
    currentTime: state.currentTime,
    timelineDuration: state.timelineDuration,
    clips: state.clips,
    operationsByClip: state.operationsByClip,
    transitions: state.transitions,
    projectSettings: state.projectSettings,
    selectedClipId: state.selectedClipId,
    showToast: state.showToast,
    activateClip: state.activateClip,
    setTransform: state.setTransform,
    beginHistoryTransaction: state.beginHistoryTransaction,
    commitHistoryTransaction: state.commitHistoryTransaction
  })))

  const canvasRef = useRef<HTMLDivElement>(null)
  const transitionLeftVideoRef = useRef<HTMLVideoElement>(null)
  const transitionRightVideoRef = useRef<HTMLVideoElement>(null)
  const transformDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    transformX: number
    transformY: number
  } | null>(null)

  const activeVideoClip = getTopmostVideoClipAtTime(clips, operationsByClip, currentTime)
  const activeTransitionPreview = useMemo(
    () => findActiveTransitionPreview(transitions, clips, operationsByClip, currentTime),
    [clips, currentTime, operationsByClip, transitions]
  )

  const previewSourceClip = activeVideoClip ?? activeTransitionPreview?.leftClip ?? null
  const sourceFile = previewSourceClip?.filePath ?? null
  const mediaInfo = previewSourceClip?.mediaInfo ?? null
  const pixelFormat = mediaInfo?.pixelFormat || ''
  const playbackProxyFailed = mediaInfo?.playbackProxyFailed
  const isLikelyUnsupported = Boolean(
    mediaInfo?.hasVideo &&
    pixelFormat &&
    !['yuv420p', 'yuvj420p', 'nv12', 'p010le', 'yuv420p10le'].includes(pixelFormat)
  )

  const sourceCanvasClip = useMemo(() => clips
    .filter((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
    .sort((a, b) => a.startTime - b.startTime || a.trackIndex - b.trackIndex || a.id.localeCompare(b.id))[0] ?? null,
  [clips])
  const canvasWidth = projectSettings.canvas.preset === 'source' && sourceCanvasClip?.mediaInfo.width
    ? sourceCanvasClip.mediaInfo.width
    : projectSettings.canvas.width
  const canvasHeight = projectSettings.canvas.preset === 'source' && sourceCanvasClip?.mediaInfo.height
    ? sourceCanvasClip.mediaInfo.height
    : projectSettings.canvas.height
  const activeVideoLayers = useMemo(() => clips
    .filter((clip) => {
      if (clip.track !== 'video' || !clip.mediaInfo.hasVideo) return false
      const range = getClipTimelineRange(clip, operationsByClip)
      return currentTime >= range.start && currentTime < range.end
    })
    .sort(compareVideoOverlayOrder), [clips, currentTime, operationsByClip])
  const supportingVideoLayers = activeVideoLayers.filter((clip) => clip.id !== activeVideoClip?.id)

  const hasActiveVideoClip = !!activeVideoClip
  const hasTransitionPreview = !!activeTransitionPreview
  const transform = getClipTransform(activeVideoClip, operationsByClip)
  const finishTransformDrag = useCallback(() => {
    if (!transformDragRef.current) return
    transformDragRef.current = null
    commitHistoryTransaction()
  }, [commitHistoryTransaction])

  useEffect(() => () => finishTransformDrag(), [finishTransformDrag])

  const beginTransformDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeVideoClip || activeTransitionPreview || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    activateClip(activeVideoClip.id)
    beginHistoryTransaction()
    transformDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      transformX: transform.x,
      transformY: transform.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [activateClip, activeTransitionPreview, activeVideoClip, beginHistoryTransaction, transform.x, transform.y])

  const moveTransformDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = transformDragRef.current
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !rect || rect.width <= 0 || rect.height <= 0) return
    event.preventDefault()
    setTransform({
      x: Math.round(drag.transformX + (event.clientX - drag.startX) * canvasWidth / rect.width),
      y: Math.round(drag.transformY + (event.clientY - drag.startY) * canvasHeight / rect.height)
    }, { recordHistory: false })
  }, [canvasHeight, canvasWidth, setTransform])
  const mainVideoStyle = buildVideoLayerStyle(
    transform,
    canvasWidth,
    canvasHeight,
    hasTransitionPreview ? 0 : 1
  )
  mainVideoStyle.zIndex = Math.max(1, activeVideoLayers.findIndex((clip) => clip.id === activeVideoClip?.id) + 1)
  const transitionLeftTransform = getClipTransform(activeTransitionPreview?.leftClip ?? null, operationsByClip)
  const transitionRightTransform = getClipTransform(activeTransitionPreview?.rightClip ?? null, operationsByClip)
  const rightTransitionEffect = activeTransitionPreview
    ? getTransitionLayerEffect(
        activeTransitionPreview.transition.type,
        'right',
        activeTransitionPreview.progress
      )
    : {}
  const transitionLeftVideoStyle: React.CSSProperties | undefined = activeTransitionPreview
    ? {
        ...buildVideoLayerStyle(
          transitionLeftTransform,
          canvasWidth,
          canvasHeight,
          getTransitionLayerOpacity(
            activeTransitionPreview.transition.type,
            'left',
            activeTransitionPreview.progress
          )
        ),
        zIndex: 101
      }
    : undefined
  const transitionRightVideoStyle: React.CSSProperties | undefined = activeTransitionPreview
    ? {
        ...buildVideoLayerStyle(
          transitionRightTransform,
          canvasWidth,
          canvasHeight,
          getTransitionLayerOpacity(
            activeTransitionPreview.transition.type,
            'right',
            activeTransitionPreview.progress
          ),
          rightTransitionEffect.transformPrefix
        ),
        clipPath: rightTransitionEffect.clipPath,
        zIndex: 102
      }
    : undefined
  const transitionMatteStyle = activeTransitionPreview
    ? getTransitionMatteStyle(activeTransitionPreview.transition.type, activeTransitionPreview.progress)
    : null

  useEffect(() => {
    if (!activeTransitionPreview) {
      transitionLeftVideoRef.current?.pause()
      transitionRightVideoRef.current?.pause()
      return
    }

    const cleanup: Array<() => void> = []
    syncTransitionVideo(
      transitionLeftVideoRef.current,
      activeTransitionPreview.leftClip,
      getTransitionMediaTime(activeTransitionPreview, 'left'),
      activeTransitionPreview.leftRange.speedRate,
      playing,
      cleanup
    )
    syncTransitionVideo(
      transitionRightVideoRef.current,
      activeTransitionPreview.rightClip,
      getTransitionMediaTime(activeTransitionPreview, 'right'),
      activeTransitionPreview.rightRange.speedRate,
      playing,
      cleanup
    )
    return () => {
      cleanup.forEach((dispose) => dispose())
    }
  }, [activeTransitionPreview, playing])

  const canvasStyle: React.CSSProperties = {
    aspectRatio: `${canvasWidth} / ${canvasHeight}`,
    backgroundColor: projectSettings.canvas.backgroundColor,
    height: '100%',
    width: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.85), 0 18px 42px rgba(0, 0, 0, 0.4)'
  }
  const previewStageStyle: React.CSSProperties = {
    backgroundColor: 'rgb(var(--canvas-bg))',
    backgroundImage:
      'linear-gradient(45deg, rgb(var(--text-primary) / 0.045) 25%, transparent 25%), linear-gradient(-45deg, rgb(var(--text-primary) / 0.045) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgb(var(--text-primary) / 0.045) 75%), linear-gradient(-45deg, transparent 75%, rgb(var(--text-primary) / 0.045) 75%)',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
    backgroundSize: '24px 24px'
  }
  const sourceFrameRect = getSourceFrameRect(
    canvasWidth,
    canvasHeight,
    mediaInfo?.width || canvasWidth,
    mediaInfo?.height || canvasHeight,
    transform.fit
  )
  const sourceFrameStyle: React.CSSProperties = {
    left: `${(sourceFrameRect.left / canvasWidth) * 100}%`,
    top: `${(sourceFrameRect.top / canvasHeight) * 100}%`,
    width: `${(sourceFrameRect.width / canvasWidth) * 100}%`,
    height: `${(sourceFrameRect.height / canvasHeight) * 100}%`,
    border: `1px dashed ${selectedClipId === activeVideoClip?.id ? 'rgb(var(--accent))' : 'rgba(255, 255, 255, 0.7)'}`,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(0, 0, 0, 0.35)'
  }
  const playbackControls = (
    <div className="ui-material flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1.5">
      <IconButton label={t('后退 5 秒', 'Back 5 seconds')} icon={<SkipBack aria-hidden size={16} fill="currentColor" />} onClick={() => step(-5)} />
      <IconButton
        label={playing ? t('暂停', 'Pause') : t('播放', 'Play')}
        variant="primary"
        icon={playing ? <Pause aria-hidden size={17} fill="currentColor" /> : <Play aria-hidden size={17} fill="currentColor" />}
        onClick={togglePlay}
      />
      <IconButton label={t('前进 5 秒', 'Forward 5 seconds')} icon={<SkipForward aria-hidden size={16} fill="currentColor" />} onClick={() => step(5)} />
      <div className="flex-1" />
      <span className="px-1 font-mono text-xs tabular-nums text-text-secondary">
        {formatTime(currentTime)} <span className="text-text-muted">/ {formatTime(timelineDuration)}</span>
      </span>
      {mediaInfo ? <Badge>{`${mediaInfo.width}×${mediaInfo.height} · ${mediaInfo.fps} fps`}</Badge> : <Badge>J / K / L</Badge>}
      {isLikelyUnsupported && <Badge tone="danger">{t(`像素格式可能不兼容：${pixelFormat}`, `Pixel format may be incompatible: ${pixelFormat}`)}</Badge>}
      {playbackProxyFailed && <Badge tone="danger">{t('代理生成失败', 'Proxy generation failed')}</Badge>}
    </div>
  )

  if (clips.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-bg-canvas">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: 'linear-gradient(rgb(var(--border-subtle) / 0.18) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border-subtle) / 0.18) 1px, transparent 1px)',
            backgroundSize: '32px 32px'
          }}
        />
        <div className="relative max-w-md px-8 text-center">
          <div aria-hidden className="mx-auto mb-6 w-72 overflow-hidden rounded-lg border border-border bg-panel/90 shadow-panel">
            <div className="relative flex h-24 items-center justify-center bg-bg-canvas">
              <Film size={24} strokeWidth={1.35} className="text-text-muted" />
              <span className="absolute bottom-2 right-3 font-mono text-[9px] tabular-nums text-text-muted">00:00:00</span>
            </div>
            <div className="relative h-16 border-t border-border-subtle bg-panel-muted/75">
              <div className="absolute left-3 right-3 top-3 h-3 rounded-xs border border-timeline-video/35 bg-timeline-video/20" />
              <div className="absolute left-3 right-12 top-9 h-2.5 rounded-xs border border-timeline-audio/35 bg-timeline-audio/20" />
              <div className="absolute bottom-0 left-[38%] top-0 w-px bg-danger shadow-[0_0_5px_rgb(var(--danger)/0.45)]">
                <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-danger" />
              </div>
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-text-primary">{t('把第一段素材放上时间线', 'Put your first clip on the timeline')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t('选择视频或音频，或直接从资源管理器拖到窗口中。', 'Choose video or audio, or drag it here from File Explorer.')}</p>
          <Button className="mt-5" size="lg" variant="primary" leadingIcon={<Upload aria-hidden size={17} strokeWidth={1.75} />} onClick={onOpenFiles}>
            {t('导入媒体', 'Import media')}
          </Button>
          <p className="mt-4 text-[11px] text-text-muted">{t('支持常见视频与音频格式 · 所有处理均在本地完成', 'Common video and audio formats · Everything is processed locally')}</p>
        </div>
      </div>
    )
  }

  if (!sourceFile) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div
          className="flex-1 flex items-center justify-center rounded-lg overflow-hidden min-h-0"
          style={previewStageStyle}
        >
        </div>
        <div className="mt-2">{playbackControls}</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Media container */}
      <div
        className="flex-1 flex items-center justify-center rounded-lg overflow-hidden min-h-0 relative"
        style={previewStageStyle}
      >
        <div ref={canvasRef} className="relative overflow-hidden" style={canvasStyle}>
        {!hasActiveVideoClip && !hasTransitionPreview && (
          <div className="absolute inset-0 bg-black" />
        )}
        {supportingVideoLayers
          .filter((clip) => !activeTransitionPreview || (
            clip.id !== activeTransitionPreview.leftClip.id && clip.id !== activeTransitionPreview.rightClip.id
          ))
          .map((clip, index) => (
            <PreviewVideoLayer
              key={clip.id}
              clip={clip}
              operationsByClip={operationsByClip}
              currentTime={currentTime}
              playing={playing}
              style={{
                ...buildVideoLayerStyle(getClipTransform(clip, operationsByClip), canvasWidth, canvasHeight),
                zIndex: index + 1
              }}
            />
          ))}
        {hasActiveVideoClip && (
          /* Video: normal <video> element */
          <video
            ref={videoRef}
            className="absolute inset-0"
            style={mainVideoStyle}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            loop={false}
            onError={(e) => {
              const error = e.currentTarget.error
              console.error('Video playback error:', error)
              // An unsupported source can fail once while its compatible proxy
              // is still being generated. The media path update will retry with
              // that proxy, so avoid presenting the expected transient failure
              // as a terminal codec error.
              if (isLikelyUnsupported && !playbackProxyFailed) return
              showToast(
                playbackProxyFailed
                  ? translate('视频兼容代理生成失败，请检查素材文件', 'Compatible video proxy generation failed. Check the media file.')
                  : translate(
                      `视频预览加载失败${error?.code ? `（错误码 ${error.code}）` : ''}`,
                      `Video preview failed to load${error?.code ? ` (error code ${error.code})` : ''}`
                    ),
                'error'
              )
            }}
            playsInline
          />
        )}
        {activeTransitionPreview && transitionLeftVideoStyle && transitionRightVideoStyle && (
          <>
            <video
              ref={transitionLeftVideoRef}
              className="absolute inset-0 pointer-events-none"
              style={transitionLeftVideoStyle}
              muted
              playsInline
              aria-hidden="true"
            />
            <video
              ref={transitionRightVideoRef}
              className="absolute inset-0 pointer-events-none"
              style={transitionRightVideoStyle}
              muted
              playsInline
              aria-hidden="true"
            />
            {transitionMatteStyle && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ ...transitionMatteStyle, zIndex: 4 }}
              />
            )}
          </>
        )}
        {hasActiveVideoClip && (
          <div
            role="group"
            tabIndex={0}
            data-preview-transform-handle
            aria-label={t('拖动调整当前视频片段位置；方向键微调', 'Drag to position the current video clip; use arrow keys for fine adjustments')}
            className={`absolute inset-0 touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent ${activeTransitionPreview ? 'pointer-events-none' : 'cursor-move'}`}
            style={{
              transform: mainVideoStyle.transform,
              transformOrigin: 'center center'
            }}
            onPointerDown={beginTransformDrag}
            onPointerMove={moveTransformDrag}
            onPointerUp={(event) => {
              if (transformDragRef.current?.pointerId !== event.pointerId) return
              event.currentTarget.releasePointerCapture(event.pointerId)
              finishTransformDrag()
            }}
            onPointerCancel={finishTransformDrag}
            onLostPointerCapture={finishTransformDrag}
            onKeyDown={(event) => {
              if (!activeVideoClip || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault()
              activateClip(activeVideoClip.id)
              const amount = event.shiftKey ? 10 : 1
              setTransform({
                x: transform.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
                y: transform.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)
              })
            }}
          >
            <div
              className="absolute"
              style={sourceFrameStyle}
            />
          </div>
        )}
        </div>
      </div>

      <div className="mt-2">{playbackControls}</div>
    </div>
  )
}

export default VideoPreview
