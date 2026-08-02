// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
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
import { buildTimelineFFmpegArgs } from './export-service'
import { ffmpegPath, ffprobePath } from './ffmpeg'

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
    }
  }, 60_000)
})
