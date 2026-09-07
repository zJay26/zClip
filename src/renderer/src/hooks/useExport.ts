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
  const activeJobRef = useRef<{ canceled: boolean; started: boolean; errorSeen: boolean; outputPath?: string } | null>(null)
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for export events from main process
  useEffect(() => {
    const unsubProgress = window.api.onExportProgress((progress) => {
      if (activeJobRef.current && !activeJobRef.current.canceled) setExportProgress(progress)
    })
    const unsubComplete = window.api.onExportComplete((outputPath) => {
      const job = activeJobRef.current
      if (job && !job.canceled) job.outputPath = outputPath
    })
    const unsubError = window.api.onExportError((error) => {
      const job = activeJobRef.current
      if (!job || job.canceled || job.errorSeen) return
      job.errorSeen = true
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
      if ((!mediaInfo && clips.length === 0) || activeJobRef.current || useProjectStore.getState().exporting) return false
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
        const startTime = scope.startTime
        const endTime = scope.endTime
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime > useProjectStore.getState().timelineDuration || endTime - startTime <= 0.001) {
          showToast(translate('请选择时间线内有效的起止时间', 'Choose a valid start and end within the timeline'), 'info')
          return false
        }
        range = { startTime, endTime }
      }

      const job = { canceled: false, started: false, errorSeen: false, outputPath: undefined as string | undefined }
      activeJobRef.current = job
      setExporting(true)
      setExportProgress(null)
      try {
        const baseName = (mediaInfo?.filePath || 'zclip_timeline').split(/[\\/]/).pop() || 'output'
        const nameWithoutExt = baseName.replace(/\.[^.]+$/, '')
        const outputPath = await window.api.showSaveDialog(`${nameWithoutExt}_edited.${format}`)
        if (!outputPath || job.canceled) return false
        const exportOptions: ExportOptions = {
          format, resolution, quality,
          customOptions: quality === 'custom' ? customOptions : undefined,
          outputPath, range, projectSettings,
          gifLoop: isAnimatedImageFormat(format) ? gifLoop : undefined
        }
        job.started = true
        const result = await window.api.startExport({
          mediaInfo: mediaInfo ?? undefined, operations, clips: exportClips,
          operationsByClip: exportOpsByClip, transitions: exportTransitions,
          audioFades: exportAudioFades, exportOptions
        })
        if (job.canceled) return false
        if (!result.success) throw new Error(result.error || translate('未知错误', 'Unknown error'))
        setExportProgress({ percent: 100, currentTime: 0, speed: '', eta: '' })
        showToast(translate(`导出完成：${job.outputPath || outputPath}`, `Export complete: ${job.outputPath || outputPath}`), 'success')
        completionTimerRef.current = setTimeout(() => {
          completionTimerRef.current = null
          onCompleteRef.current?.()
        }, 600)
        return true
      } catch (error) {
        if (!job.canceled && !job.errorSeen) {
          const detail = error instanceof Error ? error.message : translate('未知错误', 'Unknown error')
          showToast(translate(`导出失败：${detail}`, `Export failed: ${detail}`), 'error')
        }
        return false
      } finally {
        activeJobRef.current = null
        setExporting(false)
        if (!completionTimerRef.current) setExportProgress(null)
      }
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
    const job = activeJobRef.current
    if (!job || job.canceled) return
    job.canceled = true
    try {
      if (job.started) window.api.cancelExport()
      showToast(translate('正在取消导出', 'Canceling export'), 'info')
    } catch (error) {
      job.canceled = false
      showToast(error instanceof Error ? error.message : translate('取消失败', 'Could not cancel export'), 'error')
    }
    // Keep the export lock until the native job has finished cleaning up.
  }, [setExporting, setExportProgress, showToast])

  return { startExport, cancelExport, exporting, exportProgress }
}
