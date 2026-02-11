import React from 'react'
import { Badge, Button, Panel } from '../ui'

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
}

const OverlayStack: React.FC<OverlayStackProps> = ({
  dragActive,
  loading,
  merging,
  error,
  toast,
  clearToast
}) => {
  return (
    <>
      {dragActive && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-sm pointer-events-none">
          <Panel className="px-5 py-3 border-accent/40">
            <div className="text-sm text-text-secondary">松开鼠标以导入多个视频/音频</div>
          </Panel>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Panel className="flex items-center gap-3 px-6 py-4">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">加载中...</span>
          </Panel>
        </div>
      )}

      {merging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <Panel className="flex items-center gap-3 px-6 py-4">
            <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-text-secondary">正在合并片段，请稍候...</span>
          </Panel>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]">
          <Badge tone="danger" className="text-sm px-3 py-1.5">
            {error}
          </Badge>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]">
          <Button
            variant={toast.type === 'error' ? 'danger' : toast.type === 'success' ? 'primary' : 'secondary'}
            size="sm"
            onClick={clearToast}
            className="!text-sm !px-3 !py-1.5"
          >
            {toast.message}
          </Button>
        </div>
      )}
    </>
  )
}

export default OverlayStack
