// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { MediaInfo, MediaOperation, TimelineClip } from '../../shared/types'
import {
  buildTimelineFFmpegArgs,
  commitExportOutput,
  formatExportError,
  resolveOutputSize,
  resolveProjectFrameRate,
  sliceTimelineForRange
} from './export-service'
import { resolveExportEncodingOptions } from './export-quality'

function createDefaultOperations(duration: number): MediaOperation[] {
  return [
    { id: 'trim', type: 'trim', enabled: true, params: { startTime: 0, endTime: duration } },
    { id: 'speed', type: 'speed', enabled: true, params: { rate: 1 } },
    { id: 'volume', type: 'volume', enabled: true, params: { percent: 100 } }
  ]
}

function info(filePath: string, hasVideo: boolean, hasAudio: boolean): MediaInfo {
  return {
    duration: 10,
    width: hasVideo ? 1920 : 0,
    height: hasVideo ? 1080 : 0,
    fps: hasVideo ? 30 : 0,
    videoCodec: hasVideo ? 'h264' : '',
    audioCodec: hasAudio ? 'aac' : '',
    sampleRate: hasAudio ? 48_000 : 0,
    fileSize: 1024,
    filePath,
    hasVideo,
    hasAudio
  }
}

function clip(id: string, track: 'video' | 'audio', startTime = 0): TimelineClip {
  const filePath = `C:\\media\\${id}.mp4`
  return {
    id,
    groupId: `group-${id}`,
    filePath,
    startTime,
    duration: 10,
    track,
    trackIndex: 0,
    mediaInfo: info(filePath, track === 'video', track === 'audio')
  }
}

describe('timeline export compiler', () => {
  it('slices clips and trim operations to the requested range', () => {
    const video = clip('video', 'video', 2)
    const operations = { video: createDefaultOperations(10) }
    const sliced = sliceTimelineForRange([video], operations, { startTime: 4, endTime: 8 })
    expect(sliced.duration).toBe(4)
    expect(sliced.clips[0].startTime).toBe(0)
    const trim = sliced.operationsByClip.video.find((operation) => operation.type === 'trim')
    expect(trim?.params).toMatchObject({ startTime: 2, endTime: 6 })
  })

  it('builds a deterministic video and audio filter graph', () => {
    const video = clip('video', 'video')
    const audio = clip('audio', 'audio')
    const operations = {
      video: createDefaultOperations(10),
      audio: createDefaultOperations(10)
    }
    const args = buildTimelineFFmpegArgs(
      [video, audio], operations, 'C:\\output.mp4', { w: 1280, h: 720 }, 10, [], [],
      resolveExportEncodingOptions({
        format: 'mp4',
        resolution: '720p',
        quality: 'medium',
        outputPath: 'C:\\output.mp4'
      }),
      'mp4', 'infinite',
      { canvas: { preset: 'landscape', width: 1280, height: 720, backgroundColor: '#000000' } }
    )
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).not.toContain('overlay=')
    expect(graph).toContain('pad=1280:720')
    expect(graph).toContain('atrim=start=0:end=10')
    expect(args).toContain('[aout]')
    expect(args[args.length - 1]).toBe('C:\\output.mp4')
  })

  it('uses the short edge for portrait resolution and keeps dimensions even', () => {
    const portrait = clip('portrait', 'video')
    portrait.mediaInfo.width = 1080
    portrait.mediaInfo.height = 1920
    expect(resolveOutputSize([portrait], { w: 1920, h: 1080 }, {
      canvas: { preset: 'source', width: 1920, height: 1080, backgroundColor: '#000000' }
    })).toEqual({ w: 1080, h: 1920 })
  })

  it('deduplicates inputs, emits explicit fps and ignores disabled transforms', () => {
    const first = clip('first', 'video')
    const second = clip('second', 'video', 10)
    second.filePath = first.filePath
    second.mediaInfo.filePath = first.filePath
    const operations = {
      first: [
        ...createDefaultOperations(10),
        { id: 'transform', type: 'transform' as const, enabled: false, params: {
          fit: 'contain' as const, scale: 3, x: 999, y: 999, rotation: 0 as const,
          opacity: 20, flipX: false, flipY: false
        } }
      ],
      second: createDefaultOperations(10)
    }
    const args = buildTimelineFFmpegArgs(
      [first, second], operations, 'C:\\output.mp4', { w: 1920, h: 1080 }, 20, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: 'original', quality: 'medium', outputPath: 'C:\\output.mp4' }),
      'mp4', undefined,
      { canvas: { preset: 'source', width: 1920, height: 1080, backgroundColor: '#000000' }, frameRate: 60 }
    )
    expect(args.filter((item) => item === '-i')).toHaveLength(1)
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('split=2')
    expect(graph).toContain('fps=60')
    expect(graph).toContain('concat=n=2:v=1:a=0')
    expect(graph).not.toContain('overlay=')
    expect(graph).not.toContain('+999')
    expect(args).toContain('yuv420p')
  })

  it('uses bounded independent inputs for animated clips cut from the same source', () => {
    const first = clip('first', 'video')
    const second = { ...clip('second', 'video', 4), filePath: first.filePath }
    second.mediaInfo = { ...first.mediaInfo, filePath: first.filePath }
    first.trimBoundStart = 0
    first.trimBoundEnd = 4
    second.trimBoundStart = 6
    second.trimBoundEnd = 10
    const outputPath = 'C:\\output.webp'
    const args = buildTimelineFFmpegArgs(
      [first, second],
      { first: createDefaultOperations(10), second: createDefaultOperations(10) },
      outputPath,
      { w: 640, h: 360 },
      8,
      [],
      [],
      resolveExportEncodingOptions({
        format: 'webp', resolution: '720p', quality: 'low', outputPath
      }),
      'webp'
    )

    expect(args.filter((item) => item === '-i')).toHaveLength(2)
    expect(args).toEqual(expect.arrayContaining(['-ss', '6.000000', '-t', '4.000000']))
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).not.toContain('split=2')
    expect(graph).toContain('[0:v]trim=start=0:end=4')
    expect(graph).toContain('[1:v]trim=start=0:end=4')
  })

  it('seeks independent speed windows and drops fast-motion frames before scaling', () => {
    const first = clip('first', 'video')
    const second = clip('second', 'video', 4)
    second.filePath = first.filePath
    second.mediaInfo.filePath = first.filePath
    const operations = {
      first: [
        { id: 'trim-first', type: 'trim' as const, enabled: true, params: { startTime: 0, endTime: 4 } },
        { id: 'speed-first', type: 'speed' as const, enabled: true, params: { rate: 1 } }
      ],
      second: [
        { id: 'trim-second', type: 'trim' as const, enabled: true, params: { startTime: 8, endTime: 10 } },
        { id: 'speed-second', type: 'speed' as const, enabled: true, params: { rate: 16 } }
      ]
    }
    const outputPath = 'C:\\output.mp4'
    const args = buildTimelineFFmpegArgs(
      [first, second], operations, outputPath, { w: 1280, h: 720 }, 4.125, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: '720p', quality: 'medium', outputPath }),
      'mp4'
    )

    expect(args.filter((item) => item === '-i')).toHaveLength(2)
    expect(args).toEqual(expect.arrayContaining(['-ss', '8.000000', '-t', '2.000000']))
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('trim=start=0:end=2,setpts=PTS-STARTPTS,setpts=PTS/16,fps=30,scale=')
    expect(graph.indexOf('setpts=PTS/16')).toBeLessThan(graph.indexOf('fps=30', graph.indexOf('setpts=PTS/16')))
  })

  it('builds separate bounded GIF palette generation and palette-use passes', () => {
    const video = clip('video', 'video')
    const operations = { video: createDefaultOperations(10) }
    const palettePath = 'C:\\palette.png'
    const outputPath = 'C:\\output.gif'
    const encoding = resolveExportEncodingOptions({
      format: 'gif', resolution: '480p', quality: 'medium', outputPath
    })
    const paletteArgs = buildTimelineFFmpegArgs(
      [video], operations, palettePath, { w: 854, h: 480 }, 10, [], [], encoding,
      'gif', 'infinite', undefined, { mode: 'generate', palettePath }
    )
    const renderArgs = buildTimelineFFmpegArgs(
      [video], operations, outputPath, { w: 854, h: 480 }, 10, [], [], encoding,
      'gif', 'infinite', undefined, { mode: 'use', palettePath }
    )
    const paletteGraph = paletteArgs[paletteArgs.indexOf('-filter_complex') + 1]
    const renderGraph = renderArgs[renderArgs.indexOf('-filter_complex') + 1]

    expect(paletteGraph).toContain('palettegen=')
    expect(paletteGraph).not.toContain('split[g0][g1]')
    expect(paletteArgs).toEqual(expect.arrayContaining(['-frames:v', '1', '-c:v', 'png']))
    expect(renderArgs).toEqual(expect.arrayContaining(['-i', palettePath]))
    expect(renderGraph).toContain('paletteuse=')
    expect(renderGraph).not.toContain('palettegen=')
  })

  it('turns FFmpeg memory failures into a concise actionable message', () => {
    const error = new Error('FFmpeg 退出代码 4294967284: Error while filtering: Cannot allocate memory')
    expect(formatExportError(error, 'webp')).toBe(
      '导出 WEBP 时内存不足。请缩短导出范围，或降低分辨率和动图帧率；较长内容建议改用 MP4 或 WebM。'
    )
  })

  it('scales logical canvas position when exporting at another resolution', () => {
    const video = clip('positioned', 'video')
    const operations = {
      positioned: [
        ...createDefaultOperations(10),
        { id: 'transform', type: 'transform' as const, enabled: true, params: {
          fit: 'contain' as const, scale: 1, x: 300, y: -150, rotation: 0 as const,
          opacity: 100, flipX: false, flipY: false
        } }
      ]
    }
    const args = buildTimelineFFmpegArgs(
      [video], operations, 'C:\output.mp4', { w: 1280, h: 720 }, 10, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: '720p', quality: 'medium', outputPath: 'C:\output.mp4' }),
      'mp4', undefined,
      { canvas: { preset: 'landscape', width: 1920, height: 1080, backgroundColor: '#000000' } }
    )
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain("x='(W-w)/2+200'")
    expect(graph).toContain("y='(H-h)/2-100'")
  })

  it('uses an orphan video audio stream without duplicating a linked audio clip', () => {
    const video = clip('orphan', 'video')
    video.mediaInfo.hasAudio = true
    video.mediaInfo.audioCodec = 'aac'
    video.mediaInfo.sampleRate = 48_000
    const orphanArgs = buildTimelineFFmpegArgs(
      [video], { orphan: createDefaultOperations(10) }, 'C:\output.mp4', { w: 640, h: 360 },
      10, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: 'original', quality: 'medium', outputPath: 'C:\output.mp4' }),
      'mp4'
    )
    expect(orphanArgs[orphanArgs.indexOf('-filter_complex') + 1]).toContain('[0:a]atrim=')
    expect(orphanArgs).toContain('[aout]')

    const linkedAudio = clip('linked-audio', 'audio')
    linkedAudio.groupId = video.groupId
    linkedAudio.filePath = video.filePath
    linkedAudio.mediaInfo.filePath = video.filePath
    const linkedArgs = buildTimelineFFmpegArgs(
      [video, linkedAudio], {
        orphan: createDefaultOperations(10),
        'linked-audio': createDefaultOperations(10)
      }, 'C:\output.mp4', { w: 640, h: 360 }, 10, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: 'original', quality: 'medium', outputPath: 'C:\output.mp4' }),
      'mp4'
    )
    const linkedGraph = linkedArgs[linkedArgs.indexOf('-filter_complex') + 1]
    expect(linkedGraph).not.toContain('asplit=2')
    expect(linkedGraph.match(/\]atrim=start=/g)).toHaveLength(1)

    const mutedVideo = { ...video, embeddedAudioEnabled: false }
    const mutedArgs = buildTimelineFFmpegArgs(
      [mutedVideo], { orphan: createDefaultOperations(10) }, 'C:\output.mp4', { w: 640, h: 360 },
      10, [], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: 'original', quality: 'medium', outputPath: 'C:\output.mp4' }),
      'mp4'
    )
    const mutedGraph = mutedArgs[mutedArgs.indexOf('-filter_complex') + 1]
    expect(mutedGraph).not.toContain('[0:a]atrim=')
    expect(mutedArgs).not.toContain('[aout]')
  })

  it('compiles visually distinct transition filters and video fades', () => {
    const left = clip('left', 'video')
    const right = clip('right', 'video', 10)
    const operations = {
      left: [...createDefaultOperations(10), { id: 'fade', type: 'fade' as const, enabled: true, params: { fadeIn: 1, fadeOut: 2 } }],
      right: createDefaultOperations(10)
    }
    const args = buildTimelineFFmpegArgs(
      [left, right], operations, 'C:\\output.mp4', { w: 1280, h: 720 }, 20,
      [
        { id: 'wipe', type: 'wipeleft', leftClipId: 'left', rightClipId: 'right', startOffset: -1, endOffset: 1 },
        { id: 'matte', type: 'fadeblack', leftClipId: 'left', rightClipId: 'right', startOffset: -0.5, endOffset: 0.5 }
      ], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: '720p', quality: 'medium', outputPath: 'C:\\output.mp4' }),
      'mp4'
    )
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain(":a='if(")
    expect(graph).toContain("enable='between(t,0.000,2.000)'")
    expect(graph).toContain('color=c=black')
    expect(graph).toContain('fade=t=in:st=0.000:d=1.000:alpha=1')
  })

  it('composites a transition matte below video tracks that sit above its cut', () => {
    const left = clip('left', 'video')
    const right = clip('right', 'video', 10)
    const overlay = { ...clip('overlay', 'video'), trackIndex: 1 }
    const operations = {
      left: createDefaultOperations(10),
      right: createDefaultOperations(10),
      overlay: createDefaultOperations(10)
    }
    const args = buildTimelineFFmpegArgs(
      [left, right, overlay], operations, 'C:\\output.mp4', { w: 1280, h: 720 }, 20,
      [{
        id: 'matte',
        type: 'fadeblack',
        leftClipId: 'left',
        rightClipId: 'right',
        startOffset: -0.5,
        endOffset: 0.5
      }], [],
      resolveExportEncodingOptions({ format: 'mp4', resolution: '720p', quality: 'medium', outputPath: 'C:\\output.mp4' }),
      'mp4'
    )
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('[vout1][matte0]overlay=eof_action=pass[matteout0]')
    expect(graph).toContain("[matteout0][v2]overlay=x='")
  })

  it('remaps audio fades when a range removes the beginning of a clip', () => {
    const audio = clip('audio', 'audio')
    const sliced = sliceTimelineForRange(
      [audio], { audio: createDefaultOperations(10) }, { startTime: 3, endTime: 8 }, [],
      [{ id: 'fade', clipId: 'audio', kind: 'out', startOffset: 6, endOffset: 8 }]
    )
    expect(sliced.audioFades[0]).toMatchObject({ startOffset: 3, endOffset: 5 })
  })

  it('chooses configured fps and safely replaces an existing output', async () => {
    expect(resolveProjectFrameRate([clip('video', 'video')], { canvas: {
      preset: 'source', width: 1920, height: 1080, backgroundColor: '#000000'
    }, frameRate: 24 })).toBe(24)

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zclip-export-'))
    const output = path.join(directory, 'output.mp4')
    const temporary = path.join(directory, 'temporary.mp4')
    await fs.writeFile(output, 'old')
    await fs.writeFile(temporary, 'new')
    await commitExportOutput(temporary, output)
    expect(await fs.readFile(output, 'utf8')).toBe('new')
    await fs.rm(directory, { recursive: true, force: true })
  })
})
