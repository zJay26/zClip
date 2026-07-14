// ============================================================
// VideoPreview — 视频/音频预览区域
// 自动识别纯音频文件，展示不同 UI
// ============================================================

import React, { useEffect, useMemo, useRef } from 'react'
import { Film, Pause, Play, SkipBack, SkipForward, Upload } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime, mediaUrlToPath, toMediaUrl } from '../../lib/utils'
import {
  getClipTimelineRange,
  getTopmostVideoClipAtTime
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
  const transformOp = operationsByClip[clip.id]?.find((op) => op.type === 'transform')
  return {
    ...DEFAULT_TRANSFORM,
    ...(transformOp?.params as Partial<TransformParams> | undefined)
  }
}

function buildVideoLayerStyle(
  transform: TransformParams,
  opacityMultiplier = 1,
  transformPrefix = ''
): React.CSSProperties {
  const objectFit =
    transform.fit === 'cover' ? 'cover' : transform.fit === 'stretch' ? 'fill' : 'contain'
  const flipX = transform.flipX ? -1 : 1
  const flipY = transform.flipY ? -1 : 1
  const baseTransform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale * flipX}, ${transform.scale * flipY}) rotate(${transform.rotation}deg)`

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

const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoRef,
  onLoadedMetadata,
  onEnded,
  togglePlay,
  step,
  onOpenFiles
}) => {
  const {
    playing,
    currentTime,
    timelineDuration,
    clips,
    operationsByClip,
    transitions,
    projectSettings,
    showToast
  } = useProjectStore()

  const transitionLeftVideoRef = useRef<HTMLVideoElement>(null)
  const transitionRightVideoRef = useRef<HTMLVideoElement>(null)

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

  const hasActiveVideoClip = !!activeVideoClip
  const hasTransitionPreview = !!activeTransitionPreview
  const transform = getClipTransform(activeVideoClip, operationsByClip)
  const mainVideoStyle = buildVideoLayerStyle(
    transform,
    hasTransitionPreview ? 0 : 1
  )
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
          getTransitionLayerOpacity(
            activeTransitionPreview.transition.type,
            'left',
            activeTransitionPreview.progress
          )
        ),
        zIndex: 2
      }
    : undefined
  const transitionRightVideoStyle: React.CSSProperties | undefined = activeTransitionPreview
    ? {
        ...buildVideoLayerStyle(
          transitionRightTransform,
          getTransitionLayerOpacity(
            activeTransitionPreview.transition.type,
            'right',
            activeTransitionPreview.progress
          ),
          rightTransitionEffect.transformPrefix
        ),
        clipPath: rightTransitionEffect.clipPath,
        zIndex: 3
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

  const canvasWidth =
    projectSettings.canvas.preset === 'source' && mediaInfo?.width
      ? mediaInfo.width
      : projectSettings.canvas.width
  const canvasHeight =
    projectSettings.canvas.preset === 'source' && mediaInfo?.height
      ? mediaInfo.height
      : projectSettings.canvas.height
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
      'linear-gradient(45deg, rgba(255,255,255,0.055) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.055) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.055) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.055) 75%)',
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
    border: '1px dashed rgba(255, 255, 255, 0.7)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(0, 0, 0, 0.35)'
  }
  const playbackControls = (
    <div className="ui-material flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1.5">
      <IconButton label="后退 5 秒" icon={<SkipBack aria-hidden size={16} fill="currentColor" />} onClick={() => step(-5)} />
      <IconButton
        label={playing ? '暂停' : '播放'}
        variant="primary"
        icon={playing ? <Pause aria-hidden size={17} fill="currentColor" /> : <Play aria-hidden size={17} fill="currentColor" />}
        onClick={togglePlay}
      />
      <IconButton label="前进 5 秒" icon={<SkipForward aria-hidden size={16} fill="currentColor" />} onClick={() => step(5)} />
      <div className="flex-1" />
      <span className="px-1 font-mono text-xs tabular-nums text-text-secondary">
        {formatTime(currentTime)} <span className="text-text-muted">/ {formatTime(timelineDuration)}</span>
      </span>
      {mediaInfo ? <Badge>{`${mediaInfo.width}×${mediaInfo.height} · ${mediaInfo.fps} fps`}</Badge> : <Badge>J / K / L</Badge>}
      {isLikelyUnsupported && <Badge tone="danger">像素格式可能不兼容：{pixelFormat}</Badge>}
      {playbackProxyFailed && <Badge tone="danger">代理生成失败</Badge>}
    </div>
  )

  if (clips.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-bg-canvas">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(var(--accent)/0.08),transparent_36%)]" />
        <div className="relative max-w-md px-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-border-subtle bg-panel/80 text-accent-soft shadow-panel">
            <Film aria-hidden size={28} strokeWidth={1.45} />
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-text-primary">开始创作</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">导入视频或音频，把素材拖到窗口中的任意位置也可以。</p>
          <Button className="mt-5" size="lg" variant="primary" leadingIcon={<Upload aria-hidden size={17} strokeWidth={1.75} />} onClick={onOpenFiles}>
            导入媒体
          </Button>
          <p className="mt-4 text-[11px] text-text-muted">支持常见视频与音频格式 · 所有处理均在本地完成</p>
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
        <div className="relative overflow-hidden" style={canvasStyle}>
        {!hasActiveVideoClip && !hasTransitionPreview && (
          <div className="absolute inset-0 bg-black" />
        )}
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
              showToast('当前视频像素格式可能不被内置播放器支持', 'error')
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
            className="absolute inset-0 pointer-events-none"
            style={{
              transform: mainVideoStyle.transform,
              transformOrigin: 'center center'
            }}
          >
            <div className="absolute" style={sourceFrameStyle} />
          </div>
        )}
        </div>
      </div>

      <div className="mt-2">{playbackControls}</div>
    </div>
  )
}

export default VideoPreview
