import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const rootDir = path.resolve(path.dirname(__filename), '..')
const appPath = path.join(rootDir, 'release', 'win-unpacked', 'zClip.exe')
const ffmpegPath = path.join(rootDir, 'build', 'ffmpeg', 'ffmpeg.exe')
const screenshotPath = process.env.ZCLIP_TRANSITION_QA_SCREENSHOT ||
  path.join(tmpdir(), 'zclip-transition-ui-qa.png')
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function requireFile(filePath, hint) {
  try {
    await access(filePath)
  } catch {
    throw new Error(`${hint}: ${filePath}`)
  }
}

async function run(file, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(file)} exited with code ${code}`)))
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
      // The packaged renderer may still be starting.
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
    this.events = []
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) {
        this.events.push(message)
        if (this.events.length > 100) this.events.shift()
        return
      }
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
        reject(new Error(`CDP command timed out: ${method}; recent events: ${JSON.stringify(this.events.slice(-8))}`))
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
      await delay(200)
    }
    throw new Error(`Timed out waiting for renderer condition: ${expression}`)
  }

  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  async capture(filePath) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    })
    await mkdir(path.dirname(filePath), { recursive: true })
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
      stdio: 'ignore', windowsHide: true
    })
    killer.once('exit', resolve)
    killer.once('error', resolve)
  })
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Packaged transition UI QA currently requires Windows')
  await requireFile(appPath, 'Run npm run pack:dir before transition UI QA')
  await requireFile(ffmpegPath, 'Bundled FFmpeg is missing')

  const workDir = await mkdtemp(path.join(tmpdir(), 'zclip-transition-qa-'))
  const profileDir = path.join(workDir, 'profile')
  const leftPath = path.join(workDir, 'transition-left-motion.mp4')
  const rightPath = path.join(workDir, 'transition-right-motion.mp4')
  const projectPath = path.join(workDir, 'transition-qa.zclip')
  const port = await reservePort()
  let appProcess
  let cdp

  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', leftPath
    ])
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', rightPath
    ])

    const mediaInfo = (filePath) => ({
      duration: 4,
      width: 640,
      height: 360,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: 1,
      filePath,
      hasVideo: true,
      hasAudio: false
    })
    await writeFile(projectPath, JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      clips: [
        {
          id: 'left', groupId: 'left-group', filePath: leftPath, startTime: 0, duration: 4,
          trimBoundStart: 0, trimBoundEnd: 4, track: 'video', trackIndex: 0,
          mediaInfo: mediaInfo(leftPath)
        },
        {
          id: 'right', groupId: 'right-group', filePath: rightPath, startTime: 4, duration: 4,
          trimBoundStart: 0, trimBoundEnd: 4, track: 'video', trackIndex: 0,
          mediaInfo: mediaInfo(rightPath)
        }
      ],
      operationsByClip: {
        left: [
          { id: 'left-trim', type: 'trim', enabled: true, params: { startTime: 0, endTime: 4 } },
          { id: 'left-speed', type: 'speed', enabled: false, params: { rate: 1 } }
        ],
        right: [
          { id: 'right-trim', type: 'trim', enabled: true, params: { startTime: 0, endTime: 4 } },
          { id: 'right-speed', type: 'speed', enabled: false, params: { rate: 1 } }
        ]
      },
      transitions: [],
      audioFades: [],
      linkedGroups: { 'left-group': true, 'right-group': true },
      videoTrackCount: 2,
      audioTrackCount: 2,
      currentTime: 0,
      projectSettings: {
        canvas: { preset: 'source', width: 640, height: 360, backgroundColor: '#000000' },
        frameRate: 30
      }
    }, null, 2))

    appProcess = spawn(appPath, [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      projectPath
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

    console.log('Transition UI QA: waiting for project')
    try {
      await cdp.waitFor(`document.body.innerText.includes('transition-left-motion.mp4') && document.body.innerText.includes('transition-right-motion.mp4')`, 90_000)
    } catch (error) {
      const diagnostics = await cdp.evaluate(`(() => ({
        url: location.href,
        title: document.title,
        bodyText: document.body.innerText.slice(0, 4000),
        timelineClips: document.querySelectorAll('[data-timeline-clip]').length,
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map((item) => item.textContent.trim())
      }))()`)
      diagnostics.cdpEvents = cdp.events.slice(-20)
      await cdp.capture(screenshotPath).catch(() => {})
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nRenderer diagnostics: ${JSON.stringify(diagnostics)}`)
    }
    console.log('Transition UI QA: project loaded')

    const ordinaryCutSeekPoint = await cdp.evaluate(`(() => {
      const editor = document.querySelector('[aria-label="时间线编辑区"]')
      const leftClip = [...document.querySelectorAll('[data-timeline-clip]')]
        .find((item) => item.getAttribute('aria-label')?.includes('transition-left-motion.mp4'))
      if (!editor || !leftClip) return null
      const editorRect = editor.getBoundingClientRect()
      const clipRect = leftClip.getBoundingClientRect()
      return {
        x: clipRect.left + clipRect.width * 0.78,
        y: editorRect.top + 10
      }
    })()`)
    if (!ordinaryCutSeekPoint) throw new Error('Unable to resolve the ordinary cut playback position')
    await cdp.click(ordinaryCutSeekPoint.x, ordinaryCutSeekPoint.y)
    await cdp.waitFor(`Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) > 3`)
    await cdp.waitFor(`([...document.querySelectorAll('video[data-preview-video]')].some((video) =>
      video.dataset.previewClipId === 'right' && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ))`, 10_000)

    await cdp.evaluate(`(() => {
      const videos = [...document.querySelectorAll('video[data-preview-video]')]
      const qa = window.__zclipOrdinaryCutQa = {
        samples: [],
        sampling: true,
        visibleWaitTimes: [],
        visibleEmptyTimes: [],
        mainSeeks: 0,
        frameCounts: { left: 0, right: 0 }
      }
      videos.forEach((video) => {
        video.addEventListener('waiting', () => {
          if (video.dataset.previewVideo === 'main') {
            qa.visibleWaitTimes.push(Number(
              document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0
            ))
          }
        })
        video.addEventListener('emptied', () => {
          if (video.dataset.previewVideo === 'main') {
            qa.visibleEmptyTimes.push(Number(
              document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0
            ))
          }
        })
        video.addEventListener('seeking', () => {
          if (video.dataset.previewVideo === 'main') qa.mainSeeks += 1
        })
        if (video.requestVideoFrameCallback) {
          const countFrame = () => {
            const clipId = video.dataset.previewClipId
            if (clipId === 'left' || clipId === 'right') qa.frameCounts[clipId] += 1
            if (document.contains(video)) video.requestVideoFrameCallback(countFrame)
          }
          video.requestVideoFrameCallback(countFrame)
        }
      })
      const pixelCanvas = document.createElement('canvas')
      pixelCanvas.width = 16
      pixelCanvas.height = 9
      const pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true })
      const sample = () => {
        const canvas = document.querySelector('[data-preview-timeline-time]')
        const main = document.querySelector('video[data-preview-video="main"]')
        let averageLuma = null
        if (main && pixelContext && main.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            pixelContext.drawImage(main, 0, 0, 16, 9)
            const pixels = pixelContext.getImageData(0, 0, 16, 9).data
            let total = 0
            for (let index = 0; index < pixels.length; index += 4) {
              total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722
            }
            averageLuma = total / (pixels.length / 4)
          } catch {
            averageLuma = null
          }
        }
        qa.samples.push({
          wallTime: performance.now(),
          timelineTime: Number(canvas?.dataset.previewTimelineTime || 0),
          mainClipId: main?.dataset.previewClipId ?? null,
          mainIndex: main?.dataset.previewBufferIndex ?? null,
          mainTime: Number(main?.currentTime || 0),
          mainReadyState: Number(main?.readyState || 0),
          mainPaused: Boolean(main?.paused),
          averageLuma
        })
        if (qa.sampling && qa.samples.length < 600) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      return true
    })()`)

    const ordinaryPlaybackStarted = await cdp.evaluate(`(() => {
      const button = document.querySelector('button[aria-label="播放"], button[aria-label="Play"]')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!ordinaryPlaybackStarted) throw new Error('Unable to start ordinary cut playback')
    await cdp.waitFor(`Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) >= 3.25`, 5_000)
    await cdp.evaluate(`window.__zclipOrdinaryCutQa.measurementStartTimeline = Number(
      document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0
    )`)
    await cdp.waitFor(`Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) >= 4.45`, 6_000)
    await cdp.waitFor(`Boolean(
      document.querySelector('button[aria-label="暂停"]') ||
      document.querySelector('button[aria-label="Pause"]') ||
      document.querySelector('button[aria-label="播放"]') ||
      document.querySelector('button[aria-label="Play"]')
    )`, 5_000)
    const ordinaryPlaybackPaused = await cdp.evaluate(`(() => {
      const pauseButton = document.querySelector('button[aria-label="暂停"], button[aria-label="Pause"]')
      if (pauseButton) {
        pauseButton.click()
        return 'clicked'
      }
      // If playback naturally paused during the exact renderer commit sampled
      // above, the goal is already satisfied and the Play button is evidence.
      const playButton = document.querySelector('button[aria-label="播放"], button[aria-label="Play"]')
      return playButton ? 'already-paused' : null
    })()`)
    if (!ordinaryPlaybackPaused) throw new Error('Unable to pause ordinary cut playback')
    await cdp.waitFor(`Boolean(
      document.querySelector('button[aria-label="播放"]') ||
      document.querySelector('button[aria-label="Play"]')
    )`, 5_000)
    await delay(120)

    const ordinaryCutState = await cdp.evaluate(`(() => {
      const qa = window.__zclipOrdinaryCutQa
      qa.sampling = false
      const samples = qa.samples.filter((sample) =>
        sample.timelineTime >= (qa.measurementStartTimeline || 0)
      )
      const boundarySamples = samples.filter((sample) => sample.timelineTime >= 3.9 && sample.timelineTime <= 4.12)
      const before = [...samples].reverse().find((sample) => sample.timelineTime < 4) ?? null
      const after = samples.find((sample) => sample.timelineTime >= 4.0001) ?? null
      let maxFrameGapMs = 0
      let boundaryMaxFrameGapMs = 0
      let maxTimelineBackstep = 0
      for (let index = 1; index < samples.length; index += 1) {
        maxFrameGapMs = Math.max(maxFrameGapMs, samples[index].wallTime - samples[index - 1].wallTime)
        maxTimelineBackstep = Math.max(
          maxTimelineBackstep,
          samples[index - 1].timelineTime - samples[index].timelineTime
        )
      }
      for (let index = 1; index < boundarySamples.length; index += 1) {
        boundaryMaxFrameGapMs = Math.max(
          boundaryMaxFrameGapMs,
          boundarySamples[index].wallTime - boundarySamples[index - 1].wallTime
        )
      }
      const visibleWaits = qa.visibleWaitTimes.filter((time) => time >= 3.85 && time <= 4.15)
      const visibleEmpties = qa.visibleEmptyTimes.filter((time) => time >= 3.85 && time <= 4.15)
      return {
        sampleCount: samples.length,
        boundarySampleCount: boundarySamples.length,
        missingMainSamples: boundarySamples.filter((sample) => !sample.mainClipId).length,
        notReadySamples: boundarySamples.filter((sample) => sample.mainReadyState < HTMLMediaElement.HAVE_CURRENT_DATA).length,
        blackFrameSamples: boundarySamples.filter((sample) =>
          sample.averageLuma !== null && sample.averageLuma < 2
        ).length,
        pixelSampleCount: boundarySamples.filter((sample) => sample.averageLuma !== null).length,
        wrongClipBefore: boundarySamples.filter((sample) =>
          sample.timelineTime < 3.999 && sample.mainClipId !== 'left'
        ).length,
        wrongClipAfter: boundarySamples.filter((sample) =>
          sample.timelineTime > 4.001 && sample.mainClipId !== 'right'
        ).length,
        before,
        after,
        visibleWaits,
        visibleEmpties,
        mainSeeks: qa.mainSeeks,
        frameCounts: qa.frameCounts,
        maxFrameGapMs,
        boundaryMaxFrameGapMs,
        maxTimelineBackstep
      }
    })()`)
    if (
      ordinaryCutState.boundarySampleCount < 4 ||
      ordinaryCutState.missingMainSamples > 0 ||
      ordinaryCutState.notReadySamples > 0 ||
      ordinaryCutState.blackFrameSamples > 0 ||
      ordinaryCutState.wrongClipBefore > 0 ||
      ordinaryCutState.wrongClipAfter > 0 ||
      ordinaryCutState.before?.mainClipId !== 'left' ||
      ordinaryCutState.after?.mainClipId !== 'right' ||
      ordinaryCutState.frameCounts.left < 2 ||
      ordinaryCutState.frameCounts.right < 2 ||
      ordinaryCutState.visibleWaits.length > 0 ||
      ordinaryCutState.visibleEmpties.length > 0 ||
      ordinaryCutState.maxTimelineBackstep > 0.02 ||
      ordinaryCutState.boundaryMaxFrameGapMs > 180
    ) {
      throw new Error(`Ordinary cut handoff showed a blank or stale frame: ${JSON.stringify(ordinaryCutState)}`)
    }
    console.log('Transition UI QA: ordinary cut predecode handoff verified')

    await cdp.evaluate(`document.querySelector('#inspector-tab-transitions')?.click()`)
    await cdp.waitFor(`document.querySelector('#inspector-tab-transitions')?.getAttribute('aria-selected') === 'true'`)
    const applied = await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.getAttribute('aria-label')?.startsWith('叠化:'))
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!applied) throw new Error('Unable to find the Crossfade transition card')

    console.log('Transition UI QA: transition applied')
    await cdp.waitFor(`document.querySelector('[data-local-delete][data-selected="true"]')`)
    const selectionState = await cdp.evaluate(`(() => {
      const exportButton = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.trim() === '导出')
      return {
        selectedTransitionCount: document.querySelectorAll('[data-local-delete][data-selected="true"]').length,
        selectedClipCount: document.querySelectorAll('[data-timeline-clip][data-selected="true"]').length,
        transitionPanelSelected: document.querySelector('#inspector-tab-transitions')?.getAttribute('aria-selected') === 'true',
        exportEnabled: Boolean(exportButton && !exportButton.disabled),
        durationControl: Boolean(document.querySelector('input[aria-label="转场时长"]')),
        alignmentControls: document.querySelectorAll('[aria-label="转场剪辑点位置"] button').length
      }
    })()`)
    if (
      selectionState.selectedTransitionCount !== 1 ||
      selectionState.selectedClipCount !== 0 ||
      !selectionState.transitionPanelSelected ||
      !selectionState.exportEnabled ||
      !selectionState.durationControl ||
      selectionState.alignmentControls !== 3
    ) {
      throw new Error(`Transition selection state is incorrect: ${JSON.stringify(selectionState)}`)
    }
    console.log('Transition UI QA: selection and parameters verified')

    const replacementState = await cdp.evaluate(`(async () => {
      const durationInput = document.querySelector('input[aria-label="转场时长数值"]')
      if (!durationInput) return { ok: false, reason: 'duration input missing' }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      durationInput.focus()
      valueSetter?.call(durationInput, '1.40')
      durationInput.dispatchEvent(new Event('input', { bubbles: true }))
      durationInput.dispatchEvent(new Event('change', { bubbles: true }))
      durationInput.blur()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const customizedDuration = Number(durationInput.value)
      const editor = document.querySelector('[aria-label="时间线编辑区"]')
      const block = document.querySelector('[data-local-delete][data-selected="true"]')
      if (!editor || !block) return { ok: false, reason: 'replacement drop target missing', customizedDuration }
      const blockRect = block.getBoundingClientRect()
      const dragGeometry = {
        width: 132,
        height: 52,
        grabOffsetX: 66,
        grabOffsetY: 26
      }
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('application/x-zclip-transition', 'wipeleft')
      dataTransfer.setData('application/x-zclip-transition-geometry', JSON.stringify(dragGeometry))
      const dragEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: blockRect.left + blockRect.width / 2,
        clientY: blockRect.top + blockRect.height / 2,
        dataTransfer
      })
      editor.dispatchEvent(dragEvent)
      editor.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: blockRect.left + blockRect.width / 2,
        clientY: blockRect.top + blockRect.height / 2,
        dataTransfer
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const replacedDuration = Number(
        document.querySelector('input[aria-label="转场时长数值"]')?.value || 0
      )
      const selectedLabel = [...document.querySelectorAll('button[aria-pressed="true"]')]
        .find((item) => item.getAttribute('aria-label')?.includes('擦除'))
        ?.getAttribute('aria-label') || null
      const crossfade = [...document.querySelectorAll('button')]
        .find((item) => item.getAttribute('aria-label')?.startsWith('叠化:'))
      crossfade?.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const restoredDuration = Number(
        document.querySelector('input[aria-label="转场时长数值"]')?.value || 0
      )
      const restoredLabel = [...document.querySelectorAll('button[aria-pressed="true"]')]
        .find((item) => item.getAttribute('aria-label')?.startsWith('叠化:'))
        ?.getAttribute('aria-label') || null
      return {
        ok: true,
        customizedDuration,
        replacedDuration,
        selectedLabel,
        restoredDuration,
        restoredLabel,
        selectedTransitionCount: document.querySelectorAll('[data-local-delete][data-selected="true"]').length,
        selectedClipCount: document.querySelectorAll('[data-timeline-clip][data-selected="true"]').length
      }
    })()`)
    if (
      !replacementState.ok ||
      Math.abs(replacementState.customizedDuration - 1.4) > 0.001 ||
      Math.abs(replacementState.replacedDuration - 1.4) > 0.001 ||
      !replacementState.selectedLabel?.startsWith('左擦除:') ||
      Math.abs(replacementState.restoredDuration - 1.4) > 0.001 ||
      !replacementState.restoredLabel?.startsWith('叠化:') ||
      replacementState.selectedTransitionCount !== 1 ||
      replacementState.selectedClipCount !== 0
    ) {
      throw new Error(`Transition replacement did not preserve parameters: ${JSON.stringify(replacementState)}`)
    }
    console.log('Transition UI QA: type replacement preserved custom parameters')

    const dropFeedback = await cdp.evaluate(`(async () => {
      const zoom = document.querySelector('input[aria-label="时间线缩放"]')
      const editor = document.querySelector('[aria-label="时间线编辑区"]')
      if (!zoom || !editor) return { validHint: false }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(zoom, zoom.max)
      zoom.dispatchEvent(new Event('input', { bubbles: true }))
      zoom.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const block = document.querySelector('[data-local-delete][data-selected="true"]')
      if (!block) return { validHint: false }
      editor.scrollLeft = Math.max(0, block.offsetLeft - editor.clientWidth / 3)
      editor.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const blockRect = block.getBoundingClientRect()
      const hitOffset = -96
      const dragGeometry = {
        width: 132,
        height: 52,
        grabOffsetX: 16,
        grabOffsetY: 26
      }
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('application/x-zclip-transition', 'crossfade')
      dataTransfer.setData('application/x-zclip-transition-geometry', JSON.stringify(dragGeometry))
      editor.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: blockRect.left + blockRect.width / 2 + hitOffset,
        clientY: blockRect.top + blockRect.height / 2,
        dataTransfer
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const validHint = document.body.innerText.includes('方框已碰到剪辑点，松手应用')
      const hint = document.querySelector('[data-transition-drop-hint]')
      const hintRect = hint?.getBoundingClientRect()
      const editorRect = editor.getBoundingClientRect()
      const hintVisible = Boolean(hintRect &&
        hintRect.left >= editorRect.left && hintRect.right <= editorRect.right)
      const hintFontSize = hint ? parseFloat(getComputedStyle(hint).fontSize) : 0
      editor.dispatchEvent(new DragEvent('dragleave', {
        bubbles: true,
        cancelable: true,
        dataTransfer
      }))
      return {
        validHint,
        hintVisible,
        hintFontSize,
        scrollLeft: editor.scrollLeft,
        hitOffset,
        dragGeometry
      }
    })()`)
    if (
      !dropFeedback.validHint ||
      !dropFeedback.hintVisible ||
      dropFeedback.hintFontSize < 13 ||
      dropFeedback.scrollLeft <= 0 ||
      Math.abs(dropFeedback.hitOffset) <= 48
    ) {
      throw new Error(`Valid transition drop feedback was not shown: ${JSON.stringify(dropFeedback)}`)
    }

    const seekResult = await cdp.evaluate(`(async () => {
      const zoom = document.querySelector('input[aria-label="时间线缩放"]')
      const editor = document.querySelector('[aria-label="时间线编辑区"]')
      if (!zoom || !editor) return null
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      const playbackZoom = (Number(zoom.min) + Number(zoom.max)) / 2
      valueSetter?.call(zoom, String(playbackZoom))
      zoom.dispatchEvent(new Event('input', { bubbles: true }))
      zoom.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      editor.scrollLeft = 0
      editor.dispatchEvent(new Event('scroll', { bubbles: true }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const leftClip = [...document.querySelectorAll('[data-timeline-clip]')]
        .find((item) => item.getAttribute('aria-label')?.includes('transition-left-motion.mp4'))
      if (!leftClip) return null
      const leftRect = leftClip.getBoundingClientRect()
      const timelineContent = leftClip.parentElement
      const ruler = timelineContent?.firstElementChild
      if (!(ruler instanceof HTMLElement)) return null
      const rulerRect = ruler.getBoundingClientRect()
      // The left source is exactly four seconds long; 75% lands at 3.0s,
      // safely before the default transition entry at 3.5s.
      const clientX = leftRect.left + leftRect.width * 0.75
      const clientY = rulerRect.top + rulerRect.height / 2
      ruler.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY
      }))
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX,
        clientY
      }))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        clientX,
        clientY,
        rulerHeight: rulerRect.height,
        target: document.elementFromPoint(clientX, clientY)?.tagName || null
      }
    })()`)
    if (!seekResult) throw new Error('Unable to resolve the transition position on the timeline')
    await cdp.waitFor(`(() => {
      const time = Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0)
      return time >= 2.85 && time <= 3.15
    })()`, 5_000)
    await delay(120)
    const playbackWarmupStart = await cdp.evaluate(
      `Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0)`
    )
    if (playbackWarmupStart < 2.85 || playbackWarmupStart > 3.15) {
      throw new Error(`Timeline seek missed the pre-transition position: ${playbackWarmupStart}`)
    }

    await cdp.evaluate(`(() => {
      const videos = [...document.querySelectorAll('video[data-preview-video]')]
      window.__zclipTransitionQa = {
        transitionSeeks: 0,
        mainSeeks: 0,
        frames: 0,
        videoCount: videos.length,
        samples: [],
        sampling: true
      }
      videos.forEach((video) => {
        video.addEventListener('seeking', () => {
          if (video.dataset.previewVideo === 'main') window.__zclipTransitionQa.mainSeeks += 1
          else window.__zclipTransitionQa.transitionSeeks += 1
        })
        if (video.requestVideoFrameCallback) {
          const countFrame = () => {
            window.__zclipTransitionQa.frames += 1
            if (document.contains(video)) video.requestVideoFrameCallback(countFrame)
          }
          video.requestVideoFrameCallback(countFrame)
        }
      })
      const sample = () => {
        const canvas = document.querySelector('[data-preview-timeline-time]')
        const main = document.querySelector('video[data-preview-video="main"]')
        const left = document.querySelector('video[data-preview-video="transition-left"]')
        const right = document.querySelector('video[data-preview-video="transition-right"]')
        window.__zclipTransitionQa.samples.push({
          wallTime: performance.now(),
          timelineTime: Number(canvas?.dataset.previewTimelineTime || 0),
          active: Boolean(canvas?.dataset.activeTransitionId),
          mainTime: Number(main?.currentTime || 0),
          leftTime: Number(left?.currentTime || 0),
          rightTime: Number(right?.currentTime || 0),
          mainPaused: Boolean(main?.paused),
          mainReadyState: Number(main?.readyState || 0),
          mainIndex: main?.dataset.previewBufferIndex ?? null,
          mainClipId: main?.dataset.previewClipId ?? null,
          leftIndex: left?.dataset.previewBufferIndex ?? null,
          rightIndex: right?.dataset.previewBufferIndex ?? null,
          leftClipId: left?.dataset.previewClipId ?? null,
          rightClipId: right?.dataset.previewClipId ?? null,
          leftPaused: Boolean(left?.paused),
          rightPaused: Boolean(right?.paused),
          mainOpacity: main ? Number(getComputedStyle(main).opacity) : null,
          leftOpacity: left ? Number(getComputedStyle(left).opacity) : null,
          rightOpacity: right ? Number(getComputedStyle(right).opacity) : null,
          mainZ: main ? Number(getComputedStyle(main).zIndex) : null,
          leftZ: left ? Number(getComputedStyle(left).zIndex) : null,
          rightZ: right ? Number(getComputedStyle(right).zIndex) : null
        })
        if (window.__zclipTransitionQa.sampling && window.__zclipTransitionQa.samples.length < 900) {
          requestAnimationFrame(sample)
        }
      }
      requestAnimationFrame(sample)
      return window.__zclipTransitionQa
    })()`)

    const started = await cdp.evaluate(`(() => {
      const button = document.querySelector('button[aria-label="播放"], button[aria-label="Play"]')
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!started) throw new Error('Unable to start transition playback')
    await cdp.waitFor(
      `Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) >= ${playbackWarmupStart + 0.15}`,
      5_000
    )
    await cdp.evaluate(`window.__zclipTransitionQa.measurementStartTimeline = Number(
      document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0
    )`)
    await cdp.waitFor(`Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) >= 3.98`, 5_000)
    await cdp.waitFor(`Number(document.querySelector('[data-preview-timeline-time]')?.dataset.previewTimelineTime || 0) >= 4.65`, 5_000)
    await delay(120)

    const playbackState = await cdp.evaluate(`(() => {
      const qa = window.__zclipTransitionQa
      qa.sampling = false
      const samples = qa.samples.filter((sample) =>
        sample.timelineTime >= (qa.measurementStartTimeline || 0)
      )
      const entryIndex = samples.findIndex((sample, index) => sample.active && index > 0 && !samples[index - 1].active)
      const exitIndex = samples.findIndex((sample, index) => !sample.active && index > 0 && samples[index - 1].active)
      const entryDelta = entryIndex > 0
        ? Math.abs(samples[entryIndex].leftTime - samples[entryIndex - 1].mainTime)
        : null
      const exitDelta = exitIndex > 0
        ? Math.abs(samples[exitIndex].mainTime - samples[exitIndex - 1].rightTime)
        : null
      const boundaryBefore = [...samples].reverse().find((sample) => sample.timelineTime < 4 && sample.active) ?? null
      const boundaryAfter = samples.find((sample) => sample.timelineTime >= 4 && sample.active) ?? null
      const boundaryOpacityJump = boundaryBefore && boundaryAfter &&
        boundaryBefore.rightOpacity !== null && boundaryAfter.rightOpacity !== null
        ? Math.abs(boundaryAfter.rightOpacity - boundaryBefore.rightOpacity)
        : null
      const mediaAdvance = (field, start, end) => {
        const windowSamples = samples.filter((sample) =>
          sample.timelineTime >= start && sample.timelineTime <= end
        )
        if (windowSamples.length < 2) return null
        return windowSamples[windowSamples.length - 1][field] - windowSamples[0][field]
      }
      const motionContinuity = {
        leftBeforeBoundary: mediaAdvance('leftTime', 3.72, 3.94),
        rightBeforeBoundary: mediaAdvance('rightTime', 3.72, 3.94),
        leftAfterBoundary: mediaAdvance('leftTime', 4.06, 4.28),
        rightAfterBoundary: mediaAdvance('rightTime', 4.06, 4.28)
      }
      const wrongMainAfterExit = exitIndex >= 0
        ? samples.slice(exitIndex).filter((sample) => sample.mainClipId !== 'right').length
        : null
      const exitBufferMismatch = exitIndex > 0
        ? samples[exitIndex].mainIndex !== samples[exitIndex - 1].rightIndex
        : null
      let maxFrameGapMs = 0
      let maxFrameGap = null
      let maxTimelineBackstep = 0
      for (let index = 1; index < samples.length; index += 1) {
        const frameGapMs = samples[index].wallTime - samples[index - 1].wallTime
        if (frameGapMs > maxFrameGapMs) {
          maxFrameGapMs = frameGapMs
          maxFrameGap = { before: samples[index - 1], after: samples[index] }
        }
        maxTimelineBackstep = Math.max(
          maxTimelineBackstep,
          samples[index - 1].timelineTime - samples[index].timelineTime
        )
      }
      return {
        transitionSeeks: qa.transitionSeeks,
        mainSeeks: qa.mainSeeks,
        frames: qa.frames,
        videoCount: qa.videoCount,
        sampleCount: samples.length,
        entryDelta,
        exitDelta,
        entrySamples: entryIndex > 0 ? [samples[entryIndex - 1], samples[entryIndex]] : null,
        exitSamples: exitIndex > 0 ? [samples[exitIndex - 1], samples[exitIndex]] : null,
        boundarySamples: boundaryBefore && boundaryAfter ? [boundaryBefore, boundaryAfter] : null,
        boundaryOpacityJump,
        motionContinuity,
        wrongMainAfterExit,
        exitBufferMismatch,
        maxFrameGapMs,
        maxFrameGap,
        maxTimelineBackstep,
        playing: Boolean(document.querySelector('button[aria-label="暂停"], button[aria-label="Pause"]')),
        rendererErrors: performance.getEntriesByType('resource')
          .filter((entry) => entry.name.includes('ERR_')).length
      }
    })()`)
    if (playbackState.videoCount !== 3) {
      throw new Error(`Expected three rotating video buffers, got ${playbackState.videoCount}`)
    }
    if (playbackState.transitionSeeks > 4) {
      throw new Error(`Transition playback performed too many visible-layer seeks: ${playbackState.transitionSeeks}`)
    }
    if (playbackState.frames < 8) {
      throw new Error(`Transition playback presented too few video frames: ${playbackState.frames}`)
    }
    if (
      playbackState.entryDelta === null ||
      playbackState.exitDelta === null ||
      playbackState.entryDelta > 0.12 ||
      playbackState.exitDelta > 0.12 ||
      playbackState.boundaryOpacityJump === null ||
      playbackState.boundaryOpacityJump > 0.08 ||
      Object.values(playbackState.motionContinuity).some((advance) => advance === null || advance < 0.04) ||
      playbackState.wrongMainAfterExit !== 0 ||
      playbackState.exitBufferMismatch !== false ||
      playbackState.maxTimelineBackstep > 0.02 ||
      playbackState.maxFrameGapMs > 180
    ) {
      throw new Error(`Transition handoff was not continuous: ${JSON.stringify(playbackState)}`)
    }

    await cdp.capture(screenshotPath)

    console.log(JSON.stringify({
      ordinaryCut: ordinaryCutState,
      selection: selectionState,
      replacement: replacementState,
      dropFeedback,
      playback: playbackState,
      screenshot: screenshotPath
    }, null, 2))
  } finally {
    cdp?.close()
    await terminateProcessTree(appProcess)
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
