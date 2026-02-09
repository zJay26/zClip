// ============================================================
// SpeedControl — 倍速调节: 0.1x – 16x
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'

const SpeedControl: React.FC = () => {
  const { operations, setSpeed } = useProjectStore()
  const speedOp = operations.find((op) => op.type === 'speed')
  const rate = speedOp ? (speedOp.params as { rate: number }).rate : 1.0

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12,6 12,12 16,14" />
        </svg>
        倍速
      </h3>
      <ParamSlider
        label=""
        value={rate}
        min={0.1}
        max={16.0}
        step={0.05}
        unit="x"
        onChange={setSpeed}
        formatValue={(v) => v.toFixed(2)}
      />
      {/* Quick presets */}
      <div className="flex gap-1">
        {[0.1, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0].map((preset) => (
          <button
            key={preset}
            onClick={() => setSpeed(preset)}
            className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
              Math.abs(rate - preset) < 0.01
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-surface-border text-text-muted hover:text-text-secondary hover:border-surface-border'
            }`}
          >
            {preset}x
          </button>
        ))}
      </div>
    </div>
  )
}

export default SpeedControl
