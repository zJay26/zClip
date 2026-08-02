import { describe, expect, test } from 'vitest'
import {
  buildProjectData,
  createDefaultOperations,
  createDefaultProjectSettings
} from '@renderer/stores/project-store-helpers'
import type { FadeParams, TransformParams } from '@shared/types'

describe('project defaults', () => {
  test('creates operations needed by editing and export pipelines', () => {
    const operations = createDefaultOperations(12)
    expect(operations.map((op) => op.type)).toEqual([
      'trim',
      'speed',
      'volume',
      'pitch',
      'transform',
      'fade'
    ])

    const transform = operations.find((op) => op.type === 'transform')?.params as TransformParams
    expect(transform).toMatchObject({
      fit: 'contain',
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 100,
      flipX: false,
      flipY: false
    })

    const fade = operations.find((op) => op.type === 'fade')?.params as FadeParams
    expect(fade).toEqual({ fadeIn: 0, fadeOut: 0 })
  })

  test('uses a source-based canvas by default', () => {
    expect(createDefaultProjectSettings()).toEqual({
      frameRate: 30,
      canvas: {
        preset: 'source',
        width: 1920,
        height: 1080,
        backgroundColor: '#000000'
      }
    })
  })

  test('serializes timeline effects as project-level data', () => {
    const state = {
      clips: [],
      operationsByClip: {},
      transitions: [],
      audioFades: [],
      linkedGroups: {},
      videoTrackCount: 2,
      audioTrackCount: 2,
      currentTime: 0,
      projectSettings: createDefaultProjectSettings()
    }

    expect(buildProjectData(state as never)).toMatchObject({
      transitions: [],
      audioFades: []
    })
  })
})
