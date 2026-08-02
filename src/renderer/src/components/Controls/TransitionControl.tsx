import React, { useState } from 'react'
import { ArrowLeftRight, Blend, CircleDotDashed, GripVertical } from 'lucide-react'
import type { TransitionEffectType } from '../../../../shared/types'
import { useProjectStore } from '../../stores/project-store'
import { usePreferences } from '../../contexts/preferences'

export const TRANSITION_DRAG_MIME = 'application/x-zclip-transition'

export const TRANSITION_EFFECTS: Array<{
  type: TransitionEffectType
  label: string
  labelEn: string
  desc: string
  descEn: string
}> = [
  { type: 'crossfade', label: '叠化', labelEn: 'Crossfade', desc: '柔和衔接', descEn: 'Soft blend' },
  { type: 'fadeblack', label: '淡黑', labelEn: 'Fade to black', desc: '过黑场', descEn: 'Through black' },
  { type: 'fadewhite', label: '淡白', labelEn: 'Fade to white', desc: '过白场', descEn: 'Through white' },
  { type: 'wipeleft', label: '左擦除', labelEn: 'Wipe left', desc: '横向揭示', descEn: 'Horizontal reveal' },
  { type: 'wiperight', label: '右擦除', labelEn: 'Wipe right', desc: '横向揭示', descEn: 'Horizontal reveal' },
  { type: 'slideleft', label: '左滑动', labelEn: 'Slide left', desc: '画面推移', descEn: 'Sliding frame' },
  { type: 'slideright', label: '右滑动', labelEn: 'Slide right', desc: '画面推移', descEn: 'Sliding frame' }
]

const TransitionControl: React.FC = () => {
  const { t } = usePreferences()
  const [dragging, setDragging] = useState<TransitionEffectType | null>(null)
  const currentTime = useProjectStore((state) => state.currentTime)
  const selectedClipId = useProjectStore((state) => state.selectedClipId)
  const clips = useProjectStore((state) => state.clips)
  const addTransitionAtTime = useProjectStore((state) => state.addTransitionAtTime)
  const showToast = useProjectStore((state) => state.showToast)

  const addAtPlayhead = (type: TransitionEffectType): void => {
    const selected = clips.find((clip) => clip.id === selectedClipId && clip.track === 'video')
    const added = addTransitionAtTime(type, currentTime, selected?.trackIndex ?? 0)
    showToast(
      added ? t('已在播放头位置添加转场', 'Transition added at the playhead') : t('播放头附近没有可衔接的两个视频片段', 'No adjacent video clips near the playhead'),
      added ? 'success' : 'info'
    )
  }
  return (
    <div>
      <p className="mb-2 text-[11px] leading-relaxed text-text-muted">{t('拖到两个片段的衔接处，或按 Enter 在播放头位置添加。', 'Drag to a cut, or press Enter to add at the playhead.')}</p>
      <div className="grid grid-cols-2 gap-2">
      {TRANSITION_EFFECTS.map((effect) => {
        const Icon = effect.type === 'crossfade' ? Blend : effect.type === 'fadeblack' || effect.type === 'fadewhite' ? CircleDotDashed : ArrowLeftRight
        return (
        <button
          type="button"
          key={effect.type}
          draggable
          aria-label={`${t(effect.label, effect.labelEn)}: ${t(effect.desc, effect.descEn)}`}
          onDragStart={(event) => {
            setDragging(effect.type)
            event.dataTransfer.setData(TRANSITION_DRAG_MIME, effect.type)
            event.dataTransfer.setData('text/plain', `zclip-transition:${effect.type}`)
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onDragEnd={() => setDragging(null)}
          onClick={() => addAtPlayhead(effect.type)}
          className={`group w-full cursor-grab rounded-md border px-2.5 py-2.5 text-left outline-none transition-[transform,border-color,background-color,opacity] duration-fast active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent ${
            dragging === effect.type
              ? 'scale-[0.98] border-accent/70 bg-accent/10 opacity-60'
              : 'border-border-subtle bg-panel-muted hover:-translate-y-0.5 hover:border-accent/55 hover:bg-panel-hover'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-bg-base/55 text-accent-soft">
              <Icon aria-hidden size={15} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-text-primary">{t(effect.label, effect.labelEn)}</span>
              <span className="mt-0.5 block text-[10px] text-text-muted">{t(effect.desc, effect.descEn)}</span>
            </span>
            <GripVertical aria-hidden size={13} className="mt-1 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </button>
      )})}
      </div>
    </div>
  )
}

export default TransitionControl
