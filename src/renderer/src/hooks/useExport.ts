// ============================================================
// useExport — 封装导出流程
// ============================================================

import { useEffect, useCallback, useRef } from 'react'
import { useProjectStore } from '../stores/project-store'
import type { ExportOptions, ResolutionPreset, QualityPreset, ExportFormat } from '../../../shared/types'

interface UseExportOptions {
  /** 导出成功后的回调（用于关闭弹窗等） */
  onComplete?: () => void
}

export function useExport(opts?: UseExportOptions) {
  const {
    mediaInfo,
    operations,
    clips,
    operationsByClip,
    exporting,
    exportProgress,
    setExporting,
    setExportProgress,
    showToast
  } = useProjectStore()

  // Use ref so the IPC listener always sees the latest callback
  const onCompleteRef = useRef(opts?.onComplete)
  onCompleteRef.current = opts?.onComplete

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
    async (resolution: ResolutionPreset, quality: QualityPreset, format: ExportFormat) => {
      if (!mediaInfo && clips.length === 0) return

      // Ask user where to save
      const baseName = mediaInfo
        ? mediaInfo.filePath.split(/[\\/]/).pop() || 'output'
        : 'zclip_timeline'
      const nameWithoutExt = baseName.replace(/\.[^.]+$/, '')
      const outputPath = await window.api.showSaveDialog(`${nameWithoutExt}_edited.${format}`)
      if (!outputPath) return

      const exportOptions: ExportOptions = {
        format,
        resolution,
        quality,
        outputPath
      }

      setExporting(true)
      setExportProgress(null)

      await window.api.startExport({
        mediaInfo: mediaInfo ?? undefined,
        operations,
        clips,
        operationsByClip,
        exportOptions
      })
    },
    [mediaInfo, operations, clips, operationsByClip, setExporting, setExportProgress]
  )

  const cancelExport = useCallback(() => {
    window.api.cancelExport()
    setExporting(false)
    setExportProgress(null)
    showToast('导出已取消', 'info')
  }, [setExporting, setExportProgress, showToast])

  return { startExport, cancelExport, exporting, exportProgress }
}
