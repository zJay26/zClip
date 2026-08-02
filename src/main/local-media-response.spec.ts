import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { createLocalMediaResponse, parseByteRange } from './local-media-response'

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

describe('createLocalMediaResponse', () => {
  it('serves bounded ranges with hardened content headers', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-media-response-'))
    const filePath = path.join(directory, 'sample.mp4')
    await writeFile(filePath, Buffer.from('0123456789'))
    try {
      const response = await createLocalMediaResponse(filePath, new Request('local-media://media/sample.mp4', {
        headers: { Range: 'bytes=2-5', Origin: 'null' }
      }))
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
      expect(response.headers.get('content-length')).toBe('4')
      expect(response.headers.get('content-type')).toBe('video/mp4')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('access-control-allow-origin')).toBe('null')
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('2345')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not grant CORS to an unrelated origin and omits a HEAD body', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-media-response-'))
    const filePath = path.join(directory, 'sample.mp3')
    await writeFile(filePath, Buffer.from('audio'))
    try {
      const response = await createLocalMediaResponse(filePath, new Request('local-media://media/sample.mp3', {
        method: 'HEAD', headers: { Origin: 'https://example.com' }
      }))
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(response.headers.get('content-length')).toBe('5')
      expect(await response.text()).toBe('')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
