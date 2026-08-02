import React from 'react'
import { Clapperboard, Database, Download, FilePlus, FilePlus2, FolderOpen, Languages, Link2, Moon, Redo2, Save, SaveAll, Sun, Undo2 } from 'lucide-react'
import { formatFileSize } from '../../lib/utils'
import { usePreferences } from '../../contexts/preferences'
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
  onNewProject: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  onSaveProjectAs: () => void
  onOpenRecentProject: (filePath: string) => void
  onOpenExport: () => void
  onClearCache: () => void
  cacheLabel: string
  missingMediaCount: number
  onRelinkMissingMedia: () => void
  exportButtonRef?: React.RefObject<HTMLButtonElement>
}

const iconProps = { size: 15, strokeWidth: 1.75 } as const

const TopToolbar: React.FC<TopToolbarProps> = ({
  loading, sourceFile, mediaInfo, clips, projectFilePath, projectDirty, recentProjects,
  canUndo, canRedo, onUndo, onRedo, onOpenFiles, onNewProject, onOpenProject, onSaveProject,
  onSaveProjectAs, onOpenRecentProject, onOpenExport, onClearCache, cacheLabel,
  missingMediaCount, onRelinkMissingMedia, exportButtonRef
}) => {
  const { language, theme, t, toggleLanguage, toggleTheme } = usePreferences()
  const fileName = sourceFile ? sourceFile.split(/[\\/]/).pop() : null
  const projectName = projectFilePath
    ? projectFilePath.split(/[\\/]/).pop()?.replace(/\.zclip$/i, '') || t('未命名项目', 'Untitled project')
    : t('未命名项目', 'Untitled project')
  const projectItems: MenuItem[] = [
    { id: 'new', label: t('新建项目', 'New project'), icon: <FilePlus aria-hidden {...iconProps} />, shortcut: 'Ctrl+N', onSelect: onNewProject },
    { id: 'open', label: t('打开项目…', 'Open project…'), icon: <FolderOpen aria-hidden {...iconProps} />, shortcut: 'Ctrl+O', onSelect: onOpenProject },
    { id: 'save', label: t('保存项目', 'Save project'), icon: <Save aria-hidden {...iconProps} />, shortcut: 'Ctrl+S', disabled: clips.length === 0, onSelect: onSaveProject },
    { id: 'save-as', label: t('项目另存为…', 'Save project as…'), icon: <SaveAll aria-hidden {...iconProps} />, disabled: clips.length === 0, onSelect: onSaveProjectAs },
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
        {projectDirty && <span className="h-1.5 w-1.5 rounded-full bg-warning" title={t('项目有未保存的更改', 'Project has unsaved changes')} />}
      </div>
      <div className="mx-1 h-5 w-px bg-border-subtle" />
      <Button onClick={onOpenFiles} disabled={loading} leadingIcon={<FilePlus2 aria-hidden {...iconProps} />}>{t('导入媒体', 'Import media')}</Button>
      <IconButton label={t('保存项目 (Ctrl+S)', 'Save project (Ctrl+S)')} icon={<Save aria-hidden {...iconProps} />} disabled={clips.length === 0} onClick={onSaveProject} tooltipSide="bottom" />
      <div className="flex items-center rounded-md border border-border-subtle bg-bg-base/45 p-0.5">
        <IconButton label={t('撤销 (Ctrl+Z)', 'Undo (Ctrl+Z)')} icon={<Undo2 aria-hidden {...iconProps} />} disabled={!canUndo} onClick={onUndo} size="sm" tooltipSide="bottom" />
        <IconButton label={t('重做 (Ctrl+Y)', 'Redo (Ctrl+Y)')} icon={<Redo2 aria-hidden {...iconProps} />} disabled={!canRedo} onClick={onRedo} size="sm" tooltipSide="bottom" />
      </div>
      {fileName && (
        <div className="ml-1 flex min-w-0 items-center gap-2 text-xs text-text-muted">
          <span className="max-w-[220px] truncate font-medium text-text-secondary">{fileName}</span>
          {mediaInfo && <span className="hidden 2xl:inline">{formatFileSize(mediaInfo.fileSize)}</span>}
          {clips.length > 1 && <Badge>{t(`${clips.length} 个片段`, `${clips.length} clips`)}</Badge>}
        </div>
      )}
      <div className="flex-1" />
      <div className="flex shrink-0 items-center rounded-md border border-border-subtle bg-bg-base/45 p-0.5" role="group" aria-label={t('界面偏好', 'Interface preferences')}>
        <IconButton
          label={theme === 'dark' ? t('切换为浅色模式', 'Switch to light mode') : t('切换为深色模式', 'Switch to dark mode')}
          icon={theme === 'dark' ? <Sun aria-hidden {...iconProps} /> : <Moon aria-hidden {...iconProps} />}
          onClick={toggleTheme}
          size="sm"
          tooltipSide="bottom"
        />
        <Button
          variant="ghost"
          size="sm"
          className="min-w-[3.25rem] px-1.5"
          leadingIcon={<Languages aria-hidden {...iconProps} />}
          onClick={toggleLanguage}
          title={language === 'zh-CN' ? 'Switch to English' : '切换为中文'}
          aria-label={language === 'zh-CN' ? 'Switch to English' : '切换为中文'}
        >
          {language === 'zh-CN' ? 'EN' : '中'}
        </Button>
      </div>
      {missingMediaCount > 0 && (
        <Button
          onClick={onRelinkMissingMedia}
          variant="secondary"
          leadingIcon={<Link2 aria-hidden {...iconProps} />}
          title={t('为项目中无法访问的素材选择替代文件', 'Choose replacement files for unavailable media')}
        >
          {t(`重新定位 ${missingMediaCount}`, `Relink ${missingMediaCount}`)}
        </Button>
      )}
      <Button onClick={onClearCache} variant="ghost" leadingIcon={<Database aria-hidden {...iconProps} />} title={t('清理代理和时间线预览缓存', 'Clear proxy and timeline preview cache')} className="max-w-40">
        {cacheLabel ? t(`缓存 ${cacheLabel}`, `Cache ${cacheLabel}`) : t('缓存', 'Cache')}
      </Button>
      <Button ref={exportButtonRef} onClick={onOpenExport} disabled={!sourceFile || loading} variant="primary" leadingIcon={<Download aria-hidden {...iconProps} />}>{t('导出', 'Export')}</Button>
    </header>
  )
}

export default TopToolbar
