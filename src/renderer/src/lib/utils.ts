/**
 * Format seconds to mm:ss.ms display string
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00.00'
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  const mm = String(mins).padStart(2, '0')
  const ss = secs.toFixed(2).padStart(5, '0')
  return `${mm}:${ss}`
}

/**
 * Parse a time string "mm:ss.ms" back to seconds
 */
export function parseTime(timeStr: string): number | null {
  // Accept mm:ss.ms or just a raw number
  const colonMatch = timeStr.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  if (colonMatch) {
    return parseInt(colonMatch[1]) * 60 + parseFloat(colonMatch[2])
  }
  const num = parseFloat(timeStr)
  return isNaN(num) ? null : num
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Format bytes to human-readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Generate a simple UUID v4
 */
export function uid(): string {
  return crypto.randomUUID()
}
