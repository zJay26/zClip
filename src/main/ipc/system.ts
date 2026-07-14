import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { clearMediaCaches, getCacheStats } from '../services/cache-manager'
import { assertTrustedIpcEvent } from '../security/ipc-security'
import { cancelAllMediaJobs } from '../services/media-job-manager'

export function registerSystemHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_GET_STATS, async (event) => {
    assertTrustedIpcEvent(event)
    return getCacheStats()
  })
  ipcMain.handle(IPC_CHANNELS.CACHE_CLEAR, async (event) => {
    assertTrustedIpcEvent(event)
    cancelAllMediaJobs()
    await clearMediaCaches()
    return getCacheStats()
  })
}
