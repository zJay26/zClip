import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'

const trustedWebContents = new Set<number>()
export const PRODUCTION_RENDERER_URL = 'zclip-app://app/index.html'

export function registerTrustedWebContents(webContents: WebContents): () => void {
  trustedWebContents.add(webContents.id)
  return () => trustedWebContents.delete(webContents.id)
}

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const actual = new URL(value)
    const devUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      const expected = new URL(devUrl)
      return actual.origin === expected.origin && actual.pathname === expected.pathname
    }
    return actual.href === PRODUCTION_RENDERER_URL
  } catch {
    return false
  }
}

export function assertTrustedIpcEvent(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const senderFrame = event.senderFrame
  if (
    !owner ||
    owner.isDestroyed() ||
    !trustedWebContents.has(event.sender.id) ||
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(senderFrame.url)
  ) {
    throw new Error('拒绝来自未知渲染进程的 IPC 请求')
  }
}

export function assertNonEmptyString(value: unknown, field: string, maxLength = 32_768): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${field} 参数无效`)
  }
}

export function assertPlainObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 参数无效`)
  }
}
