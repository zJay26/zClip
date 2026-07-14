import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

export function assertTrustedIpcEvent(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || owner.isDestroyed()) {
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
