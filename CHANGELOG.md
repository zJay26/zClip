# Changelog

All notable changes to zClip are documented in this file.

## [2.2.1] - 2026-07-16

### Fixed

- Ensure the Windows title-bar close button and taskbar "Close window" action fully exit zClip.

## [2.2.0] - 2026-07-16

### Added

- Project files (`.zclip`), recent-project management, and autosave recovery.
- Canvas settings plus clip transform controls for position, scale, and rotation.
- Video transitions and per-clip audio fades.
- Expanded export controls for timeline, selection, or custom ranges, with custom encoding options and progress/ETA feedback.
- Media metadata handling, cache/job management, project validation, IPC/media access safeguards, and a Windows CI workflow.

### Changed

- Refined the timeline, preview, inspector, toolbar, and export workflow.
- Updated the desktop toolchain to Electron 43, electron-vite 5, Vite 7, and Vitest 4.
- The Windows installer artifact is now consistently named `zClip.Setup.<version>.exe`.

[2.2.0]: https://github.com/zJay26/zClip/compare/v2.1.0...v2.2.0
[2.2.1]: https://github.com/zJay26/zClip/compare/v2.2.0...v2.2.1
