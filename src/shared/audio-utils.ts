import type { TimelineClip } from './types'

/**
 * Audio-track clips are authoritative. A video clip may fall back to its
 * embedded stream only when that stream has not been explicitly disabled and
 * no separate audio clip represents the same imported media group.
 */
export function getEffectiveTimelineAudioClips(clips: TimelineClip[]): TimelineClip[] {
  const explicitAudioGroupIds = new Set(
    clips
      .filter((clip) => clip.track === 'audio' && clip.mediaInfo.hasAudio)
      .map((clip) => clip.groupId)
  )

  return clips.filter((clip) => {
    if (!clip.mediaInfo.hasAudio) return false
    if (clip.track === 'audio') return true
    return clip.embeddedAudioEnabled !== false && !explicitAudioGroupIds.has(clip.groupId)
  })
}
