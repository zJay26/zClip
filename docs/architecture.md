# zClip 架构边界

## 信任模型

- Renderer 只负责交互，不直接访问 Node.js。
- Preload 暴露最小化、带类型的 IPC API。
- Main 只接受已注册主窗口的 main frame IPC，并校验 URL、参数、数据规模和引用关系。
- 生产包启用 sandbox、严格 CSP、权限拒绝策略、ASAR 完整性校验以及禁用 RunAsNode/Node 调试入口的 Electron fuses。
- 生产 Renderer 仅通过 `zclip-app://app/index.html` 加载 ASAR 内白名单资源；协议层阻止路径穿越并补充 CSP、Permissions-Policy、CORP 与 MIME 响应头，不依赖高权限 `file://`。
- 媒体、项目读写和导出路径分别使用能力授权；拖拽文件路径在 Preload 解析后仍需 Main 校验。
- `local-media://` 会先解析真实路径，仅服务已由用户导入或项目文件声明的媒体，并限制 method、origin、range 和 MIME。

## 媒体流水线

1. FFprobe 以并发上限、超时、输出上限和请求去重方式探测素材，先完成时间线导入。
2. 代理、缩略图和波形进入带去重与并发上限的后台任务队列。
3. 流式音频预览按需创建播放控制器并设置保留上限；缓存按容量和 LRU 时间回收，用户可从工具栏手动清理。
4. 导出先把时间线裁剪为纯数据，再编译为 FFmpeg filter graph；长图写入临时脚本，避免 Windows 命令行长度上限。
5. FFmpeg 输出到目标目录中的唯一临时文件，完成后经 FFprobe 验证、`fsync`，最后才替换目标文件。
6. 取消会同时终止编码与验证阶段；应用退出会等待导出和预览子进程回收，避免后台残留进程。

## 数据可靠性

- `.zclip` 和 autosave 在主进程执行深度 schema、路径授权和资源规模校验。
- 保存采用同目录临时文件、`fsync`、备份和原子重命名；写入按目标路径串行化。
- 代理路径不写入项目文件；打开项目后重新探测原始素材。
- Renderer 注册好外部打开监听器后才发送 ready 握手，避免首启或二次启动传入的媒体/项目路径丢失。
- 撤销历史按事务记录并限制为最近 100 项。

## 验证层次

- Shared 时间模型和项目 schema 单元测试。
- 导出参数 golden test。
- Bundled FFmpeg 合成媒体、全部导出格式、音调链和七种转场集成测试。
- Windows CI 使用固定 commit 的 Actions，执行 dependency audit、typecheck、Vitest、native-tool hash/inventory、production build 和真实启动/退出的 unpacked package smoke test；tag 发布再次验证成品，并生成 checksum 与包含构建期和被 Vite 打包依赖的完整 SBOM。
