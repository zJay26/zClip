import { net } from 'electron'
import { Readable } from 'node:stream'

/** Electron net.fetch does not deliver manual redirect responses. Adapt net.request
 * so the updater can validate each Location before following it, using system proxy settings. */
export function fetchUpdate(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', useSessionCookies: false, cache: 'no-store' })
    let stream: Readable | null = null
    const abort = (): void => {
      const error = init.signal?.reason instanceof Error ? init.signal.reason : new Error('Update request aborted')
      reject(error)
      stream?.destroy(error)
      request.abort()
    }
    request.on('error', reject)
    request.on('close', () => init.signal?.removeEventListener('abort', abort))
    request.on('redirect', (statusCode, _method, redirectUrl) => {
      resolve(new Response(null, { status: statusCode, headers: { location: redirectUrl } }))
      request.abort()
    })
    request.on('response', (response) => {
      const headers = new Headers()
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      stream = response as unknown as Readable
      // HTTP failures and redirects are consumed/cancelled by AppUpdater.
      stream.on('error', reject)
      const noBody = [204, 205, 304].includes(response.statusCode)
      resolve(new Response(noBody ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: response.statusCode, headers
      }))
    })
    new Headers(init.headers).forEach((value, key) => request.setHeader(key, value))
    if (init.signal?.aborted) { abort(); return }
    init.signal?.addEventListener('abort', abort, { once: true })
    request.end()
  })
}
