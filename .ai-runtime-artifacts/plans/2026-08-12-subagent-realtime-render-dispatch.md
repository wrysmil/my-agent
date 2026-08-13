---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-12-subagent-realtime-render-plan.md
skills:
  - orchestration
skills_evidence:
  - orchestration@harness-kit/.agents/skills/orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-12-subagent-realtime-render-spec.md
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-realtime-render-plan.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
created_at: 2026-08-12
---

# 子 Agent 实时流式气泡渲染 — Harness 执行图

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。
> Worktree 决策：**主 checkout 直接执行**（用户确认；render 批次基线未提交，worktree 缺基线）。`worktree_path: n/a`。

## 执行图

```markdown
GROUP-1（后端事件源，必须先落）:
  WU-01: WorkerProgressEvent 增加 dispatch_started / worker_step_start / worker_text_delta / worker_step_end / dispatch_done；dispatch_to/hand_off_to 执行前后 emit dispatch_started/dispatch_done（run_worker 不 emit）；runNestedDispatch 流式路径 emit worker_step_start/worker_text_delta/worker_step_end；my-agent-web.ts 转发为 SSE；messages.ts 适配 | 标题: 后端新 SSE 事件源 | 文件: src/orchestration/dispatch.ts, src/orchestration/tools.ts, bin/my-agent-web.ts, src/web/server/routes/messages.ts, src/shared/types.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-2（前端数据层，依赖 WU-01 的事件形态）:
  WU-02: sse.ts KNOWN_EVENTS 追加 5 事件；handleSseEvent 新增 case（createAgentBubble / pushInternalBlock / appendText / finalizeBlock / closeAgentBubble + mainResume）；types.ts agent 消息 internalBlocks 或复用 blocks | 标题: 前端 SSE 路由 + Agent 气泡状态机 | 文件: web/src/features/chat/useChatStream.ts, web/src/lib/sse.ts, web/src/features/chat/types.ts | 依赖: WU-01 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto

GROUP-3（渲染 + history，均依赖 WU-02，文件不相交可并行）:
  WU-03: MessageBubble role='agent' 分支渲染 role-line/summary-line/可折叠 agent-trace/typewriter/状态；样式对齐 v3.4 mockup | 标题: MessageBubble Agent 气泡渲染 | 文件: web/src/components/chat/MessageBubble.tsx, web/tests/features/chat/message-bubble-agent.test.tsx | 依赖: WU-02 | wu_type: ui | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto
  WU-04: rebuildDispatchAgentMessages 增强（internalBlocks 派生）；run_worker 不生成气泡；主 Agent 多气泡按 messageId/runId 重建 | 标题: History 路径增强 + run_worker 语义 | 文件: web/src/features/chat/useChatStream.ts, web/tests/features/chat/useChatStream.parseHistory.test.ts | 依赖: WU-02 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: n/a | branch: n/a | wu_skills: auto
```

## 依赖说明

- **WU-01 → WU-02**：前端 SSE 路由依赖后端新事件的事件名与字段形态（dispatch_started / worker_step_start / worker_text_delta / worker_step_end / dispatch_done）。
- **WU-02 → WU-03**：MessageBubble 渲染依赖 types.ts 中 agent 消息结构（internalBlocks 或 blocks 承载步骤）。
- **WU-02 → WU-04**：history 派生依赖 WU-02 的事件路由 / store 实现落定。
- **WU-03 / WU-04 文件不相交**（MessageBubble.tsx + 组件测试 vs useChatStream.ts + parseHistory 测试），同批并行。

## 并行批次

- **Batch 1**：WU-01（后端事件源）
- **Batch 2**：WU-02（前端数据层 + 状态机）
- **Batch 3**：WU-03 + WU-04（渲染 / history，并行）
- **尾盘**：集体测试 → 集体审查（reviewer + security-auditor）→ execution-log

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-12 | 初稿。按实际代码链路把 WU-01 范围扩展为 dispatch.ts/tools.ts/my-agent-web.ts/messages.ts/shared/types.ts（plan 已授权 WorkerProgressEvent 扩展）；WU-02/03/04 同 plan；执行位置改为主 checkout（render 基线未提交，worktree 缺基线） |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改 plan 任务、不改并行策略 → 仅改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅
