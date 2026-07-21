// ============================================================
// TimelineTrackHeader — 左侧轨道标签 (V1/V2/A1/A2)
// ============================================================

import React from 'react'
import { HEADER_WIDTH, RULER_HEIGHT } from './timeline-constants'

interface TimelineTrackHeaderProps {
  videoTrackCount: number
  audioTrackCount: number
  addVideoTrack: () => void
  removeVideoTrack: () => void
  addAudioTrack: () => void
  removeAudioTrack: () => void
  trackHeight: number
  trackGap: number
  groupGap: number
}

interface TrackActionButtonProps {
  onClick: () => void
  title: string
  type: 'add' | 'remove'
  size: number
}

const TrackActionButton: React.FC<TrackActionButtonProps> = ({ onClick, title, type, size }) => (
  <button
    className="relative shrink-0 rounded text-text-muted transition-colors hover:bg-surface-lighter hover:text-text-secondary"
    style={{ width: size, height: size }}
    onClick={onClick}
    title={title}
    aria-label={title}
  >
    <span className="absolute left-1/2 top-1/2 h-px w-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
    {type === 'add' && (
      <span className="absolute left-1/2 top-1/2 h-[55%] w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
    )}
  </button>
)

const TimelineTrackHeader: React.FC<TimelineTrackHeaderProps> = ({
  videoTrackCount,
  audioTrackCount,
  addVideoTrack,
  removeVideoTrack,
  addAudioTrack,
  removeAudioTrack,
  trackHeight,
  trackGap,
  groupGap
}) => {
  const videoAreaHeight = videoTrackCount * trackHeight + Math.max(0, videoTrackCount - 1) * trackGap
  const audioAreaHeight = audioTrackCount * trackHeight + Math.max(0, audioTrackCount - 1) * trackGap
  const actionSize = Math.max(6, Math.min(20, trackHeight - 2))
  const labelFontSize = Math.max(6, Math.min(11, trackHeight * 0.55))

  return (
    <div
      className="h-full shrink-0 overflow-hidden border-r border-surface-border bg-surface-light select-none"
      style={{ width: HEADER_WIDTH }}
    >
      <div
        className="flex items-center justify-center border-b border-surface-border bg-surface-light"
        style={{ height: RULER_HEIGHT }}
      >
        <span className="font-mono text-[9px] text-text-muted">TC</span>
      </div>

      <div style={{ height: videoAreaHeight }}>
        {Array.from({ length: videoTrackCount }).map((_, i) => (
          <div
            key={`vt-${i}`}
            className="flex items-center justify-between overflow-hidden px-1.5"
            style={{ height: trackHeight, marginTop: i > 0 ? trackGap : 0 }}
          >
            <span
              className="font-mono font-semibold leading-none text-indigo-400/80"
              style={{ fontSize: labelFontSize }}
            >
              V{i + 1}
            </span>
            {i === videoTrackCount - 1 && (
              <div className="flex items-center gap-0.5">
                <TrackActionButton onClick={removeVideoTrack} title="减少画面轨道" type="remove" size={actionSize} />
                <TrackActionButton onClick={addVideoTrack} title="增加画面轨道" type="add" size={actionSize} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center px-1" style={{ height: groupGap }}>
        <div className="h-px flex-1 bg-surface-border" />
      </div>

      <div style={{ height: audioAreaHeight }}>
        {Array.from({ length: audioTrackCount }).map((_, i) => (
          <div
            key={`at-${i}`}
            className="flex items-center justify-between overflow-hidden px-1.5"
            style={{ height: trackHeight, marginTop: i > 0 ? trackGap : 0 }}
          >
            <span
              className="font-mono font-semibold leading-none text-emerald-400/80"
              style={{ fontSize: labelFontSize }}
            >
              A{i + 1}
            </span>
            {i === audioTrackCount - 1 && (
              <div className="flex items-center gap-0.5">
                <TrackActionButton onClick={removeAudioTrack} title="减少音频轨道" type="remove" size={actionSize} />
                <TrackActionButton onClick={addAudioTrack} title="增加音频轨道" type="add" size={actionSize} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(TimelineTrackHeader)
