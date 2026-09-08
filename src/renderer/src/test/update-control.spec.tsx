import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UpdateControl from '../components/Layout/UpdateControl'
import { PreferencesProvider } from '../contexts/preferences'
import { useProjectStore } from '../stores/project-store'
import type { UpdateState } from '../../../shared/update-types'

let state: UpdateState
let emit: (next: UpdateState) => void
let api: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  window.localStorage.clear()
  useProjectStore.setState({ exporting: false, merging: false, loading: false })
  state = {
    currentVersion: '2.8.0', settings: { autoCheck: true, downloadDirectory: 'D:\\Updates' },
    status: 'available', lastCheckedAt: Date.now(), progress: 0, downloadedPath: null, error: null,
    release: { version: '2.9.0', notes: 'New release', url: 'https://github.com/zJay26/zClip/releases/tag/v2.9.0', assetName: 'zClip.Setup.2.9.0.exe', assetUrl: '', size: 1024, sha256: '' }
  }
  api = {
    getUpdateState: vi.fn(async () => state),
    onUpdateState: vi.fn((callback) => { emit = callback; return () => {} }),
    setUpdateAutoCheck: vi.fn(async (enabled) => ({ ...state, settings: { ...state.settings, autoCheck: enabled } })),
    selectUpdateDirectory: vi.fn(async () => ({ ...state, settings: { ...state.settings, downloadDirectory: 'E:\\My Updates' } })),
    checkForUpdates: vi.fn(async () => state),
    downloadUpdate: vi.fn(async () => ({ ...state, status: 'downloaded', downloadedPath: 'D:\\Updates\\zClip.Setup.2.9.0.exe', progress: 100 })),
    cancelUpdateDownload: vi.fn(async () => {}),
    installUpdate: vi.fn(async () => true)
  }
  vi.stubGlobal('api', api)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('a discovered update can be dismissed without downloading or installing', async () => {
  render(<PreferencesProvider><UpdateControl /></PreferencesProvider>)
  await screen.findByText('发现 zClip 2.9.0')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '稍后' }))
  expect(screen.queryByText('发现 zClip 2.9.0')).not.toBeInTheDocument()
  expect(api.downloadUpdate).not.toHaveBeenCalled()
  expect(api.installUpdate).not.toHaveBeenCalled()
})

test('download and installation each require an explicit click, and processing blocks installation', async () => {
  render(<PreferencesProvider><UpdateControl /></PreferencesProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '查看更新' }))
  fireEvent.click(screen.getByRole('button', { name: '下载更新' }))
  const install = await screen.findByRole('button', { name: '退出并安装' })
  expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
  expect(api.installUpdate).not.toHaveBeenCalled()
  act(() => useProjectStore.setState({ exporting: true }))
  expect(install).toBeDisabled()
  act(() => useProjectStore.setState({ exporting: false }))
  fireEvent.click(install)
  await waitFor(() => expect(api.installUpdate).toHaveBeenCalledTimes(1))
})

test('disabling checks and choosing a directory invoke persistent settings APIs', async () => {
  render(<PreferencesProvider><UpdateControl /></PreferencesProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '查看更新' }))
  const automatic = screen.getByRole('checkbox')
  expect(automatic).toBeChecked()
  fireEvent.click(automatic)
  await waitFor(() => expect(automatic).not.toBeChecked())
  expect(api.setUpdateAutoCheck).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: '选择…' }))
  await waitFor(() => expect(screen.getByLabelText('更新下载目录')).toHaveValue('E:\\My Updates'))
  expect(api.downloadUpdate).not.toHaveBeenCalled()
})

test('progress events expose cancellation and never launch installation', async () => {
  render(<PreferencesProvider><UpdateControl /></PreferencesProvider>)
  fireEvent.click(await screen.findByRole('button', { name: '查看更新' }))
  act(() => emit({ ...state, status: 'downloading', progress: 42 }))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  fireEvent.click(screen.getByRole('button', { name: '取消下载' }))
  await waitFor(() => expect(api.cancelUpdateDownload).toHaveBeenCalledTimes(1))
  expect(api.installUpdate).not.toHaveBeenCalled()
})
