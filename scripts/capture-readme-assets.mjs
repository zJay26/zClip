import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const appPath = path.join(rootDir, 'release', 'win-unpacked', 'zClip.exe')
const ffmpegPath = path.join(rootDir, 'build', 'ffmpeg', 'ffmpeg.exe')
const rendererPath = path.join(rootDir, 'scripts', 'render-readme-assets.ps1')
const demoDir = path.join(rootDir, 'docs', 'demo')
const overviewPath = path.join(demoDir, 'overview.png')
const demoPath = path.join(demoDir, 'demo.webp')
const socialPath = path.join(rootDir, 'docs', 'social-preview.jpg')
const iconPath = path.join(rootDir, 'docs', 'icon', 'zClip.png')

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function requireFile(filePath, hint) {
  try {
    await access(filePath)
  } catch {
    throw new Error(`${hint}: ${filePath}`)
  }
}

async function run(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${path.basename(file)} exited with code ${code}`))
    })
  })
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a DevTools port')
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function waitForPage(port, timeoutMs = 45_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) =>
          target.type === 'page' && String(target.url).startsWith('zclip-app://app/')
        )
        if (page?.webSocketDebuggerUrl) return page
      }
    } catch {
      // The app may still be starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the packaged renderer')
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, 30_000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Renderer evaluation failed')
    }
    return result.result?.value
  }

  async waitFor(expression, timeoutMs = 60_000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(`Boolean(${expression})`)) return
      await delay(250)
    }
    throw new Error(`Timed out waiting for renderer condition: ${expression}`)
  }

  async capture(filePath) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    })
    await writeFile(filePath, Buffer.from(result.data, 'base64'))
  }

  close() {
    this.socket?.close()
  }
}

async function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  await new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('exit', resolve)
    killer.once('error', resolve)
  })
}

async function main() {
  if (process.platform !== 'win32') throw new Error('README asset capture currently requires Windows')
  await requireFile(appPath, 'Run npm run pack:dir before capturing README assets')
  await requireFile(ffmpegPath, 'Bundled FFmpeg is missing')
  await requireFile(rendererPath, 'README asset renderer is missing')
  await mkdir(demoDir, { recursive: true })

  const workDir = await mkdtemp(path.join(tmpdir(), 'zclip-readme-'))
  const profileDir = path.join(workDir, 'profile')
  const mediaPath = path.join(workDir, 'demo-media.mp4')
  const darkPath = path.join(workDir, 'dark-zh.png')
  const exportPath = path.join(workDir, 'export-dark-zh.png')
  const lightPath = path.join(workDir, 'light-en.png')
  const port = await reservePort()
  let appProcess
  let cdp

  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', mediaPath
    ], { windowsHide: true })

    appProcess = spawn(appPath, [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      mediaPath
    ], { stdio: 'ignore', windowsHide: false })

    const page = await waitForPage(port)
    cdp = new CdpClient(page.webSocketDebuggerUrl)
    await cdp.connect()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })

    await cdp.waitFor(`document.body && document.body.innerText.includes('demo-media.mp4')`, 90_000)
    await cdp.waitFor(`document.querySelector('video')`, 30_000)
    await cdp.evaluate(`(() => {
      const video = document.querySelector('video')
      if (video) video.currentTime = Math.min(3, Number.isFinite(video.duration) ? video.duration / 3 : 3)
      return true
    })()`)
    await delay(1_500)
    await cdp.capture(darkPath)

    const opened = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.trim() === '导出' && !item.disabled)
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!opened) throw new Error('Unable to open the export dialog in the packaged app')
    await cdp.waitFor(`document.querySelector('[role="dialog"]')`)
    await delay(500)
    await cdp.capture(exportPath)

    await cdp.evaluate(`document.querySelector('[aria-label="切换为浅色模式"]')?.click()`)
    await cdp.waitFor(`document.documentElement.dataset.theme === 'light'`)
    await cdp.evaluate(`document.querySelector('[aria-label="Switch to English"]')?.click()`)
    await cdp.waitFor(`document.documentElement.lang === 'en'`)
    await cdp.evaluate(`document.querySelector('[aria-label="Close dialog"]')?.click()`)
    await cdp.waitFor(`!document.querySelector('[role="dialog"]')`)
    await delay(500)
    await cdp.capture(lightPath)

    await run('pwsh.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rendererPath,
      '-DarkPath', darkPath,
      '-ExportPath', exportPath,
      '-LightPath', lightPath,
      '-IconPath', iconPath,
      '-OverviewPath', overviewPath,
      '-SocialPath', socialPath
    ], { windowsHide: true })

    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-loop', '1', '-framerate', '6', '-t', '2.4', '-i', darkPath,
      '-loop', '1', '-framerate', '6', '-t', '2.4', '-i', exportPath,
      '-loop', '1', '-framerate', '6', '-t', '2.4', '-i', lightPath,
      '-filter_complex',
      '[0:v]scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0x0b0a12,setsar=1[v0];' +
      '[1:v]scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0x0b0a12,setsar=1[v1];' +
      '[2:v]scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0x0b0a12,setsar=1[v2];' +
      '[v0][v1][v2]concat=n=3:v=1:a=0,format=yuv420p[out]',
      '-map', '[out]', '-c:v', 'libwebp_anim', '-quality', '72',
      '-compression_level', '6', '-loop', '0', demoPath
    ], { windowsHide: true })

    const socialBytes = (await readFile(socialPath)).byteLength
    if (socialBytes >= 1_000_000) {
      throw new Error(`Social preview must stay below 1 MB, got ${socialBytes} bytes`)
    }
    console.log(`Generated: ${path.relative(rootDir, overviewPath)}`)
    console.log(`Generated: ${path.relative(rootDir, demoPath)}`)
    console.log(`Generated: ${path.relative(rootDir, socialPath)} (${socialBytes} bytes)`)
  } finally {
    cdp?.close()
    await terminateProcessTree(appProcess)
    let cleaned = false
    for (let attempt = 0; attempt < 6 && !cleaned; attempt += 1) {
      try {
        await rm(workDir, { recursive: true, force: true })
        cleaned = true
      } catch (error) {
        if (!['EBUSY', 'EPERM'].includes(error?.code) || attempt === 5) {
          console.warn(`Unable to remove temporary capture directory: ${error.message}`)
          break
        }
        await delay(500 * (attempt + 1))
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
