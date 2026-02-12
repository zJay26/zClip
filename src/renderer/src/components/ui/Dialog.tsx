import React from 'react'
import { cx } from '../../lib/utils'

interface DialogProps {
  open: boolean
  title: React.ReactNode
  children: React.ReactNode
  onClose?: () => void
  className?: string
}

const Dialog: React.FC<DialogProps> = ({ open, title, children, onClose, className }) => {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className={cx('ui-dialog-surface my-4 w-[460px] max-h-[calc(100vh-2rem)] max-w-[92vw] overflow-y-auto', className)}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {onClose && (
            <button className="ui-btn ui-btn-ghost px-2 py-1" onClick={onClose} aria-label="关闭弹窗">
              x
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export default Dialog
