import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import type { TransformParams } from '../../../../shared/types'
import ParamSlider from '../common/ParamSlider'
import { Button } from '../ui'

const DEFAULT_TRANSFORM: TransformParams = {
  fit: 'contain',
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 100,
  flipX: false,
  flipY: false
}

const TransformControl: React.FC = () => {
  const { operations, clips, selectedClipId, setTransform } = useProjectStore()
  const selectedClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) : null
  if (!selectedClip || selectedClip.track !== 'video') {
    return <p className="text-xs text-text-muted">请选择视频片段调整构图。</p>
  }

  const transformOp = operations.find((op) => op.type === 'transform')
  const params: TransformParams = {
    ...DEFAULT_TRANSFORM,
    ...(transformOp?.params as Partial<TransformParams> | undefined)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1">
        {[
          { value: 'contain' as const, label: '适应' },
          { value: 'cover' as const, label: '裁满' },
          { value: 'stretch' as const, label: '拉伸' }
        ].map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={params.fit === item.value ? 'primary' : 'secondary'}
            className="!px-1 !py-1 text-[10px]"
            onClick={() => setTransform({ fit: item.value })}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <ParamSlider
        label="缩放"
        value={params.scale}
        min={0.1}
        max={4}
        step={0.01}
        unit="x"
        onChange={(scale, options) => setTransform({ scale }, options)}
        formatValue={(v) => v.toFixed(2)}
      />
      <ParamSlider
        label="水平"
        value={params.x}
        min={-2000}
        max={2000}
        step={1}
        unit="px"
        onChange={(x, options) => setTransform({ x }, options)}
        formatValue={(v) => `${Math.round(v)}`}
      />
      <ParamSlider
        label="垂直"
        value={params.y}
        min={-2000}
        max={2000}
        step={1}
        unit="px"
        onChange={(y, options) => setTransform({ y }, options)}
        formatValue={(v) => `${Math.round(v)}`}
      />
      <ParamSlider
        label="不透明度"
        value={params.opacity}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(opacity, options) => setTransform({ opacity }, options)}
        formatValue={(v) => `${Math.round(v)}`}
      />

      <div className="grid grid-cols-4 gap-1">
        {[0, 90, 180, 270].map((rotation) => (
          <Button
            key={rotation}
            size="sm"
            variant={params.rotation === rotation ? 'primary' : 'secondary'}
            className="!px-1 !py-1 text-[10px]"
            onClick={() => setTransform({ rotation: rotation as TransformParams['rotation'] })}
          >
            {rotation}°
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button
          size="sm"
          variant={params.flipX ? 'primary' : 'secondary'}
          className="!px-1 !py-1 text-[10px]"
          onClick={() => setTransform({ flipX: !params.flipX })}
        >
          水平翻转
        </Button>
        <Button
          size="sm"
          variant={params.flipY ? 'primary' : 'secondary'}
          className="!px-1 !py-1 text-[10px]"
          onClick={() => setTransform({ flipY: !params.flipY })}
        >
          垂直翻转
        </Button>
      </div>
    </div>
  )
}

export default TransformControl
