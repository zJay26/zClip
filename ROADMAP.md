# zClip Roadmap

这份 Roadmap 说明当前优先级，不是带日期的功能承诺。zClip 会先把“快速完成一次日常剪辑”做稳，再考虑扩大功能边界。

## v2.5.0：可靠地完成一次剪辑

- [x] 深色 / 浅色模式
- [x] 中文 / English 界面切换
- [x] 项目 FPS、素材重新定位和 `.zclip` 双击打开
- [x] 媒体路径、IPC、项目读写和导出安全加固
- [x] 临时文件验证、失败保护和可取消导出
- [x] 长时间线、音频预览、媒体缓存和后台任务的资源上限
- [x] 可复核的 Windows Release：测试、打包检查、SBOM、来源与 SHA-256

## 当前优先级

1. 修复能够稳定复现的数据丢失、崩溃、导出错误和素材兼容问题。
2. 缩短“导入 → 剪辑 → 导出”的常用路径，减少需要解释的操作。
3. 改善大素材、长时间线和低配置 Windows 设备上的稳定性。
4. 补充新用户文档、示例和可自动验证的回归测试。

## 如何影响下一步

请在 [Discussions](https://github.com/zJay26/zClip/discussions) 描述你的真实场景：现在用什么工具、哪一步最麻烦、理想结果是什么。维护优先级会综合问题影响、复现质量、实现风险和社区反馈，而不是只按功能名字排队。

尚未进入本页的想法都不代表拒绝，也不代表已经承诺。跨平台、复杂合成、专业调色等大方向会先验证可行性和维护成本。

## English summary

The current priority is a reliable, short Windows workflow from import to export. Stability, data safety, format compatibility, and clear onboarding come before expanding into professional NLE territory. Share real use cases in Discussions to help shape future priorities.
