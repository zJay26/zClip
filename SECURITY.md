# 安全策略

请不要在公开 Issue 中披露可被利用的安全问题。请通过 GitHub 的 [Private Vulnerability Reporting](https://github.com/zJay26/zClip/security/advisories/new) 提交报告，并附上受影响版本、复现步骤和影响评估。

当前仅维护最新发布版本。安全修复会优先升级 Electron 运行时，并在 Windows 安装包完成导入、项目读写和导出回归后发布。

项目文件和媒体文件均按不可信输入处理；渲染进程不应直接获得 Node.js 或任意文件系统能力。

## 安全边界

- Renderer 启用 sandbox、context isolation，并关闭 Node integration。
- 严格 CSP 禁止任意网络、frame、worker、object 和 form；窗口导航、弹窗、权限与外部链接均使用 allowlist/deny-by-default。
- 生产界面由受限的 `zclip-app://` 协议提供，只允许 ASAR Renderer 目录中的入口和静态资源，拒绝目录穿越、未知 host 与超限文件。
- 打包阶段启用 ASAR 完整性校验、OnlyLoadAppFromAsar，并关闭 RunAsNode、NODE_OPTIONS 与 Node 调试参数 fuses。
- Main 仅接受主窗口 main frame 的 IPC；媒体、项目和导出路径必须来自用户选择、拖拽或已打开项目所授予的能力。
- 项目 JSON、媒体探测、预览请求和 FFmpeg stderr/stdout 均设置结构、数量、大小或超时上限。
- 导出不会直接写入既有成品；临时文件验证成功后才替换目标，取消或失败只清理本次临时文件。
- 最终安装包仅携带逐文件 SHA-256 锁定的 FFmpeg/FFprobe、来源元数据和许可证，不携带其下载/安装依赖树。

依赖和原生媒体工具可分别通过 `npm audit` 与 `npm run check:native` 复核。Release 工作流会明确区分签名与未签名发布：两个签名 Secrets 同时存在时要求 Authenticode 状态为 `Valid`，同时缺失时要求状态为 `NotSigned` 并生成 `SIGNING_STATUS.txt`，只配置一个 Secret 时直接失败。流程还会对 unpacked 成品执行真实启动/退出 smoke test，并输出安装包校验和与完整 CycloneDX SBOM。FFmpeg 的再分发条款见 `THIRD_PARTY_NOTICES.md`。
