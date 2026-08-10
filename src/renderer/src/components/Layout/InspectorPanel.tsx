import React, { useEffect, useState } from 'react'
import { Clapperboard, Layers3, SlidersHorizontal } from 'lucide-react'
import TrimControl from '../Controls/TrimControl'
import SpeedControl from '../Controls/SpeedControl'
import VolumeControl from '../Controls/VolumeControl'
import PitchControl from '../Controls/PitchControl'
import CanvasControl from '../Controls/CanvasControl'
import TransformControl from '../Controls/TransformControl'
import FadeControl from '../Controls/FadeControl'
import TransitionControl from '../Controls/TransitionControl'
import { InspectorSection, SegmentedControl } from '../ui'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import { clamp, formatTime } from '../../lib/utils'
import { usePreferences } from '../../contexts/preferences'
import type { SpeedParams, VolumeParams, PitchParams } from '../../../../shared/types'

type InspectorTab = 'clip' | 'canvas' | 'transitions'
const INSPECTOR_TAB_KEY = 'zclip.ui.inspector-tab.v1'

interface InlineValueInputProps {
  value: number
  unit?: string
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  parse?: (text: string) => number
  onCommit: (value: number) => void
}

const InlineValueInput: React.FC<InlineValueInputProps> = ({ value, unit = '', min, max, step = 1, format, parse, onCommit }) => {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  useEffect(() => {
    if (!editing) setText(format ? format(value) : String(value))
  }, [value, editing, format])

  const commit = (): void => {
    const raw = parse ? parse(text) : parseFloat(text)
    if (!Number.isNaN(raw)) {
      const snapped = step > 0 ? Math.round(raw / step) * step : raw
      onCommit(clamp(snapped, min, max))
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
      <input
        type="text"
        className="ui-input h-7 min-h-7 w-16 py-0.5 text-right font-mono text-[11px]"
        value={editing ? text : format ? format(value) : String(value)}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => { setEditing(true); setText(format ? format(value) : String(value)) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') { setEditing(false); setText(format ? format(value) : String(value)) }
        }}
      />
      {unit && <span className="text-[11px] text-text-muted">{unit}</span>}
    </div>
  )
}

function readInitialTab(): InspectorTab {
  try {
    const value = window.localStorage.getItem(INSPECTOR_TAB_KEY)
    return value === 'canvas' || value === 'transitions' ? value : 'clip'
  } catch {
    return 'clip'
  }
}

const InspectorPanel: React.FC = () => {
  const { t } = usePreferences()
  const {
    operations, audioOperations, setSpeed, setVolume, setPitch,
    selectedClipId, selectedClipIds, clips
  } = useProjectStore(useShallow((state) => ({
    operations: state.operations,
    audioOperations: state.getAudioOperationsForSelection(),
    setSpeed: state.setSpeed,
    setVolume: state.setVolume,
    setPitch: state.setPitch,
    selectedClipId: state.selectedClipId,
    selectedClipIds: state.selectedClipIds,
    clips: state.clips
  })))
  const [tab, setTab] = useState<InspectorTab>(readInitialTab)
  const selectedClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) ?? null : null
  const speedOp = operations.find((op) => op.type === 'speed')
  const speedRate = speedOp ? (speedOp.params as SpeedParams).rate : 1
  const volumeOp = audioOperations.find((op) => op.type === 'volume')
  const pitchOp = audioOperations.find((op) => op.type === 'pitch')
  const volumePercent = volumeOp ? (volumeOp.params as VolumeParams).percent : 100
  const pitchPercent = pitchOp ? (pitchOp.params as PitchParams).percent : 100
  const hasAudio = Boolean(selectedClip?.mediaInfo.hasAudio)
  const fileName = selectedClip?.filePath.split(/[\\/]/).pop()

  const selectTab = (next: InspectorTab): void => {
    setTab(next)
    try { window.localStorage.setItem(INSPECTOR_TAB_KEY, next) } catch { /* best effort */ }
  }

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-border-subtle bg-panel">
      <div className="border-b border-border-subtle px-3 pb-3 pt-3">
        <SegmentedControl
          idPrefix="inspector"
          label={t('检查器内容', 'Inspector content')}
          value={tab}
          onChange={selectTab}
          options={[
            { value: 'clip', label: t('片段', 'Clip'), icon: <SlidersHorizontal aria-hidden size={14} /> },
            { value: 'canvas', label: t('画布', 'Canvas'), icon: <Layers3 aria-hidden size={14} /> },
            { value: 'transitions', label: t('转场', 'Transitions'), icon: <Clapperboard aria-hidden size={14} /> }
          ]}
        />
      </div>

      <div
        id={`inspector-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
      >
        {tab === 'clip' && !selectedClip && (
          <div className="flex h-full min-h-52 flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-panel-muted text-text-muted">
              <SlidersHorizontal aria-hidden size={19} strokeWidth={1.5} />
            </div>
            <p className="text-sm font-medium text-text-secondary">{t('选择一个片段', 'Select a clip')}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('片段的画面、时间与声音参数会显示在这里。', 'Video, timing, and audio controls for the clip appear here.')}</p>
          </div>
        )}

        {tab === 'clip' && selectedClip && (
          <>
            <div className="border-b border-border-subtle px-4 py-3">
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-text-primary" title={fileName}>{fileName}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                <span>{selectedClip.track === 'video' ? t('视频片段', 'Video clip') : t('音频片段', 'Audio clip')}</span>
                <span aria-hidden>·</span>
                <span className="font-mono">{formatTime(selectedClip.duration)}</span>
                {selectedClipIds.length > 1 && <><span aria-hidden>·</span><span>{t(`已选 ${selectedClipIds.length} 项`, `${selectedClipIds.length} selected`)}</span></>}
              </div>
            </div>
            {selectedClip.track === 'video' && (
              <InspectorSection title={t('画面', 'Video')}>
                <TransformControl />
              </InspectorSection>
            )}
            <InspectorSection title={t('时间', 'Timing')} meta={<InlineValueInput value={speedRate} unit="x" min={0.1} max={16} step={0.05} format={(value) => value.toFixed(2)} onCommit={setSpeed} />}>
              <div className="space-y-4">
                <TrimControl hideHeader />
                <SpeedControl hideHeader />
              </div>
            </InspectorSection>
            {hasAudio && (
              <InspectorSection title={t('声音', 'Audio')} meta={<InlineValueInput value={volumePercent} unit="%" min={0} max={1000} format={(value) => `${Math.round(value)}`} parse={(text) => parseFloat(text.replace('%', '').trim())} onCommit={setVolume} />}>
                <div className="space-y-4">
                  <VolumeControl hideHeader />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-text-secondary">{t('音调', 'Pitch')}</span>
                    <InlineValueInput value={pitchPercent} unit="%" min={25} max={400} format={(value) => `${Math.round(value)}`} onCommit={setPitch} />
                  </div>
                  <PitchControl hideHeader />
                  <FadeControl />
                </div>
              </InspectorSection>
            )}
          </>
        )}

        {tab === 'canvas' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">{t('项目画布', 'Project canvas')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('设置最终画面的比例、分辨率与背景。', 'Set the final aspect ratio, resolution, and background.')}</p>
            </div>
            <CanvasControl />
          </div>
        )}

        {tab === 'transitions' && (
          <div className="p-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-text-primary">{t('转场', 'Transitions')}</h2>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{t('拖动一个转场到相邻视频片段的交界处。', 'Drag a transition onto the cut between adjacent video clips.')}</p>
            </div>
            <TransitionControl />
          </div>
        )}
      </div>
    </aside>
  )
}

export default InspectorPanel
