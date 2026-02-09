// ============================================================
// PitchControl — 音调调节: 25% – 400%
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'

const PitchControl: React.FC = () => {
  const { getAudioOperationsForSelection, setPitch } = useProjectStore()
  const audioOps = getAudioOperationsForSelection()
  const pitchOp = audioOps.find((op) => op.type === 'pitch')
  const percent = pitchOp ? (pitchOp.params as { percent: number }).percent : 100

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        音调
      </h3>
      <ParamSlider
        label=""
        value={percent}
        min={25}
        max={400}
        step={1}
        unit="%"
        onChange={setPitch}
        formatValue={(v) => `${Math.round(v)}`}
        parseValue={(str) => parseFloat(str.replace('%', '').trim())}
      />
      <div className="flex gap-1">
        {[50, 75, 100, 125, 150].map((preset) => (
          <button
            key={preset}
            onClick={() => setPitch(preset)}
            className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
              percent === preset
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-surface-border text-text-muted hover:text-text-secondary'
            }`}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  )
}

export default PitchControl
