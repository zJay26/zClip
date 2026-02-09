/// <reference types="electron-vite/node" />

import type { ElectronAPI } from '../../preload/index'

declare global {
  interface Window {
    api: ElectronAPI
  }
}

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
