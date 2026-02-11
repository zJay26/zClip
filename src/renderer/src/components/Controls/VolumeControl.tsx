// ============================================================
// VolumeControl — 音量调节: 0% – 1000%
// ============================================================

import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import ParamSlider from '../common/ParamSlider'
import { Button, SectionCard } from '../ui'

interface VolumeControlProps {
  hideHeader?: boolean
}

const VolumeControl: React.FC<VolumeControlProps> = ({ hideHeader = false }) => {
  const { getAudioOperationsForSelection, setVolume } = useProjectStore()
  const audioOps = getAudioOperationsForSelection()
  const volumeOp = audioOps.find((op) => op.type === 'volume')
  const percent = volumeOp ? (volumeOp.params as { percent: number }).percent : 100

  const content = (
    <>
      <ParamSlider
        label=""
        value={percent}
        min={0}
        max={1000}
        step={1}
        unit="%"
        showInput={!hideHeader}
        onChange={setVolume}
        formatValue={(v) => `${Math.round(v)}`}
        parseValue={(str) => parseFloat(str.replace('%', '').trim())}
      />
      <div className="grid grid-cols-5 gap-1">
        {[0, 50, 100, 200, 300].map((preset) => (
          <Button
            key={preset}
            onClick={() => setVolume(preset)}
            size="sm"
            variant={Math.round(percent) === preset ? 'primary' : 'secondary'}
            className={`!px-1 !py-1 text-[10px] ${
              Math.round(percent) === preset
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
      title="音量"
      icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11,5 6,9 2,9 2,15 6,15 11,19" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      }
    >
      {content}
    </SectionCard>
  )
}

export default VolumeControl
