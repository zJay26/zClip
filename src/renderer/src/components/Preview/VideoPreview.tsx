// ============================================================
// VideoPreview — 视频/音频预览区域
// 自动识别纯音频文件，展示不同 UI
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime } from '../../lib/utils'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'

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

  const activeClip = clips.find((clip) => {
    const range = getClipTimelineRange(clip, operationsByClip)
    return currentTime >= range.start && currentTime < range.end
  }) || null

  const sourceFile = activeClip?.filePath ?? null
  const mediaInfo = activeClip?.mediaInfo ?? null
  const isAudioOnly = mediaInfo ? !mediaInfo.hasVideo : false
  const pixelFormat = mediaInfo?.pixelFormat || ''
  const isLikelyUnsupported = Boolean(
    mediaInfo?.hasVideo &&
    pixelFormat &&
    !['yuv420p', 'yuvj420p', 'nv12', 'p010le', 'yuv420p10le'].includes(pixelFormat)
  )

  const hasActiveClip = !!activeClip

  if (clips.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface rounded-lg border border-surface-border">
        <div className="text-center">
          <div className="text-4xl mb-3 opacity-30">🎬</div>
          <p className="text-text-muted text-sm">打开一个视频或音频文件开始编辑</p>
          <p className="text-text-muted text-[11px] mt-1">支持拖放文件到窗口</p>
        </div>
      </div>
    )
  }

  if (!sourceFile) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-0">
          <div className="absolute inset-0" onClick={togglePlay} />
        </div>
        {/* Playback controls bar */}
        <div className="flex items-center gap-3 px-2 py-2 mt-1">
          <button
            onClick={() => step(-5)}
            className="p-1.5 rounded hover:bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
            title="后退5秒"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="19,20 9,12 19,4" />
              <line x1="5" y1="4" x2="5" y2="20" />
            </svg>
          </button>
          <button
            onClick={togglePlay}
            className="p-2 rounded-full bg-accent hover:bg-accent-hover text-white transition-colors"
            title={playing ? '暂停' : '播放'}
          >
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
          </button>
          <button
            onClick={() => step(5)}
            className="p-1.5 rounded hover:bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
            title="前进5秒"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,4 15,12 5,20" />
              <line x1="19" y1="4" x2="19" y2="20" />
            </svg>
          </button>
          <div className="flex-1" />
          <span className="text-xs font-mono text-text-secondary">
            {formatTime(currentTime)} / {formatTime(timelineDuration)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Media container */}
      <div className="flex-1 flex items-center justify-center bg-black rounded-lg overflow-hidden min-h-0 relative">
        {!hasActiveClip && (
          <div className="absolute inset-0 bg-black" />
        )}
        {isAudioOnly ? (
          /* Audio-only: show a visual placeholder */
          <div className="flex flex-col items-center gap-4" onClick={togglePlay}>
            <div className="w-24 h-24 rounded-full bg-surface-light border-2 border-accent/40 flex items-center justify-center">
              {playing ? (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="text-accent ml-1">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </div>
            <div className="text-center">
              <p className="text-sm text-text-secondary font-medium">
                {sourceFile.split(/[\\/]/).pop()}
              </p>
              <p className="text-xs text-text-muted mt-1">
                {mediaInfo?.audioCodec?.toUpperCase()} · {mediaInfo?.sampleRate} Hz
              </p>
            </div>
            {/* Simple audio visualizer bar (static) */}
            <div className="flex items-end gap-[3px] h-12">
              {Array.from({ length: 32 }).map((_, i) => {
                const height = 8 + Math.sin(i * 0.5 + (playing ? currentTime * 4 : 0)) * 20 + Math.random() * (playing ? 12 : 0)
                return (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-accent/60 transition-all duration-100"
                    style={{ height: `${Math.max(4, height)}px` }}
                  />
                )
              })}
            </div>
          </div>
        ) : (
          /* Video: normal <video> element */
          <video
            ref={videoRef}
            src={toMediaURL(sourceFile)}
            className="max-w-full max-h-full object-contain"
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            onError={(e) => {
              const error = e.currentTarget.error
              console.error('Video playback error:', error)
              showToast('当前视频像素格式可能不被内置播放器支持', 'error')
            }}
            onClick={togglePlay}
            playsInline
          />
        )}

        {/* Hidden audio element for audio-only playback (shares same ref pattern) */}
        {isAudioOnly && (
          <audio
            ref={videoRef as React.RefObject<HTMLAudioElement>}
            src={toMediaURL(sourceFile)}
            onLoadedMetadata={onLoadedMetadata}
            onEnded={onEnded}
            className="hidden"
          />
        )}
      </div>

      {/* Playback controls bar */}
      <div className="flex items-center gap-3 px-2 py-2 mt-1">
        {/* Step back */}
        <button
          onClick={() => step(-5)}
          className="p-1.5 rounded hover:bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
          title="后退5秒"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="19,20 9,12 19,4" />
            <line x1="5" y1="4" x2="5" y2="20" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="p-2 rounded-full bg-accent hover:bg-accent-hover text-white transition-colors"
          title={playing ? '暂停' : '播放'}
        >
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
        </button>

        {/* Step forward */}
        <button
          onClick={() => step(5)}
          className="p-1.5 rounded hover:bg-surface-lighter text-text-secondary hover:text-text-primary transition-colors"
          title="前进5秒"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5,4 15,12 5,20" />
            <line x1="19" y1="4" x2="19" y2="20" />
          </svg>
        </button>

        {/* Time display */}
        <div className="flex-1" />
        <span className="text-xs font-mono text-text-secondary">
          {formatTime(currentTime)} / {formatTime(timelineDuration)}
        </span>

        {/* Media info badge */}
        {mediaInfo && (
          <span className="text-xs text-text-muted px-2 py-0.5 bg-surface rounded border border-surface-border">
            {mediaInfo.hasVideo
              ? `${mediaInfo.width}x${mediaInfo.height} · ${mediaInfo.fps}fps`
              : `${mediaInfo.audioCodec?.toUpperCase()} · ${mediaInfo.sampleRate}Hz`
            }
          </span>
        )}
        {isLikelyUnsupported && (
          <span className="text-xs text-red-300 px-2 py-0.5 bg-red-500/10 rounded border border-red-500/30">
            像素格式可能不兼容：{pixelFormat}
          </span>
        )}
      </div>
    </div>
  )
}

export default VideoPreview
