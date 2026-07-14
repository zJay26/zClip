import React, { useId } from 'react'
import { motion } from 'motion/react'
import { cx } from '../../lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  icon?: React.ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  label: string
  className?: string
}

function SegmentedControl<T extends string>({ value, options, onChange, label, className }: SegmentedControlProps<T>): React.ReactElement {
  const id = useId()
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx('grid rounded-md border border-border-subtle bg-bg-base/55 p-1', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="relative flex min-h-8 items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-medium text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => onChange(option.value)}
          >
            {selected && (
              <motion.span
                layoutId={`${id}-active`}
                className="absolute inset-0 rounded-sm border border-border bg-panel-hover shadow-panel"
                transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
              />
            )}
            <span className={cx('relative z-10 inline-flex items-center gap-1.5', selected && 'text-text-primary')}>
              {option.icon}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
