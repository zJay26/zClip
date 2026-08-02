/**
 * The single source of truth for media extensions accepted by dialogs,
 * command-line opening, drag-and-drop and IPC validation.
 */
export const VIDEO_EXTENSIONS = [
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v',
  'mpg', 'mpeg', 'mpe', '3gp', '3g2', 'mts', 'm2ts', 'vob'
] as const

export const AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus',
  'aiff', 'aif', 'alac', 'ac3', 'eac3', 'amr'
] as const

export const MEDIA_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS
] as const

/** Generated preview assets are never importable project media, but they are
 * served through the same capability-protected local protocol. */
export const LOCAL_ASSET_EXTENSIONS = [...MEDIA_EXTENSIONS, 'png'] as const

export const MEDIA_EXTENSION_SET = new Set<string>(MEDIA_EXTENSIONS)
const LOCAL_ASSET_EXTENSION_SET = new Set<string>(LOCAL_ASSET_EXTENSIONS)

export function extensionWithoutDot(filePath: string): string {
  const match = /\.([^.\\/]+)$/.exec(filePath)
  return match ? match[1].toLowerCase() : ''
}

export function isSupportedMediaExtension(filePath: string): boolean {
  return MEDIA_EXTENSION_SET.has(extensionWithoutDot(filePath))
}

export function isSupportedLocalAssetExtension(filePath: string): boolean {
  return LOCAL_ASSET_EXTENSION_SET.has(extensionWithoutDot(filePath))
}
