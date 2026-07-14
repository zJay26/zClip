// ============================================================
// useExport — 封装导出流程
// ============================================================

import { useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../stores/project-store'
import type {
  ExportCustomOptions,
  ExportOptions,
  ResolutionPreset,
  QualityPreset,
  ExportFormat,
  GifLoopMode
} from '../../../shared/types'
import { getClipTimelineRange } from '../../../shared/timeline-utils'

export type ExportScope =
  | { mode: 'timeline' }
  | { mode: 'selection' }
  | { mode: 'range'; startTime: number; endTime: number }

interface UseExportOptions {
  /** 导出成功后的回调（用于关闭弹窗等） */
  onComplete?: () => void
}

function isAnimatedImageFormat(format: ExportFormat): boolean {
  return format === 'gif' || format === 'webp'
}

export function useExport(opts?: UseExportOptions) {
  const {
    mediaInfo,
    operations,
    clips,
    selectedClipIds,
    operationsByClip,
    transitions,
    audioFades,
    projectSettings,
    exporting,
    exportProgress,
    setExporting,
    setExportProgress,
    showToast
  } = useProjectStore()

  // Use ref so the IPC listener always sees the latest callback
  const onCompleteRef = useRef(opts?.onComplete)
  onCompleteRef.current = opts?.onComplete
  const errorEventSeenRef = useRef(false)

  // Listen for export events from main process
  useEffect(() => {
    const unsubProgress = window.api.onExportProgress((progress) => {
      setExportProgress(progress)
    })
    const unsubComplete = window.api.onExportComplete((outputPath) => {
      setExporting(false)
      setExportProgress(null)
      showToast(`导出完成: ${outputPath}`, 'success')
      // Auto-close dialog after a short delay so user can see 100%
      setTimeout(() => {
        onCompleteRef.current?.()
      }, 600)
    })
    const unsubError = window.api.onExportError((error) => {
      errorEventSeenRef.current = true
      setExporting(false)
      setExportProgress(null)
      showToast(`导出失败: ${error}`, 'error')
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
    }
  }, [setExporting, setExportProgress, showToast])

  const startExport = useCallback(
    async (
      resolution: ResolutionPreset,
      quality: QualityPreset,
      format: ExportFormat,
      gifLoop: GifLoopMode = 'infinite',
      scope: ExportScope = { mode: 'timeline' },
      customOptions?: ExportCustomOptions
    ): Promise<boolean> => {
      if (!mediaInfo && clips.length === 0) return false

      let exportClips = clips
      let exportOpsByClip = operationsByClip
      let exportTransitions = transitions
      let exportAudioFades = audioFades
      let range: ExportOptions['range'] | undefined
      if (scope.mode === 'selection') {
        const selected = new Set(selectedClipIds)
        exportClips = clips.filter((clip) => selected.has(clip.id))
        if (exportClips.length === 0) {
          showToast('请先选择要导出的片段', 'info')
          return false
        }
        const starts = exportClips.map((clip) => getClipTimelineRange(clip, operationsByClip).start)
        const minStart = Math.min(...starts)
        exportClips = exportClips.map((clip) => ({
          ...clip,
          startTime: Math.max(0, clip.startTime - minStart)
        }))
        exportOpsByClip = Object.fromEntries(
          exportClips.map((clip) => [clip.id, operationsByClip[clip.id] || []])
        )
        exportTransitions = transitions.filter(
          (transition) => selected.has(transition.leftClipId) && selected.has(transition.rightClipId)
        )
        exportAudioFades = audioFades.filter((fade) => selected.has(fade.clipId))
      } else if (scope.mode === 'range') {
        const startTime = Math.max(0, Math.min(scope.startTime, scope.endTime))
        const endTime = Math.max(startTime, scope.endTime)
        if (endTime - startTime <= 0.001) {
          showToast('导出范围时长必须大于 0', 'info')
          return false
        }
        range = { startTime, endTime }
      }

      // Ask user where to save
      const baseName = mediaInfo
        ? mediaInfo.filePath.split(/[\\/]/).pop() || 'output'
        : 'zclip_timeline'
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, '')
      const outputPath = await window.api.showSaveDialog(`${nameWithoutExt}_edited.${format}`)
      if (!outputPath) return false

      const exportOptions: ExportOptions = {
        format,
        resolution,
        quality,
        customOptions: quality === 'custom' ? customOptions : undefined,
        outputPath,
        range,
        projectSettings,
        gifLoop: isAnimatedImageFormat(format) ? gifLoop : undefined
      }

      setExporting(true)
      setExportProgress(null)
      errorEventSeenRef.current = false

      const result = await window.api.startExport({
        mediaInfo: mediaInfo ?? undefined,
        operations,
        clips: exportClips,
        operationsByClip: exportOpsByClip,
        transitions: exportTransitions,
        audioFades: exportAudioFades,
        exportOptions
      })
      if (!result.success) {
        setExporting(false)
        setExportProgress(null)
        if (!errorEventSeenRef.current) {
          showToast(`导出失败: ${result.error || 'Export failed'}`, 'error')
        }
        return false
      }
      return true
    },
    [
      mediaInfo,
      operations,
      clips,
      selectedClipIds,
      operationsByClip,
      transitions,
      audioFades,
      projectSettings,
      setExporting,
      setExportProgress,
      showToast
    ]
  )

  const cancelExport = useCallback(() => {
    window.api.cancelExport()
    setExporting(false)
    setExportProgress(null)
    showToast('导出已取消', 'info')
  }, [setExporting, setExportProgress, showToast])

  return { startExport, cancelExport, exporting, exportProgress }
}
