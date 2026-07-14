import React, { forwardRef } from 'react'
import { cx } from '../../lib/utils'
import type { ButtonVariant } from './Button'
import Tooltip from './Tooltip'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  icon: React.ReactNode
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  tooltipSide?: 'top' | 'bottom'
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn',
  ghost: 'ui-btn ui-btn-ghost',
  danger: 'ui-btn ui-btn-danger'
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', tooltipSide, className, type = 'button', ...rest },
  ref
) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(
        variantClass[variant],
        size === 'sm' ? 'h-7 min-h-7 w-7 p-0' : 'h-8 min-h-8 w-8 p-0',
        className
      )}
    >
      {icon}
    </button>
  )
  return tooltipSide ? <Tooltip label={label} side={tooltipSide}>{button}</Tooltip> : button
})

export default IconButton
