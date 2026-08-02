import React from 'react'
import { cx } from '../../lib/utils'

type BadgeTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

interface BadgeProps {
  children: React.ReactNode
  tone?: BadgeTone
  className?: string
}

const toneClass: Record<BadgeTone, string> = {
  default: 'ui-badge',
  accent: 'ui-badge border-accent/40 text-accent-soft bg-accent/10',
  success: 'ui-badge border-success/40 text-success bg-success/10',
  warning: 'ui-badge border-warning/40 text-warning bg-warning/10',
  danger: 'ui-badge border-danger/40 text-danger bg-danger/10'
}

const Badge: React.FC<BadgeProps> = ({ children, tone = 'default', className }) => {
  return <span className={cx(toneClass[tone], className)}>{children}</span>
}

export default Badge
