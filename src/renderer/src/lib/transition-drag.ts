export const TRANSITION_DRAG_GEOMETRY_MIME = 'application/x-zclip-transition-geometry'

export interface TransitionDragGeometry {
  width: number
  height: number
  grabOffsetX: number
  grabOffsetY: number
}

export interface TransitionDragRect {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

const DEFAULT_DRAG_GEOMETRY: TransitionDragGeometry = {
  width: 128,
  height: 52,
  grabOffsetX: 64,
  grabOffsetY: 26
}

let activeGeometry: TransitionDragGeometry | null = null

function finiteInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

export function normalizeTransitionDragGeometry(
  value: Partial<TransitionDragGeometry> | null | undefined
): TransitionDragGeometry | null {
  if (!value) return null
  const width = finiteInRange(value.width, 24, 640)
  const height = finiteInRange(value.height, 20, 320)
  if (width === null || height === null) return null
  const grabOffsetX = finiteInRange(value.grabOffsetX, 0, width)
  const grabOffsetY = finiteInRange(value.grabOffsetY, 0, height)
  if (grabOffsetX === null || grabOffsetY === null) return null
  return { width, height, grabOffsetX, grabOffsetY }
}

export function createTransitionDragGeometry(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number
): TransitionDragGeometry {
  const width = Math.max(24, Math.min(640, rect.width))
  const height = Math.max(20, Math.min(320, rect.height))
  const rawOffsetX = clientX - rect.left
  const rawOffsetY = clientY - rect.top
  return {
    width,
    height,
    grabOffsetX: Number.isFinite(rawOffsetX) && rawOffsetX >= 0 && rawOffsetX <= width
      ? rawOffsetX
      : width / 2,
    grabOffsetY: Number.isFinite(rawOffsetY) && rawOffsetY >= 0 && rawOffsetY <= height
      ? rawOffsetY
      : height / 2
  }
}

export function setActiveTransitionDragGeometry(geometry: TransitionDragGeometry): void {
  activeGeometry = normalizeTransitionDragGeometry(geometry)
}

export function clearActiveTransitionDragGeometry(): void {
  activeGeometry = null
}

export function getTransitionDragGeometry(dataTransfer?: DataTransfer | null): TransitionDragGeometry {
  if (activeGeometry) return activeGeometry
  try {
    const raw = dataTransfer?.getData(TRANSITION_DRAG_GEOMETRY_MIME)
    if (raw) {
      const parsed = normalizeTransitionDragGeometry(JSON.parse(raw) as Partial<TransitionDragGeometry>)
      if (parsed) return parsed
    }
  } catch {
    // Browsers may protect drag payload data until drop. The module-local
    // geometry above remains available for drags originating inside zClip.
  }
  return DEFAULT_DRAG_GEOMETRY
}

export function getTransitionDragRect(
  clientX: number,
  clientY: number,
  geometry: TransitionDragGeometry
): TransitionDragRect {
  const left = clientX - geometry.grabOffsetX
  const top = clientY - geometry.grabOffsetY
  return {
    left,
    right: left + geometry.width,
    top,
    bottom: top + geometry.height,
    centerX: left + geometry.width / 2,
    centerY: top + geometry.height / 2
  }
}

export function dragRectIntersectsCut(
  dragRect: TransitionDragRect,
  cutClientX: number,
  trackTop: number,
  trackBottom: number
): boolean {
  return cutClientX >= dragRect.left &&
    cutClientX <= dragRect.right &&
    dragRect.bottom >= trackTop &&
    dragRect.top <= trackBottom
}
