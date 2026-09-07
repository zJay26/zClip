import React from 'react'
import { Dialog } from '../ui'
import { usePreferences } from '../../contexts/preferences'

export default function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = usePreferences()
  const groups = [
    { title: t('项目', 'Project'), rows: [
      [t('新建 / 打开', 'New / Open'), 'Ctrl+N / Ctrl+O'],
      [t('导入媒体', 'Import media'), 'Ctrl+I'],
      [t('保存 / 另存为', 'Save / Save as'), 'Ctrl+S / Ctrl+Shift+S'],
      [t('导出', 'Export'), 'Ctrl+E']
    ] },
    { title: t('播放与定位', 'Playback & navigation'), rows: [
      [t('播放 / 暂停', 'Play / Pause'), 'Space / K'],
      [t('前后 5 秒', 'Back / Forward 5 seconds'), 'J / L'],
      [t('前后单帧 / 1 秒', 'Step frame / 1 second'), '← → / Shift+← →'],
      [t('上一个 / 下一个剪辑点', 'Previous / Next cut'), '↑ / ↓'],
      [t('时间线起点 / 终点', 'Timeline start / end'), 'Home / End']
    ] },
    { title: t('片段编辑', 'Clip editing'), rows: [
      [t('全选 / 取消选择', 'Select all / Clear selection'), 'Ctrl+A / Esc'],
      [t('在播放头处分割', 'Split at playhead'), 'C'],
      [t('复制 / 剪切 / 粘贴', 'Copy / Cut / Paste'), 'Ctrl+C / X / V'],
      [t('删除', 'Delete'), 'Delete / Backspace'],
      [t('删除并关闭空隙', 'Delete and close gaps'), 'Shift+Delete'],
      [t('撤销 / 重做', 'Undo / Redo'), 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y']
    ] }
  ]
  return (
    <Dialog open={open} onClose={onClose} title={t('快捷键', 'Keyboard shortcuts')}
      description={t('从导入到导出，常用操作尽在键盘。按 F1 随时查看。', 'Common actions from import to export. Press F1 to open this guide.')}
      className="w-[560px]">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-2 text-xs font-semibold text-accent-soft">{group.title}</h3>
            <dl className="divide-y divide-border-subtle">
              {group.rows.map(([label, keys]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd><kbd className="rounded-sm border border-border-subtle bg-panel-hover/50 px-2 py-1 font-mono text-[11px] text-text-primary">{keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs leading-relaxed text-text-muted">{t('关闭空隙会同时移动所有轨道；有其他素材覆盖的时间段会保留。输入框内保留原生编辑快捷键。', 'Closing gaps shifts all tracks together and preserves time covered by other clips. Text fields keep their native editing shortcuts.')}</p>
      </div>
    </Dialog>
  )
}
