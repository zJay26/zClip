import React, { useRef, useState } from 'react'
import type { SubtitleCue } from '../../../../shared/types'
import { MAX_SUBTITLE_CUES, MAX_SUBTITLE_TEXT } from '../../../../shared/project-validation'
import { usePreferences } from '../../contexts/preferences'
import { formatTime, uid } from '../../lib/utils'
import { useProjectStore } from '../../stores/project-store'
import { Button, Dialog } from '../ui'

function floorToCentisecond(seconds: number): number {
  // Keep exact decimal endpoints such as 1.15 despite binary floating-point error.
  return Math.floor(seconds * 100 + 1e-8) / 100
}

export default function SubtitleControl({ seekTo }: { seekTo: (time: number) => void }): React.ReactElement {
  const { t } = usePreferences()
  const cues = useProjectStore((state) => state.subtitles)
  const duration = useProjectStore((state) => state.timelineDuration)
  const hasVideo = useProjectStore((state) => state.clips.some((clip) => clip.track === 'video'))
  const [draft, setDraft] = useState<SubtitleCue | null>(null)
  const [error, setError] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  function edit(cue: SubtitleCue): void {
    seekTo(cue.startTime)
    setError('')
    setDraft({ ...cue })
  }

  function add(): void {
    const state = useProjectStore.getState()
    const startTime = floorToCentisecond(state.currentTime)
    const next = cues.find((cue) => cue.endTime > startTime)
    if (next && next.startTime <= startTime) {
      state.showToast(t('此处已有字幕，请编辑已有字幕或移动播放头', 'A cue is already here. Edit it or move the playhead.'))
      return
    }
    const endTime = floorToCentisecond(Math.min(startTime + 2, next?.startTime ?? duration, duration))
    if (endTime <= startTime) {
      state.showToast(t('请将播放头移到时间线结束前', 'Move the playhead before the end of the timeline.'))
      return
    }
    edit({ id: uid(), startTime, endTime, text: '' })
  }

  function apply(event: React.FormEvent): void {
    event.preventDefault()
    if (!draft) return
    if (!useProjectStore.getState().saveSubtitle(draft)) {
      setError(t('请输入有效文字，并检查起止时间是否在时间线内且与其他字幕无重叠。', 'Enter valid text and a non-overlapping interval within the timeline.'))
      return
    }
    seekTo(draft.startTime)
    setDraft(null)
  }

  return <div className="space-y-3 p-4">
    <Button variant="primary" onClick={add} disabled={!hasVideo || cues.length >= MAX_SUBTITLE_CUES}>
      {t('在播放头添加字幕', 'Add subtitle at playhead')}
    </Button>
    {!hasVideo && <p className="text-xs text-text-muted">{t('先向时间线添加视频。', 'Add a video to the timeline first.')}</p>}
    {cues.map((cue) => <div key={cue.id} className="flex items-center gap-2">
      <button className="min-w-0 flex-1 rounded-sm px-2 py-1 text-left hover:bg-panel-hover"
        onClick={() => edit(cue)}>
        <span className="block font-mono text-[11px] text-text-muted">{formatTime(cue.startTime)} – {formatTime(cue.endTime)}</span>
        <span className="block truncate text-sm">{cue.text}</span>
      </button>
      <Button size="sm" onClick={() => useProjectStore.getState().deleteSubtitle(cue.id)}
        aria-label={t('删除字幕', 'Delete subtitle') + ' ' + cue.text}>{t('删除', 'Delete')}</Button>
    </div>)}
    {draft && <Dialog open title={t('编辑字幕', 'Edit subtitle')} onClose={() => setDraft(null)} initialFocusRef={textRef}>
      <form onSubmit={apply} className="space-y-4">
        <label className="block text-sm">{t('字幕文字', 'Subtitle text')}
          <textarea ref={textRef} className="ui-input mt-1 block w-full" required rows={3} maxLength={MAX_SUBTITLE_TEXT}
            value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(['startTime', 'endTime'] as const).map((key) => <label key={key} className="text-sm">
            {key === 'startTime' ? t('开始（秒）', 'Start (s)') : t('结束（秒）', 'End (s)')}
            <input type="number" className="ui-input mt-1 w-full" required min={0} max={duration} step="0.01"
              value={Number.isFinite(draft[key]) ? draft[key] : ''}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.valueAsNumber })} />
          </label>)}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="primary">{t('应用字幕', 'Apply subtitle')}</Button>
      </form>
    </Dialog>}
  </div>
}
