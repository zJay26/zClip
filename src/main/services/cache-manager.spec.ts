// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\zclip-test' } }))

import { getCacheEvictionPaths } from './cache-manager'

describe('cache eviction policy', () => {
  test('does not charge deleted temporary files against the retained budget', () => {
    const now = 10_000
    const evicted = getCacheEvictionPaths([
      { filePath: 'C:\\cache\\render.tmp.mp4', size: 9, mtimeMs: 9_900 },
      { filePath: 'C:\\cache\\preview.png', size: 2, mtimeMs: 9_800 }
    ], { maxBytes: 10, maxAgeMs: 5_000 }, now)

    expect(evicted).toEqual(['C:\\cache\\render.tmp.mp4'])
  })

  test('keeps newest valid files within the byte budget', () => {
    const now = 10_000
    const evicted = getCacheEvictionPaths([
      { filePath: 'new.bin', size: 6, mtimeMs: 9_900 },
      { filePath: 'middle.bin', size: 4, mtimeMs: 9_800 },
      { filePath: 'old.bin', size: 2, mtimeMs: 9_700 }
    ], { maxBytes: 10, maxAgeMs: 5_000 }, now)

    expect(evicted).toEqual(['old.bin'])
  })
})
