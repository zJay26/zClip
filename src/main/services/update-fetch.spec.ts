// @vitest-environment node
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { beforeEach, expect, test, vi } from 'vitest'

const electron = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net: { request: electron.request } }))
import { fetchUpdate } from './update-fetch'

function fakeRequest() {
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn(), setHeader: vi.fn() })
  electron.request.mockReturnValue(request)
  return request
}
beforeEach(() => electron.request.mockReset())

test('returns manual redirect headers without waiting for a response event', async () => {
  const request = fakeRequest()
  const pending = fetchUpdate('https://github.com/zJay26/zClip/releases/download/v2.9.0/setup.exe', {})
  request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/asset')
  const response = await pending
  expect(response.status).toBe(302)
  expect(response.headers.get('location')).toBe('https://release-assets.githubusercontent.com/asset')
  expect(request.abort).toHaveBeenCalledTimes(1)
  expect(electron.request).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'manual', credentials: 'omit', useSessionCookies: false }))
})

test('streams response bytes and propagates cancellation before response headers', async () => {
  const request = fakeRequest()
  const pending = fetchUpdate('https://api.github.com', {})
  request.emit('response', Object.assign(Readable.from([Buffer.from('installer')]), { headers: { 'content-type': 'application/octet-stream' }, statusCode: 200 }))
  expect(await (await pending).text()).toBe('installer')
  const controller = new AbortController()
  const abortedRequest = fakeRequest()
  const aborted = fetchUpdate('https://api.github.com', { signal: controller.signal })
  controller.abort(new Error('cancelled'))
  await expect(aborted).rejects.toThrow('cancelled')
  expect(abortedRequest.abort).toHaveBeenCalledTimes(1)
})

test('aborts a stalled response body after headers have arrived', async () => {
  const request = fakeRequest()
  const controller = new AbortController()
  const pending = fetchUpdate('https://api.github.com', { signal: controller.signal })
  request.emit('response', Object.assign(new Readable({ read() {} }), { headers: {}, statusCode: 200 }))
  const reading = (await pending).text()
  controller.abort(new Error('cancelled body'))
  await expect(reading).rejects.toThrow('cancelled body')
  expect(request.abort).toHaveBeenCalledTimes(1)
})
