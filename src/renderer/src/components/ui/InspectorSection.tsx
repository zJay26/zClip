import React from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../lib/utils'

interface InspectorSectionProps {
  title: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  meta?: React.ReactNode
  className?: string
}

const InspectorSection: React.FC<InspectorSectionProps> = ({ title, children, defaultOpen = true, meta, className }) => (
  <details open={defaultOpen || undefined} className={cx('group border-b border-border-subtle last:border-b-0', className)}>
    <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-xs font-semibold text-text-primary hover:bg-panel-hover/45">
      <span>{title}</span>
      <span className="flex items-center gap-2 text-text-secondary">
        {meta}
        <ChevronDown aria-hidden size={15} strokeWidth={1.75} className="collapse-chevron text-text-muted" />
      </span>
    </summary>
    <div className="px-4 pb-4 pt-2">{children}</div>
  </details>
)

export default InspectorSection
