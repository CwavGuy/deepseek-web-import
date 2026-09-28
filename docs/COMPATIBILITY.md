# 兼容矩阵与验证证据

本插件写的是 **DSH 会话日志（session log）**，而日志的**格式版本随 DSH 版本变化**：
运行中的构建写哪一代，插件就必须写哪一代的头部与事件字段。这里记录每一代差异的
证据来源，以及可复现的验证命令。

## 各代差异（对照已发布包逐条核对）

| 格式 | 由哪些版本写入 | Session 头 | `assistant/message` | `sessionPersistence` 接口 |
|------|----------------|-----------|---------------------|---------------------------|
| v0 | 0.1.1-rc.2 … 0.1.2-rc.1 | `version,id,createdAt,cwd,seedLength?`（**没有 `isSeeded`**） | 没有 `stream` 字段 | 旧式：`create(meta): Promise<void>` + `append(id, events)` |
| v1 | 未发现发布版本写入 v1 | 按 v0 建模 | 没有 `stream` | 旧式 |
| v2 | 0.1.3-alpha.2 | `…,isSeeded`（显式拒绝 `seedLength`） | `stream` 必填 | 句柄式：`create(header) → SessionHandle`、`open/flush/stat/list` |
| v3 | 0.1.5-rc.2 … 0.1.6-alpha.2 | 同 v2 | `stream` 必填 | 句柄式 |
| v4 | 0.1.7-rc.2+ | 同 v2，且 `delegationDepth` **必填** | `stream` 必填 | 句柄式 |

证据位置（对已发布包 `npm pack` 后查看）：

- `@deepseek-ai/dsh-session` 的 `SESSION_FORMAT_VERSION` 常量：
  - `0.1.1-rc.2` → 0，`0.1.2-alpha.5` → 0，`0.1.2-rc.1` → 0，`0.1.3-alpha.2` → 2，`0.1.5-rc.2` → 3，`0.1.6-alpha.2` → 3，`0.1.7-rc.2` → 4
- v0 头部：`dsh-session@0.1.1-rc.2` 的 `SessionHeader`（有 `seedLength`、无 `isSeeded`）
- v2+ 头部：`dsh-session@0.1.3-alpha.2` 的 `SessionHeader`（`isSeeded` 必填、`seedLength` 被拒绝）
- v4 头部：`dsh-session-format-v3-to-v4@0.1.7-rc.2` 的 `assertReleasedV4Header`
  （required = `version,id,createdAt,isSeeded,delegationDepth`）
- 接口代次：`dsh-session-persistence@0.1.1-rc.2`（`create/append/list`）对比
  `@0.1.3-alpha.2`（`create → handle`、`open/flush/stat/list`）
- 事件字段：`assistant/message` 在 v0 是 `{turn,step,message,usage?,interrupted?}`，
  v2+ 是 `{turn,step,message,stream,…}`

其余插件依赖的服务（`webServer`、`credentials`、`workspaceRegistry.attachSession`）
在 v0 到 v4 之间签名一致，已逐版本核对，因此兼容层只需要处理会话持久化这一层。

## 怎么自己验证

### 1) 纯单测（不需要 DSH）

```sh
node --test test/events.test.mjs
```

覆盖：fragment 提取、思维链/正文分块、时间戳单调、事件序列连续与 turn/step 配对、
各代头部与事件形状、版本探测（两种 `list()` 返回形状）、旧式接口识别。

### 2) 真实后端联调（每个 DSH 版本跑一次）

在**哪个版本的目录**下运行，就用哪个版本自己的持久化实现：

```sh
# 当前版本（v4）
cd /usr/local/lib/node_modules/@deepseek-ai/dsh
node <repo>/test/compat.mjs --expect 4
node <repo>/test/live-import.mjs

# 旧版本（示例：v0 / v2 / v3，test/matrix.sh 会自动装好）
cd /tmp/compat/v0 && node <repo>/test/compat.mjs --expect 0
cd /tmp/compat/v2 && node <repo>/test/compat.mjs --expect 2
cd /tmp/compat/v3 && node <repo>/test/compat.mjs --expect 3
```

`compat.mjs` 把合成对话写进真实后端，再用该版本自己的读取路径读回并重建会话；
`live-import.mjs` 更进一步：直接调用插件的 host 路由（网络层替换成合成响应），
断言写入的事件数、格式版本、派生消息条数和工作区挂载。

### 3) 一键矩阵

```sh
sh test/matrix.sh
```

脚本会在 `/tmp/compat/v{0,2,3}` 里 `npm i` 对应版本的
`@deepseek-ai/dsh-base`、`dsh-session-persistence(-jsonl)`、`cordis` 等包，
然后依次跑 v0/v2/v3 与当前版本。首次运行需要联网下载这些包。

## 最近一次验证结果

```
v0  0.1.1-rc.2        PASS format v0 | stored v0 | 20 events | 6 messages | reasoning=true
v2  0.1.3-alpha.2     PASS format v2 | stored v2 | 20 events | 6 messages | reasoning=true
v3  0.1.6-alpha.2     PASS format v3 | stored v3 | 20 events | 6 messages | reasoning=true
v4  0.1.7-rc.2        PASS format v4 | stored v4 | 20 events | 6 messages | reasoning=true
e2e 0.1.7-rc.2        PASS live import → format v4, 20 events, 6 messages, attached=1
e2e 0.1.1-rc.2        PASS live import → format v0, 20 events, 6 messages, attached=1
e2e 0.1.3-alpha.2     PASS live import → format v2, 20 events, 6 messages, attached=1
单测                 11/11 pass
```

v1 没有发布版本写入过它（0.1.1-rc.2、0.1.2-alpha.5、0.1.2-rc.1 都是 v0），
因此 v1 采用与 v0 相同的形状并有单测覆盖；一旦出现写入 v1 的构建，
把它的包加进 `test/matrix.sh` 即可得到实测证据。
