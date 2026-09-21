# 工作台宿主维护说明

## 规范的唯一公开入口

对工作台作者和 Agent 公开的唯一开发合同是随当前 DSH Desktop 版本生成并分发的 `development-guide.zh.md`。它由 `docs/workbench-standard.zh.md`（产品规则）与 `docs/workbenches.md`（实现附录）生成；二者是仓库内维护源，不是两套相互竞争的公开规范。GitHub 工作台市场仓库仅负责投稿渠道、材料和审核清单，不覆盖工作台运行规则。

Desktop 内的规范阅读器与 Agent、自动化都请求 `/api/desktop-workbenches/state?include=development-guide`，并读取 JSON 的 `developmentGuide` 字段。该可选字段始终来自同一个生成 Markdown 文件；普通状态请求不会携带规范正文。阅读器在当前工作台市场内渲染内容，不再打开额外的 Electron 子窗口。

## 内置笔记入口退役

宿主不再注册 `research-notebook`（调研记录）和 `writing-notebook`（内容创作），因此它们不再出现在工作台市场中，也不能通过宿主添加或打开。其他插件仍可通过 `desktopWorkbenches.register` 注册工作台。

本次取消注册，并仅在展示层隐藏这两个退役 ID：旧用户的“我的工作台”、数量和侧栏均不显示它们。其他未知 provider 仍保留“插件未加载／不可用”的兜底展示。旧用户的 `notes`、`sessionBindings`、`recentSessions`、`added` 和 `pinned` 保留，不执行数据迁移或清理；加载状态及后续保存其他工作台时，不删除这些历史数据。历史会话仍可通过原生入口打开，不自动恢复笔记工作台。

`Notebook` 组件及通用笔记保存能力继续保留。`development-guide.zh.md` 由 `docs/workbench-standard.zh.md` 和 `docs/workbenches.md` 生成；修改源文档后运行 `node scripts/build-workbench-guide.mjs` 同步，勿单独修改生成副本。

针对性验证：

```sh
npx vitest run test/workbench-client.test.mjs test/workbench-state.test.mjs test/workbench-navigation.test.mjs test/workbench-guide-sync.test.mjs
```
