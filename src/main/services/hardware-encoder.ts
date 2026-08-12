import { spawn } from 'child_process'
import os from 'os'
import { ffmpegPath, terminateProcess } from './ffmpeg'
import type { ResolvedExportEncodingOptions } from './export-quality'

export type H264EncoderKind = 'software' | 'nvenc' | 'qsv' | 'amf'

const HARDWARE_ENCODERS: Array<{ kind: Exclude<H264EncoderKind, 'software'>; codec: string }> = [
  { kind: 'nvenc', codec: 'h264_nvenc' },
  { kind: 'qsv', codec: 'h264_qsv' },
  { kind: 'amf', codec: 'h264_amf' }
]

let detectedEncoder: Promise<H264EncoderKind> | null = null

function probeEncoder(codec: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=0.1',
      '-frames:v', '1', '-vf', 'format=nv12', '-an',
      '-c:v', codec,
      '-f', 'null', '-'
    ], { windowsHide: true, stdio: 'ignore' })
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      terminateProcess(proc)
      finish(false)
    }, 8_000)
    timeout.unref()
    proc.once('error', () => finish(false))
    proc.once('close', (code) => finish(code === 0))
  })
}

/**
 * Opens each encoder with a real one-frame encode instead of trusting
 * `ffmpeg -encoders`: a compiled-in NVENC/AMF/QSV encoder can still be unusable
 * because of a missing GPU, runtime or incompatible driver.
 */
export function detectPreferredH264Encoder(): Promise<H264EncoderKind> {
  if (detectedEncoder) return detectedEncoder
  detectedEncoder = (async () => {
    for (const candidate of HARDWARE_ENCODERS) {
      if (await probeEncoder(candidate.codec)) return candidate.kind
    }
    return 'software'
  })()
  return detectedEncoder
}

function qsvPreset(preset: ResolvedExportEncodingOptions['h264Preset']): string {
  if (['slow', 'slower', 'veryslow'].includes(preset)) return 'slow'
  if (preset === 'medium') return 'medium'
  if (['fast', 'faster'].includes(preset)) return 'fast'
  return 'veryfast'
}

function nvencPreset(preset: ResolvedExportEncodingOptions['h264Preset']): string {
  if (preset === 'veryslow') return 'p7'
  if (preset === 'slower' || preset === 'slow') return 'p6'
  if (preset === 'medium') return 'p5'
  if (preset === 'fast') return 'p4'
  if (preset === 'faster') return 'p3'
  if (preset === 'veryfast' || preset === 'superfast') return 'p2'
  return 'p1'
}

export function getH264EncoderArgs(
  kind: H264EncoderKind,
  encoding: ResolvedExportEncodingOptions,
  hardwareFrames = false
): string[] {
  const bitrate = encoding.videoBitrateKbps
  if (kind === 'nvenc') {
    const args = [
      '-c:v', 'h264_nvenc',
      '-preset', nvencPreset(encoding.h264Preset),
      '-tune', 'hq'
    ]
    if (!hardwareFrames) args.push('-pix_fmt', 'nv12')
    if (bitrate) args.push('-rc', 'vbr', '-b:v', `${bitrate}k`)
    else args.push('-rc', 'vbr', '-cq', String(encoding.crf), '-b:v', '0')
    return args
  }
  if (kind === 'qsv') {
    const args = [
      '-c:v', 'h264_qsv',
      '-preset', qsvPreset(encoding.h264Preset)
    ]
    if (!hardwareFrames) args.push('-pix_fmt', 'nv12')
    if (bitrate) args.push('-b:v', `${bitrate}k`)
    else args.push('-global_quality', String(encoding.crf))
    return args
  }
  if (kind === 'amf') {
    const quality = ['slow', 'slower', 'veryslow'].includes(encoding.h264Preset)
      ? 'quality'
      : ['medium', 'fast'].includes(encoding.h264Preset)
        ? 'balanced'
        : 'speed'
    const args = ['-c:v', 'h264_amf', '-quality', quality]
    if (!hardwareFrames) args.push('-pix_fmt', 'nv12')
    if (bitrate) args.push('-rc', 'vbr_peak', '-b:v', `${bitrate}k`)
    else {
      args.push(
        '-rc', 'cqp',
        '-qp_i', String(encoding.crf),
        '-qp_p', String(encoding.crf),
        '-qp_b', String(encoding.crf)
      )
    }
    return args
  }

  const args = ['-c:v', 'libx264', '-preset', encoding.h264Preset, '-pix_fmt', 'yuv420p']
  if (bitrate) args.push('-b:v', `${bitrate}k`)
  else args.push('-crf', String(encoding.crf))
  return args
}

export function getHardwareDecodeInputArgs(kind: H264EncoderKind): string[] {
  if (kind === 'qsv') return ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv']
  if (kind === 'nvenc') return ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']
  if (kind === 'amf') return ['-hwaccel', 'd3d11va', '-hwaccel_output_format', 'd3d11']
  return []
}

export function getVp9ParallelArgs(width: number): string[] {
  const logicalProcessors = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length
  const threads = Math.max(2, Math.min(8, logicalProcessors))
  const tileColumns = width >= 3840 ? 3 : width >= 1920 ? 2 : width >= 960 ? 1 : 0
  return ['-row-mt', '1', '-tile-columns', String(tileColumns), '-threads', String(threads)]
}
