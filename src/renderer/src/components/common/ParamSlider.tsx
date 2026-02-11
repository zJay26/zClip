// ============================================================
// ParamSlider — 通用参数控制: 滑块 + 数值输入联动
// 所有参数控制面板的基础组件
// ============================================================

import React, { useState, useCallback } from 'react'
import { clamp } from '../../lib/utils'

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  showInput?: boolean
  disabled?: boolean
  onChange: (value: number) => void
  /** Format value for display in the number input */
  formatValue?: (value: number) => string
  /** Parse display string back to number */
  parseValue?: (str: string) => number
}

const ParamSlider: React.FC<ParamSliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  showInput = true,
  disabled = false,
  onChange,
  formatValue,
  parseValue
}) => {
  const [inputValue, setInputValue] = useState('')
  const [editing, setEditing] = useState(false)

  const displayValue = formatValue ? formatValue(value) : value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value)
      onChange(clamp(val, min, max))
    },
    [onChange, min, max]
  )

  const handleInputFocus = useCallback(() => {
    setInputValue(displayValue)
    setEditing(true)
  }, [displayValue])

  const handleInputBlur = useCallback(() => {
    setEditing(false)
    const parsed = parseValue ? parseValue(inputValue) : parseFloat(inputValue)
    if (!isNaN(parsed)) {
      onChange(clamp(parsed, min, max))
    }
  }, [inputValue, onChange, min, max, parseValue])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        ;(e.target as HTMLInputElement).blur()
      } else if (e.key === 'Escape') {
        setEditing(false)
        setInputValue(displayValue)
      }
    },
    [displayValue]
  )

  // Calculate slider fill percentage for visual feedback
  const percent = ((value - min) / (max - min)) * 100

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {(showInput || label) && (
        <div className="flex items-center justify-between">
          {label ? <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</label> : <span />}
          {showInput && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                className="ui-input w-16 text-right font-mono text-xs"
                value={editing ? inputValue : displayValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                onKeyDown={handleInputKeyDown}
                disabled={disabled}
              />
              {unit && <span className="text-xs text-text-muted">{unit}</span>}
            </div>
          )}
        </div>
      )}
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className="w-full"
          style={{
            background: `linear-gradient(to right, #6c63ff ${percent}%, #3a3a5c ${percent}%)`
          }}
        />
      </div>
    </div>
  )
}

export default ParamSlider
