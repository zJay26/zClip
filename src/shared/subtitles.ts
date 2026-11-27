import type { SubtitleCue } from './types'

/** Intersect with the exported timeline and move its origin to zero. */
export function sliceSubtitles(cues: SubtitleCue[], start: number, end: number): SubtitleCue[] {
  return cues.filter((cue) => cue.startTime < end && cue.endTime > start)
    .map((cue) => ({
      ...cue,
      startTime: Math.max(start, cue.startTime) - start,
      endTime: Math.min(end, cue.endTime) - start
    }))
}
