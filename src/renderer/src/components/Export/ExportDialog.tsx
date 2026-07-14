// ============================================================
// ExportDialog — 导出选项弹窗: 分辨率/质量选择 + 进度条
// 导出成功后自动关闭
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useExport, type ExportScope } from '../../hooks/useExport'
import { useProjectStore } from '../../stores/project-store'
import type {
  ExportCustomOptions,
  ExportFormat,
  GifLoopMode,
  H264Preset,
  QualityPreset,
  ResolutionPreset
} from '../../../../shared/types'
import { Badge, Button, Dialog, ProgressBar } from '../ui'
import { formatTime, parseTime } from '../../lib/utils'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  originRef?: React.RefObject<HTMLElement | null>
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
  { value: 'low', label: '低质量', desc: '文件最小，质量一般' },
  { value: 'custom', label: '自定义', desc: '手动设置编码参数' }
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

const H264_PRESETS: { value: H264Preset; label: string }[] = [
  { value: 'ultrafast', label: 'ultrafast' },
  { value: 'superfast', label: 'superfast' },
  { value: 'veryfast', label: 'veryfast' },
  { value: 'faster', label: 'faster' },
  { value: 'fast', label: 'fast' },
  { value: 'medium', label: 'medium' },
  { value: 'slow', label: 'slow' },
  { value: 'slower', label: 'slower' },
  { value: 'veryslow', label: 'veryslow' }
]

const DEFAULT_CUSTOM_OPTIONS: ExportCustomOptions = {
  crf: 23,
  h264Preset: 'medium',
  audioBitrateKbps: 192
}

type ExportStep = 'configure' | 'running'
type ExportMode = 'timeline' | 'selection' | 'range'
type NumericCustomOptionKey = 'crf' | 'videoBitrateKbps' | 'audioBitrateKbps' | 'animatedFps'

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

function parseBoundedIntInput(value: string, min: number, max: number): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

const ExportDialog: React.FC<ExportDialogProps> = ({ open, onClose, originRef }) => {
  const [resolution, setResolution] = useState<ResolutionPreset>('original')
  const [quality, setQuality] = useState<QualityPreset>('medium')
  const [customOptions, setCustomOptions] = useState<ExportCustomOptions>(DEFAULT_CUSTOM_OPTIONS)
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [gifLoop, setGifLoop] = useState<GifLoopMode>('infinite')
  const [exportMode, setExportMode] = useState<ExportMode>('timeline')
  const [rangeStartText, setRangeStartText] = useState('00:00.00')
  const [rangeEndText, setRangeEndText] = useState('00:00.00')
  const [step, setStep] = useState<ExportStep>('configure')
  const [etaFallbackText, setEtaFallbackText] = useState('')
  const configureScrollRef = useRef<HTMLDivElement>(null)
  const prevFormatRef = useRef<ExportFormat>(format)
  const etaEstimatorRef = useRef<{ percent: number; ts: number; etaSec: number | null } | null>(null)
  const { mediaInfo, clips, selectedClipIds, timelineDuration } = useProjectStore()
  const hasAnyVideo = clips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const isAudioOnly = clips.length > 0 ? !hasAnyVideo : mediaInfo ? !mediaInfo.hasVideo : false
  const selectedClips = clips.filter((clip) => selectedClipIds.includes(clip.id))
  const selectedHasVideo = selectedClips.some((clip) => clip.track === 'video' && clip.mediaInfo.hasVideo)
  const effectiveAudioOnly =
    exportMode === 'selection' && selectedClipIds.length > 0
      ? !selectedHasVideo
      : isAudioOnly

  const formatOptions = effectiveAudioOnly ? AUDIO_FORMATS : VIDEO_FORMATS
  const animatedFormat = isAnimatedImageFormat(format)
  const supportsAudioBitrate = ['mp3', 'aac', 'opus', 'mp4', 'mov', 'mkv', 'webm'].includes(format)
  const showCustomCrf = quality === 'custom' && !effectiveAudioOnly && format !== 'gif'
  const showCustomVideoBitrate = quality === 'custom' && !effectiveAudioOnly && !animatedFormat
  const showCustomH264Preset = showCustomVideoBitrate && format !== 'webm'
  const showCustomAudioBitrate = quality === 'custom' && !animatedFormat && supportsAudioBitrate
  const showCustomAnimatedFps = quality === 'custom' && !effectiveAudioOnly && animatedFormat

  const setCustomNumber = (key: NumericCustomOptionKey, value: string, min: number, max: number): void => {
    const next = parseBoundedIntInput(value, min, max)
    setCustomOptions((prev) => ({ ...prev, [key]: next }))
  }

  // Pass onClose as onComplete — dialog auto-closes after export success
  const { startExport, cancelExport, exporting, exportProgress } = useExport({
    onComplete: onClose
  })

  useEffect(() => {
    if (effectiveAudioOnly && !AUDIO_FORMATS.find((f) => f.value === format)) {
      setFormat('mp3')
    }
    if (!effectiveAudioOnly && !VIDEO_FORMATS.find((f) => f.value === format)) {
      setFormat('mp4')
    }
  }, [format, effectiveAudioOnly])

  useEffect(() => {
    if (open) {
      setStep('configure')
      setExportMode('timeline')
      setRangeStartText('00:00.00')
      setRangeEndText(formatTime(timelineDuration))
      if (!effectiveAudioOnly) {
        setFormat('mp4')
      }
      const host = configureScrollRef.current
      if (host) {
        requestAnimationFrame(() => {
          host.scrollTo({ top: 0, behavior: 'auto' })
        })
      }
    }
  }, [open, effectiveAudioOnly, timelineDuration])

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
    let scope: ExportScope = { mode: 'timeline' }
    if (exportMode === 'selection') {
      scope = { mode: 'selection' }
    } else if (exportMode === 'range') {
      const startTime = parseTime(rangeStartText)
      const endTime = parseTime(rangeEndText)
      if (startTime === null || endTime === null || endTime <= startTime) {
        return
      }
      scope = { mode: 'range', startTime, endTime }
    }
    setStep('running')
    const started = await startExport(
      effectiveAudioOnly ? 'original' : resolution,
      quality,
      format,
      gifLoop,
      scope,
      customOptions
    )
    if (!started) {
      setStep('configure')
    }
  }

  const handleClose = (): void => {
    if (exporting) {
      cancelExport()
    }
    onClose()
  }

  const parsedRangeStart = parseTime(rangeStartText)
  const parsedRangeEnd = parseTime(rangeEndText)
  const rangeValid =
    exportMode !== 'range' ||
    (parsedRangeStart !== null &&
      parsedRangeEnd !== null &&
      parsedRangeEnd > parsedRangeStart &&
      parsedRangeStart >= 0 &&
      parsedRangeEnd <= Math.max(timelineDuration, 0.001))
  const canStartExport = Boolean(format && quality) &&
    rangeValid &&
    (exportMode !== 'selection' || selectedClipIds.length > 0)
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
    <Dialog
      open={open}
      onClose={handleClose}
      originRef={originRef}
      closeOnBackdrop={!exporting}
      title={effectiveAudioOnly ? '导出音频' : '导出视频'}
    >
      <div className="flex items-center gap-2 mb-4">
        <Badge tone={step === 'configure' ? 'accent' : 'default'}>1 配置</Badge>
        <Badge tone={step === 'running' ? 'accent' : 'default'}>2 执行</Badge>
      </div>

      {!exporting && step === 'configure' && (
        <div className="flex max-h-[62vh] flex-col">
          <div ref={configureScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-3">
            {!effectiveAudioOnly && (
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
              {quality === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-border-subtle bg-panel-muted/50 p-3">
                  {showCustomCrf && (
                    <label>
                      <span className="mb-1 block text-xs text-text-muted">CRF</span>
                      <input
                        type="number"
                        min={0}
                        max={51}
                        className="ui-input w-full"
                        value={customOptions.crf ?? ''}
                        onChange={(e) => setCustomNumber('crf', e.target.value, 0, 51)}
                      />
                    </label>
                  )}
                  {showCustomVideoBitrate && (
                    <label>
                      <span className="mb-1 block text-xs text-text-muted">视频码率 kbps</span>
                      <input
                        type="number"
                        min={64}
                        max={200000}
                        className="ui-input w-full"
                        value={customOptions.videoBitrateKbps ?? ''}
                        onChange={(e) => setCustomNumber('videoBitrateKbps', e.target.value, 64, 200000)}
                      />
                    </label>
                  )}
                  {showCustomH264Preset && (
                    <label>
                      <span className="mb-1 block text-xs text-text-muted">H.264 preset</span>
                      <select
                        className="ui-input w-full"
                        value={customOptions.h264Preset ?? 'medium'}
                        onChange={(e) =>
                          setCustomOptions((prev) => ({ ...prev, h264Preset: e.target.value as H264Preset }))
                        }
                      >
                        {H264_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {showCustomAudioBitrate && (
                    <label>
                      <span className="mb-1 block text-xs text-text-muted">音频码率 kbps</span>
                      <input
                        type="number"
                        min={32}
                        max={512}
                        className="ui-input w-full"
                        value={customOptions.audioBitrateKbps ?? ''}
                        onChange={(e) => setCustomNumber('audioBitrateKbps', e.target.value, 32, 512)}
                      />
                    </label>
                  )}
                  {showCustomAnimatedFps && (
                    <label>
                      <span className="mb-1 block text-xs text-text-muted">动图 FPS</span>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        className="ui-input w-full"
                        value={customOptions.animatedFps ?? ''}
                        onChange={(e) => setCustomNumber('animatedFps', e.target.value, 1, 60)}
                      />
                    </label>
                  )}
                </div>
              )}
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

            <div>
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wider block mb-2">导出范围</label>
              <div className="space-y-1">
                {[
                  { value: 'timeline' as const, label: '整条时间线', disabled: false },
                  { value: 'selection' as const, label: `所选片段（${selectedClipIds.length}）`, disabled: selectedClipIds.length === 0 },
                  { value: 'range' as const, label: '自定义片段范围', disabled: false }
                ].map((item) => (
                  <label
                    key={item.value}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
                      item.disabled
                        ? 'cursor-not-allowed opacity-50 border-transparent'
                        : exportMode === item.value
                          ? 'cursor-pointer border-accent bg-accent/10'
                          : 'cursor-pointer border-transparent hover:bg-panel-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="export-mode"
                      value={item.value}
                      checked={exportMode === item.value}
                      disabled={item.disabled}
                      onChange={() => setExportMode(item.value)}
                      className="accent-accent"
                    />
                    <span className="text-sm text-text-primary">{item.label}</span>
                  </label>
                ))}
              </div>
              {exportMode === 'range' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-1 block text-xs text-text-muted">开始</span>
                    <input
                      className={`ui-input w-full font-mono ${rangeValid ? '' : 'border-danger/60'}`}
                      value={rangeStartText}
                      onChange={(e) => setRangeStartText(e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-text-muted">结束</span>
                    <input
                      className={`ui-input w-full font-mono ${rangeValid ? '' : 'border-danger/60'}`}
                      value={rangeEndText}
                      onChange={(e) => setRangeEndText(e.target.value)}
                    />
                  </label>
                  <p className="col-span-2 text-[10px] text-text-muted">
                    当前时间线总时长：{formatTime(timelineDuration)}
                  </p>
                </div>
              )}
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
