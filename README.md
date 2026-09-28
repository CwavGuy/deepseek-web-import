# deepseek-web-import

把 [chat.deepseek.com](https://chat.deepseek.com) 网页版的历史对话**导入成 DeepSeek Harness (DSH) 的正式会话**：
导入后出现在左侧工作区列表里，可以打开、查看完整历史（含思维链）、选模型继续对话。

这是 [wpc0323/deepseek-web-import](https://github.com/wpc0323/deepseek-web-import) 的**维护分支（fork）**。
原版导入一直失败（`encodeCurrent requires Session format v3`），且会话格式已升级到 v4，
本分支重写了导入链路，**按运行中的 DSH 版本自适应写入 v0 / v1 / v2 / v3 / v4**，并补上了原版会丢正文的问题。

- 兼容矩阵与验证证据：[docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

## ✨ 功能

- 设置面板新增 **「DeepSeek 对话导入」** 页面
- 粘贴 `userToken` 后一键拉取**对话目录**（仅显示标题 + 日期，不展开正文）
- 每条对话可选**目标工作区**，一键**导入为 DSH 会话**
- 导入的会话：
  - 显示 DeepSeek 里的原标题
  - **保留思维链**（THINK 片段 → `reasoning` 块）与真实时间
  - 可在其中**选模型继续对话**（走 DSH 正常 resume 路径，不会报 `cannot prepare session while it is live`）
  - 持久化在 `$DSH_HOME/sessions/<工作区>/` 下，重启 DSH 后仍在
- 自动提取 `userToken` 中的 `value` 字段（兼容 `{"value":"...","__version":"0"}` 格式）
- 内置「诊断」区，接口变更时可直接 GET 原始响应排查

## 它解决了什么

| 问题 | 现象 | 修复 |
|------|------|------|
| 会话格式版本写死成 v0 | 导入报 `encodeCurrent requires Session format v3` | 运行时探测当前构建写入的格式版本，写错时按后端报出的版本自动重试 |
| 用错持久化接口 | `persistence.append is not a function`（v2+ 是句柄式接口） | 自动识别两代接口：v0/v1 用 `create(meta)` + `append(id, events)`，v2+ 用 `create(header)` 返回的写句柄 |
| 正文取错字段 | 消息全部为空 | DeepSeek 的正文在 `fragments`（`REQUEST`/`RESPONSE`/`THINK`），不在 `content`；现在按角色提取，并把思维链导入为 `reasoning` 块 |
| 热重载路由冲突 | 重载插件报 `webserver: duplicate exact route` | 路由注册可重入，并在 fiber 销毁时释放 |

## 兼容性

| DSH 版本 | Session 格式 | 状态 |
|----------|--------------|------|
| 0.1.1-rc.2 – 0.1.2-rc.1 | v0 | ✅ 实测通过 |
| （无发布版本） | v1 | ✅ 按 v0 形状建模，单测覆盖 |
| 0.1.3-alpha.2 | v2 | ✅ 实测通过 |
| 0.1.5-rc.2 – 0.1.6-alpha.2 | v3 | ✅ 实测通过 |
| 0.1.7-rc.2+ | v4 | ✅ 实测通过（当前版本） |

“实测通过”指用该版本**真实的** `dsh-session-persistence-jsonl` 后端写入并读回校验，
命令见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)。

## 安装

```sh
# 从 GitHub 安装（dsh 会把它当作 bundle 插件）
dsh plugin add <你的GitHub用户名>/deepseek-web-import
```

装完**重启 DSH**，设置页左侧出现「DeepSeek 对话导入」。

> 手动安装（不使用 `dsh plugin add`）：把本仓库放到
> `$DSH_HOME/profiles/web/node_modules/deepseek-web-import/`，然后重启 DSH 即可。

## 使用

1. 打开 **设置 → DeepSeek 对话导入**。
2. **① 登录态**：浏览器登录 chat.deepseek.com → `F12` → `Application` → `Local Storage` → 复制 `userToken` 的值 → 粘贴保存（整段 `{"value":"…"}` 也可以，插件会自动取值）。
3. **② 对话目录**：点「获取对话目录」（一次最多 100 条）。
4. 每条对话右侧选目标工作区 → 点「导入为会话」。
5. **刷新网页 (F5)**，左侧工作区即可看到导入的会话；点开选模型即可继续对话。

## 工作原理

- **架构**：`lib/index.js` 是 host 半部（用 DSH 的 `webServer` 注册同源 JSON 路由 `/__deepseek-web-import/*`），`lib/client.js` 是 web client 半部（设置页 UI）。二者通过 fetch 通信，不依赖动态插件机制。
- **接口**（DeepSeek 网页端非官方内部 API，随其改版可能失效）：
  - 会话目录：`GET /api/v0/chat_session/fetch_page?count=100`
  - 对话历史：`GET /api/v0/chat/history_messages?chat_session_id=<uuid>`
  - 无自定义 Header 能力时，通过 `subprocess` 起 node 发请求并带上 `Authorization: Bearer`。
- **导入**：把历史消息转成合法 DSH 会话事件（`turn/start → user/message → step/start → assistant/message → step/end → turn/end`，surface 事件带 `surfaceOp: "append"`，首部 `session/title`、尾部 `session/end-seed`），只写持久化、不进 live store，因此导入的会话可以被正常打开和续聊。
- **版本自适应**：`lib/formats.js` 保存各代格式的头部/事件差异，`lib/persistence.js` 负责识别接口代次并写入，`lib/events.js` 是纯翻译层（无副作用、可单测）。
- **Token 存储**：用 DSH 的 `credentials` 服务（`$DSH_HOME/.credentials.yaml`），不写进浏览器或会话日志。

## 会话日志损坏（corrupt session log）排查与修复

这是 **DSH 自身的恢复游标问题**（`session/end-seed` 由活动会话单独 append、重启后游标漏算导致 seq 复用），与本插件无关；插件的导入方式（整批写入）恰好避开了触发。现象、根因、修复方法见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 已知限制

- 依赖 DeepSeek **非官方内部接口**，可能随其网页改版失效（失效时用「诊断」区查看原始响应）。
- 密码登录会被 DeepSeek 的**人机验证（AWS WAF）**拦截，必须使用 `userToken` 方式。
- 对话目录一次最多拉取 **100 条**：实测 `fetch_page` 响应仅含 `chat_sessions` + `has_more`，无可用游标字段（`cursor`/`lte_cursor` 参数均不生效），超过 100 条时只返回最新 100 条。
- `userToken` 有时效（约数小时~数天），失效后重新复制保存即可。
- 联网检索类片段（`TOOL_SEARCH` / `TOOL_OPEN`）不会导入为 DSH 工具调用，只保留正文与思维链。
- 修改 `lib/` 下的代码后**必须重启 DSH** 才会生效：这个部署的 HMR 不监听 `node_modules`，且 Node 对模块与包解析都有进程级缓存。

## 开发与测试

```sh
node --test test/events.test.mjs        # 纯单测，无需 DSH

# 真实后端联调（在哪个版本目录下跑，就用哪个版本的持久化后端）
cd /usr/local/lib/node_modules/@deepseek-ai/dsh
node <repo>/test/compat.mjs --expect 4
node <repo>/test/live-import.mjs
```

`test/matrix.sh` 会在 `/tmp/compat/v{0,2,3}` 里装好旧版本并跑完整矩阵。

### 加一个新的会话格式版本（例如 v5）

1. 在 `lib/formats.js` 的 `PROFILES` 表里加一行（或确认新版本沿用 v2+ 形状即可，未知版本默认沿用最新形状）。
2. 用新 DSH 跑 `test/compat.mjs --expect 5`，若报字段错误，按错误把差异补进 `PROFILES`。
3. 在 `docs/COMPATIBILITY.md` 的矩阵里补一行证据，更新 `CHANGELOG.md`。

## 发布 release

```sh
git tag -a v0.2.0 -m "v0.2.0" && git push origin v0.2.0
# 然后在 GitHub 上 Releases → Draft a new release → 选择 tag → 粘贴 CHANGELOG 内容
```

## 安全提醒

- 请勿在任何对话、Issue、PR 中泄露 `userToken`、密码或私密对话内容。
- 报 bug 时请把日志里的 token 与对话正文抹掉；`test/fixtures/history.json` 是**合成数据**，可直接引用。

## 上游

- 原仓库：[wpc0323/deepseek-web-import](https://github.com/wpc0323/deepseek-web-import)（MIT）
- 本分支保留原作者版权声明（见 [LICENSE](LICENSE)），欢迎上游合并：本分支的改动是纯代码改动，没有依赖任何私有接口之外的东西。
