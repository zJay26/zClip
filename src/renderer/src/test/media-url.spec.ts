import { describe, expect, test } from 'vitest'
import { mediaUrlToPath, toMediaUrl } from '@renderer/lib/utils'

describe('media URL helpers', () => {
  test('round-trips Windows paths with URL-reserved characters', () => {
    const path = 'D:\\media clips\\a#b?c%25 片段.mp4'
    const url = toMediaUrl(path)

    expect(url).toBe('local-media://media/D:/media%20clips/a%23b%3Fc%2525%20%E7%89%87%E6%AE%B5.mp4')
    expect(mediaUrlToPath(url).replace(/\//g, '\\')).toBe(path)
  })

  test('round-trips UNC paths without treating the server as a URL host', () => {
    const path = '\\\\media-server\\shared clips\\voice.mp3'
    const url = toMediaUrl(path)

    expect(url).toBe('local-media://media/__unc__/media-server/shared%20clips/voice.mp3')
    expect(mediaUrlToPath(url).replace(/\//g, '\\')).toBe(path)
  })

  test('normalizes file URLs for source comparison', () => {
    expect(mediaUrlToPath('file:///D:/media%20clips/a%23b.mp4')).toBe('D:/media clips/a#b.mp4')
  })
})
