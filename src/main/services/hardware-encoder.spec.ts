// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveExportEncodingOptions } from './export-quality'
import {
  getH264EncoderArgs,
  getHardwareDecodeInputArgs,
  getVp9ParallelArgs
} from './hardware-encoder'

const encoding = resolveExportEncodingOptions({
  format: 'mp4',
  resolution: '1080p',
  quality: 'medium',
  outputPath: 'output.mp4'
})

describe('hardware encoder arguments', () => {
  it('keeps a complete software H.264 fallback', () => {
    expect(getH264EncoderArgs('software', encoding)).toEqual([
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-crf', '23'
    ])
  })

  it('maps quality mode to valid QSV and NVENC constant-quality arguments', () => {
    expect(getH264EncoderArgs('qsv', encoding)).toEqual(expect.arrayContaining([
      '-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'nv12'
    ]))
    expect(getH264EncoderArgs('nvenc', encoding)).toEqual(expect.arrayContaining([
      '-c:v', 'h264_nvenc', '-cq', '23', '-pix_fmt', 'nv12'
    ]))
  })

  it('selects matching zero-copy hardware decode surfaces', () => {
    expect(getHardwareDecodeInputArgs('qsv')).toEqual([
      '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'
    ])
    expect(getHardwareDecodeInputArgs('nvenc')).toEqual([
      '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'
    ])
    expect(getHardwareDecodeInputArgs('software')).toEqual([])
  })

  it('enables bounded VP9 row and tile parallelism', () => {
    const args = getVp9ParallelArgs(3840)
    expect(args).toEqual(expect.arrayContaining([
      '-row-mt', '1', '-tile-columns', '3', '-threads'
    ]))
    const threads = Number(args[args.indexOf('-threads') + 1])
    expect(threads).toBeGreaterThanOrEqual(2)
    expect(threads).toBeLessThanOrEqual(8)
  })
})
