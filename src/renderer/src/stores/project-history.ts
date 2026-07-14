import type { ProjectSnapshot } from './project-store-types'

export const HISTORY_LIMIT = 100

export function appendHistory(history: ProjectSnapshot[], snapshot: ProjectSnapshot): ProjectSnapshot[] {
  return [...history, snapshot].slice(-HISTORY_LIMIT)
}

export function snapshotsEqual(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
