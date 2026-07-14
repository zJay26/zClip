import React from 'react'
import { Clapperboard, Database, Download, FilePlus2, FolderOpen, Redo2, Save, SaveAll, Undo2 } from 'lucide-react'
import { formatFileSize } from '../../lib/utils'
import { Badge, Button, IconButton, Menu, type MenuItem } from '../ui'
import type { MediaInfo, RecentProject, TimelineClip } from '../../../../shared/types'

interface TopToolbarProps {
  loading: boolean
  sourceFile: string | null
  mediaInfo: MediaInfo | null
  clips: TimelineClip[]
  projectFilePath: string | null
  projectDirty: boolean
  recentProjects: RecentProject[]
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onOpenFiles: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onOpenRecentProject: (filePath: string) => void
  onOpenExport: () => void
  onClearCache: () => void
  cacheLabel: string
  exportButtonRef?: React.RefObject<HTMLButtonElement>
}

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const TopToolbar: React.FC<TopToolbarProps> = ({
  loading, sourceFile, mediaInfo, clips, projectFilePath, projectDirty, recentProjects,
  canUndo, canRedo, onUndo, onRedo, onOpenFiles, onOpenProject, onSaveProject,
  onSaveProjectAs, onOpenRecentProject, onOpenExport, onClearCache, cacheLabel, exportButtonRef
}) => {
  const fileName = sourceFile ? sourceFile.split(/[\\/]/).pop() : null
  const projectName = projectFilePath
    ? projectFilePath.split(/[\\/]/).pop()?.replace(/\.zclip$/i, '') || '未命名项目'
    : '未命名项目'
  const projectItems: MenuItem[] = [
    { id: 'open', label: '打开项目…', icon: <FolderOpen aria-hidden {...iconProps} />, shortcut: 'Ctrl+O', onSelect: onOpenProject },
    { id: 'save', label: '保存项目', icon: <Save aria-hidden {...iconProps} />, shortcut: 'Ctrl+S', disabled: clips.length === 0, onSelect: onSaveProject },
    { id: 'save-as', label: '项目另存为…', icon: <SaveAll aria-hidden {...iconProps} />, disabled: clips.length === 0, onSelect: onSaveProjectAs },
    ...recentProjects.map((project, index) => ({
      id: `recent-${project.filePath}`,
      label: project.name,
      dividerBefore: index === 0,
      icon: <Clapperboard aria-hidden {...iconProps} />,
      onSelect: () => onOpenRecentProject(project.filePath)
    }))
  ]

  return (
    <header className="ui-material relative z-40 flex h-12 shrink-0 items-center gap-2 border-x-0 border-t-0 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent/15 text-accent-soft">
          <Clapperboard aria-hidden size={17} strokeWidth={1.75} />
        </span>
        <span className="text-sm font-semibold tracking-[-0.02em] text-text-primary">zClip</span>
        <Menu label={projectName} items={projectItems} />
        {projectDirty && <span className="h-1.5 w-1.5 rounded-full bg-warning" title="项目有未保存的更改" />}
      </div>
      <div className="mx-1 h-5 w-px bg-border-subtle" />
      <Button onClick={onOpenFiles} disabled={loading} leadingIcon={<FilePlus2 aria-hidden {...iconProps} />}>导入媒体</Button>
      <IconButton label="保存项目 (Ctrl+S)" icon={<Save aria-hidden {...iconProps} />} disabled={clips.length === 0} onClick={onSaveProject} tooltipSide="bottom" />
      <div className="flex items-center rounded-md border border-border-subtle bg-bg-base/45 p-0.5">
        <IconButton label="撤销 (Ctrl+Z)" icon={<Undo2 aria-hidden {...iconProps} />} disabled={!canUndo} onClick={onUndo} size="sm" tooltipSide="bottom" />
        <IconButton label="重做 (Ctrl+Y)" icon={<Redo2 aria-hidden {...iconProps} />} disabled={!canRedo} onClick={onRedo} size="sm" tooltipSide="bottom" />
      </div>
      {fileName && (
        <div className="ml-1 flex min-w-0 items-center gap-2 text-xs text-text-muted">
          <span className="max-w-[220px] truncate font-medium text-text-secondary">{fileName}</span>
          {mediaInfo && <span className="hidden 2xl:inline">{formatFileSize(mediaInfo.fileSize)}</span>}
          {clips.length > 1 && <Badge>{clips.length} 个片段</Badge>}
        </div>
      )}
      <div className="flex-1" />
      <Button onClick={onClearCache} variant="ghost" leadingIcon={<Database aria-hidden {...iconProps} />} title="清理代理和时间线预览缓存" className="max-w-40">
        {cacheLabel ? `缓存 ${cacheLabel}` : '缓存'}
      </Button>
      <Button ref={exportButtonRef} onClick={onOpenExport} disabled={!sourceFile || loading} variant="primary" leadingIcon={<Download aria-hidden {...iconProps} />}>导出</Button>
    </header>
  )
}

export default TopToolbar
