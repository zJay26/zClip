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
  accent: 'ui-badge border-accent/40 text-indigo-200 bg-accent/10',
  success: 'ui-badge border-emerald-400/40 text-emerald-200 bg-emerald-500/10',
  warning: 'ui-badge border-amber-400/40 text-amber-200 bg-amber-500/10',
  danger: 'ui-badge border-red-400/40 text-red-200 bg-red-500/10'
}

const Badge: React.FC<BadgeProps> = ({ children, tone = 'default', className }) => {
  return <span className={cx(toneClass[tone], className)}>{children}</span>
}

export default Badge
