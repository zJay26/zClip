import React, { useEffect, useId, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cx } from '../../lib/utils'
import IconButton from './IconButton'
import { usePreferences } from '../../contexts/preferences'

interface DialogProps {
  open: boolean
  title: React.ReactNode
  children: React.ReactNode
  onClose?: () => void
  className?: string
  description?: React.ReactNode
  originRef?: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  onExitComplete?: () => void
}

const Dialog: React.FC<DialogProps> = ({
  open,
  title,
  children,
  onClose,
  className,
  description,
  originRef,
  initialFocusRef,
  closeOnBackdrop = true,
  onExitComplete
}) => {
  const { t } = usePreferences()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const transformOrigin = useMemo(() => {
    if (!open || !originRef?.current) return 'center center'
    const rect = originRef.current.getBoundingClientRect()
    return `${rect.left + rect.width / 2}px ${rect.top + rect.height / 2}px`
  }, [open, originRef])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const surface = surfaceRef.current
    const focusable = surface?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ;(initialFocusRef?.current || focusable || surface)?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault()
        onClose()
      }
      if (event.key !== 'Tab' || !surface) return
      const items = Array.from(surface.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previous?.focus()
    }
  }, [initialFocusRef, onClose, open])

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={(event) => {
            if (closeOnBackdrop && event.target === event.currentTarget) onClose?.()
          }}
        >
          <motion.div
            ref={surfaceRef}
            tabIndex={-1}
            className={cx('ui-dialog-surface my-4 max-h-[calc(100vh-2rem)] w-[460px] max-w-[92vw] overflow-y-auto', className)}
            style={{ transformOrigin }}
            initial={{ opacity: 0, scale: 0.96, y: 10, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.97, y: 6, filter: 'blur(5px)' }}
            transition={{ type: 'spring', bounce: 0, duration: 0.36 }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-base font-semibold leading-tight tracking-[-0.01em] text-text-primary">{title}</h2>
                {description && <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-text-secondary">{description}</p>}
              </div>
              {onClose && <IconButton label={t('关闭弹窗', 'Close dialog')} icon={<X aria-hidden size={16} />} onClick={onClose} />}
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default Dialog
