// ============================================================
// Timeline 共享常量
// ============================================================

export const RULER_HEIGHT = 28
export const TRACK_HEIGHT = 48
export const TRACK_GAP = 4
export const GROUP_GAP = 8
export const HANDLE_WIDTH = 8
export const DRAG_THRESHOLD_PX = 8
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 80
export const SNAP_THRESHOLD_PX = 10
export const HEADER_WIDTH = 72
export const TIMELINE_TAIL_PX = 220

export function hasPassedDragThreshold(
  deltaX: number,
  deltaY: number,
  threshold = DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(deltaX, deltaY) >= threshold
}

export interface AdaptiveTrackLayout {
  trackHeight: number
  trackGap: number
  groupGap: number
  videoAreaHeight: number
  audioAreaHeight: number
  trackAreaHeight: number
}

/** Size every track so the complete stack exactly fills the track viewport. */
export function getAdaptiveTrackLayout(
  viewportHeight: number,
  videoTrackCount: number,
  audioTrackCount: number
): AdaptiveTrackLayout {
  const totalTracks = Math.max(1, videoTrackCount + audioTrackCount)
  const withinGroupGapCount = Math.max(0, videoTrackCount - 1) + Math.max(0, audioTrackCount - 1)
  const hasBothGroups = videoTrackCount > 0 && audioTrackCount > 0
  const nominalTrackAreaHeight =
    totalTracks * TRACK_HEIGHT +
    withinGroupGapCount * TRACK_GAP +
    (hasBothGroups ? GROUP_GAP : 0)
  const trackAreaHeight = viewportHeight > RULER_HEIGHT
    ? viewportHeight - RULER_HEIGHT
    : nominalTrackAreaHeight
  const shrinkScale = Math.min(1, trackAreaHeight / nominalTrackAreaHeight)
  const trackGap = TRACK_GAP * shrinkScale
  const groupGap = hasBothGroups ? GROUP_GAP * shrinkScale : 0
  const trackHeight = Math.max(
    1,
    (trackAreaHeight - withinGroupGapCount * trackGap - groupGap) / totalTracks
  )
  const videoAreaHeight =
    videoTrackCount * trackHeight + Math.max(0, videoTrackCount - 1) * trackGap
  const audioAreaHeight =
    audioTrackCount * trackHeight + Math.max(0, audioTrackCount - 1) * trackGap

  return {
    trackHeight,
    trackGap,
    groupGap,
    videoAreaHeight,
    audioAreaHeight,
    trackAreaHeight
  }
}

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
