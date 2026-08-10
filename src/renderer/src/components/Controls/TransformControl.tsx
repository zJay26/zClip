import React from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useShallow } from 'zustand/react/shallow'
import type { TransformParams } from '../../../../shared/types'
import ParamSlider from '../common/ParamSlider'
import { Button } from '../ui'
import { usePreferences } from '../../contexts/preferences'

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
  const { t } = usePreferences()
  const { operations, clips, selectedClipId, setTransform } = useProjectStore(useShallow((state) => ({
    operations: state.operations,
    clips: state.clips,
    selectedClipId: state.selectedClipId,
    setTransform: state.setTransform
  })))
  const selectedClip = selectedClipId ? clips.find((clip) => clip.id === selectedClipId) : null
  if (!selectedClip || selectedClip.track !== 'video') {
    return <p className="text-xs text-text-muted">{t('请选择视频片段调整构图。', 'Select a video clip to adjust its framing.')}</p>
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
          { value: 'contain' as const, label: t('适应', 'Fit') },
          { value: 'cover' as const, label: t('裁满', 'Fill') },
          { value: 'stretch' as const, label: t('拉伸', 'Stretch') }
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
        label={t('缩放', 'Scale')}
        value={params.scale}
        min={0.1}
        max={4}
        step={0.01}
        unit="x"
        onChange={(scale, options) => setTransform({ scale }, options)}
        formatValue={(v) => v.toFixed(2)}
      />
      <ParamSlider
        label={t('水平', 'Horizontal')}
        value={params.x}
        min={-2000}
        max={2000}
        step={1}
        unit="px"
        onChange={(x, options) => setTransform({ x }, options)}
        formatValue={(v) => `${Math.round(v)}`}
      />
      <ParamSlider
        label={t('垂直', 'Vertical')}
        value={params.y}
        min={-2000}
        max={2000}
        step={1}
        unit="px"
        onChange={(y, options) => setTransform({ y }, options)}
        formatValue={(v) => `${Math.round(v)}`}
      />
      <ParamSlider
        label={t('不透明度', 'Opacity')}
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
          {t('水平翻转', 'Flip horizontal')}
        </Button>
        <Button
          size="sm"
          variant={params.flipY ? 'primary' : 'secondary'}
          className="!px-1 !py-1 text-[10px]"
          onClick={() => setTransform({ flipY: !params.flipY })}
        >
          {t('垂直翻转', 'Flip vertical')}
        </Button>
      </div>
    </div>
  )
}

export default TransformControl
