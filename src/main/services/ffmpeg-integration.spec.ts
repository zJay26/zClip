// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'fs/promises'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
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
})
