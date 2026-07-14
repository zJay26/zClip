import { describe, expect, test } from 'vitest'
import { parseMediaInfo } from '@shared/media-info-utils'

describe('media info parsing', () => {
  test('treats MP3 cover art as artwork instead of a playable video stream', () => {
    const info = parseMediaInfo(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'mjpeg',
            width: 600,
            height: 600,
            r_frame_rate: '90000/1',
            disposition: { attached_pic: 1 }
          },
          {
            codec_type: 'audio',
            codec_name: 'mp3',
            sample_rate: '44100'
          }
        ],
        format: {
          duration: '12.5',
          size: '123456',
          format_name: 'mp3'
        }
      },
      'D:\\music\\cover-art.mp3'
    )

    expect(info.hasVideo).toBe(false)
    expect(info.hasAudio).toBe(true)
    expect(info.width).toBe(0)
    expect(info.height).toBe(0)
    expect(info.fps).toBe(0)
    expect(info.videoCodec).toBe('')
    expect(info.audioCodec).toBe('mp3')
  })

  test('keeps a normal video stream when present', () => {
    const info = parseMediaInfo(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30000/1001',
            disposition: { attached_pic: 0 }
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000'
          }
        ],
        format: {
          duration: '4.2',
          size: '987654',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2'
        }
      },
      'D:\\video.mp4'
    )

    expect(info.hasVideo).toBe(true)
    expect(info.hasAudio).toBe(true)
    expect(info.width).toBe(1920)
    expect(info.height).toBe(1080)
    expect(info.fps).toBe(29.97)
    expect(info.videoCodec).toBe('h264')
  })
})
