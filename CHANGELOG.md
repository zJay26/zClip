# Changelog

All notable changes to zClip are documented in this file.

## [2.4.0] - 2026-07-29

### Added

- Add `ultra_high` and `ultra_low` export quality presets alongside the existing high, medium, low, and custom options.
- Apply format-aware quality controls to every supported video, animated-image, and audio export format.
- Expand custom export controls for VP9 speed, WebP compression, GIF palettes and dithering, and WAV/FLAC sample rate, bit depth, and compression.

### Changed

- Make high quality the default export preset.
- Show the effective encoding parameters for each format and place format selection before quality selection.
- Share one quality-profile definition between the export UI and both FFmpeg export paths.

### Tests

- Add profile-matrix coverage and real bundled-FFmpeg export checks for all eleven supported formats.

## [2.3.0] - 2026-07-21

### Fixed

- Restore reliable MP3 and other local-media playback, including initial playback and seeking before metadata is ready.
- Ensure Windows title-bar and taskbar close requests fully exit the application.

### Changed

- Serve authorized local media through the dedicated `local-media://media` protocol with range-response support.
- Refine timeline track layout, zoom behavior, clip blocks, transitions, and audio-fade rendering.
- Add regression coverage for local-media responses and timeline track layout.

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
[2.3.0]: https://github.com/zJay26/zClip/compare/v2.2.1...v2.3.0
[2.4.0]: https://github.com/zJay26/zClip/compare/v2.3.0...v2.4.0
