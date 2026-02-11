import React, { useEffect, useState } from 'react'
import TrimControl from '../Controls/TrimControl'
import SpeedControl from '../Controls/SpeedControl'
import VolumeControl from '../Controls/VolumeControl'
import PitchControl from '../Controls/PitchControl'
import { useProjectStore } from '../../stores/project-store'
import { clamp } from '../../lib/utils'
import type { SpeedParams, VolumeParams, PitchParams } from '../../../../shared/types'

interface CollapsibleItemProps {
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
}

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

const InlineValueInput: React.FC<InlineValueInputProps> = ({
  value,
  unit = '',
  min,
  max,
  step = 1,
  format,
  parse,
  onCommit
}) => {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    if (!editing) {
      setText(format ? format(value) : String(value))
    }
  }, [value, editing, format])

  const commit = (): void => {
    const raw = parse ? parse(text) : parseFloat(text)
    if (!isNaN(raw)) {
      const snapped = step > 0 ? Math.round(raw / step) * step : raw
      onCommit(clamp(snapped, min, max))
    }
    setEditing(false)
  }

  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        className="ui-input w-16 text-right font-mono text-xs py-0.5"
        value={editing ? text : format ? format(value) : String(value)}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          setEditing(true)
          setText(format ? format(value) : String(value))
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setEditing(false)
            setText(format ? format(value) : String(value))
          }
        }}
      />
      {unit && <span className="text-xs text-text-muted">{unit}</span>}
    </div>
  )
}

const CollapsibleItem: React.FC<CollapsibleItemProps> = ({ title, meta, children }) => {
  return (
    <details className="ui-panel overflow-hidden group">
      <summary className="list-none cursor-pointer px-3 py-2 text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center justify-between gap-2">
        <span>{title}</span>
        <div className="flex items-center gap-2">
          {meta}
          <svg
            className="w-5 h-5 text-text-muted transition-transform duration-fast collapse-chevron group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M7 10l5 6 5-6H7z" />
          </svg>
        </div>
      </summary>
      <div className="p-3 border-t border-border-subtle">{children}</div>
    </details>
  )
}

const InspectorPanel: React.FC = () => {
  const { operations, getAudioOperationsForSelection, setSpeed, setVolume, setPitch } = useProjectStore()
  const speedOp = operations.find((op) => op.type === 'speed')
  const speedRate = speedOp ? (speedOp.params as SpeedParams).rate : 1
  const audioOps = getAudioOperationsForSelection()
  const volumeOp = audioOps.find((op) => op.type === 'volume')
  const pitchOp = audioOps.find((op) => op.type === 'pitch')
  const volumePercent = volumeOp ? (volumeOp.params as VolumeParams).percent : 100
  const pitchPercent = pitchOp ? (pitchOp.params as PitchParams).percent : 100

  return (
    <aside className="w-[310px] shrink-0 border-r border-border bg-panel overflow-y-auto">
      <div className="p-3 space-y-3">
        <CollapsibleItem title="片段范围">
          <TrimControl hideHeader />
        </CollapsibleItem>
        <CollapsibleItem
          title="倍速"
          meta={
            <InlineValueInput
              value={speedRate}
              unit="x"
              min={0.1}
              max={16}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onCommit={setSpeed}
            />
          }
        >
          <SpeedControl hideHeader />
        </CollapsibleItem>
        <CollapsibleItem
          title="音量"
          meta={
            <InlineValueInput
              value={volumePercent}
              unit="%"
              min={0}
              max={1000}
              step={1}
              format={(v) => `${Math.round(v)}`}
              parse={(text) => parseFloat(text.replace('%', '').trim())}
              onCommit={setVolume}
            />
          }
        >
          <VolumeControl hideHeader />
        </CollapsibleItem>
        <CollapsibleItem
          title="音调"
          meta={
            <InlineValueInput
              value={pitchPercent}
              unit="%"
              min={25}
              max={400}
              step={1}
              format={(v) => `${Math.round(v)}`}
              parse={(text) => parseFloat(text.replace('%', '').trim())}
              onCommit={setPitch}
            />
          }
        >
          <PitchControl hideHeader />
        </CollapsibleItem>
      </div>
    </aside>
  )
}

export default InspectorPanel
