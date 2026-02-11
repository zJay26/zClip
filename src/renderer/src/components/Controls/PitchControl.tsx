// ============================================================
// PitchControl — 音调调节: 25% – 400%
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'
import { Button, SectionCard } from '../ui'

interface PitchControlProps {
  hideHeader?: boolean
}

const PitchControl: React.FC<PitchControlProps> = ({ hideHeader = false }) => {
  const { getAudioOperationsForSelection, setPitch } = useProjectStore()
  const audioOps = getAudioOperationsForSelection()
  const pitchOp = audioOps.find((op) => op.type === 'pitch')
  const percent = pitchOp ? (pitchOp.params as { percent: number }).percent : 100

  const content = (
    <>
      <ParamSlider
        label=""
        value={percent}
        min={25}
        max={400}
        step={1}
        unit="%"
        showInput={!hideHeader}
        onChange={setPitch}
        formatValue={(v) => `${Math.round(v)}`}
        parseValue={(str) => parseFloat(str.replace('%', '').trim())}
      />
      <div className="grid grid-cols-5 gap-1">
        {[50, 75, 100, 125, 150].map((preset) => (
          <Button
            key={preset}
            onClick={() => setPitch(preset)}
            size="sm"
            variant={percent === preset ? 'primary' : 'secondary'}
            className={`!px-1 !py-1 text-[10px] ${
              percent === preset
                ? ''
                : 'text-text-muted'
            }`}
          >
            {preset}%
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
      title="音调"
      icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      }
    >
      {content}
    </SectionCard>
  )
}

export default PitchControl
