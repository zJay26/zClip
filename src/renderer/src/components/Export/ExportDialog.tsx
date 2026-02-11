// ============================================================
// ExportDialog — 导出选项弹窗: 分辨率/质量选择 + 进度条
// 导出成功后自动关闭
// ============================================================

import React, { useEffect, useState } from 'react'
import { useExport } from '../../hooks/useExport'
import { useProjectStore } from '../../stores/project-store'
import type { ResolutionPreset, QualityPreset, ExportFormat } from '../../../../shared/types'
import { Badge, Button, Dialog, ProgressBar } from '../ui'

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

const VIDEO_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (H.264 + AAC)' },
  { value: 'mov', label: 'MOV (H.264 + AAC)' },
  { value: 'mkv', label: 'MKV (H.264 + AAC)' },
  { value: 'webm', label: 'WEBM (VP9 + Opus)' }
]

const AUDIO_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'aac', label: 'AAC' },
  { value: 'opus', label: 'Opus' }
]

type ExportStep = 'configure' | 'running'

const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose }) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('original')
  const [quality, setQuality] = useState<QualityPreset>('medium')
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [step, setStep] = useState<ExportStep>('configure')
  const { mediaInfo, clips } = useProjectStore()
  const hasAnyVideo = clips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const isAudioOnly = clips.length > 0 ? !hasAnyVideo : mediaInfo ? !mediaInfo.hasVideo : false

  const formatOptions = isAudioOnly ? AUDIO_FORMATS : VIDEO_FORMATS

  useEffect(() => {
    if (isAudioOnly && !AUDIO_FORMATS.find((f) => f.value === format)) {
      setFormat('mp3')
    }
    if (!isAudioOnly && !VIDEO_FORMATS.find((f) => f.value === format)) {
      setFormat('mp4')
    }
  }, [format, isAudioOnly])

  useEffect(() => {
    if (open) {
      setStep('configure')
    }
  }, [open])

  // Pass onClose as onComplete — dialog auto-closes after export success
  const { startExport, cancelExport, exporting, exportProgress } = useExport({
    onComplete: onClose
  })

  if (!open) return null

  const handleExport = async (): Promise<void> => {
    setStep('running')
    await startExport(isAudioOnly ? 'original' : resolution, quality, format)
  }

  const handleClose = (): void => {
    if (exporting) {
      cancelExport()
    }
    onClose()
  }

  const canStartExport = Boolean(format && quality)

  return (
    <Dialog open={open} onClose={handleClose} title={isAudioOnly ? '导出音频' : '导出视频'}>
      <div className="flex items-center gap-2 mb-4">
        <Badge tone={step === 'configure' ? 'accent' : 'default'}>1 配置</Badge>
        <Badge tone={step === 'running' ? 'accent' : 'default'}>2 执行</Badge>
      </div>

      {!exporting && step === 'configure' && (
        <div className="space-y-4">
          {!isAudioOnly && (
            <div>
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">分辨率</label>
              <div className="space-y-1">
                {RESOLUTIONS.map((r) => (
                  <label
                    key={r.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors ${
                      resolution === r.value ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-hover'
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

          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">质量</label>
            <div className="space-y-1">
              {QUALITIES.map((q) => (
                <label
                  key={q.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors ${
                    quality === q.value ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-hover'
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

          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">格式</label>
            <div className="space-y-1">
              {formatOptions.map((f) => (
                <label
                  key={f.value}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors ${
                    format === f.value ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={f.value}
                    checked={format === f.value}
                    onChange={() => setFormat(f.value)}
                    className="accent-accent"
                  />
                  <span className="text-sm text-text-primary">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button onClick={handleClose}>取消</Button>
            <Button onClick={handleExport} variant="primary" disabled={!canStartExport}>
              开始导出
            </Button>
          </div>
        </div>
      )}

      {(exporting || step === 'running') && (
        <div className="space-y-4">
          <div className="flex justify-between text-xs text-text-secondary">
            <span>导出中...</span>
            <span>{exportProgress ? `${exportProgress.percent.toFixed(1)}%` : '准备中...'}</span>
          </div>
          <ProgressBar value={exportProgress?.percent ?? 0} />
          {exportProgress && (
            <div className="text-[11px] text-text-muted space-y-1">
              <p>速度: {exportProgress.speed}</p>
              <p>剩余: {exportProgress.eta || '计算中...'}</p>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={handleClose} variant="danger">
              取消导出
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default ExportDialog
