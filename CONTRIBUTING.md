# 参与 zClip

感谢你愿意帮助 zClip 变得更好。这里不要求先熟悉整套代码；能把问题说清楚、给出可复现素材或补充文档，同样是很有价值的贡献。

## 从哪里开始

- 使用问题和经验分享：前往 [Discussions](https://github.com/zJay26/zClip/discussions)
- 可复现的 Bug：使用 [Bug report](https://github.com/zJay26/zClip/issues/new/choose)
- 新功能想法：先提交 Feature request 或在 Discussions 说明它解决的实际麻烦
- 安全问题：不要公开提交，请按 [SECURITY.md](./SECURITY.md) 使用 Private Vulnerability Reporting

提交前请先搜索现有 Issue 和 Discussion，避免重复。Bug 报告至少应包含 zClip 版本、Windows 版本、复现步骤、预期结果和实际结果；能公开分享时，再附一份最小测试素材或项目文件。

## 修改代码

环境要求：Windows 10/11 x64、Node.js 22.12+、npm 10+。

```bash
npm install
npm run dev
```

提交 Pull Request 前运行：

```bash
npm run check
npm run pack:dir
npm run check:packaged
```

如果修改 README 模板或版本号，还需要运行：

```bash
npm run readme:generate
```

请不要直接编辑生成后的 README 而遗漏 `docs/templates` 中的源模板，也不要提交 `release/`、`out/`、证书、密码、私人媒体或包含个人路径的项目文件。

## Pull Request 约定

- 一个 PR 解决一个清晰问题；说明“为什么改”和用户能感知到什么
- 行为变化要补测试，界面变化请附截图
- 保持旧 `.zclip` 项目可打开；确需破坏兼容时，先在 Issue 中讨论迁移方案
- 不要关闭 Electron sandbox、context isolation、CSP、能力授权或成品校验来绕过问题
- 同意项目按 [MIT License](./LICENSE) 发布你的贡献

## English summary

Please search existing Issues and Discussions before opening a new one. Bug reports should include the zClip version, Windows version, reproduction steps, expected behavior, and actual behavior. Before submitting code, run `npm run check`, `npm run pack:dir`, and `npm run check:packaged`. Keep generated README files in sync with their templates, preserve `.zclip` compatibility, and never commit credentials or private media.
