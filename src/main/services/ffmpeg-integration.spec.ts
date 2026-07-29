// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import type { ExportFormat, MediaInfo, QualityPreset } from '../../shared/types'
import { buildFFmpegArgs } from './media-engine'
import { resolveExportEncodingOptions } from './export-quality'
import { ffmpegPath } from './ffmpeg'

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
  }, 30_000)
})
