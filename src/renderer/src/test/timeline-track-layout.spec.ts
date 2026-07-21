import { describe, expect, test } from 'vitest'
import { RULER_HEIGHT, getAdaptiveTrackLayout } from '../components/Timeline/timeline-constants'

describe('adaptive timeline track layout', () => {
  test('fills the available track area exactly', () => {
    const viewportHeight = 260
    const layout = getAdaptiveTrackLayout(viewportHeight, 5, 4)

    expect(layout.trackAreaHeight).toBe(viewportHeight - RULER_HEIGHT)
    expect(layout.videoAreaHeight + layout.groupGap + layout.audioAreaHeight)
      .toBeCloseTo(layout.trackAreaHeight, 8)
  })

  test('shrinks every track instead of overflowing when track count grows', () => {
    const viewportHeight = 220
    const compact = getAdaptiveTrackLayout(viewportHeight, 8, 8)
    const roomy = getAdaptiveTrackLayout(viewportHeight, 2, 2)

    expect(compact.trackHeight).toBeLessThan(roomy.trackHeight)
    expect(compact.videoAreaHeight + compact.groupGap + compact.audioAreaHeight)
      .toBeCloseTo(viewportHeight - RULER_HEIGHT, 8)
  })
})
