// ============================================================
// useExport — 封装导出流程
// ============================================================

import { useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import type {
  ExportCustomOptions,
  ExportOptions,
  ResolutionPreset,
  QualityPreset,
  ExportFormat,
  GifLoopMode
} from '../../../shared/types'
import { getClipTimelineRange } from '../../../shared/timeline-utils'
import { translate } from '../contexts/preferences'

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
  } = useProjectStore(useShallow((state) => ({
    mediaInfo: state.mediaInfo,
    operations: state.operations,
    clips: state.clips,
    selectedClipIds: state.selectedClipIds,
    operationsByClip: state.operationsByClip,
    transitions: state.transitions,
    audioFades: state.audioFades,
    projectSettings: state.projectSettings,
    exporting: state.exporting,
    exportProgress: state.exportProgress,
    setExporting: state.setExporting,
    setExportProgress: state.setExportProgress,
    showToast: state.showToast
  })))

  // Use ref so the IPC listener always sees the latest callback
  const onCompleteRef = useRef(opts?.onComplete)
  onCompleteRef.current = opts?.onComplete
  const errorEventSeenRef = useRef(false)
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for export events from main process
  useEffect(() => {
    const unsubProgress = window.api.onExportProgress((progress) => {
      setExportProgress(progress)
    })
    const unsubComplete = window.api.onExportComplete((outputPath) => {
      setExporting(false)
      setExportProgress(null)
      showToast(translate(`导出完成：${outputPath}`, `Export complete: ${outputPath}`), 'success')
      // Auto-close dialog after a short delay so user can see 100%
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current)
      completionTimerRef.current = setTimeout(() => {
        completionTimerRef.current = null
        onCompleteRef.current?.()
      }, 600)
    })
    const unsubError = window.api.onExportError((error) => {
      errorEventSeenRef.current = true
      setExporting(false)
      setExportProgress(null)
      showToast(translate(`导出失败：${error}`, `Export failed: ${error}`), 'error')
    })

    return () => {
      unsubProgress()
      unsubComplete()
      unsubError()
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
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
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }

      let exportClips = clips
      let exportOpsByClip = operationsByClip
      let exportTransitions = transitions
      let exportAudioFades = audioFades
      let range: ExportOptions['range'] | undefined
      if (scope.mode === 'selection') {
        const selected = new Set(selectedClipIds)
        exportClips = clips.filter((clip) => selected.has(clip.id))
        if (exportClips.length === 0) {
          showToast(translate('请先选择要导出的片段', 'Select clips to export first'), 'info')
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
          showToast(translate('导出范围时长必须大于 0', 'Export range duration must be greater than 0'), 'info')
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
          showToast(translate(`导出失败：${result.error || '未知错误'}`, `Export failed: ${result.error || 'Unknown error'}`), 'error')
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
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current)
      completionTimerRef.current = null
    }
    window.api.cancelExport()
    setExporting(false)
    setExportProgress(null)
    showToast(translate('导出已取消', 'Export canceled'), 'info')
  }, [setExporting, setExportProgress, showToast])

  return { startExport, cancelExport, exporting, exportProgress }
}
