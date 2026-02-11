# zClip

[简体中文](./README.zh.md)

zClip is a local video editor for Windows, focused on a fast learning curve, short workflows, and fully offline processing.

I often need simple edits where opening a professional NLE feels too heavy, while some lightweight tools lock key features (such as export) behind VIP paywalls. So I started vibe-coding a lightweight editor myself.  
This project is open-sourced under the MIT license. Feel free to use it and build on top of it.

zClip is built with Electron + React and uses FFmpeg for media analysis and export. It is designed for quickly trimming, assembling, and exporting common video/audio assets.

## Download

> Current release in this repo: `{{VERSION}}`

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/download/{{TAG}}/{{SETUP_EXE}}">
    <img src="https://img.shields.io/badge/Download_for_Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows"/>
  </a>
</p>

## First Launch on Windows

zClip is not code-signed with a commercial certificate yet, so Windows may show a security warning the first time you run it. This is expected.

You can continue with these steps:
1. Click "More info"
2. Choose "Keep"
3. Click "More info" again
4. Choose "Keep anyway"

## Windows Context Menu (Optional)

If you want to add "Open with zClip" to the first-level right-click menu on Windows, **Custom Context Menu** is a practical option.

## Key Features

- Fully local processing: no media is uploaded to cloud services
- Multi-file import: file picker, drag-and-drop, system/CLI open-with support
- Multi-track timeline: video + audio tracks with add/remove, snap, and zoom
- Common editing tools: split, copy/cut/paste, delete, undo/redo
- Parameter controls: trim, speed (0.1x~16x), volume (0%~1000%), pitch (25%~400%)
- Export options:
  - Video formats: `mp4` / `mov` / `mkv` / `webm`
  - Audio formats: `mp3` / `wav` / `flac` / `aac` / `opus`
  - Resolution presets: `original` / `1080p` / `720p` / `480p`
  - Quality presets: `high` / `medium` / `low`
  - Progress display and cancel support

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Play / Pause | `Space` or `K` |
| Seek backward 5s | `J` |
| Seek forward 5s | `L` |
| Previous frame / 1s (hold Shift) | `←` / `Shift + ←` |
| Next frame / 1s (hold Shift) | `→` / `Shift + →` |
| Split at playhead | `C` |
| Copy selected clip | `Ctrl/Cmd + C` |
| Cut selected clip | `Ctrl/Cmd + X` |
| Paste clip | `Ctrl/Cmd + V` |
| Delete selected clip | `Backspace` / `Delete` |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` |

## Tech Stack

- Desktop framework: Electron + electron-vite
- Frontend: React 18 + TypeScript + Tailwind CSS
- State management: Zustand
- Media tools: FFmpeg / FFprobe (via `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`)
- Testing: Vitest + Testing Library (JSDOM)

## Requirements

- Node.js 18+ (LTS recommended)
- npm 9+
- Windows 10/11 (primary target platform)

## Quick Start

```bash
npm install
npm run dev
```

Development mode starts both Electron main and renderer processes, suitable for UI and interaction debugging.

## Common Scripts

```bash
# Local development
npm run dev

# Build artifacts (without installer packaging)
npm run build

# Package release (electron-builder)
npm run dist

# Preview built result
npm run start

# Type checking
npm run typecheck

# UI tests
npm run test:ui

# Update snapshots
npm run test:ui:update
```

## Project Structure

```text
src/
  main/         # Electron main process: window/protocol/IPC/export service
  preload/      # Security bridge layer exposing APIs to renderer
  renderer/     # React UI: preview/timeline/inspector/export dialog
  shared/       # Shared types and timeline utilities across processes
```

## Media Pipeline Notes

- Uses `ffprobe` to read media metadata (duration, codec, resolution, sample rate, etc.).
- Automatically generates proxy files for some preview-unfriendly assets (without touching source files).
- Timeline can render video thumbnails and audio waveforms for faster editing feedback.
- Export jobs run in the main process, and progress is sent back through IPC.

## License

MIT
