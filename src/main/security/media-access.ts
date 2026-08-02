import path from 'path'
import fs from 'fs/promises'
import {
  isSupportedLocalAssetExtension,
  isSupportedMediaExtension
} from '../../shared/media-formats'

const authorizedMediaPaths = new Set<string>()
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
  return isSupportedMediaExtension(filePath)
}

/**
 * Resolve the actual file identity before checking authorization. This closes
 * common junction/symlink aliases and makes authorization useful at IPC and
 * custom-protocol boundaries.
 */
export async function assertAuthorizedMediaPath(filePath: string): Promise<string> {
  const realPath = await fs.realpath(filePath)
  if (!isSupportedLocalAssetExtension(realPath)) {
    throw new Error('不支持的媒体文件类型')
  }
  if (!isMediaPathAuthorized(filePath) && !isMediaPathAuthorized(realPath)) {
    throw new Error('媒体路径未授权，请通过文件选择器重新选择素材')
  }
  authorizeMediaPath(realPath)
  return realPath
}

export function clearAuthorizedMediaPaths(): void {
  authorizedMediaPaths.clear()
}
