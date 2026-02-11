declare module 'soundtouchjs' {
  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void)
    tempo: number
    pitch: number
    percentagePlayed: number
    connect(node: AudioNode): void
    disconnect(): void
  }
}
