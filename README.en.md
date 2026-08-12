<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/latest">
    <img src="./docs/icon/zClip.png" alt="zClip icon" width="144" />
  </a>
</p>

<h1 align="center">zClip</h1>

<p align="center"><strong>For the edits that should take minutes—not a full professional editing setup or a paywall at export.</strong></p>
<p align="center">zClip is a free, open-source video editor for Windows. Your media stays on your computer, and the everyday editing workflow stays short.</p>
<p align="center"><em>本地、离线、无订阅的 Windows 视频剪辑器。</em></p>

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/latest"><img src="https://img.shields.io/github/v/release/zJay26/zClip?style=flat-square" alt="Latest release" /></a>
  <a href="https://github.com/zJay26/zClip/releases"><img src="https://img.shields.io/github/downloads/zJay26/zClip/total?style=flat-square" alt="Total downloads" /></a>
  <a href="https://github.com/zJay26/zClip/actions/workflows/ci.yml"><img src="https://github.com/zJay26/zClip/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/zJay26/zClip?style=flat-square" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/download/v2.6.0/zClip.Setup.2.6.0.exe"><strong>Download for Windows</strong></a>
  ·
  <a href="#demo">Demo</a>
  ·
  <a href="#start-editing-in-three-steps">Get started</a>
</p>

> [!WARNING]
> The Windows installer for `v2.6.0` is not commercially code-signed. Windows may show an “Unknown publisher” or SmartScreen warning. Download only from this repository and verify it with `SHA256SUMS.txt`; see [First launch on Windows](#first-launch-on-windows).

## The problems zClip is built for

- **A small edit should not require a heavyweight setup.** Trim an intro, join a few clips, or add music without starting a large NLE and creating a full project first.
- **Export should not be the paywall.** zClip has no login, VIP quality tier, export quota, or subscription.
- **Private footage should stay private.** Media analysis, preview, and export happen locally instead of uploading your files to an online service.
- **The common path should be obvious.** Import, arrange, trim, and export without learning a course first.

## Who it is for

- Windows users editing lessons, meetings, screen recordings, game clips, or social media footage
- Creators who need quick trimming, joining, audio adjustments, or format conversion
- Anyone who prefers local processing for personal or work media
- Developers looking for a complete Electron + FFmpeg desktop project to study or extend

## Demo

<p align="center">
  <img src="./docs/demo/demo.webp" alt="zClip workflow demo" />
</p>

## Download

Current version: `2.6.0`. Supported platform: Windows 10/11 x64.

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/download/v2.6.0/zClip.Setup.2.6.0.exe">
    <img src="https://img.shields.io/badge/Download_for_Windows-6D5DFB?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows" />
  </a>
</p>

- [Read the release notes](https://github.com/zJay26/zClip/releases/tag/v2.6.0)
- [Download SHA-256 checksums](https://github.com/zJay26/zClip/releases/download/v2.6.0/SHA256SUMS.txt)
- [Check the signing status](https://github.com/zJay26/zClip/releases/download/v2.6.0/SIGNING_STATUS.txt)

## Start editing in three steps

1. Open zClip and drag video or audio into the window, or choose **Open files**.
2. Split, move, and trim clips on the timeline; adjust visuals, speed, volume, pitch, fades, or transitions as needed.
3. Choose **Export**, select a format and quality, and let your computer process the result.

Projects can be saved as `.zclip` files and reopened by double-clicking. Autosave, recent-project recovery, and missing-media relinking are included.

## What it can do

- Import multiple video and audio files into a multi-track timeline
- Split, copy, cut, paste, delete, undo, and redo
- Set canvas size, background, and FPS; position, scale, and rotate clips
- Adjust trim range, speed, volume, pitch, and audio fades
- Apply seven transitions and position footage directly in the preview
- Export the full timeline, selected clips, or a custom range with progress, speed, and ETA

### What is new in v2.6.0

- Reworked transition playback to remove black frames, jumps, and stalls around edit points
- More forgiving transition drops, clearer selection and parameter controls, and duration-preserving replacement
- Fixed detached and deleted audio continuing to play from its former video clip
- Much faster exports for high-speed clips, simple sequential edits, GIF, WebP, VP9, and wipe transitions
- Runtime detection for NVENC, QSV, and AMF with safe software fallback

## What it does not try to replace

zClip is designed for quick everyday editing. It is not currently aimed at professional color grading, complex compositing, multi-camera collaboration, plugin ecosystems, or cross-platform production. Premiere Pro, DaVinci Resolve, and other professional NLEs are better choices for those workflows.

## Export formats

- Video and animation: `mp4`, `mov`, `mkv`, `webm`, `gif`, `webp`
- Audio: `mp3`, `wav`, `flac`, `aac`, `opus`
- Resolution: original, 1080p, 720p, 480p
- Quality: ultra high, high, medium, low, ultra low, and custom

## First launch on Windows

The current installer does not have a commercial Authenticode certificate, so your browser or Windows SmartScreen may show a warning:

1. Confirm that the file came from the Releases page at `github.com/zJay26/zClip`.
2. Compare the installer SHA-256 with `SHA256SUMS.txt`.
3. If SmartScreen blocks it, select **More info**, confirm the app name is zClip, and choose **Run anyway**.

Unsigned does not mean malware was detected; it means Windows cannot verify a commercial publisher identity. Every release includes checksums, signing status, third-party notices, and an SBOM for independent verification.

## FAQ

<details>
<summary>Does zClip need an account or internet connection?</summary>

No. Editing and export are local, and there is no account system. Internet access is only needed to download the app or updates from GitHub.

</details>

<details>
<summary>Why does Windows warn me on first launch?</summary>

The installer does not yet use a paid commercial code-signing certificate. Download it from the official Release and verify its SHA-256; the signing state is published with every release.

</details>

<details>
<summary>Can I open older .zclip projects?</summary>

Yes. The project schema remains v1, and projects without an FPS setting open at the 30 FPS default.

</details>

<details>
<summary>Does it run on macOS or Linux?</summary>

The currently supported release target is Windows 10/11 x64. Other platforms do not yet have validated packages.

</details>

## Keyboard shortcuts

<details>
<summary>Show shortcut table</summary>

| Action | Shortcut |
| --- | --- |
| New project | `Ctrl/Cmd + N` |
| Open project | `Ctrl/Cmd + O` |
| Save / Save as | `Ctrl/Cmd + S` / `Ctrl/Cmd + Shift + S` |
| Play / pause | `Space` or `K` |
| Seek backward / forward 5 seconds | `J` / `L` |
| Previous / next frame | `←` / `→` |
| Previous / next second | `Shift + ←` / `Shift + →` |
| Split at playhead | `C` |
| Copy / cut / paste | `Ctrl/Cmd + C` / `X` / `V` |
| Delete | `Backspace` or `Delete` |
| Undo / redo | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Y` |

</details>

## For developers

### Requirements

- Node.js 22.12+
- npm 10+
- Windows 10/11 x64

```bash
npm install
npm run dev
```

Common validation commands:

```bash
npm run check
npm run pack:dir
npm run check:packaged
```

The stack is Electron, React, TypeScript, Zustand, Tailwind CSS, and hash-pinned FFmpeg/FFprobe 8.1.2. See the [architecture notes](./docs/architecture.md) for trust boundaries and the media pipeline.

## Join the project

- Found a bug? Use the [Bug report form](https://github.com/zJay26/zClip/issues/new/choose).
- Have an idea? Start a [Discussion](https://github.com/zJay26/zClip/discussions) or submit a feature request.
- Want to contribute code? Read [CONTRIBUTING.md](./CONTRIBUTING.md).
- Found a security issue? Do not open a public issue; read [SECURITY.md](./SECURITY.md).
- Curious about priorities? See [ROADMAP.md](./ROADMAP.md).

If zClip saved you time, consider giving the repository a Star. It helps other people with the same “small edit, big tool” problem find it.

## License

[MIT](./LICENSE) © zJay26
