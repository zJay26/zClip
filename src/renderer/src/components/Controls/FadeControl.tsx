import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { formatTime } from '../../lib/utils'
import { Button } from '../ui'

const FadeControl: React.FC = () => {
  const {
    clips,
    operationsByClip,
    selectedClipId,
    linkedGroups,
    audioFades,
    addAudioFade,
    deleteAudioFade
  } = useProjectStore()

  const selectedClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) : null
  const targetAudioClip =
    selectedClip?.track === 'audio'
      ? selectedClip
      : selectedClip
        ? clips.find(
            (clip) =>
              clip.track === 'audio' &&
              clip.groupId === selectedClip.groupId &&
              linkedGroups[selectedClip.groupId] !== false
          ) || null
        : null
  const fades = targetAudioClip
    ? audioFades.filter((fade) => fade.clipId === targetAudioClip.id)
    : []
  const duration = targetAudioClip
    ? getClipTimelineRange(targetAudioClip, operationsByClip).visibleDuration
    : 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant={fades.some((fade) => fade.kind === 'in') ? 'primary' : 'secondary'}
          disabled={!targetAudioClip}
          onClick={() => addAudioFade('in')}
        >
          添加淡入
        </Button>
        <Button
          size="sm"
          variant={fades.some((fade) => fade.kind === 'out') ? 'primary' : 'secondary'}
          disabled={!targetAudioClip}
          onClick={() => addAudioFade('out')}
        >
          添加淡出
        </Button>
      </div>

      {!targetAudioClip && (
        <p className="text-xs text-text-muted">请选择音频片段，或选择已链接音频的视频片段。</p>
      )}

      {targetAudioClip && (
        <div className="space-y-1.5">
          {fades.length === 0 && (
            <p className="text-xs text-text-muted">当前音频未添加淡入或淡出。</p>
          )}
          {fades.map((fade) => (
            <div
              key={fade.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-border bg-panel-muted px-2 py-1.5 text-xs"
            >
              <span className="text-text-secondary">
                {fade.kind === 'in' ? '淡入' : '淡出'} · {formatTime(Math.max(0, fade.endOffset - fade.startOffset))}
              </span>
              <button
                className="text-text-muted hover:text-text-primary"
                onClick={() => deleteAudioFade(fade.id)}
              >
                删除
              </button>
            </div>
          ))}
          <p className="text-[10px] text-text-muted">音频时长 {formatTime(duration)}</p>
        </div>
      )}
    </div>
  )
}

export default FadeControl
