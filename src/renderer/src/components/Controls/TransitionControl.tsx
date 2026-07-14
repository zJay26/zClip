import React, { useState } from 'react'
import { ArrowLeftRight, Blend, CircleDotDashed, GripVertical } from 'lucide-react'
import type { TransitionEffectType } from '../../../../shared/types'

export const TRANSITION_DRAG_MIME = 'application/x-zclip-transition'

export const TRANSITION_EFFECTS: Array<{
  type: TransitionEffectType
  label: string
  desc: string
}> = [
  { type: 'crossfade', label: '叠化', desc: '柔和衔接' },
  { type: 'fadeblack', label: '淡黑', desc: '过黑场' },
  { type: 'fadewhite', label: '淡白', desc: '过白场' },
  { type: 'wipeleft', label: '左擦除', desc: '横向揭示' },
  { type: 'wiperight', label: '右擦除', desc: '横向揭示' },
  { type: 'slideleft', label: '左滑动', desc: '画面推移' },
  { type: 'slideright', label: '右滑动', desc: '画面推移' }
]

const TransitionControl: React.FC = () => {
  const [dragging, setDragging] = useState<TransitionEffectType | null>(null)
  return (
    <div className="grid grid-cols-2 gap-2">
      {TRANSITION_EFFECTS.map((effect) => {
        const Icon = effect.type === 'crossfade' ? Blend : effect.type === 'fadeblack' || effect.type === 'fadewhite' ? CircleDotDashed : ArrowLeftRight
        return (
        <div
          key={effect.type}
          draggable
          onDragStart={(event) => {
            setDragging(effect.type)
            event.dataTransfer.setData(TRANSITION_DRAG_MIME, effect.type)
            event.dataTransfer.setData('text/plain', `zclip-transition:${effect.type}`)
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onDragEnd={() => setDragging(null)}
          className={`group cursor-grab rounded-md border px-2.5 py-2.5 transition-[transform,border-color,background-color,opacity] duration-fast active:cursor-grabbing ${
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
              <span className="block text-xs font-semibold text-text-primary">{effect.label}</span>
              <span className="mt-0.5 block text-[10px] text-text-muted">{effect.desc}</span>
            </span>
            <GripVertical aria-hidden size={13} className="mt-1 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </div>
      )})}
    </div>
  )
}

export default TransitionControl
