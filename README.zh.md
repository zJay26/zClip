# zClip

<p align="center">
  <img src="./docs/icon/zClip.png" alt="zClip icon" width="96" />
</p>

[English README](./README.md)

zClip 是一个面向 Windows 的本地视频剪辑工具，强调「上手快、流程短、离线处理」。

由于平时经常会遇到一些简单剪辑需求，专门启动 PR 显得过于笨重；而一些便捷剪辑软件又可能在关键环节用 VIP 限制功能（比如导出）。所以我决定自己 Vibe Coding 一个轻量级的视频剪辑工具。  
项目按 MIT 协议开源，欢迎下载使用，也欢迎基于它做二次开发。

项目基于 Electron + React 构建，使用 FFmpeg 进行媒体解析与导出，适合快速裁剪、拼接和导出常见视频/音频素材。

## 演示

<p align="center">
  <img src="./docs/demo/demo.webp" alt="zClip 演示" />
</p>

## 下载

> 当前仓库版本：`2.1.0`

<p align="center">
  <a href="https://github.com/zJay26/zClip/releases/download/v2.1.0/zClip.Setup.2.1.0.exe">
    <img src="https://img.shields.io/badge/Download_for_Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows"/>
  </a>
</p>

## Windows 首次运行提示

zClip 目前未进行商业代码签名，首次下载运行时 Windows 可能提示风险警告，这是正常现象。

可按以下步骤继续：
1. 点击“更多信息”
2. 选择“保留”
3. 再次点击“更多信息”
4. 选择“仍然保留”

## Windows 右键菜单（可选）

如果你希望把“用 zClip 打开文件”添加到 Windows 右键一级菜单，推荐使用 **Custom Context Menu**，实测可用。

## 核心特性

- 本地离线处理：素材不上传云端
- 多文件导入：支持文件选择、拖拽导入、系统/命令行打开文件
- 多轨时间线：视频轨 + 音频轨，支持增减轨道、吸附、缩放
- 常用编辑能力：分割、复制/剪切/粘贴、删除、撤销/重做
- 参数调整：片段裁剪（Trim）、倍速（0.1x~16x）、音量（0%~1000%）、音调（25%~400%）
- 导出能力：
  - 视频格式：`mp4` / `mov` / `mkv` / `webm` / `gif` / `webp`
  - 音频格式：`mp3` / `wav` / `flac` / `aac` / `opus`
  - 分辨率档位：`original` / `1080p` / `720p` / `480p`
  - 质量档位：`high` / `medium` / `low`
  - 支持导出进度展示与取消导出

## 快捷键

| 操作 | 快捷键 |
| --- | --- |
| 播放 / 暂停 | `Space` 或 `K` |
| 后退 5 秒 | `J` |
| 前进 5 秒 | `L` |
| 向后单帧 / 1 秒（按住 Shift） | `←` / `Shift + ←` |
| 向前单帧 / 1 秒（按住 Shift） | `→` / `Shift + →` |
| 分割（播放头位置） | `C` |
| 复制选中片段 | `Ctrl/Cmd + C` |
| 剪切选中片段 | `Ctrl/Cmd + X` |
| 粘贴片段 | `Ctrl/Cmd + V` |
| 删除选中片段 | `Backspace` / `Delete` |
| 撤销 | `Ctrl/Cmd + Z` |
| 重做 | `Ctrl/Cmd + Y` 或 `Ctrl/Cmd + Shift + Z` |

## 技术栈

- 桌面端框架：Electron + electron-vite
- 前端：React 18 + TypeScript + Tailwind CSS
- 状态管理：Zustand
- 媒体能力：FFmpeg / FFprobe（通过 `@ffmpeg-installer/ffmpeg` 和 `@ffprobe-installer/ffprobe`）
- 测试：Vitest + Testing Library（JSDOM）

## 环境要求

- Node.js 18+（推荐 LTS）
- npm 9+
- Windows 10/11（当前主要目标平台）

## 快速开始

```bash
npm install
npm run dev
```

开发模式会启动 Electron 主进程与渲染进程，适合进行 UI 与交互调试。

## 常用脚本

```bash
# 本地开发
npm run dev

# 构建产物（不打安装包）
npm run build

# 打包发布（electron-builder）
npm run dist

# 预览构建结果
npm run start

# 类型检查
npm run typecheck

# UI 测试
npm run test:ui

# 更新快照
npm run test:ui:update
```

## 项目结构

```text
src/
  main/         # Electron 主进程：窗口、协议、IPC、导出服务
  preload/      # 安全桥接层：向渲染进程暴露 API
  renderer/     # React UI：预览、时间线、参数面板、导出弹窗
  shared/       # 主进程与渲染进程共享类型与时间线工具
```

## 媒体处理说明

- 使用 `ffprobe` 读取素材元数据（时长、编码、分辨率、采样率等）。
- 针对部分不利于预览的素材会自动生成代理文件用于播放（不影响原文件）。
- 时间线可生成视频缩略条与音频波形预览，提升编辑反馈速度。
- 导出任务由主进程执行，进度通过 IPC 回传到渲染层。

## 许可证

MIT
