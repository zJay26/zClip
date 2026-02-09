import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { registerAllHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null

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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

export { mainWindow }
