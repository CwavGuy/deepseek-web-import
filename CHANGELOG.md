# Changelog

本分支遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

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
