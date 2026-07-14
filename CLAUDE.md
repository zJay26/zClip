# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在本仓库中工作时提供指导。

## 构建与开发命令

```bash
npm run dev              # 启动 Electron + Vite 开发模式（热重载）
npm run build            # 生产构建（electron-vite）
npm run start            # 预览构建后的应用
npm run typecheck        # TypeScript 类型检查（node + web）
npm run typecheck:web    # 仅渲染进程类型检查
npm run typecheck:node   # 仅主进程类型检查
npm run test:ui          # 运行 Vitest 测试
npm run test:ui:update   # 运行测试并更新快照
npm run dist             # 打包 NSIS 安装程序
npm run readme:generate  # 生成动图演示 README
```

## 架构（Electron + React + FFmpeg）

### 分层结构

```
src/main/          # Electron 主进程（Node.js）
src/preload/       # contextBridge 安全隔离层
src/renderer/      # React UI（Chromium）
src/shared/        # 共享类型与纯工具函数（两端共用）
```

### 数据流

- **单一 Zustand Store**（`src/renderer/src/stores/project-store.ts`）管理所有应用状态：片段、时间轴、操作、撤销/重做历史、导出状态。
- **Preload 桥接**（`src/preload/index.ts`）通过 `window.api` 暴露 IPC——渲染进程从不直接访问 Node.js。
- **IPC 处理**（`src/main/ipc/`）在主进程中注册：媒体探测、项目文件读写、导出任务。
- **操作**是 `MediaOperation[]` 数组（trim、speed、volume、pitch、transform、fade），按片段 ID 挂载在 `operationsByClip` 中。
- **时间轴导出**按范围裁剪片段，通过 `export-service.ts` 中的 `buildTimelineFFmpegArgs` 构建 FFmpeg 滤镜图，spawn 进程并上报进度。

### 主进程（`src/main/`）

- `index.ts` — 窗口创建、`local-media://` 协议注册、单实例锁、CLI 文件解析
- `services/ffmpeg.ts` — 薄封装层：`probe()` 读取元数据，`runFFmpeg()` 执行并解析进度
- `services/media-engine.ts` — 将单片段 `MediaOperation[]` 翻译为 FFmpeg 参数（滤镜图）
- `services/export-service.ts` — 多片段时间轴导出：范围裁剪、filter_complex 构建、分辨率/质量映射、ETA 计算
- `services/audio-filters.ts` — 构建音频滤镜链（atempo、asetrate、volume），大范围变速时自动倍频
- `services/project-files.ts` — `.zclip` 项目 JSON 读写、自动保存、最近打开记录
- `services/media-preview.ts` / `media-proxy.ts` — 缩略图/波形生成、代理文件管理

### 渲染进程（`src/renderer/src/`）

- **布局**：`AppLayout.tsx` — 主框架（键盘快捷键、拖拽导入、自动保存、工具栏 + 预览 + 时间轴）
- **组件**：`Timeline/*`、`Controls/*`（Trim、Speed、Volume、Pitch、Transform、Fade、Canvas）、`Preview/VideoPreview`、`Export/ExportDialog`
- **Hooks**：`useVideoPlayer.ts` — requestAnimationFrame 驱动的时间轴播放头及音频同步；`useAudioPlaybackEngine.ts` — Web Audio API + soundtouchjs 实现变速不变调播放；`useExport.ts` — 导出生命周期（对话框、IPC 事件、进度）
- **Store 辅助**：`project-store-helpers.ts` — 快照/恢复、裁剪边界、轨道管理；`timeline-overlap.ts` — 片段重叠碰撞解决；`merge-selection.ts` — 片段合并校验逻辑
- **UI 基础组件**位于 `components/ui/`：Button、Badge、Dialog、Panel、SectionCard、ProgressBar

### 共享层（`src/shared/`）

- `types.ts` — 所有接口定义：TimelineClip、MediaInfo、MediaOperation（可辨识联合类型）、ExportOptions、ProjectData、IPC 频道常量
- `timeline-utils.ts` — 纯时间模型函数：裁剪/变速计算、可见时长、叠加顺序、时间点查片段
- `media-info-utils.ts` — FFprobe JSON → MediaInfo 解析器（正确处理音频文件中的封面图，不将其视为视频流）

## 关键模式

- **媒体操作**独立启用/禁用；导出和预览均检查 `op.enabled`
- **撤销/重做**使用基于快照的历史记录（`ProjectSnapshot`），存储在 `historyPast[]` / `historyFuture[]` 中
- **链接组**在移动、裁剪、删除、变速等操作中保持视频+音频配对同步
- **时间轴重叠解决**（`resolveClipOverlaps`）自动将重叠片段向右推；活动片段（正在拖拽/裁剪的）拥有优先权
- **音频播放**正常播放使用 `<audio>` 元素，变调片段使用 soundtouchjs `PitchShifter`，两者均通过 Web Audio API 路由以实现增益控制
- **导出进度**从 FFmpeg stderr 解析（`time=` 和 `speed=` 正则），ETA 通过最近样本中位数平滑
- **路径别名**：`@shared` → `src/shared`，`@renderer` → `src/renderer/src`
