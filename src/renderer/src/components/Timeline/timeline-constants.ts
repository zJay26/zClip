// ============================================================
// Timeline 共享常量
// ============================================================

export const RULER_HEIGHT = 28
export const TRACK_HEIGHT = 48
export const TRACK_GAP = 4
export const GROUP_GAP = 8
export const HANDLE_WIDTH = 8
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 80
export const SNAP_THRESHOLD_PX = 10
export const HEADER_WIDTH = 72
export const TIMELINE_TAIL_PX = 220

/** Calculate sensible tick intervals based on zoom level */
export function getTickInterval(
  _duration: number,
  pixelsPerSecond: number
): { major: number; minor: number } {
  // 固定档位刻度：缩放跨档才跳变，避免刻度抖动
  const targetMajorPx = 90
  const majorOptions = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const major =
    majorOptions.find((n) => n * pixelsPerSecond >= targetMajorPx) ||
    majorOptions[majorOptions.length - 1]
  const minor = major >= 1 ? major / 5 : major / 4

  return { major, minor }
}
