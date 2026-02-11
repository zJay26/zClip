import React from 'react'
import Panel from './Panel'
import { cx } from '../../lib/utils'

interface SectionCardProps {
  title: React.ReactNode
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}

const SectionCard: React.FC<SectionCardProps> = ({ title, icon, className, children }) => {
  return (
    <Panel className={cx('p-3 space-y-3', className)}>
      <h3 className="ui-section-title">
        {icon}
        {title}
      </h3>
      {children}
    </Panel>
  )
}

export default SectionCard
