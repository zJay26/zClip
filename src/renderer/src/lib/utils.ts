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
 * Convert a local filesystem path into the authorized custom media URL served
 * by the Electron main process. Keep drive separators and URL path separators
 * visible so Chromium accepts the URL as a standard, streamable media URL.
 */
export function toMediaUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')

  if (normalizedPath.startsWith('//')) {
    const encodedUncPath = normalizedPath
      .slice(2)
      .split('/')
      .map(encodeURIComponent)
      .join('/')
    return `local-media://media/__unc__/${encodedUncPath}`
  }

  const absolutePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  const encodedPath = absolutePath
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')

  return `local-media://media${encodedPath}`
}

/**
 * Normalize a media URL back to a comparable path-like string.
 */
export function mediaUrlToPath(mediaUrl: string): string {
  try {
    if (mediaUrl.startsWith('local-media://')) {
      const url = new URL(mediaUrl)
      const decodedPath = decodeURIComponent(url.pathname)
      if (decodedPath.startsWith('/__unc__/')) {
        return `//${decodedPath.slice('/__unc__/'.length)}`
      }
      return /^\/[A-Za-z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath
    }
    if (mediaUrl.startsWith('file://')) {
      const url = new URL(mediaUrl)
      const decodedPath = decodeURIComponent(url.pathname)
      return /^\/[A-Za-z]:/.test(decodedPath) ? decodedPath.slice(1) : decodedPath
    }
  } catch {
    // Fall through to a best-effort string normalization below.
  }

  try {
    return decodeURIComponent(mediaUrl)
  } catch {
    return mediaUrl
  }
}

/**
 * Generate a simple UUID v4
 */
export function uid(): string {
  return crypto.randomUUID()
}

/**
 * Join class names safely
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
