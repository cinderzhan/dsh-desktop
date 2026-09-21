# DSH 工作台作者指南：把需求交给 AI，开发、验收与发布

版本：2026-09-21 · 随本机 DSH Desktop 分发，以当前安装版本为准。

**个人使用：开发 → 本机安装验收。公开到市场：提交到自己的 GitHub 仓库，再向 awesome-dsh-workbench 提交一个 YAML 的 PR。**之后正常发版，不需要每次再提 PR。

## 1. 直接交给 AI 的任务

开发时可以把需求与本文一起交给 AI：

> 按这份指南开发我的 DSH 工作台。先检查当前项目、DSH Desktop 版本和可用接口，复用真实接口；完成必要测试、打包、本机安装，并实际打开验证。保留现有业务数据和会话，不擅自公开代码。最后告诉我哪些已验证、哪些仍未完成。

开发完成，决定公开到市场时可以说：

> 按这份指南把工作台提交到公共市场。先确认待公开的仓库和内容，用我已授权的 GitHub/npm 身份发布，然后向 awesome-dsh-workbench 提交收录 PR，并核对真实结果。缺少凭证或公开授权时，先完成能完成的部分，再说明缺什么，不能说已经上架。

AI 从项目读取名称、作者、仓库、版本、说明和测试命令，只询问查不到的必要信息。开发请求本身不代表授权公开私有仓库、商业数据或凭证。

## 2. 开发前检查

- 确认项目根目录、已有代码、未提交修改、包管理器、脚本和目标 Desktop 版本；不要覆盖别人的修改。
- 本机指南入口是 `GET /api/desktop-workbenches/author-guide`，挂在实际运行的 Desktop 服务地址下，不要假设固定端口。
- 确认目标平台与架构，区分 JS/TS 包、外部程序和原生依赖。缺少宿主或工具链时明确说明，不能只凭构建通过就说能运行。

## 3. 工作台的基本规则

工作台是一个 DSH 插件，提供业务面板，并复用 Desktop 的原生会话。业务布局可以自行设计；市场、设置、侧边栏等公共入口由 Desktop 负责。

注册方式示意（先确认当前宿主有这个接口）：

```js
ctx.effect(() => ctx.desktopWorkbenches.register({
  id: 'my-workbench',
  title: '我的工作台',
  icon: '◇',
  panelTitle: '业务面板',
  description: '说明它解决什么问题',
  audience: '适用用户',
  requirements: '所需原生配置'
}, BusinessPanel))
```

这只是注册部分，不是完整项目。先读取项目的插件模板、`package.json` 和 `cordis.patch.yml`。

交互要求：

1. 打开工作台就显示业务面板；没有会话或工作区时也能浏览、创建和选择业务资料。
2. 一条会话最多属于一个工作台；只有工作台内部明确创建或恢复会话时，才通过宿主登记归属。不要改写原生历史会话的归属。
3. 原生“新建会话”创建普通会话，不因为当前开着工作台就自动绑定。
4. 发起工作台 Agent 请求、写入会话草稿前，检查当前会话归属；不符合时引导创建或恢复，不阻断其他业务操作。
5. 创建失败可以重试，取消目录选择不创建会话。异步完成后不能把已经离开的用户拉回来。
6. 切换工作台保留业务数据、会话和草稿；关闭视图不等于卸载。
7. 使用 `customFrame` 时，把原生 conversation 放进业务布局，不重复创建聊天；拖动、最大化等都限制在宿主内容区域内，不遮挡侧边栏。
8. 关闭视图、取消收藏、卸载都保留业务文件与会话；清除业务数据必须是单独、明确的操作。

## 4. 打包与说明材料

- 仓库根目录只放一个工作台（暂不支持 monorepo 子目录）。
- `package.json` 包含 `dsh.bundle.patch` 及其指向的 `cordis.patch.yml`；`repository` 指向真实作者仓库（npm 映射据此核对）。
- 工作台描述文件为 manifest v1，版本与 `package.json` 一致；工作台 id 与注册 id 一致，并保持稳定。
- 打包后不超过 8 MiB；排除 `.env`、token、客户数据、数据库、本机绝对路径和不应公开的素材。
- 按项目真实脚本构建打包；有 `scripts/check-workbench-package.mjs` 时用它检查，没有就不要声称运行过。
- 说明外部依赖、需要执行的安装或构建脚本、网络访问和本地数据位置。

## 5. 本地安装与验收

用当前 Desktop 可用的插件安装方式安装。先检查真实的 CLI 帮助或宿主工具，不猜命令。安装脚本默认不执行；必须执行时，向用户说明具体包、版本、来源和用途，逐项取得授权。

检查：

- 工作台出现在“已安装的工作台”中，能打开，名称和作者正确。
- 主要业务操作可用；没有会话时能看业务面板，需要会话的操作有正确引导。
- 原生新会话保持未绑定；工作台内创建或恢复的会话归属正确，切换后业务资料不串。
- 关闭、重开、切换工作台后草稿和数据都在；侧边栏不被遮挡。
- 重启 Desktop 后仍能加载，实际运行版本就是要发布的版本。
- 记录 Desktop 版本、操作系统和架构、测试结果和未验证项。

本机可用就可以自己使用，不需要公开仓库或提交市场。

## 6. 公开发布：先准备作者自己的发布源

确认用户已授权公开源码和安装包，使用作者自己的公共 GitHub 仓库。安装来源按以下顺序由市场自动选择：

| 方式 | 作者要做什么 |
|---|---|
| npm 包 | 发布真实版本；`package.json.name` 与 npm 包名一致，`repository` 指回该仓库 |
| GitHub Release 安装包 | 上传 `.tgz` / `.tar.gz`，并在 YAML 的 `tarball` 中填写地址 |
| GitHub 源码 | 默认分支包含可直接安装的入口和 bundle patch（目录不会替作者编译） |

私有仓库不能收录到公共市场，但可以继续在本机或团队内部使用。

## 7. 首次市场收录 PR

向 [awesome-dsh-workbench](https://github.com/dataelement/awesome-dsh-workbench) 提交 PR。

新增一个文件 `data/workbenches/<owner>__<repo>.yml`，格式以该仓库 `catalog/README.md` 为准：

```yaml
url: https://github.com/owner/repo
name: 项目助手
category: productivity
description:
  zh: 帮助整理项目资料、跟进任务并生成工作报告。
  en: Organize project materials, track tasks, and generate work reports.
screenshots:
  - https://raw.githubusercontent.com/owner/repo/main/docs/images/overview.webp
# 可选：没有 npm 时指定 Release 安装包
# tarball: https://github.com/owner/repo/releases/latest/download/my-workbench.tgz
```

- `category` 从仓库的 7 个分类中选择；中英文简介都必填。
- 截图 1–5 张，放在自己仓库中，填写完整 HTTPS 地址；PNG/JPEG/WebP，单张不超过 2 MiB，必须是真实产品画面。
- 不要填写版本、npm 包名、校验值等，这些由自动探测得到；不要修改生成的文件。
- PR 描述写用途、本机验收结果、验证过的 Desktop 版本和平台。

提交 PR 就是进入审核。根据检查结果修改，确认最新提交通过。只创建 PR 时报告“已提交”，合并后报告“已合并，等待目录发布”，在市场目录中能看到条目后才报告“已上架”。

## 8. 后续版本更新

- npm：发布新版本即可，市场自动发现，不需要 PR。
- Release：使用 `releases/latest/download/<固定文件名>` 时，新版本保持同样的文件名即可；地址变化时需要 PR 修改 `tarball`。
- 源码：更新默认分支，市场会发现新的 commit。
- 修改名称、分类、简介、截图地址或仓库地址时提 PR。

每个版本都由作者自己测试和在本机验收。

## 9. 失败时如何交付

AI 最后列出真实结果和证据：本地文件、包版本、验收结果、发布地址、PR 地址、目录是否可见。缺哪一项就写哪一项，不虚构成功。凭证缺失、发布失败或网络不通时，保留已完成的代码和材料，说明原因和下一步。

本机不保存投稿状态：提交 PR 就是进入审核，进度以 GitHub 上的 PR 为准。
