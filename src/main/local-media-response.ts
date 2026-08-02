import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { extname } from 'path'
import { Readable } from 'stream'

export interface ByteRange {
  start: number
  end: number
}

export function parseByteRange(value: string | null, size: number): ByteRange | null | false {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0 || (!match[1] && !match[2])) return false

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return false
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

const MEDIA_CONTENT_TYPES: Record<string, string> = {
  '.aac': 'audio/aac',
  '.ac3': 'audio/ac3',
  '.3g2': 'video/3gpp2',
  '.3gp': 'video/3gpp',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.alac': 'audio/mp4',
  '.amr': 'audio/amr',
  '.avi': 'video/x-msvideo',
  '.flac': 'audio/flac',
  '.flv': 'video/x-flv',
  '.eac3': 'audio/eac3',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.m2ts': 'video/mp2t',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.mpe': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mts': 'video/mp2t',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.ts': 'video/mp2t',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.vob': 'video/mpeg',
  '.wma': 'audio/x-ms-wma',
  '.wmv': 'video/x-ms-wmv'
}

function getContentType(filePath: string): string {
  return MEDIA_CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function createHeaders(filePath: string, request: Request, allowedOrigins: ReadonlySet<string>): Headers {
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': getContentType(filePath),
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Vary': 'Origin'
  })
  const origin = request.headers.get('origin')
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }
  return headers
}

export async function createLocalMediaResponse(
  filePath: string,
  request: Request,
  allowedOrigins: ReadonlySet<string> = new Set(['null', 'zclip-app://app'])
): Promise<Response> {
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) return new Response('Media not found', { status: 404 })

  const size = fileStat.size
  const range = parseByteRange(request.headers.get('range'), size)
  const headers = createHeaders(filePath, request, allowedOrigins)
  if (range === false) {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  if (range) {
    const contentLength = range.end - range.start + 1
    headers.set('Content-Length', String(contentLength))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers })

    const stream = Readable.toWeb(createReadStream(filePath, range))
    return new Response(stream as BodyInit, { status: 206, headers })
  }

  headers.set('Content-Length', String(size))
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  const stream = Readable.toWeb(createReadStream(filePath))
  return new Response(stream as BodyInit, { status: 200, headers })
}
