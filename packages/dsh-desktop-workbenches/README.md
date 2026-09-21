# dsh-desktop-workbenches

Desktop host plugin for the Awesome DSH Workbench market, local workbench state, navigation and the native conversation frame.

Market metadata comes exclusively from the published Awesome protocol v2 index. Runtime providers register their own component and runtime ID. A provider that wants to be recognized as the installed form of an Awesome entry must include the canonical GitHub URL in its registration descriptor's `repository` field.

The host does not bundle a separate catalog or third-party workbench packages. Catalog installation is outside this package's current scope; unloaded entries link to their source repository.

## 规范的唯一公开入口

对工作台作者和 Agent 公开的唯一指南是随当前 DSH Desktop 版本分发的 `development-guide.zh.md`，覆盖开发、本机验收、首次市场收录和后续版本更新。它由 `docs/workbench-author-guide.zh.md` 生成，勿单独修改生成副本。GitHub 工作台市场仓库负责收录 PR 的材料和审核清单。

Desktop 内的指南阅读器与 Agent 都请求 `/api/desktop-workbenches/author-guide`（兼容别名 `/api/desktop-workbenches/development-guide`），得到同一份 Markdown。阅读器在当前工作台市场内渲染内容，不打开额外的 Electron 子窗口。
