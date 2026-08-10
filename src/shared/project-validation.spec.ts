// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isProjectData, sanitizeProjectForPersistence } from './project-validation'
import type { MediaOperation, ProjectData, ProjectSettings } from './types'

function createDefaultOperations(duration: number): MediaOperation[] {
  return [
    { id: 'trim', type: 'trim', enabled: true, params: { startTime: 0, endTime: duration } },
    { id: 'speed', type: 'speed', enabled: true, params: { rate: 1 } }
  ]
}

function createDefaultProjectSettings(): ProjectSettings {
  return { canvas: { preset: 'source', width: 1920, height: 1080, backgroundColor: '#000000' } }
}

function project(): ProjectData {
  const mediaInfo = {
    duration: 5, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
    sampleRate: 48_000, fileSize: 100, filePath: 'C:\\clip.mp4', hasVideo: true, hasAudio: true,
    playbackPath: 'C:\\cache\\proxy.mp4', playbackIsProxy: true
  }
  return {
    schemaVersion: 1,
    savedAt: new Date(0).toISOString(),
    clips: [{ id: 'clip', groupId: 'group', filePath: mediaInfo.filePath, startTime: 0, duration: 5, track: 'video', trackIndex: 0, mediaInfo }],
    operationsByClip: { clip: createDefaultOperations(5) },
    linkedGroups: { group: true },
    videoTrackCount: 2,
    audioTrackCount: 2,
    currentTime: 0,
    projectSettings: createDefaultProjectSettings()
  }
}

describe('project validation', () => {
  it('accepts a valid project and strips ephemeral proxy paths', () => {
    const value = project()
    expect(isProjectData(value)).toBe(true)
    expect(sanitizeProjectForPersistence(value).clips[0].mediaInfo.playbackPath).toBeUndefined()
  })

  it('rejects invalid operation parameters and dangling references', () => {
    const value = project()
    value.operationsByClip.clip[1].params = { rate: 0 }
    expect(isProjectData(value)).toBe(false)
  })

  it('rejects malformed dates, unsupported media and mismatched track streams', () => {
    const invalidDate = project()
    invalidDate.savedAt = 'not-a-date'
    expect(isProjectData(invalidDate)).toBe(false)

    const unsupported = project()
    unsupported.clips[0].filePath = 'C:\\still.png'
    unsupported.clips[0].mediaInfo.filePath = unsupported.clips[0].filePath
    expect(isProjectData(unsupported)).toBe(false)

    const wrongStream = project()
    wrongStream.clips[0].mediaInfo.hasVideo = false
    expect(isProjectData(wrongStream)).toBe(false)
  })

  it('rejects duplicate operations and effects outside their clip bounds', () => {
    const duplicateOperation = project()
    duplicateOperation.operationsByClip.clip.push({
      ...duplicateOperation.operationsByClip.clip[1],
      id: 'another-speed'
    })
    expect(isProjectData(duplicateOperation)).toBe(false)

    const invalidFade = project()
    invalidFade.audioFades = [{
      id: 'fade', clipId: 'clip', kind: 'out', startOffset: 4, endOffset: 6
    }]
    expect(isProjectData(invalidFade)).toBe(false)
  })

  it('rejects a playhead beyond the effective timeline', () => {
    const value = project()
    value.currentTime = 6
    expect(isProjectData(value)).toBe(false)
  })

  it('bounds and validates linked-group metadata', () => {
    const invalidId = project()
    invalidId.linkedGroups['bad\u0000group'] = true
    expect(isProjectData(invalidId)).toBe(false)

    const oversized = project()
    oversized.linkedGroups = Object.fromEntries(
      Array.from({ length: 20_001 }, (_, index) => [`group-${index}`, true])
    )
    expect(isProjectData(oversized)).toBe(false)
  })
})
