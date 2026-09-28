# Changelog

本分支遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.2.2] — 2026-09-28

### 修复

- **跨版本可读性（重要）**：用户分支把 `user/message` 排在 `step/start` **之前**，
  而 DSH 自己的日志是 `turn/start → step/start → user/message`。v2→v3 迁移会在**第一个
  `step/start`** 处插入 system 头，所以「首个 step 之前就出现 surface 事件」的日志会被 v3/v4
  构建直接拒绝：
  `format v2 surface before first step cannot acquire a system head without changing chronology`。
  后果是：在 **0.1.1-rc.2 ～ 0.1.3-alpha.2** 上导入的会话，用户升级 DSH 之后**打不开**
  （文件仍在，只是读不出来）。现在 step 先于消息，跨代读取恢复正常。
- 新增 **跨代读取测试**（`test/cross-version.mjs` + 矩阵脚本）：用旧版本写入、用当前版本读取，
  专门覆盖「同版本往返测不出来」的迁移约束。此前矩阵每个版本只用自己读写，因此这类问题不可见。

## [0.2.1] — 2026-09-28

发布后审计（三位独立评审 + 逐行复核）发现的修正。仍然兼容 v0–v4。

### 修复

- **时间线**：`buildSessionEvents` 用导入时刻（`Date.now()`）初始化了时间游标，
  导致任何「比现在早」的历史消息都被钳到导入时刻——导入的会话里每条消息的时间都是
  「刚刚」。现在按消息自身的 `inserted_at` 走时间线，首条 `session/title` 取第一条消息的时间；
  缺失/乱序的时间戳继承前一条（保持非递减），不会再跳到「现在」。
- **非人类回合**：`SYSTEM`/`TOOL` 等角色原会被拼成「助手回复」。现在只翻译 `USER`/`ASSISTANT`；
  整段对话没有可翻译回合时返回 `empty_history`，不再写入只有标题的空会话。
- **只有附件没有文字的消息**：原来会写成空文本块，现在写入一句明确说明（`EMPTY_PROMPT_NOTE`）。
- **超长对话**：传输层原本把响应体截断在 50 万字符，超长对话会导致 JSON 解析失败并报
  「响应非 JSON（可能 Token 无效）」，误导排查。现在上限提高到 400 万字符，并在确实超限时
  返回 `too_large` 与明确提示。

- **安全与健壮性**（同一轮审计）：
  - 请求 spec（含 `Authorization`）改为通过子进程 **stdin** 传递，不再出现在 `ps` / `/proc/<pid>/cmdline` 里；
  - `probe` 只接受 `https://chat.deepseek.com`（拒绝明文与带用户名/密码的 URL），并且忽略调用方自带的 `Authorization`，一律使用已保存的 token；
  - 上游返回的 `raw`、凭据服务的报错都会被截断并把 token 抹成 `[token]`，不再回显到页面；`saveToken`/`clearToken` 失败只回固定文案，细节进 DSH 日志；
  - 超限请求体现在真的返回 413（此前 `req.destroy()` 让响应永远发不出去，浏览器只看到连接被重置）；非法 JSON 返回 400；
  - 路由带 owner 标记：只回收本插件上一实例的路由，别家的路由不动；旧实例销毁时不会误删新实例的路由；挂载中途失败会把已注册的路由全部释放；
  - 会话格式版本重试有次数上限；写成功但句柄无法释放（例如残留 `session.lock`）会作为失败上报；
  - 时间线兜底取「对话最早的时间戳」而不是 `Date.now()`，避免首条消息缺 `inserted_at` 时把整条时间线拖到导入时刻；
  - 空白标题归一为默认标题；方言证据只用于「建模」的版本行（v1 与未知版本），已被发布版本验证过的行不被相反证据改写。

### 测试

- 新增 `test/host-routes.test.mjs`：用假 ctx 覆盖 8 条路由的注册、成功导入、
  版本纠正重试、旧式服务路径、超长响应、空对话、未知工作区、无 token、
  DeepSeek 接口报错、`probe` 的 SSRF 拦截、非 POST、写入失败、token 状态（13 项）。
- `test/events.test.mjs` 增加真实时间线、乱序/缺失时间戳、角色过滤、附件消息（共 15 项）。
- 新增 `test/transport.test.mjs`：用真实 `node` 子进程 + 本地 HTTP 服务验证传输层
  （spec 只走 stdin、请求方法/头/体正确、超限报 `truncated`、连接失败报错误、畸形 spec 不发请求）6 项。
- 单测总数 **57**，`npm test` 一条命令跑完；CI 与矩阵脚本都已接上。

## [0.2.0] — 2026-09-28

首个维护分支版本：导入链路重写，支持 DSH Session 格式 v0–v4。基于上游 `0.1.0`。

### 修复

- **导入必然失败**（`encodeCurrent requires Session format v3`）：会话头原先把 `version` 写死为 `0`，而 0.1.5-rc.2 起写入的是 v3、0.1.7-rc.2 起是 v4。现在运行时会探测当前构建写入的格式版本，并在后端拒绝时按它报出的版本自动重试。
- **用错持久化接口**：v2 起 `sessionPersistence` 是句柄式接口（`create(header) → handle.append/flush/close`），
  原代码调用的是 v0/v1 时代的 `create(meta)` + `append(id, events)`。现在两代接口都支持，自动识别。
- **导入的消息全部为空**：DeepSeek 历史消息的正文在 `fragments`（`REQUEST` / `RESPONSE` / `THINK`）而不是 `content`。
  现在按角色提取：用户取 `REQUEST`，助手取 `RESPONSE` 作正文、`THINK` 作 `reasoning` 块；
  未完成的生成会写入一句占位说明，避免出现空回合。
- **消息时间线**：改用 DeepSeek 的 `inserted_at` 作为事件时间，并按 seq 单调递增。
- **热重载路由冲突**：路由注册可重入（重挂载时回收上一实例的路由），并在 fiber 销毁时释放自己的路由。

### 新增

- `lib/formats.js`：各代格式差异表（头部字段、`assistant/message.stream`、`delegationDepth` 等）。
- `lib/persistence.js`：两代持久化接口适配 + 版本探测 + 版本纠正重试。
- `lib/events.js`：纯翻译层（DeepSeek 历史 → DSH 事件），可离线单测。
- 测试：11 个纯单测、真实后端兼容矩阵（v0/v2/v3/v4）、离线端到端导入测试。
- 文档：兼容矩阵与证据（`docs/COMPATIBILITY.md`）、加新格式版本的步骤。

### 兼容性

| DSH | 格式 | 状态 |
|-----|------|------|
| 0.1.1-rc.2 – 0.1.2-rc.1 | v0 | ✅ 实测 |
| 未发布 | v1 | ✅ 按 v0 建模 + 单测 |
| 0.1.3-alpha.2 | v2 | ✅ 实测 |
| 0.1.5-rc.2 – 0.1.6-alpha.2 | v3 | ✅ 实测 |
| 0.1.7-rc.2+ | v4 | ✅ 实测 |

## [0.1.0] — 2026-08-17（上游原作者 wpc0323）

- 首次发布为可安装的 DSH bundle 插件（`dsh.bundle` + `dsh.client`）。
- 设置页 UI（「DeepSeek 对话导入」）：粘贴 `userToken`、拉取 chat.deepseek.com 对话目录（标题 + 日期，最近 100 条）、把选中的对话导入到选中的工作区成为可续聊的 DSH 会话。
- 导入的会话保留 DeepSeek 原标题，可在 DSH 中打开与续聊（只写持久化，不进 live store）。
- 空对话守卫与挂载失败上报（`attached: false`，而不是误报导入失败）。
- host 半部提供同源 JSON 路由，浏览器半部用 `fetch` 调用。
- 诊断路由仅允许 chat.deepseek.com 域名。
