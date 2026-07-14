import React from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { motion } from 'motion/react'
import IconButton from './IconButton'

type ToastTone = 'default' | 'success' | 'danger'

interface ToastProps {
  children: React.ReactNode
  tone?: ToastTone
  onClose?: () => void
}

const icons = {
  default: <Info aria-hidden size={16} strokeWidth={1.75} className="text-accent-soft" />,
  success: <CheckCircle2 aria-hidden size={16} strokeWidth={1.75} className="text-success" />,
  danger: <AlertCircle aria-hidden size={16} strokeWidth={1.75} className="text-danger" />
}

const Toast: React.FC<ToastProps> = ({ children, tone = 'default', onClose }) => (
  <motion.div
    role={tone === 'danger' ? 'alert' : 'status'}
    aria-live={tone === 'danger' ? 'assertive' : 'polite'}
    initial={{ opacity: 0, y: 10, scale: 0.98 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 6, scale: 0.98 }}
    transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
    className="ui-material flex min-h-10 max-w-[min(540px,calc(100vw-32px))] items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-text-primary"
  >
    {icons[tone]}
    <span className="min-w-0 flex-1">{children}</span>
    {onClose && <IconButton label="关闭通知" icon={<X aria-hidden size={14} />} size="sm" onClick={onClose} />}
  </motion.div>
)

export default Toast
