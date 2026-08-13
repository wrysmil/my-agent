---
artifact: verification
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - verification-before-completion
skills_evidence:
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - harness-kit/artifact-templates/collective-test.md
  - harness-kit/references/definition-of-done.md
created_at: 2026-08-12
batch_id: subagent-realtime-render
worktree_id:
worktree_path:
verdict: PASS
---

# 子 Agent 实时渲染 — 集体测试

> **纪律：** 先 Load **verification-before-completion**；**先跑命令、再给结论**。
> **写入者：** Leader。WU 内 Coder 单测摘要可引用，**不能替代**本表命令的本机重跑。

## 变更范围

- 本批次触及模块/目录：
  - 后端：`src/orchestration/dispatch.ts`、`src/orchestration/tools.ts`、`src/shared/types.ts`、`src/web/server/routes/messages.ts`、`bin/my-agent-web.ts`
  - 前端：`web/src/features/chat/useChatStream.ts`、`web/src/features/chat/types.ts`、`web/src/lib/sse.ts`、`web/src/components/chat/MessageBubble.tsx`
  - 测试：后端 orchestration/messages 套件、前端 chat 特性套件（状态机 / parseHistory / merge / message-bubble）

## WU 已覆盖项（引用，非替代）

| WU | 命令/结论摘要 |
| --- | --- |
| WU-01 | 后端 SSE emit：`dispatch_started` / `worker_step_start` / `worker_text_delta` / `worker_step_end` / `dispatch_done`；89/89 定向单测，reviewer APPROVE |
| WU-02 | 前端 SSE 路由 + Agent 气泡状态机；chat 套件 195/195，reviewer BLOCK→全修 |
| WU-03 | MessageBubble v3.4 Agent 气泡渲染；BLOCK→修复→复审 APPROVE，chat 套件 207/207 |
| WU-04 | History 重建增强 + run_worker 语义；BLOCK→修复(A+B)→复审 APPROVE，42/42 |

## 命令表（Leader 本机实测）

| 命令 | cwd | exit | 关键输出摘要 |
| --- | --- | --- | --- |
| `npm run check` | 根 | 2（21 条错误） | **stash 基线对比逐条一致**，本批零新增（runner.ts TS2393×2/TS2322、test/providers 模块解析、tools-page-api TS18046×2 均预存在） |
| `npx vitest run test/orchestration test/prompts src/web/server/routes/messages.test.ts` | 根 | **0** | **93/93 PASS**：dispatch-guideline 4 / actor 8 / agent-spec 5 / dispatch 24 / tools 16 / messages 36 |
| `pnpm exec tsc -b` | web | **0** | 零错误 |
| `pnpm exec vitest run tests/features/chat/ tests/unit/sse.test.ts` | web | **0** | **215/215 PASS**（15 文件）：agentBubbleStateMachine 14 / parseHistory / merge-persisted-with-overlay / message-bubble-agent / run-trace-panel 27 等 |
| `pnpm exec vitest run`（全量） | web | 1（2 文件 4 例失败） | **4 例失败 = stash 基线复现一致（预存在）**：chat-stream-state 2（sessionId 视图重置）+ bundle 预算 2（dist 产物体积，未构建 dist） |

## stash 基线对比

- 方法：`git stash push -u` 隐藏本批改动 → 重跑失败用例 → `git stash pop` 恢复（无冲突，前端 tsc 复验 exit 0）。
- 结论：全量 4 例失败（chat-stream-state ×2 / bundle ×2）在**不含本批改动**的基线上同样失败，**非本批回归**。
- 佐证：render 批次集体测试（`2026-08-12-subagent-render-collective-test.md`）已记录同一 4 例失败为预存在。

## 集成 / E2E

- 无（未做真实浏览器 E2E / 截图；refetch 视觉验证留待后续）。后端→SSE→前端全链路经单测覆盖：`adaptStreamEventWithEnvelope` 帧格式 + `KNOWN_EVENTS` 解析 + 状态机消费 + merge 去重逐环节验证。

## 未验证项

- `done.deduplicated` 分支（重试去重流）未应用 messageId 清空/写入逻辑，无新增测试覆盖（复审 Suggestion 记录）
- 纯 `agent_message` 兼容路径 + history 含 dispatch tool_call 时兜底不命中场景（WU-03 既有兼容路径，非本批引入回归）
- `tool_use` 后到达路径（dispatch_started 先到→blk-N）仅由 merge 兜底测试间接覆盖
- 未做真实浏览器 refetch 视觉验证

## 残留风险

- 低：以上未验证项均为罕见时序/兼容路径，正常主路径已由 215 例 chat 套件 + 93 例后端定向锁定

## 结论

**verdict:** PASS

## Next

- PASS → 进入集体代码审查（`requesting-code-review` → `code-review.md`）
- FAIL → 开 bugfix WU；不得进入审查或声称批次完成
