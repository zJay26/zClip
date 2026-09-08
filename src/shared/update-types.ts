export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdateSettings {
  autoCheck: boolean
  downloadDirectory: string
}

export interface UpdateRelease {
  version: string
  notes: string
  url: string
  assetUrl: string
  assetName: string
  size: number
  sha256: string
}

export interface UpdateState {
  currentVersion: string
  settings: UpdateSettings
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  lastCheckedAt: number | null
  release: UpdateRelease | null
  downloadedPath: string | null
  progress: number
  error: string | null
}
