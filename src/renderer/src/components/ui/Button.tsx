import React from 'react'
import { cx } from '../../lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn',
  ghost: 'ui-btn ui-btn-ghost',
  danger: 'ui-btn ui-btn-danger'
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-[11px]',
  md: 'px-3 py-1.5 text-xs'
}

const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  disabled,
  children,
  ...rest
}) => {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        variantClass[variant],
        sizeClass[size],
        (disabled || loading) && 'opacity-45 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      {loading && (
        <span className="inline-block w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  )
}

export default Button
