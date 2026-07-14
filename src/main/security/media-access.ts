import path from 'path'

const authorizedMediaPaths = new Set<string>()
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v',
  '.mpg', '.mpeg', '.mpe', '.3gp', '.3g2', '.mts', '.m2ts', '.vob',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus',
  '.aiff', '.aif', '.alac', '.ac3', '.eac3', '.amr', '.png'
])

function key(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function authorizeMediaPath(filePath: string): void {
  if (typeof filePath !== 'string' || filePath.length === 0) return
  authorizedMediaPaths.add(key(filePath))
}

export function authorizeMediaPaths(filePaths: string[]): void {
  filePaths.forEach(authorizeMediaPath)
}

export function isMediaPathAuthorized(filePath: string): boolean {
  return authorizedMediaPaths.has(key(filePath))
}

export function isSupportedMediaPath(filePath: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function clearAuthorizedMediaPaths(): void {
  authorizedMediaPaths.clear()
}
