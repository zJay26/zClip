import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import type { CanvasPreset, CanvasSettings } from '../../../../shared/types'
import { Button } from '../ui'
import { usePreferences } from '../../contexts/preferences'

const PRESETS: Array<{ preset: CanvasPreset; label: string; labelEn?: string; width: number; height: number }> = [
  { preset: 'source', label: '原始', labelEn: 'Source', width: 1920, height: 1080 },
  { preset: 'landscape', label: '16:9', width: 1920, height: 1080 },
  { preset: 'portrait', label: '9:16', width: 1080, height: 1920 },
  { preset: 'square', label: '1:1', width: 1080, height: 1080 },
  { preset: 'social', label: '4:5', width: 1080, height: 1350 }
]
const FRAME_RATES = [24, 25, 30, 50, 60] as const

const CanvasControl: React.FC = () => {
  const { t } = usePreferences()
  const { projectSettings, setProjectSettings } = useProjectStore()
  const canvas = projectSettings.canvas

  const updateCanvas = (patch: Partial<CanvasSettings>): void => {
    setProjectSettings({ canvas: { ...canvas, ...patch } })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.preset}
            size="sm"
            variant={canvas.preset === preset.preset ? 'primary' : 'secondary'}
            className="!px-1 !py-1 text-[10px]"
            onClick={() =>
              updateCanvas({
                preset: preset.preset,
                width: preset.width,
                height: preset.height
              })
            }
          >
            {preset.labelEn ? t(preset.label, preset.labelEn) : preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-xs text-text-muted">{t('宽度', 'Width')}</span>
          <input
            type="number"
            className="ui-input w-full font-mono"
            min={16}
            value={canvas.width}
            onChange={(e) =>
              updateCanvas({
                preset: 'custom',
                width: Math.max(16, Number(e.target.value) || canvas.width)
              })
            }
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-text-muted">{t('高度', 'Height')}</span>
          <input
            type="number"
            className="ui-input w-full font-mono"
            min={16}
            value={canvas.height}
            onChange={(e) =>
              updateCanvas({
                preset: 'custom',
                height: Math.max(16, Number(e.target.value) || canvas.height)
              })
            }
          />
        </label>
      </div>

      <label className="flex items-center justify-between gap-3 text-xs text-text-secondary">
        {t('背景色', 'Background')}
        <input
          type="color"
          className="h-7 w-12 rounded-sm border border-border bg-panel-muted"
          value={canvas.backgroundColor}
          onChange={(e) => updateCanvas({ backgroundColor: e.target.value })}
        />
      </label>

      <div>
        <span className="mb-1.5 block text-xs text-text-muted">{t('项目帧率', 'Project frame rate')}</span>
        <div className="grid grid-cols-5 gap-1" role="group" aria-label={t('项目帧率', 'Project frame rate')}>
          {FRAME_RATES.map((frameRate) => (
            <Button
              key={frameRate}
              size="sm"
              variant={(projectSettings.frameRate ?? 30) === frameRate ? 'primary' : 'secondary'}
              className="!px-1 !py-1 text-[10px]"
              onClick={() => setProjectSettings({ frameRate })}
            >
              {frameRate}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CanvasControl
