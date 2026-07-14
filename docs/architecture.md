# zClip 架构边界

## 信任模型

- Renderer 只负责交互，不直接访问 Node.js。
- Preload 暴露最小化、带类型的 IPC API。
- Main 对 IPC 来源和运行时参数再次校验。
- `local-media://` 仅服务已由用户导入或项目文件声明的媒体路径。

## 媒体流水线

1. FFprobe 并发探测素材，先完成时间线导入。
2. 代理、缩略图和波形进入带去重与并发上限的后台任务队列。
3. 缓存按容量和最后修改时间回收，用户可从工具栏手动清理。
4. 导出先把时间线裁剪为纯数据，再编译为 FFmpeg filter graph。

## 数据可靠性

- `.zclip` 和 autosave 在主进程执行深度 schema 校验。
- 保存采用临时文件加原子重命名。
- 代理路径不写入项目文件；打开项目后重新探测原始素材。
- 撤销历史按事务记录并限制为最近 100 项。

## 验证层次

- Shared 时间模型和项目 schema 单元测试。
- 导出参数 golden test。
- Bundled FFmpeg 合成媒体 smoke test。
- Windows CI 执行 typecheck、Vitest 和 production build。
