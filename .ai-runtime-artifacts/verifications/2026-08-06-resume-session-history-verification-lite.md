---
artifact: verification-lite
route: leader-direct | 小改动直做
skills:
  - verification-before-completion
skills_evidence:
  - .claude/skills/verification-before-completion/SKILL.md
source:
  - 用户：「chat再优化下，就是去根据会话继续聊的时候，需要展现历史会话内容」
created_at: 2026-08-06
tier: 1
---

# 恢复会话展现历史内容 — 轻量验证（Tier 1）

> **适用：** Leader 直做简单任务（≥2 写文件 / 跑测试 / fix·实现类），**不**走 spec/plan/WU 编排。
> **纪律：** Load `verification-before-completion`；先跑命令再给结论。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "只改了一行，不用验证" | 一行改动能破坏整个构建 |
| "上次跑过了" | 代码变了，上次不等于这次 |
| "看起来没问题" | 看起来 ≠ 验证过 |

## 范围

- 改动文件：
  - `src/cli/session-history.ts`（新增）— `renderSessionHistory()` 纯函数：从 `Session.getAllMessages()` 提取 user/assistant 文本轮次，过滤 tool_use/tool_result/thinking 内部块，按最近 `maxTurns` 轮截断、单条 `maxTextLength` 截断
  - `chat.ts` — 恢复会话分支（`opts.session` 存在）在进入对话模式前打印历史；导入 `renderSessionHistory`
  - `test/session-history.test.ts`（新增）— 7 个用例（含 PersistentSession 磁盘恢复场景）
- 路由判定：Tier 1（Leader 直做，主 checkout）

## 文档优先（source-driven-development Step 0）

- 扫描 `.ai-runtime-artifacts/`：
  - `verifications/2026-08-06-main-menu-load-history-verification-lite.md` — 主菜单 + `--load` 恢复路径基线
  - `plans/2026-08-06-third-phase-infrastructure-plan.md` — Session 消息模型（`Message.role` + `MessageContent` 5 种子类型）
- 结论：复用既有 `--load` / `runHistoryMenu` → `runChat({session})` 恢复路径，仅在其输出前加历史渲染，无架构变更

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `npx vitest run test/session-history.test.ts` | 7/7 通过 |
| `npx vitest run test/chat-bootstrap.test.ts test/chat-full-flow.test.ts test/session-history.test.ts` | 3 文件 26/26 通过 |
| `ReadLints`（chat.ts / session-history.ts / 测试） | 无 lint 错误 |
| 运行时验证：临时 `MY_AGENT_HOME` 建 2 轮会话 → `cmd /c "echo /quit \| npx tsx chat.ts --load <id>"` | `💬 恢复会话` → 打印历史（👤/🤖 两轮 + 分隔线）→ 进入对话模式 → 正常退出 |

## 未验证项

- 真实 TTY 交互下的显示效果与配色（非 TTY 管道验证；功能路径已覆盖）
- 超长历史（数百轮）的滚动性能（渲染为一次性字符串，随轮数线性增长；合理范围内可接受）

## Next

- 任务完成 → 无需暂停（除非用户要求 commit/MR）
- 范围扩大 → 补 spec/plan 或升级 Tier 2 编排
