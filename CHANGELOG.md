# Changelog

All notable changes to zClip are documented in this file.

## [Unreleased]

## [2.5.0] - 2026-08-02

### Added

- Add persistent dark/light themes and Chinese/English interface switching without changing project files.
- Add project FPS controls, direct preview positioning with pointer/keyboard input, project open/save shortcuts, missing-media relinking, and safe Save/Discard/Cancel shutdown handling.
- Add `.zclip` file association and a renderer-ready handshake for reliable OS/second-instance opening.
- Add pinned FFmpeg/FFprobe 8.1.2 preparation with archive and per-binary SHA-256 verification, source metadata, native capability checks, release checksums, and CycloneDX SBOM generation.
- Add tag-based Windows release automation and real FFmpeg integration coverage for all export formats, all seven transitions, and independent audio speed/pitch/volume processing.
- Add Chinese-first and English READMEs, real interface demos, repository contribution guides, Issue Forms, a roadmap, support guidance, and community templates.

### Changed

- Compile distinct transition effects, video fades, canvas transforms, project FPS, range remapping, deduplicated media inputs, high-quality Rubber Band pitch shifting, and bounded audio mixing into timeline exports.
- Write exports and project files through verified, synchronized temporary files before replacing destinations; project saves also retain a backup.
- Stream preview audio instead of decoding whole files in renderer memory, cap retained controllers and native job concurrency, virtualize off-screen timeline content, and bound metadata/preview caches.
- Upgrade Electron and renderer dependencies within their compatible release lines and reduce the packaged native dependency tree.

### Security

- Enforce sandbox/context isolation, strict CSP, deny-by-default permissions/navigation, trusted-main-frame IPC, schema/resource limits, and capability-based media/project/export paths.
- Serve packaged renderer assets through a traversal-resistant `zclip-app://` allowlist instead of privileged `file://` loading; enable hardened Electron fuses and ASAR integrity validation.
- Pin GitHub Actions to immutable commits, fail partially configured signing credentials, and verify every release as either Authenticode `Valid` or explicitly `NotSigned`.
- Validate real paths, supported stream types, output/source identity, FFprobe output size/time, and native binary hashes before use.

### Fixed

- Prevent canceled exports from committing during verification and wait for native child-process shutdown on application exit.
- Preserve existing export destinations on failure, avoid source-file overwrite aliases, and verify the expected output stream before commit.
- Correct portrait geometry, transform coordinate scaling, transition rendering, orphan-video audio, audio fades after range slicing, and project frame stepping.
- Prevent conditional React Hook ordering, stale open-file events, dirty-state changes from playback metadata, unbounded audio element retention, and stale proxy/project-path mutations.

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
[2.5.0]: https://github.com/zJay26/zClip/compare/v2.4.0...v2.5.0
[Unreleased]: https://github.com/zJay26/zClip/compare/v2.5.0...HEAD
