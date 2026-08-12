// ============================================================
// ParamSlider — 通用参数控制: 滑块 + 数值输入联动
// 所有参数控制面板的基础组件
// ============================================================

import React, { useState, useCallback, useId, useRef } from 'react'
import { clamp } from '../../lib/utils'
import { useProjectStore } from '../../stores/project-store'
import type { HistoryEditOptions } from '../../stores/project-store-types'
import { usePreferences } from '../../contexts/preferences'

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  showInput?: boolean
  disabled?: boolean
  onChange: (value: number, options?: HistoryEditOptions) => void
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
  const { t } = usePreferences()
  const id = useId()
  const rangeId = `${id}-range`
  const valueId = `${id}-value`
  const [inputValue, setInputValue] = useState('')
  const [editing, setEditing] = useState(false)
  const draggingRef = useRef(false)
  const beginHistoryTransaction = useProjectStore((state) => state.beginHistoryTransaction)
  const commitHistoryTransaction = useProjectStore((state) => state.commitHistoryTransaction)

  const displayValue = formatValue ? formatValue(value) : value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value)
      onChange(clamp(val, min, max), {
        recordHistory: !draggingRef.current
      })
    },
    [onChange, min, max]
  )

  const beginContinuousChange = useCallback(() => {
    if (disabled || draggingRef.current) return
    draggingRef.current = true
    beginHistoryTransaction()
  }, [beginHistoryTransaction, disabled])

  const endContinuousChange = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    commitHistoryTransaction()
  }, [commitHistoryTransaction])

  const handleSliderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      beginContinuousChange()
      e.currentTarget.setPointerCapture?.(e.pointerId)
    },
    [beginContinuousChange]
  )

  const handleSliderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      endContinuousChange()
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    },
    [endContinuousChange]
  )

  const handleSliderKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        beginContinuousChange()
      }
    },
    [beginContinuousChange]
  )

  const handleSliderKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
        endContinuousChange()
      }
    },
    [endContinuousChange]
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
  const range = max - min
  const percent = range > 0 ? ((value - min) / range) * 100 : 100

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {(showInput || label) && (
        <div className="flex items-center justify-between">
          {label ? <label htmlFor={rangeId} className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</label> : <span />}
          {showInput && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                id={valueId}
                aria-label={t(`${label}数值`, `${label} value`)}
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
          id={rangeId}
          type="range"
          aria-label={label || t('参数', 'Parameter')}
          aria-valuetext={`${displayValue}${unit}`}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          onPointerDown={handleSliderPointerDown}
          onPointerUp={handleSliderPointerUp}
          onPointerCancel={endContinuousChange}
          onBlur={endContinuousChange}
          onKeyDown={handleSliderKeyDown}
          onKeyUp={handleSliderKeyUp}
          disabled={disabled}
          className="w-full"
          style={{
            background: `linear-gradient(to right, rgb(var(--accent)) ${percent}%, rgb(var(--border-strong) / 0.62) ${percent}%)`
          }}
        />
      </div>
    </div>
  )
}

export default ParamSlider
