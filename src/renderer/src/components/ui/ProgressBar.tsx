import React from 'react'
import { clamp, cx } from '../../lib/utils'

interface ProgressBarProps {
  value: number
  className?: string
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, className }) => {
  const percent = clamp(value, 0, 100)
  return (
    <div className={cx('w-full h-2 bg-panel-muted rounded-full overflow-hidden border border-border-subtle', className)}>
      <div
        className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

export default ProgressBar
