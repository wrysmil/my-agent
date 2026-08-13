---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/，按 overlay + 项目既有 plan 结构执行)
  - orchestration@harness-kit/.agents/skills/orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-12-subagent-render-spec.md
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
created_at: 2026-08-12
---

# 子 Agent 调度渲染 — Harness 执行图

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```markdown
GROUP-1（后端契约，必须先落）:
  WU-01: 扩展 StreamEvent（agent_message + actor 可选字段）与 WorkerProgressEvent（agent_reply） | 标题: 后端契约类型扩展 | 文件: src/shared/types.ts, src/orchestration/dispatch.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-2（后端接线，依赖 WU-01）:
  WU-02: tools.ts 发 agent_reply（text 走 unwrapWorkerPayload）/ my-agent-web.ts 转发 actor + agent_message + buildSystemPrompt 追加 DISPATCH_GUIDELINE（吸收原 WU-05 web 侧）/ messages.ts SSE 透传 | 标题: 后端事件接线 + web prompt | 文件: src/orchestration/tools.ts, bin/my-agent-web.ts, src/web/server/routes/messages.ts | 依赖: WU-01 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-3（前端数据层 + 组件，依赖 WU-01/WU-02）:
  WU-03: 前端数据层（types.ts / useChatStream.ts / runTrace.ts，含 insertAgentMessage + stripWorkerEnvelope 反转义 + dispatch_to 简短确认） | 标题: 前端数据层扩展 | 文件: web/src/features/chat/types.ts, web/src/features/chat/useChatStream.ts, web/src/features/chat/runTrace.ts | 依赖: WU-01, WU-02 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto
  WU-04: 前端组件渲染（RunTracePanel / MessageBubble / MessageList）+ sse.ts KNOWN_EVENTS 注册 agent_message（P0：parseSseStream 会丢弃未知事件，方案 C 依赖它） | 标题: 前端组件渲染 | 文件: web/src/components/chat/RunTracePanel.tsx, web/src/components/chat/MessageBubble.tsx, web/src/components/chat/MessageList.tsx, web/src/lib/sse.ts | 依赖: WU-03 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-4（独立可并行，文件与 WU-02 不相交）:
  WU-05: dispatch-guideline.ts 共享常量 + chat.ts 追加 | 标题: CLI Prompt 调度指引 | 文件: src/prompts/dispatch-guideline.ts, chat.ts | 依赖: 无 | wu_type: feature | agent_role: implementer | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-5（收尾）:
  WU-06: 全量验证（含 unwrapWorkerPayload 单测 / agent_reply.text 无信封断言 / hand_off_to endTurn 时序断言）+ verification-lite | 标题: 验证与产物 | 文件: .ai-runtime-artifacts/verifications/2026-08-12-subagent-render-verification-lite.md | 依赖: WU-02, WU-03, WU-04, WU-05 | wu_type: test | agent_role: test-engineer | workspace_scope: none | worktree_path: n/a | branch: n/a | wu_skills: auto
```

## 依赖说明

- **WU-01 → WU-02**：类型先行，接线必须消费新类型（含 `unwrapWorkerPayload`）。
- **WU-02 → WU-03**：前端数据层必须知道 SSE 事件形态（`agent_message` + actor 字段）。
- **WU-03 → WU-04**：组件消费数据层的 step/消息结构。
- **WU-05 独立**：只改 `src/prompts/dispatch-guideline.ts` + `chat.ts`，**与 WU-02 文件不相交**（web prompt 追加已并入 WU-02），可最早并行。
- **WU-06 收尾**：所有 WU 落盘后 Leader 跑全量验证并写 verification-lite。

## 并行批次

- **Batch 1**：WU-01（后端契约）
- **Batch 2**：WU-02 + WU-05（后端接线 + CLI prompt，文件不相交，可并行）
- **Batch 3**：WU-03 + WU-04（前端，WU-04 依赖 WU-03 的类型，同批顺序执行）
- **Batch 4**：WU-06 收尾验证

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-12 | 初稿 |
| 2 | 2026-08-12 | 审查修复：WU-02 吸收 web prompt（解决与 WU-05 同文件冲突）；WU-05 收窄为 chat.ts + dispatch-guideline.ts；WU-03 增加 insertAgentMessage / stripWorkerEnvelope 反转义 / dispatch_to 简短确认；WU-06 增加 unwrapWorkerPayload 与 endTurn 时序断言 |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改 plan 任务、不改并行策略 → 仅改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅
