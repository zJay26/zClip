import path from 'path'

type CapabilityKind = 'project-read' | 'project-write' | 'export-write'

const capabilities: Record<CapabilityKind, Set<string>> = {
  'project-read': new Set<string>(),
  'project-write': new Set<string>(),
  'export-write': new Set<string>()
}

function key(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function grantFileCapability(kind: CapabilityKind, filePath: string): void {
  if (typeof filePath !== 'string' || filePath.length === 0) return
  capabilities[kind].add(key(filePath))
}

export function hasFileCapability(kind: CapabilityKind, filePath: string): boolean {
  return capabilities[kind].has(key(filePath))
}

export function consumeFileCapability(kind: CapabilityKind, filePath: string): boolean {
  return capabilities[kind].delete(key(filePath))
}

export function clearFileCapabilities(): void {
  Object.values(capabilities).forEach((items) => items.clear())
}
