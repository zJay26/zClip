import React from 'react'
import { formatFileSize } from '../../lib/utils'
import { Badge, Button } from '../ui'
import type { MediaInfo, TimelineClip } from '../../../../shared/types'

interface TopToolbarProps {
  loading: boolean
  sourceFile: string | null
  mediaInfo: MediaInfo | null
  clips: TimelineClip[]
  onOpenFiles: () => void
  onOpenExport: () => void
}

const TopToolbar: React.FC<TopToolbarProps> = ({
  loading,
  sourceFile,
  mediaInfo,
  clips,
  onOpenFiles,
  onOpenExport
}) => {
  const fileName = sourceFile ? sourceFile.split(/[\\/]/).pop() : null

  return (
    <header className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-border shrink-0">
      <span className="text-xl font-bold text-accent tracking-tight">zClip</span>
      <div className="w-px h-4 bg-border" />

      <Button onClick={onOpenFiles} disabled={loading} variant="secondary" className="text-lg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        打开文件
      </Button>

      {fileName && (
        <div className="flex items-center gap-2 text-sm text-text-muted min-w-0">
          <span className="text-text-secondary font-medium max-w-[220px] truncate">{fileName}</span>
          {mediaInfo && <span>({formatFileSize(mediaInfo.fileSize)})</span>}
          {clips.length > 1 && <Badge className="text-xs">{clips.length} 段</Badge>}
        </div>
      )}

      <div className="flex-1" />

      <Button onClick={onOpenExport} disabled={!sourceFile || loading} variant="primary" className="text-lg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7,10 12,15 17,10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        导出
      </Button>
    </header>
  )
}

export default TopToolbar
