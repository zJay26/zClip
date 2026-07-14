import React from 'react'
import { cx } from '../../lib/utils'

interface TooltipProps {
  label: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom'
  className?: string
}

const Tooltip: React.FC<TooltipProps> = ({ label, children, side = 'bottom', className }) => (
  <span className={cx('group/tooltip relative inline-flex', className)}>
    {children}
    <span
      role="tooltip"
      className={cx(
        'ui-material pointer-events-none absolute left-1/2 z-[90] w-max max-w-64 -translate-x-1/2 rounded-sm px-2 py-1 text-[11px] font-medium text-text-primary opacity-0 transition-opacity duration-fast group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
        side === 'bottom' ? 'top-[calc(100%+7px)]' : 'bottom-[calc(100%+7px)]'
      )}
    >
      {label}
    </span>
  </span>
)

export default Tooltip
