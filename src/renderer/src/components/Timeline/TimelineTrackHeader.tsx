// ============================================================
// TimelineTrackHeader — 左侧轨道标签 (V1/V2/A1/A2)
// ============================================================

import React from 'react'
import { RULER_HEIGHT, TRACK_HEIGHT, TRACK_GAP, GROUP_GAP, HEADER_WIDTH } from './timeline-constants'

interface TimelineTrackHeaderProps {
  videoTrackCount: number
  audioTrackCount: number
  addVideoTrack: () => void
  removeVideoTrack: () => void
  addAudioTrack: () => void
  removeAudioTrack: () => void
}

interface TrackActionButtonProps {
  onClick: () => void
  title: string
  type: 'add' | 'remove'
}

const TrackActionButton: React.FC<TrackActionButtonProps> = ({ onClick, title, type }) => (
  <button
    className="relative w-5 h-5 rounded text-text-muted hover:text-text-secondary hover:bg-surface-lighter transition-colors"
    onClick={onClick}
    title={title}
    aria-label={title}
  >
    <span className="absolute left-1/2 top-1/2 w-2.5 h-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
    {type === 'add' && (
      <span className="absolute left-1/2 top-1/2 w-0.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
    )}
  </button>
)

const TimelineTrackHeader: React.FC<TimelineTrackHeaderProps> = ({
  videoTrackCount,
  audioTrackCount,
  addVideoTrack,
  removeVideoTrack,
  addAudioTrack,
  removeAudioTrack
}) => {
  const videoAreaHeight = videoTrackCount * TRACK_HEIGHT + Math.max(0, videoTrackCount - 1) * TRACK_GAP
  const audioAreaHeight = audioTrackCount * TRACK_HEIGHT + Math.max(0, audioTrackCount - 1) * TRACK_GAP

  return (
    <div
      className="shrink-0 border-r border-surface-border bg-surface-light select-none"
      style={{ width: HEADER_WIDTH }}
    >
      {/* Ruler spacer */}
      <div
        className="border-b border-surface-border flex items-center justify-center"
        style={{ height: RULER_HEIGHT }}
      >
        <span className="text-[9px] text-text-muted font-mono">TC</span>
      </div>

      {/* Video tracks */}
      <div style={{ height: videoAreaHeight }}>
        {Array.from({ length: videoTrackCount }).map((_, i) => (
          <div
            key={`vt-${i}`}
            className="flex items-center justify-between px-1.5"
            style={{
              height: TRACK_HEIGHT,
              marginTop: i > 0 ? TRACK_GAP : 0
            }}
          >
            <span className="text-[11px] font-mono font-semibold text-indigo-400/80">
              V{i + 1}
            </span>
            {i === videoTrackCount - 1 && (
              <div className="flex items-center gap-0.5">
                <TrackActionButton onClick={removeVideoTrack} title="减少画面轨道" type="remove" />
                <TrackActionButton onClick={addVideoTrack} title="增加画面轨道" type="add" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Separator */}
      <div className="flex items-center px-1" style={{ height: GROUP_GAP }}>
        <div className="flex-1 h-px bg-surface-border" />
      </div>

      {/* Audio tracks */}
      <div style={{ height: audioAreaHeight }}>
        {Array.from({ length: audioTrackCount }).map((_, i) => (
          <div
            key={`at-${i}`}
            className="flex items-center justify-between px-1.5"
            style={{
              height: TRACK_HEIGHT,
              marginTop: i > 0 ? TRACK_GAP : 0
            }}
          >
            <span className="text-[11px] font-mono font-semibold text-emerald-400/80">
              A{i + 1}
            </span>
            {i === audioTrackCount - 1 && (
              <div className="flex items-center gap-0.5">
                <TrackActionButton onClick={removeAudioTrack} title="减少音频轨道" type="remove" />
                <TrackActionButton onClick={addAudioTrack} title="增加音频轨道" type="add" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(TimelineTrackHeader)
