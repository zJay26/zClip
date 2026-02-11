// ============================================================
// TrimControl — 片段范围面板: 精确输入入点 / 出点
// ============================================================

import React, { useState, useCallback } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { formatTime, parseTime, clamp } from '../../lib/utils'
import type { TrimParams, SpeedParams } from '../../../../shared/types'
import { SectionCard } from '../ui'

interface TrimControlProps {
  hideHeader?: boolean
}

const TrimControl: React.FC<TrimControlProps> = ({ hideHeader = false }) => {
  const { operations, duration, setTrim, clips, selectedClipId } = useProjectStore()
  const selectedClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) : null

  const trimOp = operations.find((op) => op.type === 'trim')
  const params = trimOp?.params as TrimParams | undefined
  const trimBoundStart = Math.max(0, Math.min(selectedClip?.trimBoundStart ?? 0, duration))
  const trimBoundEnd = Math.max(trimBoundStart, Math.min(selectedClip?.trimBoundEnd ?? duration, duration))
  const boundedClipDuration = Math.max(0, trimBoundEnd - trimBoundStart)
  const startTime = params?.startTime ?? trimBoundStart
  const endTime = params?.endTime ?? trimBoundEnd
  const speedOp = operations.find((op) => op.type === 'speed' && op.enabled)
  const speedRate = speedOp ? (speedOp.params as SpeedParams).rate : 1
  const trimmedDuration = Math.max(0, endTime - startTime)
  const visibleDuration = trimmedDuration / Math.max(0.01, speedRate)

  const content = (
    <>
      <div className="grid grid-cols-2 gap-2">
        <TimeInput
          label="入点"
          value={startTime}
          min={trimBoundStart}
          max={endTime - 0.1}
          onChange={(v) => setTrim({ startTime: v })}
        />
        <TimeInput
          label="出点"
          value={endTime}
          min={startTime + 0.1}
          max={trimBoundEnd}
          onChange={(v) => setTrim({ endTime: v })}
        />
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <span className="text-text-secondary">片段时长</span>
        <span className="text-text-primary font-mono">{formatTime(boundedClipDuration)}</span>
        <span className="text-text-secondary">时间轴时长</span>
        <span className="text-text-primary font-mono">{formatTime(visibleDuration)}</span>
      </div>
    </>
  )

  if (hideHeader) {
    return <div className="space-y-3">{content}</div>
  }

  return (
    <SectionCard
      title="片段范围"
      icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      }
    >
      {content}
    </SectionCard>
  )
}

interface TimeInputProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

const TimeInput: React.FC<TimeInputProps> = ({ label, value, min, max, onChange }) => {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')

  const handleFocus = useCallback(() => {
    setText(formatTime(value))
    setEditing(true)
  }, [value])

  const handleBlur = useCallback(() => {
    setEditing(false)
    const parsed = parseTime(text)
    if (parsed !== null) {
      onChange(clamp(parsed, min, max))
    }
  }, [text, min, max, onChange])

  return (
    <div>
      <label className="text-xs text-text-muted block mb-0.5">{label}</label>
      <input
        type="text"
        className="ui-input w-full font-mono text-xs"
        value={editing ? text : formatTime(value)}
        onChange={(e) => setText(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

export default TrimControl
