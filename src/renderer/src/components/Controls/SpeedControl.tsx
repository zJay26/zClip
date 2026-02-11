// ============================================================
// SpeedControl — 倍速调节: 0.1x – 16x
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'
import { Button, SectionCard } from '../ui'

interface SpeedControlProps {
  hideHeader?: boolean
}

const SpeedControl: React.FC<SpeedControlProps> = ({ hideHeader = false }) => {
  const { operations, setSpeed } = useProjectStore()
  const speedOp = operations.find((op) => op.type === 'speed')
  const rate = speedOp ? (speedOp.params as { rate: number }).rate : 1.0

  const content = (
    <>
      <ParamSlider
        label=""
        value={rate}
        min={0.1}
        max={16.0}
        step={0.05}
        unit="x"
        showInput={!hideHeader}
        onChange={setSpeed}
        formatValue={(v) => v.toFixed(2)}
      />
      {/* Quick presets */}
      <div className="grid grid-cols-5 gap-1">
        {[0.25, 0.5, 1.0, 1.5, 2.0].map((preset) => (
          <Button
            key={preset}
            onClick={() => setSpeed(preset)}
            size="sm"
            variant={Math.abs(rate - preset) < 0.01 ? 'primary' : 'secondary'}
            className={`!px-1 !py-1 text-[10px] ${
              Math.abs(rate - preset) < 0.01
                ? ''
                : 'text-text-muted'
            }`}
          >
            {preset}x
          </Button>
        ))}
      </div>
    </>
  )

  if (hideHeader) {
    return <div className="space-y-2">{content}</div>
  }

  return (
    <SectionCard
      title="倍速"
      icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12,6 12,12 16,14" />
        </svg>
      }
    >
      {content}
    </SectionCard>
  )
}

export default SpeedControl
