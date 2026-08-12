import { afterEach, describe, expect, test } from 'vitest'
import {
  clearActiveTransitionDragGeometry,
  createTransitionDragGeometry,
  dragRectIntersectsCut,
  getTransitionDragRect,
  normalizeTransitionDragGeometry,
  setActiveTransitionDragGeometry,
  getTransitionDragGeometry
} from '@renderer/lib/transition-drag'

describe('transition drag geometry', () => {
  afterEach(() => clearActiveTransitionDragGeometry())

  test('uses the actual card bounds and pointer grab offset', () => {
    const geometry = createTransitionDragGeometry(
      { left: 100, top: 40, width: 132, height: 52 },
      116,
      66
    )
    const dragRect = getTransitionDragRect(304, 226, geometry)

    expect(geometry).toEqual({
      width: 132,
      height: 52,
      grabOffsetX: 16,
      grabOffsetY: 26
    })
    expect(dragRect).toMatchObject({ left: 288, right: 420, top: 200, bottom: 252 })
  })

  test('accepts whenever the card intersects the cut even if the pointer is far away', () => {
    const dragRect = getTransitionDragRect(304, 226, {
      width: 132,
      height: 52,
      grabOffsetX: 16,
      grabOffsetY: 26
    })

    expect(Math.abs(304 - 400)).toBe(96)
    expect(dragRectIntersectsCut(dragRect, 400, 204, 248)).toBe(true)
    expect(dragRectIntersectsCut(dragRect, 421, 204, 248)).toBe(false)
    expect(dragRectIntersectsCut(dragRect, 400, 253, 301)).toBe(false)
  })

  test('rejects malformed external geometry and preserves active internal geometry', () => {
    expect(normalizeTransitionDragGeometry({
      width: Number.POSITIVE_INFINITY,
      height: 40,
      grabOffsetX: 10,
      grabOffsetY: 10
    })).toBeNull()

    const active = { width: 140, height: 50, grabOffsetX: 20, grabOffsetY: 25 }
    setActiveTransitionDragGeometry(active)
    expect(getTransitionDragGeometry()).toEqual(active)
  })
})
