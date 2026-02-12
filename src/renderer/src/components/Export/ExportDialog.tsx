// ============================================================
// ExportDialog — 导出选项弹窗: 分辨率/质量选择 + 进度条
// 导出成功后自动关闭
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useExport } from '../../hooks/useExport'
import { useProjectStore } from '../../stores/project-store'
import type { ResolutionPreset, QualityPreset, ExportFormat, GifLoopMode } from '../../../../shared/types'
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
  { value: 'webm', label: 'WEBM (VP9 + Opus)' },
  { value: 'gif', label: 'GIF (动画图像)' },
  { value: 'webp', label: 'WEBP (动画图像)' }
]

const AUDIO_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
  { value: 'aac', label: 'AAC' },
  { value: 'opus', label: 'Opus' }
]

type ExportStep = 'configure' | 'running'

function parseSpeedValue(speed: string | undefined): number | null {
  if (!speed) return null
  const match = speed.match(/(\d+(?:\.\d+)?)x/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function getSpeedLevel(speedValue: number): string {
  if (speedValue < 0.8) return '较慢'
  if (speedValue < 1.2) return '接近实时'
  if (speedValue < 2.0) return '较快'
  return '很快'
}

function formatEtaText(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  if (safe <= 1) return '即将完成'
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  if (hours > 0) return `${hours}小时${minutes}分${secs}秒`
  if (minutes > 0) return `${minutes}分${secs}秒`
  return `${secs}秒`
}

function isAnimatedImageFormat(format: ExportFormat): boolean {
  return format === 'gif' || format === 'webp'
}

const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose }) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('original')
  const [quality, setQuality] = useState<QualityPreset>('medium')
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [gifLoop, setGifLoop] = useState<GifLoopMode>('infinite')
  const [step, setStep] = useState<ExportStep>('configure')
  const [etaFallbackText, setEtaFallbackText] = useState('')
  const configureScrollRef = useRef<HTMLDivElement>(null)
  const prevFormatRef = useRef<ExportFormat>(format)
  const etaEstimatorRef = useRef<{ percent: number; ts: number; etaSec: number | null } | null>(null)
  const { mediaInfo, clips } = useProjectStore()
  const hasAnyVideo = clips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const isAudioOnly = clips.length > 0 ? !hasAnyVideo : mediaInfo ? !mediaInfo.hasVideo : false

  const formatOptions = isAudioOnly ? AUDIO_FORMATS : VIDEO_FORMATS
  // Pass onClose as onComplete — dialog auto-closes after export success
  const { startExport, cancelExport, exporting, exportProgress } = useExport({
    onComplete: onClose
  })

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
      if (!isAudioOnly) {
        setFormat('mp4')
      }
      const host = configureScrollRef.current
      if (host) {
        requestAnimationFrame(() => {
          host.scrollTo({ top: 0, behavior: 'auto' })
        })
      }
    }
  }, [open, isAudioOnly])

  useEffect(() => {
    if (!exporting) {
      etaEstimatorRef.current = null
      setEtaFallbackText('')
    }
  }, [exporting])

  useEffect(() => {
    if (!exportProgress) return
    if (exportProgress.eta) {
      setEtaFallbackText(exportProgress.eta)
      return
    }

    const now = Date.now()
    const percent = Number.isFinite(exportProgress.percent) ? exportProgress.percent : 0
    if (percent >= 99.6) {
      setEtaFallbackText('即将完成')
      return
    }

    const prev = etaEstimatorRef.current
    let nextEtaSec: number | null = prev?.etaSec ?? null
    if (prev) {
      const deltaPercent = percent - prev.percent
      const deltaSec = (now - prev.ts) / 1000
      if (deltaPercent > 0.03 && deltaSec > 0.2) {
        const rate = deltaPercent / deltaSec
        if (Number.isFinite(rate) && rate > 0) {
          const instantEta = Math.max(0, (100 - percent) / rate)
          nextEtaSec = nextEtaSec === null ? instantEta : nextEtaSec * 0.65 + instantEta * 0.35
        }
      } else if (nextEtaSec !== null) {
        nextEtaSec = Math.max(0, nextEtaSec - Math.max(0, (now - prev.ts) / 1000))
      }
    }

    etaEstimatorRef.current = { percent, ts: now, etaSec: nextEtaSec }
    setEtaFallbackText(nextEtaSec === null ? '' : formatEtaText(nextEtaSec))
  }, [exportProgress])

  useEffect(() => {
    const prevFormat = prevFormatRef.current
    prevFormatRef.current = format
    if (!open || !isAnimatedImageFormat(format) || prevFormat === format) return
    const host = configureScrollRef.current
    if (!host) return
    requestAnimationFrame(() => {
      host.scrollTo({ top: host.scrollHeight, behavior: 'smooth' })
    })
  }, [format, open])

  if (!open) return null

  const handleExport = async (): Promise<void> => {
    setStep('running')
    await startExport(isAudioOnly ? 'original' : resolution, quality, format, gifLoop)
  }

  const handleClose = (): void => {
    if (exporting) {
      cancelExport()
    }
    onClose()
  }

  const canStartExport = Boolean(format && quality)
  const progressPercentText = exportProgress ? `${exportProgress.percent.toFixed(1)}%` : '准备中...'
  const speedValue = parseSpeedValue(exportProgress?.speed)
  const progressSpeedText = speedValue
    ? `${getSpeedLevel(speedValue)}（${speedValue.toFixed(speedValue >= 10 ? 0 : 1)}x）`
    : exportProgress
      ? '获取中...'
      : '准备中...'
  const progressEtaText = exportProgress
    ? exportProgress.percent >= 99.8
      ? '即将完成'
      : exportProgress.eta
        ? `约 ${exportProgress.eta}`
        : etaFallbackText
          ? `约 ${etaFallbackText}`
        : exportProgress.percent < 1
          ? '准备中...'
          : '估算中...'
    : '准备中...'

  return (
    <Dialog open={open} onClose={handleClose} title={isAudioOnly ? '导出音频' : '导出视频'}>
      <div className="flex items-center gap-2 mb-4">
        <Badge tone={step === 'configure' ? 'accent' : 'default'}>1 配置</Badge>
        <Badge tone={step === 'running' ? 'accent' : 'default'}>2 执行</Badge>
      </div>

      {!exporting && step === 'configure' && (
        <div className="flex max-h-[62vh] flex-col">
          <div ref={configureScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-3">
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

            {isAnimatedImageFormat(format) && (
              <div>
                <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">动图循环</label>
                <div className="space-y-1">
                  <label
                    className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors ${
                      gifLoop === 'infinite' ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gif-loop"
                      value="infinite"
                      checked={gifLoop === 'infinite'}
                      onChange={() => setGifLoop('infinite')}
                      className="accent-accent"
                    />
                    <span className="text-sm text-text-primary">无限循环</span>
                  </label>
                  <label
                    className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer border transition-colors ${
                      gifLoop === 'once' ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="gif-loop"
                      value="once"
                      checked={gifLoop === 'once'}
                      onChange={() => setGifLoop('once')}
                      className="accent-accent"
                    />
                    <span className="text-sm text-text-primary">仅播放一次</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div className="mt-2 border-t border-border bg-panel pt-3">
            <div className="flex gap-2 justify-end">
              <Button onClick={handleClose}>取消</Button>
              <Button onClick={handleExport} variant="primary" disabled={!canStartExport}>
                开始导出
              </Button>
            </div>
          </div>
        </div>
      )}

      {(exporting || step === 'running') && (
        <div className="flex max-h-[62vh] flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-3">
            <div className="flex items-end justify-between">
              <span className="text-sm font-medium text-text-secondary">导出执行中</span>
              <span className="text-base font-semibold tabular-nums text-text-primary">{progressPercentText}</span>
            </div>
            <ProgressBar value={exportProgress?.percent ?? 0} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-panel-hover/30 px-3 py-2">
                <p className="text-xs text-text-secondary">处理速度（相对实时）</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-text-primary">{progressSpeedText}</p>
              </div>
              <div className="rounded-md border border-border bg-panel-hover/30 px-3 py-2">
                <p className="text-xs text-text-secondary">预计剩余</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-text-primary">{progressEtaText}</p>
              </div>
            </div>
            <p className="text-xs text-text-muted">说明：1.0x 代表与实时处理速度相当，数值越大导出越快。</p>
          </div>
          <div className="mt-2 border-t border-border bg-panel pt-3">
            <div className="flex justify-end">
              <Button onClick={handleClose} variant="danger">
                取消导出
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default ExportDialog
