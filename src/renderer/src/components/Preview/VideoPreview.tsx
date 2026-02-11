// ============================================================
// VideoPreview — 视频/音频预览区域
// 自动识别纯音频文件，展示不同 UI
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime } from '../../lib/utils'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { Badge, Button, Panel } from '../ui'

function toMediaURL(filePath: string): string {
  // Windows: C:\path → file:///C:/path
  // Unix: /path → file:///path
  const normalizedPath = filePath.replace(/\\/g, '/')
  const url = normalizedPath.startsWith('/') 
    ? 'file://' + normalizedPath 
    : 'file:///' + normalizedPath
  
  return url
}

interface VideoPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>
  onLoadedMetadata: () => void
  onEnded: () => void
  togglePlay: () => void
  step: (seconds: number) => void
}

const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoRef,
  onLoadedMetadata,
  onEnded,
  togglePlay,
  step
}) => {
  const {
    playing,
    currentTime,
    timelineDuration,
    clips,
    operationsByClip,
    showToast
  } = useProjectStore()

  const activeVideoClip = clips
    .filter((clip) => clip.track === 'video')
    .sort((a, b) => {
      if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
      return a.id.localeCompare(b.id)
    })
    .find((clip) => {
    const range = getClipTimelineRange(clip, operationsByClip)
    return currentTime >= range.start && currentTime < range.end
    }) || null

  const sourceFile = activeVideoClip?.filePath ?? null
  const playbackPath = activeVideoClip?.mediaInfo?.playbackPath || sourceFile
  const mediaInfo = activeVideoClip?.mediaInfo ?? null
  const pixelFormat = mediaInfo?.pixelFormat || ''
  const playbackProxyFailed = mediaInfo?.playbackProxyFailed
  const isLikelyUnsupported = Boolean(
    mediaInfo?.hasVideo &&
    pixelFormat &&
    !['yuv420p', 'yuvj420p', 'nv12', 'p010le', 'yuv420p10le'].includes(pixelFormat)
  )

  const hasActiveVideoClip = !!activeVideoClip

  if (clips.length === 0) {
    return (
      <Panel className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-1">
          <div className="text-3xl mb-2 opacity-40">MEDIA</div>
          <p className="text-text-muted text-xl">打开一个视频或音频文件开始编辑</p>
          <p className="text-text-muted text-lg">支持拖放文件到窗口</p>
        </div>
      </Panel>
    )
  }

  if (!sourceFile) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-0">
        </div>
        {/* Playback controls bar */}
        <div className="flex items-center gap-2 px-2 py-2 mt-2 ui-panel">
          <Button onClick={() => step(-5)} variant="ghost" size="sm" title="后退5秒">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19,20 9,12 19,4" />
              <line x1="5" y1="4" x2="5" y2="20" />
            </svg>
          </Button>
          <Button onClick={togglePlay} variant="primary" size="sm" title={playing ? '暂停' : '播放'}>
            {playing ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </Button>
          <Button onClick={() => step(5)} variant="ghost" size="sm" title="前进5秒">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,4 15,12 5,20" />
              <line x1="19" y1="4" x2="19" y2="20" />
            </svg>
          </Button>
          <div className="flex-1" />
          <span className="text-xs font-mono text-text-secondary px-1">
            {formatTime(currentTime)} / {formatTime(timelineDuration)}
          </span>
          <Badge>J/K/L 快捷预览</Badge>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Media container */}
      <div className="flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-0 relative">
        {!hasActiveVideoClip && (
          <div className="absolute inset-0 bg-black" />
        )}
        {hasActiveVideoClip && (
          /* Video: normal <video> element */
          <video
            ref={videoRef}
            src={toMediaURL(playbackPath || sourceFile || '')}
            className="max-w-full max-h-full object-contain"
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
      </div>

      {/* Playback controls bar */}
      <div className="flex items-center gap-2 px-2 py-2 mt-2 ui-panel">
        {/* Step back */}
        <Button onClick={() => step(-5)} variant="ghost" size="sm" title="后退5秒">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="19,20 9,12 19,4" />
            <line x1="5" y1="4" x2="5" y2="20" />
          </svg>
        </Button>

        {/* Play/Pause */}
        <Button onClick={togglePlay} variant="primary" size="sm" title={playing ? '暂停' : '播放'}>
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </Button>

        {/* Step forward */}
        <Button onClick={() => step(5)} variant="ghost" size="sm" title="前进5秒">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5,4 15,12 5,20" />
            <line x1="19" y1="4" x2="19" y2="20" />
          </svg>
        </Button>

        {/* Time display */}
        <div className="flex-1" />
        <span className="text-xs font-mono text-text-secondary">
          {formatTime(currentTime)} / {formatTime(timelineDuration)}
        </span>

        {/* Media info badge */}
        {mediaInfo && <Badge>{`${mediaInfo.width}x${mediaInfo.height} · ${mediaInfo.fps}fps`}</Badge>}
        {isLikelyUnsupported && (
          <Badge tone="danger" className="text-xs">
            像素格式可能不兼容：{pixelFormat}
          </Badge>
        )}
        {playbackProxyFailed && (
          <Badge tone="danger" className="text-xs">
            代理生成失败，可能无法播放
          </Badge>
        )}
      </div>
    </div>
  )
}

export default VideoPreview
