import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import type { CanvasPreset, CanvasSettings } from '../../../../shared/types'
import { Button } from '../ui'

const PRESETS: Array<{ preset: CanvasPreset; label: string; width: number; height: number }> = [
  { preset: 'source', label: '原始', width: 1920, height: 1080 },
  { preset: 'landscape', label: '16:9', width: 1920, height: 1080 },
  { preset: 'portrait', label: '9:16', width: 1080, height: 1920 },
  { preset: 'square', label: '1:1', width: 1080, height: 1080 },
  { preset: 'social', label: '4:5', width: 1080, height: 1350 }
]

const CanvasControl: React.FC = () => {
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
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-1 block text-xs text-text-muted">宽度</span>
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
          <span className="mb-1 block text-xs text-text-muted">高度</span>
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
        背景色
        <input
          type="color"
          className="h-7 w-12 rounded-sm border border-border bg-panel-muted"
          value={canvas.backgroundColor}
          onChange={(e) => updateCanvas({ backgroundColor: e.target.value })}
        />
      </label>
    </div>
  )
}

export default CanvasControl
