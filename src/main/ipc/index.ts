// ============================================================
// IPC — 注册所有 handler
// ============================================================

import { registerMediaHandlers } from './media'
import { registerExportHandlers } from './export'

export function registerAllHandlers(): void {
  registerMediaHandlers()
  registerExportHandlers()
}
