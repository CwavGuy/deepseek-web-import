# 修复：导入在 0.1.5-rc.2 之后必然失败，并适配 Session 格式 v0–v4

> 这个 PR 让「导入为会话」在 DSH **0.1.1-rc.2 ～ 0.1.7-rc.2+** 上都能用。
> 动机很直接：本插件导入时报 `{"ok":false,"error":"persist","message":"encodeCurrent requires Session format v3"}`，
> 而 0.1.7-rc.2 起会话格式已经是 **v4**，只修 v3 也活不过一个版本。

## 问题（三个叠加的 bug）

1. **会话头版本写死为 `0`**
   `lib/index.js` 里 `const meta = { version: 0, ... }`。这个值来自 DSH 0.1.1/0.1.2 时代（那时确实是 v0）；
   0.1.5-rc.2 起写 v3、0.1.7-rc.2 起写 v4，于是 `sessionPersistence.create` 直接抛
   `encodeCurrent requires Session format v3`。

2. **持久化接口用错了代次**
   `persistence.create(meta)` + `persistence.append(id, events)` 是 v0/v1 时代的**服务级**接口。
   从 0.1.3-alpha.2 起契约变成**句柄式**：`create(header)` 返回写句柄，事件走 `handle.append()`，
   耐久屏障是 `handle.flush()`，用完 `handle.close()`。

3. **正文取错字段**
   `chat.deepseek.com` 的历史消息没有 `content` 字段，正文在 `fragments` 里
   （`REQUEST` = 用户提问、`RESPONSE` = 回答正文、`THINK` = 思维链、`TOOL_SEARCH`/`TOOL_OPEN` = 联网检索）。
   原实现读 `m.content`，所以**即使前两个 bug 修好，导入的每条消息也会是空字符串**。

另外两个会让用户直接撞上的问题：

4. **超长对话**：传输层把响应截断在 50 万字符，超过就 `JSON.parse` 失败并报「响应非 JSON（可能 Token 无效）」，
   把「对话太长」误报成「token 失效」。现在上限提到 400 万字符，确实超限时返回明确的 `too_large`。

5. **重载冲突**：路由注册没有随 fiber 释放，插件重载会报 `webserver: duplicate exact route`（路由在插件卸载后仍留在 webserver 表里）。

## 改动

| 文件 | 作用 |
|------|------|
| `lib/formats.js`（新） | 各代格式差异表：头部字段（`isSeeded` / `seedLength` / `delegationDepth`）、`assistant/message` 是否带 `stream`、未知版本的默认形状 |
| `lib/persistence.js`（新） | 两代持久化接口适配；版本探测（读已存会话 → 后端拒绝时按它报出的版本重试）；方言证据（已存头里有 `isSeeded` 还是有 `seedLength`）优先于表格 |
| `lib/events.js`（新） | 纯翻译层：fragments → 内容块（正文 + 思维链）、时间线取 `inserted_at`、只翻译 `USER`/`ASSISTANT`、只有附件的消息写明确说明 |
| `lib/index.js` | 路由不变，改为调用上面三层；响应上限与截断上报；路由可重入并在 fiber 销毁时释放 |
| `test/`（新） | 57 个单测（翻译层 + 传输层 + 用假 ctx 覆盖 8 条路由及其错误路径）+ 真实后端兼容矩阵 + 离线端到端导入 |
| `docs/COMPATIBILITY.md`（新） | 每代差异的证据出处与验证命令 |
| `.github/workflows/ci.yml`（新） | push/PR 跑单测；手动触发跑完整矩阵 |
| `README.md` / `CHANGELOG.md` | 补上兼容矩阵、`too_large` 等行为说明 |

| `lib/transport.js`（新） | 子进程请求的封装：请求 spec（含 `Authorization`）只走 **stdin**，不进 argv；响应上限与 `truncated` 上报集中在这里 |

**没有改动** `lib/client.js`（设置页 UI 原样保留）、`cordis.patch.yml`、依赖列表；不新增依赖。

### 顺带修掉的健壮性/安全问题（同一轮审计发现的）

- **请求 spec 走 stdin**：原来把带 `Authorization` 的 JSON 当 argv 传给子进程，`ps` / `/proc/<pid>/cmdline` 能看到 token；现在只走 stdin。
- **`probe` 收紧**：只允许 `https://chat.deepseek.com`（拒绝明文降级与带用户名/密码的 URL），并且忽略调用方自带的 `Authorization`，一律用已保存的 token —— 它仍是诊断用的转发，但不再是被注入凭据的入口。
- **不再把上游原文回显给页面**：`raw` 截断 + 把 token 抹成 `[token]`；凭据服务自身的报错（可能内嵌被拒的值）只写 DSH 日志，页面只看到固定文案。
- **413 真的能返回**：原来 `req.destroy()` 之后响应永远发不出去（浏览器只看到连接重置），现在超限请求体直接 413；非法 JSON 400。
- **路由所有权**：路由带 owner 标记，只回收本插件上一实例留下的路由；旧实例销毁时不会误删新实例的路由；挂载中途失败会释放已注册的路由（web server 的“重复路由即配置错误”契约保持不变）。
- **写成功但句柄无法释放**（例如残留 `session.lock`）不再报成功；格式版本重试有次数上限。
- **时间线**：`inserted_at` 缺失/乱序/离谱（负数、NaN、已按毫秒、1e15）时回退到“上一条/最早一条”，不会把 2023 年的对话标到 2025 年或 55000 年。
- **标题归一**：换行、ANSI 转义、不可见控制字符、超长（按 UTF-8 字节 80 上限）都按 `dsh-session-title` 的语义清理，空白标题回退默认。
- 历史以“未回答的用户提问”结尾时，保留未闭合的 turn（DSH 自己会在下次打开/续聊时补 `interrupted` 收尾），文档里写明。

## 验证（都可复现）

```sh
# 纯单测，不需要 DSH
npm test        # 57 pass

# 各代真实后端（用哪个版本的 dsh-session-persistence，就跑哪个版本）
cd /usr/local/lib/node_modules/@deepseek-ai/dsh && node test/compat.mjs --expect 4 && node test/live-import.mjs
cd /tmp/compat/v0 && node test/compat.mjs --expect 0
cd /tmp/compat/v2 && node test/compat.mjs --expect 2
cd /tmp/compat/v3 && node test/compat.mjs --expect 3

# 一键矩阵（首次会把旧版本 npm 装到 /tmp/compat/）
sh test/matrix.sh
```

实测结果：

```
v0  0.1.1-rc.2    PASS format v0 | stored v0 | 20 events | 6 messages | reasoning=true
v2  0.1.3-alpha.2 PASS format v2 | stored v2 | 20 events | 6 messages | reasoning=true
v3  0.1.6-alpha.2 PASS format v3 | stored v3 | 20 events | 6 messages | reasoning=true
v4  0.1.7-rc.2    PASS format v4 | stored v4 | 20 events | 6 messages | reasoning=true
e2e v4            PASS live import → format v4, 20 events, 6 messages, attached=1
```

验证方式不是「跑通就算」：每个版本都用**它自己的** `dsh-session-persistence-jsonl` 写入合成对话，
再用该版本的读取路径读回、重建 `Session` 并 `deriveMessages()`，断言事件数、格式版本、
消息条数、思维链存在、工作区挂载。`test/fixtures/history.json` 是**合成数据**，可安全引用。

### 一个只有跨代读取才能发现的约束

审计发现（并已修）：用户分支原先发的是 `turn/start → user/message → step/start`，
而 DSH 自己的日志是 `turn/start → step/start → user/message`。v2→v3 迁移在**第一个 `step/start`**
处插入 system 头，因此「首个 step 之前就有 surface 事件」的 v0/v2 日志会被 v3/v4 构建拒绝：

```
format v2 surface before first step cannot acquire a system head without changing chronology
```

也就是：在 0.1.1-rc.2 ～ 0.1.3-alpha.2 上导入的会话，用户升级 DSH 后会打不开。
现在 step 先于消息，并且新增了 `test/cross-version.mjs`：**旧版本写、当前版本读**，
`sh test/matrix.sh` 会为 v0/v2/v3 各跑一遍（v0/v2 的 v4 读取结果：21 events、6/6 messages）。

## 兼容性与行为变化

- **v1 说明**：没有任何已发布版本写过 v1，所以表里那行按 v0 建模；插件会先读该 profile 自己已存会话的头部字段判断方言，
  证据优先，所以两种可能形状都能写对。
- `messageCount` 现在返回**可导入**的消息条数（非 `USER`/`ASSISTANT` 的行会被忽略），并在返回里新增
  `sessionFormatVersion` 与 `eventCount`，便于排查。
- 新增错误码：`too_large`（对话超过上限）、`empty_history`（整段对话没有可翻译回合，不再创建空会话）。
- 时间戳改为真实会话时间（此前若照搬旧实现会把所有消息钳到导入时刻）。

## Checklist

- [x] 不新增依赖，不改动 client 半部
- [x] 单测 + 真实后端矩阵 + 端到端测试
- [x] 文档：兼容矩阵与证据、CHANGELOG、README 行为说明
- [x] 向后兼容：老版本 DSH 走旧接口，新版本走句柄接口，均由运行时探测
