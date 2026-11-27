import type { SubtitleCue } from '../../shared/types'

function assTime(seconds: number): string {
  const ticks = Math.round(seconds * 100)
  return [
    Math.floor(ticks / 360000),
    String(Math.floor(ticks / 6000) % 60).padStart(2, '0'),
    String(Math.floor(ticks / 100) % 60).padStart(2, '0')
  ].join(':') + '.' + String(ticks % 100).padStart(2, '0')
}

function plainText(text: string): string {
  // Break literal ASS escapes (\N, \n, \h) with an invisible word joiner.
  // Escape braces separately, then introduce only our own hard line breaks.
  return text.replace(/\\/g, '\\\u2060').replace(/[{}]/g, '\\$&').replace(/\n/g, '\\N')
}

export function buildSubtitleScript(cues: SubtitleCue[], size: { w: number; h: number }): string {
  const height = 720
  const width = Math.round(height * size.w / size.h)
  const margin = Math.round(width * 0.05)
  return [
    '[Script Info]', 'ScriptType: v4.00+', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes',
    'PlayResX: ' + width, 'PlayResY: ' + height,
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Microsoft YaHei,36,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,' + margin + ',' + margin + ',36,1',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...cues.map((cue) => [
      'Dialogue: 0', assTime(cue.startTime), assTime(cue.endTime),
      'Default', '', 0, 0, 0, '', plainText(cue.text)
    ].join(',')), ''
  ].join('\n')
}
