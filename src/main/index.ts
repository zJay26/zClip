import { app, BrowserWindow, dialog, shell, protocol, ipcMain } from 'electron'
import { join, isAbsolute, normalize, extname } from 'path'
import { existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'
import { IPC_CHANNELS } from '../shared/types'
import {
  assertAuthorizedMediaPath,
  authorizeMediaPaths,
  clearAuthorizedMediaPaths
} from './security/media-access'
import { enforceCachePolicies } from './services/cache-manager'
import { cancelAllMediaJobs } from './services/media-job-manager'
import { cancelExport } from './services/export-service'
import { createLocalMediaResponse } from './local-media-response'
import { isSupportedMediaExtension } from '../shared/media-formats'
import {
  assertTrustedIpcEvent,
  isTrustedRendererUrl,
  PRODUCTION_RENDERER_URL,
  registerTrustedWebContents
} from './security/ipc-security'
import { clearFileCapabilities, grantFileCapability } from './security/file-capabilities'
import type { AppCloseDecision } from '../shared/types'
import { createRendererAssetResponse } from './renderer-asset-response'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let closeRequestPending = false
let unresponsivePromptPending = false
let shutdownPromise: Promise<void> | null = null
let rendererReady = false
const pendingOpenFiles: string[] = []
const smokeTestMode = process.argv.includes('--smoke-test')

async function shutdownAndQuit(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  isQuitting = true
  closeRequestPending = false
  shutdownPromise = (async () => {
    await Promise.allSettled([cancelExport(), cancelAllMediaJobs()])
    clearAuthorizedMediaPaths()
    clearFileCapabilities()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
    app.quit()
  })()
  return shutdownPromise
}

function requestAppClose(): void {
  if (!mainWindow || mainWindow.isDestroyed() || closeRequestPending) return
  closeRequestPending = true
  mainWindow.webContents.send(IPC_CHANNELS.APP_CLOSE_REQUEST)
}

ipcMain.on(IPC_CHANNELS.APP_CLOSE_RESPONSE, async (event, decision: AppCloseDecision) => {
  try {
    assertTrustedIpcEvent(event)
  } catch (error) {
    console.warn('Rejected app close response:', event.senderFrame?.url, error)
    return
  }
  if (!closeRequestPending || (decision !== 'close' && decision !== 'cancel')) return
  closeRequestPending = false
  if (decision === 'cancel') return
  await shutdownAndQuit()
})

ipcMain.on(IPC_CHANNELS.RENDERER_READY, (event) => {
  try {
    assertTrustedIpcEvent(event)
  } catch (error) {
    console.warn('Rejected renderer ready signal:', event.senderFrame?.url, error)
    return
  }
  rendererReady = true
  if (pendingOpenFiles.length > 0) {
    const uniqueFiles = Array.from(new Set(pendingOpenFiles))
    pendingOpenFiles.length = 0
    sendOpenFiles(uniqueFiles)
  }
  if (smokeTestMode) requestAppClose()
})

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
      if (extension !== '.zclip' && !isSupportedMediaExtension(normalized)) continue
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
  const projectFiles = filePaths.filter((filePath) => extname(filePath).toLowerCase() === '.zclip')
  const mediaFiles = filePaths.filter((filePath) => isSupportedMediaExtension(filePath))
  authorizeMediaPaths(mediaFiles)
  projectFiles.forEach((filePath) => grantFileCapability('project-read', filePath))
  const acceptedFiles = [...projectFiles, ...mediaFiles]
  if (acceptedFiles.length === 0) return
  if (!mainWindow || mainWindow.webContents.isDestroyed() || !rendererReady) {
    pendingOpenFiles.push(...acceptedFiles)
    return
  }
  mainWindow.webContents.send(IPC_CHANNELS.OPEN_FILE, acceptedFiles)
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const filePaths = extractFilePaths(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    sendOpenFiles(filePaths)
  })
}

// Register scheme early so Chromium treats it as standard/streamable.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'zclip-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      bypassCSP: false
    }
  },
  {
    scheme: 'local-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
])

function createWindow(): void {
  rendererReady = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0c10',
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: is.dev
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!smokeTestMode) mainWindow?.show()
  })

  const unregisterTrustedRenderer = registerTrustedWebContents(mainWindow.webContents)

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    requestAppClose()
  })

  mainWindow.on('closed', () => {
    unregisterTrustedRenderer()
    closeRequestPending = false
    rendererReady = false
    mainWindow = null
  })

  mainWindow.on('unresponsive', async () => {
    if (!mainWindow || mainWindow.isDestroyed() || unresponsivePromptPending || isQuitting) return
    unresponsivePromptPending = true
    try {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'zClip 无响应',
        message: '渲染界面暂时无响应。可以继续等待，或强制退出并在下次启动时尝试恢复自动保存。',
        buttons: ['继续等待', '强制退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      if (result.response === 1) await shutdownAndQuit()
    } catch (error) {
      console.error('Failed to handle unresponsive renderer:', error)
    } finally {
      unresponsivePromptPending = false
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process exited: ${details.reason}`)
    void shutdownAndQuit()
  })

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isAllowed = is.dev ? isTrustedRendererUrl(url) : url === PRODUCTION_RENDERER_URL
    if (!isAllowed) event.preventDefault()
  })

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)

  // Open safe external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (
        url.protocol === 'https:' &&
        url.hostname === 'github.com' &&
        (url.pathname === '/zJay26/zClip' || url.pathname.startsWith('/zJay26/zClip/'))
      ) void shell.openExternal(url.href)
    } catch {
      // Ignore malformed or unsafe external URLs.
    }
    return { action: 'deny' }
  })

  // Dev: load from vite dev server; Prod: load through the hardened app protocol.
  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : PRODUCTION_RENDERER_URL
  void mainWindow.loadURL(rendererUrl).catch(async (error) => {
    console.error(`Failed to load renderer from ${rendererUrl}:`, error)
    if (!smokeTestMode) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'zClip 启动失败',
        message: '界面资源加载失败，应用将退出。',
        detail: error instanceof Error ? error.message : String(error),
        buttons: ['退出'],
        noLink: true
      })
    }
    await shutdownAndQuit()
  })
}

app.whenReady().then(() => {
  void enforceCachePolicies()
  protocol.handle('zclip-app', (request) =>
    createRendererAssetResponse(join(__dirname, '../renderer'), request)
  )
  // Register custom protocol to serve local media files safely.
  protocol.handle('local-media', async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405 })
      }
      const mediaUrl = new URL(request.url)
      if (mediaUrl.hostname !== 'media') {
        return new Response('Invalid media URL', { status: 400 })
      }
      const decodedUrlPath = decodeURIComponent(mediaUrl.pathname)
      const decodedPath = decodedUrlPath.startsWith('/__unc__/')
        ? `//${decodedUrlPath.slice('/__unc__/'.length)}`
        : /^\/[A-Za-z]:\//.test(decodedUrlPath)
          ? decodedUrlPath.slice(1)
          : decodedUrlPath
      const authorizedPath = await assertAuthorizedMediaPath(decodedPath)
      const allowedOrigins = new Set(['null', new URL(PRODUCTION_RENDERER_URL).origin])
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        allowedOrigins.add(new URL(process.env['ELECTRON_RENDERER_URL']).origin)
      }
      return await createLocalMediaResponse(authorizedPath, request, allowedOrigins)
    } catch (error) {
      console.error('Failed to load local media:', error)
      return new Response('Media not found', { status: 404 })
    }
  })

  registerAllHandlers()
  const initialFiles = extractFilePaths(process.argv)
  if (initialFiles.length > 0) sendOpenFiles(initialFiles)
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
  sendOpenFiles(extractFilePaths([filePath]))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
    event.preventDefault()
    requestAppClose()
    return
  }
  isQuitting = true
  void Promise.allSettled([cancelExport(), cancelAllMediaJobs()])
  clearAuthorizedMediaPaths()
  clearFileCapabilities()
})

export { mainWindow }
