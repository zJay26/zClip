// ============================================================
// VolumeControl — 音量调节: 0% – 1000%
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'

const VolumeControl: React.FC = () => {
  const { getAudioOperationsForSelection, setVolume } = useProjectStore()
  const audioOps = getAudioOperationsForSelection()
  const volumeOp = audioOps.find((op) => op.type === 'volume')
  const percent = volumeOp ? (volumeOp.params as { percent: number }).percent : 100

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
        音量
      </h3>
      <ParamSlider
        label=""
        value={percent}
        min={0}
        max={1000}
        step={1}
        unit="%"
        onChange={setVolume}
        formatValue={(v) => `${Math.round(v)}`}
        parseValue={(str) => parseFloat(str.replace('%', '').trim())}
      />
      <button
        onClick={() => setVolume(100)}
        className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
      >
        重置为 100%
      </button>
      <div className="flex gap-1">
        {[0, 25, 50, 100, 150, 200, 300, 500, 1000].map((preset) => (
          <button
            key={preset}
            onClick={() => setVolume(preset)}
            className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
              Math.round(percent) === preset
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-surface-border text-text-muted hover:text-text-secondary hover:border-surface-border'
            }`}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  )
}

export default VolumeControl
