# 花学工作台接入审查

日期：2026-09-20。范围：本地 Desktop 工作台市场接入，不是公开发布或远程市场审核通过。2026-09-20 根据用户提供的 `huaxue-source-review.zip` 再次复核原始 `0.2.0` 产物并重做界面接入层。

## 来源与目标

- 上游：https://github.com/gjz18342624299-arch/dsh-huaxue-workbench
- 审查基线：`2c770bd12fac52dcf243c23faa3d9396b3cfcdda`（原版本 `0.3.0-rc.1`）。
- 本地适配源码：相邻目录 `dsh-huaxue-workbench`，改动尚未推送上游。
- Desktop 集成分支：`feat/dsh-desktop-integrated`。
- 保留角色选择、角色切换、原生聊天和第八位嘉宾游戏；公共导航和会话归属由 Desktop 管理。
- 原始包中的 `games.json`、`personas.json` 与当前适配包业务数据 SHA-256 一致；人物、场景、游戏和背景编辑继续以原始版本为准。Desktop 只替换宿主、会话归属和外层布局。
- 取消 `research-notebook`（调研记录）、`writing-notebook`（内容创作）的内置注册。保留旧笔记、会话绑定和持久化记录，不删除用户数据。内容运营工作台不是内容创作示例，不在移除范围内。

## 需要整改的地方

| 优先级 | 原有问题 | 接入要求 |
| --- | --- | --- |
| P0 | 自带 `dsh-local-workbenches` 宿主与侧栏/main/overlay 注册，未接 Desktop 市场 | Desktop 入口只注册 `desktopWorkbenches` provider，不启动第二套宿主 |
| P0 | 角色提示词依赖独立 `dsh-workbenches` settings 归属，与 Desktop state.json 不一致 | 通过服务端只读 `desktopWorkbenchOwnership.read()` 读取同一个已持久化快照；未归属或已移除时不注入角色 |
| P0 | 原插件直接控制原生会话创建、打开及游戏隔离 | 所有工作台会话先记录归属，异步创建不抢回新导航，隐藏工作台不改动前台会话 |
| P1 | 部分浮层挂载到 document.body，可越出工作台主区域 | 复用宿主传入的 conversation，浮层约束在工作台边界内，侧栏和设置始终可用 |
| P1 | 第一版 Desktop 外壳只做到可挂载：会话区暴露浏览器默认 select/button，人物区变成描边表单，未延续原工作台视觉层级 | 增加宿主化会话工具栏，恢复以人物头像与场景为中心的布局；工作区与会话动作保持原生能力，但不重写业务 UI |
| P1 | 缺少 workbench.json，兼容说明仍指向 standalone Desktop 0.9.0 | 补齐标准描述、实际依赖与 Desktop 专用构建入口；源目录和打包解压目录都执行校验 |
| P1 | 尚未进入 Desktop 的依赖、配置和分发闭包 | 同步 manifest/lockfile、Desktop patch、Harness dependency patch 和带 SHA-256 的 catalog |
| 发布阻塞 | UNLICENSED，头像及节目素材的再分发授权未确认 | 保留 RIGHTS.md；公开分发前由作者确认许可证和素材授权，不以代码测试替代授权确认 |

## 宿主改动与数据边界

新增 `desktopWorkbenchOwnership` 内部只读服务，复用已有 state store，只返回 revision、added、sessionBindings 的副本。它不允许 provider 自行写入归属，不创建第二份状态文件；损坏状态抛错，不伪装为空状态。会话归属不等于权限授权，工具和模型仍由原生会话管理。

此次不运行同事原来的安装器、不替换用户 profile 的 node_modules、不迁移正式客户端数据。旧 standalone 绑定不会自动当成 Desktop 授权绑定。

## 验证基线

适配开始前，Desktop 全量测试为 **996 通过 / 4 失败（109 个文件）**。四项既有失败：

- `desktop-onboarding.test.ts` 的步骤数断言（旧断言要求 totalSteps = 3）。
- 同文件两项测试 mock 未支持 `@deepseek-ai/dsh-client-ui-settings-models`。
- `release.test.ts` 的开发版 userData 路径源码断言。

这些文件与 onboarding 实现不是本次整改范围，保留原改动，没有降低断言以制造全绿。

基线类型检查、构建通过。

## 最终整改与验证结果

上表 P0/P1 项已完成本地整改。发布授权项仍未解决，不进行公开发布。详细业务适配和测试说明随包包含在 `DESKTOP-ADAPTER.md`。

- 原交付版本：`dsh-huaxue-workbench@0.3.0-desktop.1`；当前适配版本：`0.3.5-desktop.1`，工作台 ID `huaxue`。
- 包：`vendor/workbenches/dsh-huaxue-workbench-0.3.5-desktop.1.tgz`，1,010,845 字节（小于 8 MB）。
- SHA-256：`fc3dd67197fa3732974314eabada0e92f4fb5c2c96fd35aacbbd96d6d654dc2b`。
- `0.3.2` 恢复原始会话态结构：中间原生对话、右侧“今日旅伴”游戏机与七人头像列表；人物切换会同步顶部身份、选中态与逐轮思考头像。
- `0.3.3` 修复角色切换后模型仍沿用前一人物的问题：移除通用提示词中的毛毛姐专属示例、增加当前身份硬约束，并以 `turn/end` 释放本轮冻结角色。
- `0.3.4` 固定游戏打开时的父会话与人物上下文；首次发送创建后台游戏会话时，不再因 `sessions.current` 的短暂切换卸载游戏界面。
- `catalog.json` 保留可校验的上游 commit，并通过 `reviewSource` 单独记录本轮用户上传的原始源码包；`localAdaptation: true` 标明本地修改，包内包含适配源码。未向同事仓库推送。
- 源码、已安装包和 tarball 解包后的描述校验通过；npm prepack 完整执行 build/check/test，33 项包级测试通过。
- 真实 Cordis + Settings + SystemPrompt + Desktop state store 验证通过：依赖注入、旧 preset 不越权、角色轮次缓存、游戏、移除/重加、损坏状态拒绝。
- React/ReactDOM + Desktop controller 集成验证通过：空工作区、选人、目录取消/创建、归属、角色切换、草稿、背景/游戏、普通会话及隐藏面板。
- Desktop 全量测试：**1016 通过 / 4 失败，共 1020 项**；失败名称与基线相同，无新增失败。
- 类型检查、构建和 `git diff --check` 通过。22 个 patch-package 补丁应用成功；新增依赖补丁的 hunk 长度已有回归测试。bundled Node `v24.9.0` 已通过 `npm rebuild node` 安装校验。
- 全新临时 DSH_HOME + 真实 Harness + 无头 Chromium：市场显示花学、两个退役示例不显示、添加/打开、零会话七角色及游戏场景、创建原生工作区、界面创建花学归属会话、仅一个原生可编辑输入框，全部通过，`pageErrors: []`。未发送模型请求。

运行 smoke：

```sh
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/verify-huaxue-market.mjs
```

最终临时测试证据（临时目录可能被系统清理）：

`/var/folders/80/wbsr1lw900v4bh8hmbwb2f540000gn/T/dsh-huaxue-smoke-qhbOK0/`

包含 `market.png`、`huaxue.png`、`game.png`、`owned-session.png`。测试进程及无头浏览器均已结束；测试目录保留便于复核。

## 剩余边界

1. 未重启用户当前可见的 Electron 实例；它可能仍加载旧模块。集成代码和依赖已就位，重新启动集成开发客户端后加载新版本。未启动第二个可见客户端。
2. 没有调用付费模型；真实模型续演、系统目录选择器、Windows/macOS 打包成品尚需人工验收。
3. 适配桥目前依赖 Desktop controller 的内部接口（commit/open/navigation），不是已发布稳定 SDK；升级宿主必须重跑集成验证。
4. 游戏/背景未保存草稿可跨市场导航保留，但不承诺跨整页刷新恢复。旧 standalone 会话不会自动取得 Desktop 归属。
5. 另发现当前 onboarding 的“跳过引导”确认弹窗被自身遮罩阻挡。smoke 使用逐步跳过四步完成独立测试准备，未改动该已有模块；应另行修复，不能把本次 smoke 当成 onboarding 验收。
6. 公开分发仍需作者确认代码许可、人物形象及节目素材授权。`UNLICENSED` 和 `RIGHTS.md` 均保留。
