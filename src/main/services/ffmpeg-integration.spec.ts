// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import type { BrowserWindow } from 'electron'
import type {
  ExportFormat,
  MediaInfo,
  MediaOperation,
  QualityPreset,
  TimelineClip,
  TransitionEffectType
} from '../../shared/types'
import { buildFFmpegArgs } from './media-engine'
import { resolveExportEncodingOptions } from './export-quality'
import { buildTimelineFFmpegArgs, runExportJob } from './export-service'
import { ffmpegPath, ffprobePath } from './ffmpeg'
import { detectPreferredH264Encoder } from './hardware-encoder'
import { IPC_CHANNELS } from '../../shared/types'

let directory = ''
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('bundled FFmpeg', () => {
  it('can render a small synthetic media file', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-ffmpeg-'))
    const output = path.join(directory, 'smoke.mp4')
    const result = spawnSync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=0.2',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(result.status, result.stderr).toBe(0)
    expect((await stat(output)).size).toBeGreaterThan(0)
  })

  it('uses a runtime-probed H.264 hardware encoder when one can really open', async () => {
    const encoder = await detectPreferredH264Encoder()
    if (encoder === 'software') {
      expect(encoder).toBe('software')
      return
    }
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-hardware-'))
    const source = path.join(directory, 'source.mp4')
    const output = path.join(directory, `hardware-${encoder}.mp4`)
    const generated = spawnSync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=0.5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(generated.status, generated.stderr).toBe(0)
    const mediaInfo: MediaInfo = {
      duration: 0.5,
      width: 640,
      height: 360,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: (await stat(source)).size,
      filePath: source,
      hasVideo: true,
      hasAudio: false
    }
    const args = buildFFmpegArgs(source, output, [
      { id: 'default-speed', type: 'speed', enabled: true, params: { rate: 1 } }
    ], mediaInfo, {
      ...resolveExportEncodingOptions({
        format: 'mp4', quality: 'medium', resolution: 'original', outputPath: output
      }),
      format: 'mp4',
      h264Encoder: encoder
    })
    expect(args).toContain('-hwaccel')
    expect(args.join(' ')).not.toContain('setpts=PTS/1')
    const rendered = spawnSync(ffmpegPath, args, {
      encoding: 'utf8', windowsHide: true, timeout: 20_000
    })
    expect(rendered.status, `${encoder}: ${rendered.stderr}`).toBe(0)
    expect((await stat(output)).size).toBeGreaterThan(0)

    const timelineOutput = path.join(directory, `hardware-timeline-${encoder}.mp4`)
    const timelineClip: TimelineClip = {
      id: 'hardware', groupId: 'hardware', filePath: source, startTime: 0, duration: 0.5,
      track: 'video', trackIndex: 0, mediaInfo
    }
    const timelineArgs = buildTimelineFFmpegArgs(
      [timelineClip],
      { hardware: [] },
      timelineOutput,
      { w: 640, h: 360 },
      0.5,
      [],
      [],
      resolveExportEncodingOptions({
        format: 'mp4', quality: 'medium', resolution: 'original', outputPath: timelineOutput
      }),
      'mp4',
      undefined,
      { canvas: { preset: 'source', width: 640, height: 360, backgroundColor: '#000000' }, frameRate: 30 },
      undefined,
      encoder
    )
    const renderedTimeline = spawnSync(ffmpegPath, timelineArgs, {
      encoding: 'utf8', windowsHide: true, timeout: 20_000
    })
    expect(renderedTimeline.status, `${encoder} timeline: ${renderedTimeline.stderr}`).toBe(0)
    expect((await stat(timelineOutput)).size).toBeGreaterThan(0)
  }, 30_000)

  it('retries the same export with software arguments after an encoder failure', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-encoder-fallback-'))
    const output = path.join(directory, 'fallback.mp4')
    const primary = [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=0.2',
      '-c:v', 'zclip_missing_encoder', output
    ]
    const fallback = [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30:d=0.2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output
    ]
    const events: string[] = []
    const win = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string) => events.push(channel)
      }
    } as unknown as BrowserWindow

    await runExportJob(primary, 0.2, output, win, 'video', 'mp4', {
      fallbackArgs: fallback
    })

    expect((await stat(output)).size).toBeGreaterThan(0)
    expect(events).toContain(IPC_CHANNELS.EXPORT_COMPLETE)
    expect(events).not.toContain(IPC_CHANNELS.EXPORT_ERROR)
  }, 30_000)

  it('orchestrates a bounded two-pass GIF export and cleans its palette', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-gif-prepass-'))
    const source = path.join(directory, 'source.mp4')
    const palettePath = path.join(directory, 'palette.png')
    const output = path.join(directory, 'two-pass.gif')
    const generated = spawnSync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=20:d=0.5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(generated.status, generated.stderr).toBe(0)
    const mediaInfo: MediaInfo = {
      duration: 0.5,
      width: 160,
      height: 90,
      fps: 20,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: (await stat(source)).size,
      filePath: source,
      hasVideo: true,
      hasAudio: false
    }
    const encoding = resolveExportEncodingOptions({
      format: 'gif', quality: 'medium', resolution: 'original', outputPath: output
    })
    const paletteArgs = buildFFmpegArgs(source, palettePath, [], mediaInfo, {
      ...encoding,
      format: 'gif',
      gifPalettePass: { mode: 'generate', palettePath }
    })
    const renderArgs = buildFFmpegArgs(source, output, [], mediaInfo, {
      ...encoding,
      format: 'gif',
      gifPalettePass: { mode: 'use', palettePath }
    })
    const progress: number[] = []
    const win = {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => {
          if (channel === IPC_CHANNELS.EXPORT_PROGRESS) {
            progress.push((payload as { percent: number }).percent)
          }
        }
      }
    } as unknown as BrowserWindow

    await runExportJob(renderArgs, 0.5, output, win, 'video', 'gif', {
      prepass: { args: paletteArgs, duration: 0.5, outputPath: palettePath, progressWeight: 35 },
      cleanupPaths: [palettePath]
    })

    expect((await stat(output)).size).toBeGreaterThan(0)
    expect(await stat(palettePath).then(() => true).catch(() => false)).toBe(false)
    expect(progress.some((percent) => percent >= 35)).toBe(true)
    expect(progress[progress.length - 1]).toBe(100)
  }, 30_000)

  it('keeps accurate frames when a normal timeline input is seeked before decoding', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-input-seek-'))
    const source = path.join(directory, 'red-then-blue.mp4')
    const output = path.join(directory, 'blue-only.mp4')
    const generated = spawnSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=1',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(generated.status, generated.stderr).toBe(0)
    const mediaInfo: MediaInfo = {
      duration: 2,
      width: 160,
      height: 90,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: (await stat(source)).size,
      filePath: source,
      hasVideo: true,
      hasAudio: false
    }
    const clip: TimelineClip = {
      id: 'late', groupId: 'late', filePath: source, startTime: 0, duration: 2,
      trimBoundStart: 1, trimBoundEnd: 2, track: 'video', trackIndex: 0, mediaInfo
    }
    const args = buildTimelineFFmpegArgs(
      [clip],
      { late: [{ id: 'trim', type: 'trim', enabled: true, params: { startTime: 1, endTime: 2 } }] },
      output,
      { w: 160, h: 90 },
      1,
      [],
      [],
      resolveExportEncodingOptions({
        format: 'mp4', quality: 'low', resolution: 'original', outputPath: output
      }),
      'mp4'
    )
    expect(args).toEqual(expect.arrayContaining(['-ss', '1.000000', '-t', '1.000000']))
    const rendered = spawnSync(ffmpegPath, args, {
      encoding: 'utf8', windowsHide: true, timeout: 20_000
    })
    expect(rendered.status, rendered.stderr).toBe(0)
    const sampled = spawnSync(ffmpegPath, [
      '-v', 'error', '-ss', '0.25', '-i', output,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
    ], { encoding: null, windowsHide: true, timeout: 10_000 })
    expect(sampled.status, sampled.stderr?.toString()).toBe(0)
    const pixels = sampled.stdout as Buffer
    let red = 0
    let blue = 0
    for (let offset = 0; offset + 2 < pixels.length; offset += 3) {
      red += pixels[offset]
      blue += pixels[offset + 2]
    }
    expect(blue).toBeGreaterThan(red * 3)
  }, 30_000)

  it('accepts generated quality arguments for every export format', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-quality-'))
    const source = path.join(directory, 'source.mkv')
    const sourceResult = spawnSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=0.3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.3',
      '-shortest',
      '-c:v', 'libx264',
      '-c:a', 'pcm_s16le',
      source
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(sourceResult.status, sourceResult.stderr).toBe(0)

    const mediaInfo: MediaInfo = {
      duration: 0.3,
      width: 160,
      height: 90,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: 'pcm_s16le',
      sampleRate: 48_000,
      fileSize: (await stat(source)).size,
      filePath: source,
      hasVideo: true,
      hasAudio: true
    }
    const cases: Array<[ExportFormat, QualityPreset]> = [
      ['mp4', 'high'],
      ['mov', 'low'],
      ['mkv', 'ultra_high'],
      ['webm', 'ultra_low'],
      ['gif', 'ultra_high'],
      ['webp', 'ultra_high'],
      ['mp3', 'ultra_high'],
      ['wav', 'ultra_high'],
      ['flac', 'ultra_high'],
      ['aac', 'ultra_low'],
      ['opus', 'high']
    ]

    for (const [format, quality] of cases) {
      const output = path.join(directory, `quality-${quality}.${format}`)
      const encoding = resolveExportEncodingOptions({
        format,
        quality,
        resolution: 'original',
        outputPath: output
      })
      const args = buildFFmpegArgs(source, output, [], mediaInfo, {
        ...encoding,
        format,
        resolution: null,
        gifLoop: 'infinite'
      })
      const result = spawnSync(ffmpegPath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000
      })
      expect(result.status, `${format}: ${result.stderr}`).toBe(0)
      expect((await stat(output)).size, format).toBeGreaterThan(0)
      const inspected = spawnSync(ffprobePath, [
        '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', output
      ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      expect(inspected.status, `${format}: ${inspected.stderr}`).toBe(0)
      const streamTypes = (JSON.parse(inspected.stdout) as {
        streams?: Array<{ codec_type?: string }>
      }).streams?.map((stream) => stream.codec_type) ?? []
      if (['mp3', 'wav', 'flac', 'aac', 'opus'].includes(format)) {
        expect(streamTypes, format).toContain('audio')
      } else {
        expect(streamTypes, format).toContain('video')
        if (format !== 'gif' && format !== 'webp') expect(streamTypes, format).toContain('audio')
      }
    }

    const adjustedOutput = path.join(directory, 'adjusted.mp4')
    const adjustedArgs = buildFFmpegArgs(source, adjustedOutput, [
      { id: 'speed', type: 'speed', enabled: true, params: { rate: 1.25 } },
      { id: 'pitch', type: 'pitch', enabled: true, params: { percent: 125 } },
      { id: 'volume', type: 'volume', enabled: true, params: { percent: 150 } }
    ], mediaInfo, {
      ...resolveExportEncodingOptions({
        format: 'mp4', quality: 'low', resolution: 'original', outputPath: adjustedOutput
      }),
      format: 'mp4'
    })
    const adjusted = spawnSync(ffmpegPath, adjustedArgs, {
      encoding: 'utf8', windowsHide: true, timeout: 20_000
    })
    expect(adjusted.status, adjusted.stderr).toBe(0)
    expect((await stat(adjustedOutput)).size).toBeGreaterThan(0)
  }, 30_000)

  it('renders GIF and WebP timelines from independently seeked clips of one source', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-animated-timeline-'))
    const source = path.join(directory, 'source.mp4')
    const generated = spawnSync(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=20:d=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    expect(generated.status, generated.stderr).toBe(0)

    const mediaInfo: MediaInfo = {
      duration: 2,
      width: 160,
      height: 90,
      fps: 20,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: (await stat(source)).size,
      filePath: source,
      hasVideo: true,
      hasAudio: false
    }
    const clips: TimelineClip[] = [
      {
        id: 'first', groupId: 'first', filePath: source, startTime: 0, duration: 2,
        trimBoundStart: 0, trimBoundEnd: 1, track: 'video', trackIndex: 0, mediaInfo
      },
      {
        id: 'second', groupId: 'second', filePath: source, startTime: 1, duration: 2,
        trimBoundStart: 1, trimBoundEnd: 2, track: 'video', trackIndex: 0, mediaInfo
      }
    ]
    const operations: Record<string, MediaOperation[]> = Object.fromEntries(clips.map((clip) => [
      clip.id,
      [
        { id: `${clip.id}-trim`, type: 'trim', enabled: true, params: { startTime: 0, endTime: 2 } },
        { id: `${clip.id}-speed`, type: 'speed', enabled: true, params: { rate: 1 } }
      ]
    ]))
    for (const format of ['gif', 'webp'] as const) {
      const output = path.join(directory, `timeline.${format}`)
      const palettePath = path.join(directory, 'timeline-palette.png')
      const encoding = resolveExportEncodingOptions({
        format, quality: 'low', resolution: 'original', outputPath: output
      })
      if (format === 'gif') {
        const paletteArgs = buildTimelineFFmpegArgs(
          clips,
          operations,
          palettePath,
          { w: 160, h: 90 },
          2,
          [],
          [],
          encoding,
          format,
          'infinite',
          { canvas: { preset: 'source', width: 160, height: 90, backgroundColor: '#000000' }, frameRate: 20 },
          { mode: 'generate', palettePath }
        )
        const generatedPalette = spawnSync(ffmpegPath, paletteArgs, {
          encoding: 'utf8', windowsHide: true, timeout: 20_000
        })
        expect(generatedPalette.status, generatedPalette.stderr).toBe(0)
        expect((await stat(palettePath)).size).toBeGreaterThan(0)
      }
      const args = buildTimelineFFmpegArgs(
        clips,
        operations,
        output,
        { w: 160, h: 90 },
        2,
        [],
        [],
        encoding,
        format,
        'infinite',
        { canvas: { preset: 'source', width: 160, height: 90, backgroundColor: '#000000' }, frameRate: 20 },
        format === 'gif' ? { mode: 'use', palettePath } : undefined
      )

      expect(args.filter((item) => item === '-i'), format).toHaveLength(format === 'gif' ? 3 : 2)
      expect(args[args.indexOf('-filter_complex') + 1], format).not.toContain('split=2')
      const rendered = spawnSync(ffmpegPath, args, {
        encoding: 'utf8', windowsHide: true, timeout: 20_000
      })
      expect(rendered.status, `${format}: ${rendered.stderr}`).toBe(0)
      const bytes = await readFile(output)
      if (format === 'webp') {
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP')
        expect(bytes.toString('latin1').match(/ANMF/g)?.length ?? 0).toBeGreaterThan(5)
      } else {
        expect(bytes.subarray(0, 3).toString('ascii')).toBe('GIF')
        const inspected = spawnSync(ffprobePath, [
          '-v', 'error', '-count_frames', '-select_streams', 'v:0',
          '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', output
        ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
        expect(inspected.status, inspected.stderr).toBe(0)
        expect(Number(inspected.stdout.trim())).toBeGreaterThan(5)
      }
    }
  }, 30_000)

  it('renders every timeline transition with the requested geometry and frame rate', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'zclip-transitions-'))
    const sources = [path.join(directory, 'red.mp4'), path.join(directory, 'blue.mp4')]
    for (let index = 0; index < sources.length; index += 1) {
      const color = index === 0 ? 'red' : 'blue'
      const generated = spawnSync(ffmpegPath, [
        '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=30:d=1`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', sources[index]
      ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
      expect(generated.status, generated.stderr).toBe(0)
    }

    const makeInfo = (filePath: string): MediaInfo => ({
      duration: 1,
      width: 160,
      height: 90,
      fps: 30,
      videoCodec: 'h264',
      audioCodec: '',
      sampleRate: 0,
      fileSize: 1,
      filePath,
      hasVideo: true,
      hasAudio: false
    })
    const clips: TimelineClip[] = sources.map((filePath, index) => ({
      id: index === 0 ? 'left' : 'right',
      groupId: index === 0 ? 'left-group' : 'right-group',
      filePath,
      startTime: index,
      duration: 1,
      track: 'video',
      trackIndex: 0,
      mediaInfo: makeInfo(filePath)
    }))
    const operations: Record<string, MediaOperation[]> = Object.fromEntries(clips.map((clip) => [
      clip.id,
      [
        { id: `${clip.id}-trim`, type: 'trim', enabled: true, params: { startTime: 0, endTime: 1 } },
        { id: `${clip.id}-speed`, type: 'speed', enabled: true, params: { rate: 1 } }
      ]
    ]))
    const transitionTypes: TransitionEffectType[] = [
      'crossfade', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'slideleft', 'slideright'
    ]

    for (const transitionType of transitionTypes) {
      const output = path.join(directory, `${transitionType}.mp4`)
      const args = buildTimelineFFmpegArgs(
        clips,
        operations,
        output,
        { w: 160, h: 90 },
        2,
        [{
          id: transitionType,
          type: transitionType,
          leftClipId: 'left',
          rightClipId: 'right',
          startOffset: -0.25,
          endOffset: 0.25
        }],
        [],
        resolveExportEncodingOptions({
          format: 'mp4', quality: 'low', resolution: 'original', outputPath: output
        }),
        'mp4',
        undefined,
        {
          canvas: { preset: 'source', width: 160, height: 90, backgroundColor: '#000000' },
          frameRate: 30
        }
      )
      const rendered = spawnSync(ffmpegPath, args, {
        encoding: 'utf8', windowsHide: true, timeout: 20_000
      })
      expect(rendered.status, `${transitionType}: ${rendered.stderr}`).toBe(0)
      const inspected = spawnSync(ffprobePath, [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt:format=duration',
        '-of', 'json', output
      ], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      expect(inspected.status, inspected.stderr).toBe(0)
      const metadata = JSON.parse(inspected.stdout) as {
        streams: Array<{ width: number; height: number; r_frame_rate: string; pix_fmt: string }>
        format: { duration: string }
      }
      expect(metadata.streams[0]).toMatchObject({
        width: 160,
        height: 90,
        r_frame_rate: '30/1',
        pix_fmt: 'yuv420p'
      })
      expect(Number(metadata.format.duration)).toBeCloseTo(2, 1)

      if (transitionType === 'crossfade') {
        const sampled = spawnSync(ffmpegPath, [
          '-v', 'error', '-ss', '0.95', '-i', output,
          '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
        ], { encoding: null, windowsHide: true, timeout: 10_000 })
        expect(sampled.status, sampled.stderr?.toString()).toBe(0)
        const pixels = sampled.stdout as Buffer
        let red = 0
        let blue = 0
        const pixelCount = Math.max(1, Math.floor(pixels.length / 3))
        for (let offset = 0; offset + 2 < pixels.length; offset += 3) {
          red += pixels[offset]
          blue += pixels[offset + 2]
        }
        // Both sources must be visible before the cut. The previous compiler
        // faded the left clip toward black and did not overlap the right clip.
        const averageRed = red / pixelCount
        const averageBlue = blue / pixelCount
        expect(averageRed).toBeGreaterThan(70)
        expect(averageBlue).toBeGreaterThan(70)
        // A linear red/blue mix stays bright. Fading both sources' alpha
        // simultaneously would leak black from the canvas and fail this sum.
        expect(averageRed + averageBlue).toBeGreaterThan(220)
      }
    }
  }, 60_000)
})
