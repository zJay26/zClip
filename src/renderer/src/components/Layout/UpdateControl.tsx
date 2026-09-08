import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpCircle, FolderOpen } from 'lucide-react'
import type { UpdateState } from '../../../../shared/update-types'
import { usePreferences } from '../../contexts/preferences'
import { useProjectStore } from '../../stores/project-store'
import { formatFileSize } from '../../lib/utils'
import { Button, Dialog, IconButton, ProgressBar } from '../ui'

const UpdateControl: React.FC = () => {
  const { t, language } = usePreferences()
  const [state, setState] = useState<UpdateState | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const originRef = useRef<HTMLButtonElement>(null)
  const working = useProjectStore((project) => project.exporting || project.merging || project.loading)

  useEffect(() => {
    if (!window.api?.getUpdateState) return
    let active = true
    let receivedEvent = false
    const unsubscribe = window.api.onUpdateState((next) => {
      receivedEvent = true
      if (active) setState(next)
    })
    void window.api.getUpdateState().then((next) => {
      if (active && !receivedEvent) setState(next)
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false; unsubscribe() }
  }, [])

  async function run(name: string, action: () => Promise<UpdateState | boolean | void>): Promise<void> {
    setPending(name)
    setError(null)
    try {
      const result = await action()
      if (result && typeof result === 'object') setState(result)
      if (name === 'install') {
        if (result === true) setOpen(false)
        else setError(t('暂时无法启动安装，请完成当前操作后重试。', 'Cannot start installation yet. Finish the current action and retry.'))
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPending(null) }
  }

  const release = state?.release
  const downloading = state?.status === 'downloading'
  const downloaded = state?.status === 'downloaded'
  const busy = !!pending || downloading || state?.status === 'checking' || state?.status === 'installing'
  const notificationKey = `${state?.status}:${release?.version}`
  const notify = !!release && (state?.status === 'available' || downloaded) && dismissed !== notificationKey && !open
  const close = (): void => { setDismissed(notificationKey); setOpen(false) }
  const statusText = state?.status === 'checking' ? t('正在检查更新…', 'Checking for updates…')
    : state?.status === 'up-to-date' ? t('已是最新版本', 'You are up to date')
    : downloaded ? t('下载完成，随时可以安装', 'Downloaded and ready to install')
    : downloading ? t('正在下载安装包…', 'Downloading installer…')
    : state?.status === 'installing' ? t('正在启动安装程序…', 'Starting the installer…')
    : state?.status === 'error' ? t('更新未完成，可重试', 'Update did not complete. You can retry.')
    : release ? t(`发现新版本 ${release.version}`, `Version ${release.version} is available`)
    : t('可以随时手动检查更新', 'You can check for updates at any time')

  return <>
    <span className="relative shrink-0">
      <IconButton ref={originRef} label={t('软件更新', 'Software updates')} icon={<ArrowUpCircle aria-hidden size={16} strokeWidth={1.75} />} onClick={() => setOpen(true)} tooltipSide="bottom" />
      {release && <span className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
    </span>
    {createPortal(<>
      {notify && <aside className="ui-material fixed right-4 top-16 z-40 w-80 max-w-[90vw] rounded-lg p-4 shadow-xl" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-text-primary">{downloaded ? t('更新已准备就绪', 'Update ready to install') : t(`发现 zClip ${release.version}`, `zClip ${release.version} is available`)}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">{t('由你决定何时更新，可以继续剪辑。', 'Update when it suits you. You can keep editing.')}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => setOpen(true)}>{t('查看更新', 'View update')}</Button>
          <Button variant="ghost" onClick={() => setDismissed(notificationKey)}>{t('稍后', 'Later')}</Button>
        </div>
      </aside>}
      <Dialog open={open} title={t('软件更新', 'Software updates')} description={t('检查后由你决定是否下载；只有点击“退出并安装”才会启动安装。', 'Choose whether to download. Installation starts only when you click “Quit and install”.')} onClose={close} originRef={originRef} className="w-[540px]">
        <div className="space-y-4 text-xs text-text-secondary">
          {state && <>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-base/40 p-3">
              <div><p className="font-semibold text-text-primary">zClip {state.currentVersion}</p><p className="mt-1" role="status">{statusText}</p></div>
              <Button disabled={busy} onClick={() => void run('check', () => window.api.checkForUpdates())}>{t('检查更新', 'Check for updates')}</Button>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border-subtle p-3">
              <input type="checkbox" className="mt-0.5 accent-accent" checked={state.settings.autoCheck} disabled={pending === 'settings'} onChange={(event) => void run('settings', () => window.api.setUpdateAutoCheck(event.target.checked))} />
              <span><span className="font-medium text-text-primary">{t('每 6 小时自动检查更新', 'Automatically check every 6 hours')}</span><span className="mt-1 block leading-relaxed">{t('应用运行时检查。关闭后仍可手动检查；不会自动下载或安装。', 'Checks while the app is running. Manual checks remain available when disabled. Downloads and installation require your choice.')}</span></span>
            </label>
            <div className="space-y-2">
              <label htmlFor="update-directory" className="font-medium text-text-primary">{t('更新下载目录', 'Update download directory')}</label>
              <div className="flex gap-2">
                <input id="update-directory" className="ui-input min-w-0 flex-1 text-xs" readOnly value={state.settings.downloadDirectory} title={state.settings.downloadDirectory} />
                <Button disabled={busy} leadingIcon={<FolderOpen aria-hidden size={14} />} onClick={() => void run('directory', () => window.api.selectUpdateDirectory())}>{t('选择…', 'Choose…')}</Button>
              </div>
              <p>{t('安装包保存在此目录下的独立子文件夹中，已下载文件不会随设置改变而移动。', 'Installers are saved in a separate subfolder here. Changing this setting does not move existing downloads.')}</p>
            </div>
            {state.lastCheckedAt && <p>{t('上次检查：', 'Last checked: ')}{new Date(state.lastCheckedAt).toLocaleString(language === 'zh-CN' ? 'zh-CN' : 'en-US')}</p>}
            {release && <section className="space-y-3 border-t border-border-subtle pt-4">
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-text-primary">zClip {release.version}</h3><span>{formatFileSize(release.size)}</span></div>
              {release.notes && <details><summary className="cursor-pointer text-text-primary">{t('版本说明', 'Release notes')}</summary><p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{release.notes}</p></details>}
              <a href={release.url} target="_blank" rel="noreferrer" className="inline-block text-accent-soft underline">{t('在 GitHub 查看完整说明', 'View full release on GitHub')}</a>
              {downloading && <div className="space-y-2"><ProgressBar value={state.progress} /><p>{Math.floor(state.progress)}% · {t('下载后自动校验完整性', 'Integrity is verified after downloading')}</p></div>}
              {downloaded && <p className="break-all leading-relaxed">{t('已校验 SHA-256：', 'SHA-256 verified: ')}{state.downloadedPath}</p>}
              {downloaded && working && <p>{t('请等待导出或媒体处理完成后再安装。', 'Wait for export or media processing to finish before installing.')}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close}>{t('稍后再说', 'Maybe later')}</Button>
                {downloading ? <Button onClick={() => void run('cancel', () => window.api.cancelUpdateDownload())}>{t('取消下载', 'Cancel download')}</Button>
                  : downloaded ? <Button variant="primary" disabled={busy || working} onClick={() => void run('install', () => window.api.installUpdate())}>{t('退出并安装', 'Quit and install')}</Button>
                  : <Button variant="primary" disabled={busy} onClick={() => void run('download', () => window.api.downloadUpdate())}>{t('下载更新', 'Download update')}</Button>}
              </div>
            </section>}
          </>}
          {(error || state?.error) && <div role="alert" className="rounded-md border border-danger/30 p-3 text-danger"><p>{t('操作未完成，请检查网络或下载目录后重试。', 'Could not complete the action. Check your connection or download directory and retry.')}</p><p className="mt-1 break-all">{error || state?.error}</p></div>}
          {!state && <Button disabled={!!pending} onClick={() => void run('load', () => window.api.getUpdateState())}>{t('重新加载', 'Reload')}</Button>}
        </div>
      </Dialog>
    </>, document.body)}
  </>
}

export default UpdateControl
