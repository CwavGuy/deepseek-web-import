# v0.2.0 — 支持 DSH Session 格式 v0–v4

维护分支的首个版本（基于上游 `0.1.0`）。**导入功能从"必然失败"修到在 0.1.1-rc.1 ～ 0.1.7-alpha.1+ 上都能用**。

## 修复

- **导入必然失败** `encodeCurrent requires Session format v3`：会话头版本原先写死为 `0`，而 0.1.5-alpha.1 起写入 v3、0.1.7-alpha.1 起写入 v4。现在会探测当前构建写入的格式版本，并在后端拒绝时按它报出的版本自动重试。
- **用错持久化接口**：v2 起 `sessionPersistence` 是句柄式接口（`create(header) → handle.append/flush/close`），而原代码用的是 v0/v1 时代的 `create(meta)` + `append(id, events)`。现在两代接口都支持，自动识别。
- **导入的对话全是空的**：DeepSeek 历史消息的正文在 `fragments`（`REQUEST` / `RESPONSE` / `THINK`），不在 `content` 字段。现在用户提问取 `REQUEST`，助手回答取 `RESPONSE` 作正文、`THINK` 作 `reasoning` 块（可在 UI 折叠查看思维链）。
- **时间线**：事件时间改用 DeepSeek 的 `inserted_at`，并按 seq 单调递增。
- **未完成的回答**：写入一句占位说明，不再产生空回合。
- **热重载冲突**：路由注册可重入，并在 fiber 销毁时释放，不再报 `webserver: duplicate exact route`。

## 兼容性（每个版本都用真实持久化后端实测）

| DSH 版本 | Session 格式 | 结果 |
|----------|--------------|------|
| 0.1.1-rc.1 – 0.1.2-rc.1 | v0 | ✅ `PASS format v0 … 20 events, 6 messages, reasoning=true` |
| （无发布版本） | v1 | ✅ 按 v0 形状建模，单测覆盖 |
| 0.1.3-alpha.2 | v2 | ✅ `PASS format v2 …` |
| 0.1.5-alpha.1 – 0.1.6-alpha.2 | v3 | ✅ `PASS format v3 …` |
| 0.1.7-alpha.1+ | v4 | ✅ `PASS format v4 …` |

验证方式：用各版本**自己的** `dsh-session-persistence-jsonl` 后端写入合成对话，再用该版本的读取路径读回、重建会话；另有离线端到端测试直接调用插件的 host 路由。命令见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)，一条 `sh test/matrix.sh` 可复现全部。

## 安装

```sh
dsh plugin add CwavGuy/deepseek-web-import
```

装完**重启 DSH**，设置页左侧出现「DeepSeek 对话导入」：粘贴 `userToken` → 获取对话目录 → 选工作区 → 导入为会话 → 刷新页面即可打开续聊。

## 说明

- DeepSeek 内部接口与 DSH 会话格式都可能继续变化；本分支把版本差异集中在 `lib/formats.js` 一张表里，新格式版本通常只需加一行 + 跑一次矩阵测试。
- 保留上游原作者版权（MIT）。改动是纯代码改动，欢迎上游合并。
