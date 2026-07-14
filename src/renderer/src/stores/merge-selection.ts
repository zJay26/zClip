import type { TimelineClip } from '../../../shared/types'

export type MergeSelectionMeta = {
  selectedClips: TimelineClip[]
  logicalSelectionCount: number
  hasVideoSelection: boolean
  hasAudioSelection: boolean
  canMerge: boolean
  disabledReason: string | null
}

export function getMergeSelectionMeta(
  clips: TimelineClip[],
  selectedClipIds: string[]
): MergeSelectionMeta {
  const selectedIdSet = new Set(selectedClipIds)
  const selectedClips = clips.filter((clip) => selectedIdSet.has(clip.id))
  const logicalSelectionCount = new Set(selectedClips.map((clip) => clip.groupId)).size
  const groupTrackMap = new Map<string, { hasVideo: boolean; hasAudio: boolean }>()
  selectedClips.forEach((clip) => {
    const entry = groupTrackMap.get(clip.groupId) || { hasVideo: false, hasAudio: false }
    if (clip.track === 'video') entry.hasVideo = true
    if (clip.track === 'audio') entry.hasAudio = true
    groupTrackMap.set(clip.groupId, entry)
  })

  const groupSelections = Array.from(groupTrackMap.values())
  const hasVideoSelection = groupSelections.some((group) => group.hasVideo)
  const hasAudioSelection = groupSelections.some((group) => group.hasAudio)
  const allGroupsHaveVideo = groupSelections.length > 0 && groupSelections.every((group) => group.hasVideo)
  const allGroupsHaveAudio = groupSelections.length > 0 && groupSelections.every((group) => group.hasAudio)
  const isUniformTrackSelection =
    (allGroupsHaveVideo && !hasAudioSelection) ||
    (allGroupsHaveAudio && !hasVideoSelection) ||
    (allGroupsHaveVideo && allGroupsHaveAudio)

  let disabledReason: string | null = null
  if (selectedClips.length === 0) {
    disabledReason = '请先选择片段'
  } else if (!isUniformTrackSelection) {
    disabledReason = '请仅选择同类型逻辑片段（纯视频、纯音频或完整音画段）'
  } else if (logicalSelectionCount < 2) {
    disabledReason = '请至少选择两个逻辑片段以合并'
  }

  return {
    selectedClips,
    logicalSelectionCount,
    hasVideoSelection,
    hasAudioSelection,
    canMerge: disabledReason === null,
    disabledReason
  }
}
