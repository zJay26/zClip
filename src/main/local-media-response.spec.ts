import { describe, expect, it } from 'vitest'
import { parseByteRange } from './local-media-response'

describe('parseByteRange', () => {
  it('returns null when no range was requested', () => {
    expect(parseByteRange(null, 100)).toBeNull()
  })

  it('parses bounded, open-ended and suffix ranges', () => {
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
  })

  it('clamps the requested end to the file size', () => {
    expect(parseByteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects invalid and unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=100-', 100)).toBe(false)
    expect(parseByteRange('bytes=20-10', 100)).toBe(false)
    expect(parseByteRange('bytes=0-1,4-5', 100)).toBe(false)
  })
})
