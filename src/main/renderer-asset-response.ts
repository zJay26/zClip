import fs from 'fs/promises'
import path from 'path'

const MAX_RENDERER_ASSET_BYTES = 20 * 1024 * 1024
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: local-media:",
  "media-src 'self' local-media:",
  "connect-src 'self' local-media:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'"
].join('; ')

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
}

export function resolveRendererAssetPath(rendererRoot: string, requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'zclip-app:' || url.hostname !== 'app') return null
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    if (relative !== 'index.html' && !/^assets\/[A-Za-z0-9._-]+$/.test(relative)) return null
    const candidate = path.resolve(rendererRoot, ...relative.split('/'))
    const relation = path.relative(path.resolve(rendererRoot), candidate)
    if (relation.startsWith('..') || path.isAbsolute(relation)) return null
    return candidate
  } catch {
    return null
  }
}

export async function createRendererAssetResponse(
  rendererRoot: string,
  request: Request
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
  }
  const filePath = resolveRendererAssetPath(rendererRoot, request.url)
  if (!filePath) return new Response('Not found', { status: 404 })
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile() || stat.size <= 0 || stat.size > MAX_RENDERER_ASSET_BYTES) {
    return new Response('Not found', { status: 404 })
  }
  const headers = new Headers({
    'Cache-Control': path.basename(filePath) === 'index.html'
      ? 'no-store'
      : 'public, max-age=31536000, immutable',
    'Content-Length': String(stat.size),
    'Content-Security-Policy': RENDERER_CSP,
    'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), hid=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  const contents = await fs.readFile(filePath)
  return new Response(new Uint8Array(contents), { status: 200, headers })
}
