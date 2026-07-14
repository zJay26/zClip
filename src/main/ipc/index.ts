// ============================================================
// IPC — 注册所有 handler
// ============================================================

import { registerMediaHandlers } from './media'
import { registerExportHandlers } from './export'
import { registerProjectHandlers } from './project'
import { registerSystemHandlers } from './system'

export function registerAllHandlers(): void {
  registerMediaHandlers()
  registerExportHandlers()
  registerProjectHandlers()
  registerSystemHandlers()
}
