---
artifact: collective-test
route: verification-before-completion
plan: .ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md
skills:
  - verification-before-completion
skills_evidence:
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-dispatch.md
  - .ai-runtime-artifacts/verifications/2026-08-12-subagent-render-verification-lite.md
created_at: 2026-08-12
---

# 子 Agent 调度渲染 — 集体测试

## 批次范围

WU-01 后端契约 / WU-02 后端接线 / WU-05 CLI prompt / WU-03 前端数据层 / WU-04 前端组件 + sse.ts P0 / WU-06 验证产物。

## 测试执行（Leader 实测，非转述子 Agent）

| # | 命令（cwd） | 结果 | 摘要 |
|---|---|---|---|
| 1 | `npm run check`（根） | PASS（零新增） | 21 条基线错误经 `git stash` 对比逐条一致；被改文件零新增（WU-06 证据 + Leader 复核） |
| 2 | `npx vitest run test/orchestration test/prompts src/web/server/routes/messages.test.ts`（根） | **PASS 85/85** | 6 文件：dispatch-guideline 4 / actor 8 / agent-spec 5 / dispatch 22 / tools 13 / messages 33 |
| 3 | `pnpm exec tsc -b`（web） | **PASS exit 0** | 零错误 |
| 4 | `pnpm exec vitest run tests/features/chat/ tests/unit/sse.test.ts`（web） | **PASS 178/178** | 13 文件：含新增 use-chat-stream-agent-message 7 / message-bubble-agent 4 / run-trace-panel 27 / sse agent_message |
| 5 | `pnpm exec vitest run tests/unit/`（web，补充） | 4 失败 = 预存在 | bundle 预算 2 + chat-stream-state 2，stash 基线复现一致，非本批引入 |

## 契约核对（11 点，源码逐点对照）

1. `types.ts` StreamEvent：`tool_start`/`tool_end` 可选 `actorName`/`actorKind` + `agent_message` 事件 — PASS
2. `dispatch.ts`：`WorkerProgressEvent.agent_reply` + `unwrapWorkerPayload` 剥离/反转义 — PASS
3. `tools.ts`：dispatch_to/hand_off_to 触发 `agent_reply`，text 无信封 — PASS
4. `my-agent-web.ts`：actor 透传 + `agent_reply`→`agent_message` + `DISPATCH_GUIDELINE` 追加 — PASS
5. `messages.ts`：`tool_use`/`tool_result` 带 `actor_name`/`actor_kind`；`agent_message` 帧 — PASS
6. `chat.ts`：prompt 追加 `DISPATCH_GUIDELINE`；onWorkerEvent 未改 — PASS
7. 前端 `types.ts`：`role: 'agent'` + `SseAgentMessageData` — PASS
8. `useChatStream.ts`：`insertAgentMessage` 锚定最后一条 assistant 后 — PASS
9. `runTrace.ts`：三中文名 + `stripWorkerEnvelope` + dispatch 简短确认 — PASS
10. `RunTracePanel`/`MessageBubble`：徽章 + 绿描边 + agent 气泡（「子 Agent 回复」/「最终回答」）— PASS
11. `web/src/lib/sse.ts`：`KNOWN_EVENTS` 含 `agent_message`（P0 已修）— PASS

## 尾盘修复（集体审查后）

- `chat.ts` — `undefined` 拼接守卫（reviewer + security 双点名）：`[systemPrompt, DISPATCH_GUIDELINE].filter(Boolean).join("\n\n")`
- `runTrace.ts` — stripWorkerEnvelope 仅限 `run_worker`，普通工具保留原文（防误剥）
- `messages.test.ts` — 新增「agent_message 帧在 tool_result 之后、done 之前」时序断言（34/34）
- 复验：后端 messages.test.ts 34/34；前端 tsc -b 零错 + runTrace/run-trace-panel 69/69

## 已知限制（非本批范围）

- worker 活动不持久化：刷新后 agent 气泡不显示，trace 内 dispatch_to/hand_off_to 按简短确认策略降级展示（spec §3 非目标，留后续批次）
- `tools.test.ts` 依赖 dispatch content 前缀的断言保持现状（commander 上下文契约不变）

## References 检查

- `harness-kit/references/definition-of-done.md`：
  - Correctness ✅ 验收全过（spec §8 对照）；运行时验证 ✅（测试 + tsc 实测）；新增行为有测试且 RED→GREEN ✅；无回归 ✅；边界（unwrap 空串/无信封/转义实体）✅
  - Quality ✅ 无重复逻辑（unwrap 前后端各持一份等价实现并有各自单测；中文映射单点）；无死代码；改动范围限定 WU 文件
  - Integration ✅ 后端事件流 → SSE → 前端渲染全链路打通；`StreamEvent`/`WorkerProgressEvent` 均为向后兼容扩展；SSE 协议未改（仅新增事件名）
  - Documentation ⚠️ 调度指引已入 system prompt（面向模型的"文档"）；spec/plan 已落盘 `.ai-runtime-artifacts/`；UI 行为已在 mockup v2 与验收节定义
  - Ship-readiness ✅ 安全审查（独立 security-auditor 见 `*-code-review.md`/`*-security-review.md`）；可观测性=既有日志路径（SSE 帧转发无新增关键路径）；回滚=本批可整体 revert 无迁移
- `harness-kit/references/testing-patterns.md`：✅ AAA 全覆盖；纯函数（unwrap/stripWorkerEnvelope/insertAgentMessage）可测；mock 最小化（onWorkerEvent 用 mock 断言事件，未 mock 业务层）

## 结论

**PASS** — 集体测试通过。转 B 集体审查（reviewer + security-auditor）。

## Next

- 审查产物齐备 + 全部 PASS → 批次完成声明（execution-log）
- 任一 BLOCK → 对应修复后重审
