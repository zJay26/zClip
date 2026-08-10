import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { getClipTimelineRange } from '../../../../shared/timeline-utils'
import { formatTime } from '../../lib/utils'
import { Button } from '../ui'
import { usePreferences } from '../../contexts/preferences'

const FadeControl: React.FC = () => {
  const { t } = usePreferences()
  const {
    clips,
    operationsByClip,
    selectedClipId,
    linkedGroups,
    audioFades,
    addAudioFade,
    deleteAudioFade
  } = useProjectStore(useShallow((state) => ({
    clips: state.clips,
    operationsByClip: state.operationsByClip,
    selectedClipId: state.selectedClipId,
    linkedGroups: state.linkedGroups,
    audioFades: state.audioFades,
    addAudioFade: state.addAudioFade,
    deleteAudioFade: state.deleteAudioFade
  })))

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
          {t('添加淡入', 'Add fade in')}
        </Button>
        <Button
          size="sm"
          variant={fades.some((fade) => fade.kind === 'out') ? 'primary' : 'secondary'}
          disabled={!targetAudioClip}
          onClick={() => addAudioFade('out')}
        >
          {t('添加淡出', 'Add fade out')}
        </Button>
      </div>

      {!targetAudioClip && (
        <p className="text-xs text-text-muted">{t('请选择音频片段，或选择已链接音频的视频片段。', 'Select an audio clip or a video clip with linked audio.')}</p>
      )}

      {targetAudioClip && (
        <div className="space-y-1.5">
          {fades.length === 0 && (
            <p className="text-xs text-text-muted">{t('当前音频未添加淡入或淡出。', 'No audio fades have been added.')}</p>
          )}
          {fades.map((fade) => (
            <div
              key={fade.id}
              className="flex items-center justify-between gap-2 rounded-sm border border-border bg-panel-muted px-2 py-1.5 text-xs"
            >
              <span className="text-text-secondary">
                {fade.kind === 'in' ? t('淡入', 'Fade in') : t('淡出', 'Fade out')} · {formatTime(Math.max(0, fade.endOffset - fade.startOffset))}
              </span>
              <button
                className="text-text-muted hover:text-text-primary"
                onClick={() => deleteAudioFade(fade.id)}
              >
                {t('删除', 'Delete')}
              </button>
            </div>
          ))}
          <p className="text-[10px] text-text-muted">{t(`音频时长 ${formatTime(duration)}`, `Audio duration ${formatTime(duration)}`)}</p>
        </div>
      )}
    </div>
  )
}

export default FadeControl
