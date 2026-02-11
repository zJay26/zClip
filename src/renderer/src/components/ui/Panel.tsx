import React from 'react'
import { cx } from '../../lib/utils'

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {}

const Panel: React.FC<PanelProps> = ({ className, children, ...rest }) => {
  return (
    <div {...rest} className={cx('ui-panel', className)}>
      {children}
    </div>
  )
}

export default Panel
