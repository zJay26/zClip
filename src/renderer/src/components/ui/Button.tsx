import React, { forwardRef } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cx } from '../../lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leadingIcon?: React.ReactNode
  trailingIcon?: React.ReactNode
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'ui-btn-primary',
  secondary: 'ui-btn',
  ghost: 'ui-btn ui-btn-ghost',
  danger: 'ui-btn ui-btn-danger'
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-7 px-2 py-1 text-[11px]',
  md: 'min-h-8 px-3 py-1.5 text-xs',
  lg: 'min-h-10 px-4 py-2 text-sm'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        variantClass[variant],
        sizeClass[size],
        isDisabled && 'cursor-not-allowed opacity-45',
        className
      )}
    >
      {loading ? <LoaderCircle aria-hidden size={14} strokeWidth={1.75} className="animate-spin" /> : leadingIcon}
      <span className="min-w-0 truncate">{children}</span>
      {trailingIcon}
    </button>
  )
})

export default Button
