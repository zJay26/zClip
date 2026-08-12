import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Blend, Check, CircleDotDashed, GripVertical } from 'lucide-react'
import type { TransitionEffectType } from '../../../../shared/types'
import {
  MIN_TRANSITION_SIDE_DURATION,
  getTimelineTransitionTiming
} from '../../../../shared/transition-utils'
import { useProjectStore } from '../../stores/project-store'
import { usePreferences } from '../../contexts/preferences'
import { useShallow } from 'zustand/react/shallow'
import ParamSlider from '../common/ParamSlider'
import type { HistoryEditOptions } from '../../stores/project-store-types'
import {
  TRANSITION_DRAG_GEOMETRY_MIME,
  clearActiveTransitionDragGeometry,
  createTransitionDragGeometry,
  setActiveTransitionDragGeometry
} from '../../lib/transition-drag'

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

type TransitionAlignment = 'before' | 'center' | 'after'

function allocateTransitionExtents(
  requestedTotal: number,
  beforeRatio: number,
  beforeMax: number,
  afterMax: number
): { before: number; after: number } {
  const minimum = MIN_TRANSITION_SIDE_DURATION
  const total = Math.max(minimum * 2, Math.min(requestedTotal, beforeMax + afterMax))
  let before = Math.max(minimum, Math.min(beforeMax, total * beforeRatio))
  let after = total - before

  if (after < minimum) {
    after = minimum
    before = total - after
  } else if (after > afterMax) {
    after = afterMax
    before = total - after
  }
  if (before > beforeMax) {
    before = beforeMax
    after = total - before
  }

  return {
    before: Math.max(minimum, Math.min(beforeMax, before)),
    after: Math.max(minimum, Math.min(afterMax, after))
  }
}

const TransitionControl: React.FC = () => {
  const { t } = usePreferences()
  const [dragging, setDragging] = useState<TransitionEffectType | null>(null)
  useEffect(() => () => clearActiveTransitionDragGeometry(), [])
  const {
    clips,
    operationsByClip,
    transitions,
    selectedTransitionId,
    applyTransition,
    updateTransition
  } = useProjectStore(useShallow((state) => ({
    clips: state.clips,
    operationsByClip: state.operationsByClip,
    transitions: state.transitions,
    selectedTransitionId: state.selectedTransitionId,
    applyTransition: state.applyTransition,
    updateTransition: state.updateTransition
  })))
  const selectedTransition = transitions.find((transition) => transition.id === selectedTransitionId) ?? null
  const selectedEffect = selectedTransition
    ? TRANSITION_EFFECTS.find((effect) => effect.type === selectedTransition.type)
    : null
  const selectedDuration = selectedTransition
    ? selectedTransition.endOffset - selectedTransition.startOffset
    : 0
  const parameterModel = useMemo(() => {
    if (!selectedTransition) return null
    const timing = getTimelineTransitionTiming(
      selectedTransition,
      clips,
      operationsByClip
    )
    if (!timing) return null
    const incomingNeighbor = transitions.find((transition) =>
      transition.id !== selectedTransition.id && transition.rightClipId === timing.left.id
    )
    const outgoingNeighbor = transitions.find((transition) =>
      transition.id !== selectedTransition.id && transition.leftClipId === timing.right.id
    )
    const beforeMax = Math.max(
      MIN_TRANSITION_SIDE_DURATION,
      timing.leftRange.visibleDuration - (incomingNeighbor?.endOffset ?? 0)
    )
    const afterMax = Math.max(
      MIN_TRANSITION_SIDE_DURATION,
      timing.rightRange.visibleDuration - (outgoingNeighbor ? -outgoingNeighbor.startOffset : 0)
    )
    const before = -selectedTransition.startOffset
    const after = selectedTransition.endOffset
    const ratio = before / Math.max(MIN_TRANSITION_SIDE_DURATION * 2, before + after)
    const alignment: TransitionAlignment = ratio > 0.58
      ? 'before'
      : ratio < 0.42
        ? 'after'
        : 'center'
    return { timing, before, after, beforeMax, afterMax, ratio, alignment }
  }, [clips, operationsByClip, selectedTransition, transitions])

  const setTransitionDuration = (value: number, options?: HistoryEditOptions): void => {
    if (!selectedTransition || !parameterModel) return
    const extents = allocateTransitionExtents(
      value,
      parameterModel.ratio,
      parameterModel.beforeMax,
      parameterModel.afterMax
    )
    updateTransition(selectedTransition.id, {
      startOffset: -extents.before,
      endOffset: extents.after
    }, options)
  }

  const setTransitionAlignment = (alignment: TransitionAlignment): void => {
    if (!selectedTransition || !parameterModel) return
    const ratio = alignment === 'before' ? 0.65 : alignment === 'after' ? 0.35 : 0.5
    const extents = allocateTransitionExtents(
      selectedDuration,
      ratio,
      parameterModel.beforeMax,
      parameterModel.afterMax
    )
    updateTransition(selectedTransition.id, {
      startOffset: -extents.before,
      endOffset: extents.after
    })
  }

  return (
    <div>
      <div className={`mb-2.5 rounded-md border px-2.5 py-2 ${
        selectedTransition
          ? 'border-accent/55 bg-accent/10'
          : 'border-border-subtle bg-panel-muted'
      }`}>
        {selectedTransition && selectedEffect ? (
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white">
              <Check aria-hidden size={13} strokeWidth={2.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-text-primary">
                {t(`已选中：${selectedEffect.label}`, `Selected: ${selectedEffect.labelEn}`)}
              </span>
              <span className="block font-mono text-[10px] tabular-nums text-text-muted">
                {selectedDuration.toFixed(2)} s · {t('点击下方卡片可直接替换', 'Click a card below to replace it')}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-text-muted">
            {t('点击即可应用到所选片段旁的剪辑点；也可拖到时间线。', 'Click to apply beside the selected clip, or drag to the timeline.')}
          </p>
        )}
      </div>
      {selectedTransition && parameterModel && (
        <div className="mb-3 rounded-md border border-border-subtle bg-bg-base/35 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-text-primary">{t('转场参数', 'Transition settings')}</span>
            <span className="font-mono text-[11px] tabular-nums text-accent-soft">
              {selectedDuration.toFixed(2)} s
            </span>
          </div>

          <ParamSlider
            label={t('转场时长', 'Duration')}
            value={selectedDuration}
            min={MIN_TRANSITION_SIDE_DURATION * 2}
            max={parameterModel.beforeMax + parameterModel.afterMax}
            step={0.05}
            unit="s"
            disabled={parameterModel.beforeMax + parameterModel.afterMax <= MIN_TRANSITION_SIDE_DURATION * 2 + 0.001}
            onChange={setTransitionDuration}
          />

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-text-secondary">
              <span>{t('剪辑点位置', 'Cut position')}</span>
              <span className="font-mono tabular-nums text-text-muted">
                {t('前', 'Before')} {parameterModel.before.toFixed(2)} s · {t('后', 'After')} {parameterModel.after.toFixed(2)} s
              </span>
            </div>
            <div
              role="img"
              aria-label={t(
                `剪辑点前 ${parameterModel.before.toFixed(2)} 秒，剪辑点后 ${parameterModel.after.toFixed(2)} 秒`,
                `${parameterModel.before.toFixed(2)} seconds before and ${parameterModel.after.toFixed(2)} seconds after the cut`
              )}
              className="relative mb-2 h-5 overflow-hidden rounded-sm border border-border-subtle bg-panel-muted"
            >
              <div className="absolute inset-y-0 left-0 bg-accent/18" style={{ width: `${parameterModel.ratio * 100}%` }} />
              <div className="absolute inset-y-0 right-0 bg-violet-300/10" style={{ width: `${(1 - parameterModel.ratio) * 100}%` }} />
              <div
                className="absolute inset-y-0 w-px -translate-x-1/2 bg-white shadow-[0_0_8px_rgb(var(--accent)/0.9)]"
                style={{ left: `${parameterModel.ratio * 100}%` }}
              />
              <div
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-accent"
                style={{ left: `${parameterModel.ratio * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('转场剪辑点位置', 'Transition cut position')}>
              {([
                ['before', t('前段更长', 'More before')],
                ['center', t('居中', 'Centered')],
                ['after', t('后段更长', 'More after')]
              ] as Array<[TransitionAlignment, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={parameterModel.alignment === value}
                  onClick={() => setTransitionAlignment(value)}
                  className={`min-h-7 rounded-sm border px-1.5 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                    parameterModel.alignment === value
                      ? 'border-accent/70 bg-accent/15 text-accent-soft'
                      : 'border-border-subtle bg-panel-muted text-text-muted hover:border-accent/45 hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
      {TRANSITION_EFFECTS.map((effect) => {
        const Icon = effect.type === 'crossfade' ? Blend : effect.type === 'fadeblack' || effect.type === 'fadewhite' ? CircleDotDashed : ArrowLeftRight
        const isApplied = selectedTransition?.type === effect.type
        return (
        <button
          type="button"
          key={effect.type}
          draggable
          aria-pressed={isApplied}
          aria-label={`${t(effect.label, effect.labelEn)}: ${t(effect.desc, effect.descEn)}`}
          onDragStart={(event) => {
            setDragging(effect.type)
            const rect = event.currentTarget.getBoundingClientRect()
            const geometry = createTransitionDragGeometry(rect, event.clientX, event.clientY)
            setActiveTransitionDragGeometry(geometry)
            event.dataTransfer.setData(TRANSITION_DRAG_MIME, effect.type)
            event.dataTransfer.setData('text/plain', `zclip-transition:${effect.type}`)
            event.dataTransfer.setData(TRANSITION_DRAG_GEOMETRY_MIME, JSON.stringify(geometry))
            event.dataTransfer.effectAllowed = 'copy'
            event.dataTransfer.setDragImage(
              event.currentTarget,
              geometry.grabOffsetX,
              geometry.grabOffsetY
            )
          }}
          onDragEnd={() => {
            clearActiveTransitionDragGeometry()
            setDragging(null)
          }}
          onClick={() => applyTransition(effect.type)}
          className={`group w-full cursor-grab rounded-md border px-2.5 py-2.5 text-left outline-none transition-[transform,border-color,background-color,opacity] duration-fast active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent ${
            dragging === effect.type
              ? 'scale-[0.98] border-accent/70 bg-accent/10 opacity-60'
              : isApplied
                ? 'border-accent bg-accent/15 shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.2)]'
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
            {isApplied ? (
              <Check aria-hidden size={14} className="mt-1 text-accent-soft" strokeWidth={2.4} />
            ) : (
              <GripVertical aria-hidden size={13} className="mt-1 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </div>
        </button>
      )})}
      </div>
    </div>
  )
}

export default TransitionControl
