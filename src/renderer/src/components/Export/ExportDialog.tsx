// ============================================================
// ExportDialog — 导出选项弹窗: 分辨率/质量选择 + 进度条
// 导出成功后自动关闭
// ============================================================

import React, { useState } from 'react'
import { useExport } from '../../hooks/useExport'
import { useProjectStore } from '../../stores/project-store'
import type { ResolutionPreset, QualityPreset } from '../../../../shared/types'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

const RESOLUTIONS: { value: ResolutionPreset; label: string }[] = [
  { value: 'original', label: '原始分辨率' },
  { value: '1080p', label: '1080p (1920x1080)' },
  { value: '720p', label: '720p (1280x720)' },
  { value: '480p', label: '480p (854x480)' }
]

const QUALITIES: { value: QualityPreset; label: string; desc: string }[] = [
  { value: 'high', label: '高质量', desc: '文件较大，质量最佳' },
  { value: 'medium', label: '中等', desc: '平衡质量与文件大小' },
  { value: 'low', label: '低质量', desc: '文件最小，质量一般' }
]

const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose }) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('original')
  const [quality, setQuality] = useState<QualityPreset>('medium')
  const { mediaInfo, clips } = useProjectStore()
  const hasAnyVideo = clips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const isAudioOnly = clips.length > 0 ? !hasAnyVideo : mediaInfo ? !mediaInfo.hasVideo : false

  // Pass onClose as onComplete — dialog auto-closes after export success
  const { startExport, cancelExport, exporting, exportProgress } = useExport({
    onComplete: onClose
  })

  if (!open) return null

  const handleExport = async (): Promise<void> => {
    await startExport(isAudioOnly ? 'original' : resolution, quality)
  }

  const handleClose = (): void => {
    if (exporting) {
      cancelExport()
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-light border border-surface-border rounded-xl shadow-2xl w-[420px] p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          {isAudioOnly ? '导出音频' : '导出视频'}
        </h2>

        {!exporting ? (
          <>
            {/* Resolution — only show for video */}
            {!isAudioOnly && (
              <div className="mb-4">
                <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">
                  分辨率
                </label>
                <div className="space-y-1">
                  {RESOLUTIONS.map((r) => (
                    <label
                      key={r.value}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                        resolution === r.value
                          ? 'border-accent bg-accent/10'
                          : 'border-transparent hover:bg-surface-lighter'
                      }`}
                    >
                      <input
                        type="radio"
                        name="resolution"
                        value={r.value}
                        checked={resolution === r.value}
                        onChange={() => setResolution(r.value)}
                        className="accent-accent"
                      />
                      <span className="text-sm text-text-primary">{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Quality */}
            <div className="mb-6">
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">
                质量
              </label>
              <div className="space-y-1">
                {QUALITIES.map((q) => (
                  <label
                    key={q.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                      quality === q.value
                        ? 'border-accent bg-accent/10'
                        : 'border-transparent hover:bg-surface-lighter'
                    }`}
                  >
                    <input
                      type="radio"
                      name="quality"
                      value={q.value}
                      checked={quality === q.value}
                      onChange={() => setQuality(q.value)}
                      className="accent-accent"
                    />
                    <div>
                      <span className="text-sm text-text-primary">{q.label}</span>
                      <span className="text-[10px] text-text-muted ml-2">{q.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary rounded-lg
                           border border-surface-border hover:bg-surface-lighter transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                className="px-4 py-2 text-sm text-white bg-accent hover:bg-accent-hover rounded-lg
                           transition-colors font-medium"
              >
                开始导出
              </button>
            </div>
          </>
        ) : (
          /* Exporting progress view */
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-text-secondary mb-1">
                <span>导出中...</span>
                <span>{exportProgress ? `${exportProgress.percent.toFixed(1)}%` : '准备中...'}</span>
              </div>
              <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${exportProgress?.percent ?? 0}%` }}
                />
              </div>
            </div>

            {exportProgress && (
              <div className="text-[11px] text-text-muted space-y-0.5">
                <p>速度: {exportProgress.speed}</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-red-400 hover:text-red-300 rounded-lg
                           border border-red-400/30 hover:bg-red-400/10 transition-colors"
              >
                取消导出
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ExportDialog
