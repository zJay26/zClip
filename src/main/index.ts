import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join, isAbsolute, normalize, extname } from 'path'
import { existsSync, statSync } from 'fs'
import { pathToFileURL, fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { IPC_CHANNELS } from '../shared/types'

let mainWindow: BrowserWindow | null = null
const pendingOpenFiles: string[] = []

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus'
])

function extractFilePaths(argv: string[]): string[] {
  const resolved: string[] = []
  const seen = new Set<string>()
  const windowsPathPattern = /[A-Za-z]:[\\/][^"\r\n]+/g
  const fileUrlPattern = /file:\/\/[^\s"]+/gi

  const collectCandidatesFromArg = (rawArg: string): string[] => {
    const trimmed = rawArg.trim()
    if (!trimmed || trimmed.startsWith('-')) return []

    const candidates: string[] = [trimmed]
    const normalizedNewline = trimmed.replace(/\r\n?/g, '\n')
    const newlineParts = normalizedNewline
      .split(/\n+/)
      .map((part) => part.trim())
      .filter(Boolean)
    candidates.push(...newlineParts)
    for (const part of newlineParts) {
      const separated = part
        .split(/[;,](?=(?:\s*"?)?(?:[A-Za-z]:[\\/]|file:\/\/))/g)
        .map((value) => value.trim())
        .filter(Boolean)
      candidates.push(...separated)
    }

    const quotedParts = trimmed.match(/"([^"]+)"/g) || []
    candidates.push(...quotedParts.map((part) => part.replace(/^"+|"+$/g, '').trim()))

    const fileUrls = trimmed.match(fileUrlPattern) || []
    candidates.push(...fileUrls)

    const windowsPaths = trimmed.match(windowsPathPattern) || []
    candidates.push(...windowsPaths)

    return candidates
      .map((value) => value.trim().replace(/^"+|"+$/g, ''))
      .filter(Boolean)
  }

  const allCandidates = argv.flatMap(collectCandidatesFromArg)
  for (const item of allCandidates) {
    try {
      const candidate = item.startsWith('file://') ? fileURLToPath(item) : item
      const normalized = normalize(candidate)
      if (!isAbsolute(normalized)) continue
      const extension = extname(normalized).toLowerCase()
      if (extension === '.exe' || extension === '.lnk') continue
      if (extension && !MEDIA_EXTENSIONS.has(extension)) continue
      if (seen.has(normalized)) continue
      if (!existsSync(normalized)) continue
      const stat = statSync(normalized)
      if (!stat.isFile()) continue
      seen.add(normalized)
      resolved.push(normalized)
    } catch {
      continue
    }
  }

  return resolved
}

function sendOpenFiles(filePaths: string[]): void {
  if (filePaths.length === 0) return
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    pendingOpenFiles.push(...filePaths)
    return
  }
  mainWindow.webContents.send(IPC_CHANNELS.OPEN_FILE, filePaths)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePaths = extractFilePaths(argv)
    if (filePaths.length > 0) {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
      sendOpenFiles(filePaths)
    }
  })
}

// Register scheme early so Chromium treats it as standard/streamable.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true
    }
  }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenFiles.length === 0) return
    const uniqueFiles = Array.from(new Set(pendingOpenFiles))
    pendingOpenFiles.length = 0
    sendOpenFiles(uniqueFiles)
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Dev: load from vite dev server; Prod: load built file
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Register custom protocol to serve local media files safely.
  protocol.handle('local-media', async (request) => {
    try {
      // Decode URL manually to handle all edge cases (spaces, special chars)
      // Remove 'local-media:///' prefix
      const rawPath = request.url.replace(/^local-media:\/\//, '')
      const decodedPath = decodeURIComponent(rawPath.startsWith('/') ? rawPath.slice(1) : rawPath)
      const fileUrl = pathToFileURL(decodedPath).href

      return await net.fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      })
    } catch (error) {
      console.error('Failed to load local media:', error)
      return new Response('Media not found', { status: 404 })
    }
  })

  registerAllHandlers()
  const initialFiles = extractFilePaths(process.argv)
  if (initialFiles.length > 0) {
    pendingOpenFiles.push(...initialFiles)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// macOS: open file from Finder
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  sendOpenFiles([filePath])
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
