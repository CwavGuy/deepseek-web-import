# v0.2.2 — 跨版本可读性修复（重要）

`v0.2.1` 修完审计问题后又发现一个**会影响真实用户**的问题，本版修掉。

## 问题

用户分支发的是 `turn/start → user/message → step/start`，而 DSH 自己的日志是
`turn/start → step/start → user/message`。DSH 的 v2→v3 迁移会在**第一个 `step/start`**
处插入 system 头，所以「首个 step 之前就出现 surface 事件（user/assistant 消息）」的
v0/v2 日志会被 v3/v4 构建直接拒绝：

```
format v2 surface before first step cannot acquire a system head without changing chronology
```

**后果**：在 DSH **0.1.1-rc.1 ～ 0.1.3-alpha.2** 上导入的会话，用户升级 DSH 之后
**打不开**（会话文件仍在、列表里也还在，但读取会被拒）。在 0.1.5-alpha.1+ 上导入的不受影响。

## 修复

- 事件顺序改为 `turn/start → step/start → user/message`（step 先于它承载的消息），
  与 DSH 自身日志一致，迁移链就能正常插入 system 头。
- 新增 **跨代读取测试** `test/cross-version.mjs`：旧版本 `write`、当前版本 `read`；
  `sh test/matrix.sh` 现在会为 v0/v2/v3 各跑一遍（写作 20 events，v4 读取迁移为 21 events、6/6 消息）。
  此前的矩阵每个版本只用自己读写，这类问题**不可能被发现**，现在补上了。

## 验证

```
单元测试            57/57 pass
同版本矩阵          v0 / v2 / v3 / v4 全部 PASS
跨代读取（v4 读旧写入）
  session-cross-v0  PASS stored v4 → 21 events, 6/6 messages
  session-cross-v2  PASS stored v4 → 21 events, 6/6 messages
  session-cross-v3  PASS stored v4 → 20 events, 6/6 messages
```

## 安装

```sh
dsh plugin add CwavGuy/deepseek-web-import
```

装完重启 DSH。**如果你在 0.1.5-alpha.1 之前导入过会话，用本版重新导入一次即可**（旧的那些在升级后的 DSH 上无法打开）。
