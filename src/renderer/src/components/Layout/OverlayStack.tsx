import React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, Upload } from 'lucide-react'
import { Toast } from '../ui'
import { usePreferences } from '../../contexts/preferences'

interface ToastState {
  message: string
  type: 'success' | 'error' | 'info'
}

interface OverlayStackProps {
  dragActive: boolean
  loading: boolean
  merging: boolean
  error: string | null
  toast: ToastState | null
  clearToast: () => void
  clearError: () => void
}

const BlockingStatus: React.FC<{ label: string; strong?: boolean }> = ({ label, strong }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className={`fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm ${strong ? 'bg-black/65' : 'bg-black/45'}`}
  >
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.32 }}
      className="ui-material flex min-w-52 items-center gap-3 rounded-lg px-5 py-4"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle aria-hidden size={19} strokeWidth={1.75} className="animate-spin text-accent-soft" />
      <span className="text-sm font-medium text-text-primary">{label}</span>
    </motion.div>
  </motion.div>
)

const OverlayStack: React.FC<OverlayStackProps> = ({ dragActive, loading, merging, error, toast, clearToast, clearError }) => {
  const { t } = usePreferences()
  return (
    <>
    <AnimatePresence>
      {dragActive && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/65 bg-accent/10 backdrop-blur-sm"
        >
          <motion.div initial={{ scale: 0.96, y: 6 }} animate={{ scale: 1, y: 0 }} className="ui-material flex flex-col items-center rounded-lg px-8 py-6 text-center">
            <Upload aria-hidden size={25} strokeWidth={1.6} className="mb-3 text-accent-soft" />
            <span className="text-sm font-semibold text-text-primary">{t('松开以导入媒体', 'Drop to import media')}</span>
            <span className="mt-1 text-xs text-text-secondary">{t('支持同时导入多个视频或音频文件', 'Import multiple video or audio files at once')}</span>
          </motion.div>
        </motion.div>
      )}
      {loading && !merging && <BlockingStatus label={t('正在准备媒体…', 'Preparing media…')} />}
      {merging && <BlockingStatus label={t('正在合并片段…', 'Merging clips…')} strong />}
    </AnimatePresence>

    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence mode="popLayout">
        {error && <div className="pointer-events-auto" key="error"><Toast tone="danger" onClose={clearError}>{error}</Toast></div>}
        {toast && (
          <div className="pointer-events-auto" key={`${toast.type}-${toast.message}`}>
            <Toast tone={toast.type === 'error' ? 'danger' : toast.type === 'success' ? 'success' : 'default'} onClose={clearToast}>
              {toast.message}
            </Toast>
          </div>
        )}
      </AnimatePresence>
    </div>
    </>
  )
}

export default OverlayStack
