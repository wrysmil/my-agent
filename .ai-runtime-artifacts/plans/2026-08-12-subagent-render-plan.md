---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
  - source-driven-development
  - test-driven-development
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/，仅 .cursor/skills/writing-plans 空目录；按 overlay + 项目既有 plan 结构执行)
  - source-driven-development@harness-kit/.agents/skills/source-driven-development/SKILL.md
  - test-driven-development@harness-kit/.agents/skills/test-driven-development/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-12-subagent-render-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-12-subagent-render-spec.md
  - .superpowers/brainstorm/subagent-render-v2/content/index.html
  - harness-kit/core/routing.md
  - harness-kit/references/definition-of-done.md
  - harness-kit/references/testing-patterns.md
created_at: 2026-08-12
status: draft
approved: false
tier: 2
---

# Plan — 子 Agent 调度渲染（run_worker / dispatch_to / hand_off_to）

> 多 WU、前后端跨模块，Tier 2 编排。dispatch 见同 stem `*-dispatch.md`。
> 实现顺序：后端契约 → 前端数据层 → 前端组件 → prompt → 验证。

## Goal

让三个调度工具（run_worker / dispatch_to / hand_off_to）在前端有正确的可视化：
- 子 Agent 工具步骤平铺 + 绿色「coder」徽章（方案 B）
- dispatch_to / hand_off_to 可见回复独立成绿色 agent 气泡（方案 C）
- 三工具中文可读名（派生子 Agent / 派发子 Agent / 移交子 Agent）
- run_worker XML 信封剥离
- system prompt 加入调度工具使用指引（CLI + web 双端）

## Architecture / Tech Stack

- 后端：Node 22 + TypeScript ESM，`src/` 源码，`bin/` 入口
- 前端：React 18 + TypeScript + Zustand + Tailwind，`web/src/`
- 测试：vitest（后端 `test/`，前端 `web/tests/`）
- 验证命令：
  - 后端类型：`npm run check`
  - 后端单测：`npx vitest run test/orchestration src/web/server/routes/messages.test.ts`
  - 前端类型：`pnpm -C web exec tsc -b`
  - 前端单测：`pnpm -C web exec vitest run tests/features/chat/ tests/components/chat/`

## WU 划分与依赖图

```
WU-1 后端契约（StreamEvent + WorkerProgressEvent + agent_reply 事件）
  ↓
WU-2 后端接线（tools.ts 发 agent_reply / my-agent-web.ts 转发 actor + agent_message / messages.ts SSE 透传）
  ↓
WU-3 前端数据层（types.ts / useChatStream.ts / runTrace.ts）
  ↓
WU-4 前端组件（RunTracePanel / MessageBubble / MessageList）
  ↓
WU-5 prompt 指引（dispatch-guideline.ts + chat.ts + my-agent-web.ts）
  ↓
WU-6 验证 + verification-lite
```

WU-1 → WU-2 强依赖（类型先行）；WU-3/WU-4 依赖 WU-1/WU-2（SSE 事件形态）；WU-5 独立可并行；WU-6 最后。

## Task 列表

### WU-1 — 后端契约类型扩展

**文件**：
1. `src/shared/types.ts` — `StreamEvent` 增加 `agent_message` 事件；`tool_start`/`tool_end` 加可选 `actorName`/`actorKind`：
   ```ts
   | { type: "agent_message"; actorId: string; actorName: string; actorKind: string; text: string; isFinal: boolean }
   // tool_start 增加: actorName?: string; actorKind?: string
   // tool_end 增加: actorName?: string; actorKind?: string
   ```
2. `src/orchestration/dispatch.ts` — `WorkerProgressEvent` 增加：
   ```ts
   | { type: "agent_reply"; actor: Actor; text: string; isFinal: boolean }
   ```
   并新增导出 `unwrapWorkerPayload(result: string): string`：剥离 `<worker-result>`/`<worker-error>`（含 `aborted` 属性）+ XML 实体反转义（`&lt;`/`&gt;`/`&amp;`/`&quot;`/`&apos;`）。

**done criteria**：`npm run check` 中 `src/shared/types.ts` / `src/orchestration/dispatch.ts` 无错误；`WorkerProgressEvent` 联合类型包含 `agent_reply`。

### WU-2 — 后端接线（tools.ts 发 agent_reply / web 转发 / SSE 透传）

**文件**：
1. `src/orchestration/tools.ts` — `dispatch_to` / `hand_off_to` 的 `execute` 完成后调用 `opts.onWorkerEvent({ type: "agent_reply", actor, text: unwrapWorkerPayload(result), isFinal })`（**text 必须剥离信封**，否则气泡显示 XML）；返回给 commander 的 `content` 保留（不再依赖前缀解析，但前缀保留不影响 commander）。**CLI `chat.ts` 的 onWorkerEvent 不消费 `agent_reply`（行为不变），不改 CLI 此回调。**
2. `bin/my-agent-web.ts` — `onWorkerEvent`：
   - `tool_start`/`tool_end` 转发时补 `actorName: ev.actor.name, actorKind: ev.actor.kind`
   - 新增 `case "agent_reply"` → 入队 `{ type: "agent_message", actorId, actorName, actorKind, text: ev.text, isFinal }`（text 已是纯文本）
   - **同文件 `buildSystemPrompt` 的 `extraSystemPrompt` 追加 `DISPATCH_GUIDELINE`**（吸收原 WU-05 的 web 侧，避免并行文件冲突）
3. `src/web/server/routes/messages.ts` — `adaptStreamEventWithEnvelope`：
   - `tool_start`/`tool_end` 分支透传 `actorName`/`actorKind`（可选，缺省不写）
   - 新增 `case "agent_message"` → `emit("agent_message", { type: "agent_message", actorId, actorName, actorKind, text, isFinal })`

**done criteria**：
- dispatch_to/hand_off_to 触发 `agent_reply` 回调（`test/orchestration/tools.test.ts` 覆盖）
- SSE `agent_message` 帧透传（`messages.test.ts` 覆盖）
- `tool_use`/`tool_result` 帧带 actor 字段

### WU-3 — 前端数据层

**文件**：
1. `web/src/features/chat/types.ts`：
   - `Block`/`ToolCallBlock`/`ToolResultBlock` 加可选 `actorName`/`actorKind`
   - `ChatMessage.role` 扩展 `'user' | 'assistant' | 'agent'`
   - `ChatMessage` 加可选 `actorName`/`isFinal`
   - 新增 `SseAgentMessageData`（`type: 'agent_message'` + 字段）
2. `web/src/features/chat/useChatStream.ts`：
   - `agent_message` SSE → 创建 `role: 'agent'` 消息（`actorName`/`isFinal`），新增 `insertAgentMessage(msgs, runId, agentMsg)`：锚定该 run 最后一条 `assistant` 之后 `splice` 插入，挂 `runId`，`id` 用 `nextBlockId()` 风格
   - tool block 记录 `actorName`/`actorKind`
3. `web/src/features/chat/runTrace.ts`：
   - `ToolTraceStep` 加可选 `actorName`/`actorKind`
   - `TOOL_ACTION_LABELS` 加：`run_worker: '派生子 Agent'`、`dispatch_to: '派发子 Agent'`、`hand_off_to: '移交子 Agent'`
   - 新增 `stripWorkerEnvelope(text: string): string` 纯函数：剥离 `<worker-result>`/`<worker-error>` 标签 **+ XML 实体反转义**（信封 body 是 `escapeXml` 转义的）
   - `resultDetail` 走 `stripWorkerEnvelope`
   - **dispatch_to / hand_off_to 步骤的 `resultDetail` 用简短确认文案**（如「已回复用户（见上方子 Agent 气泡）」），避免与 agent 气泡双显示

**done criteria**：组件层拿到带 `actorName` 的 step / 消息；中文映射生效；XML 剥离有单测。

### WU-4 — 前端组件渲染

**文件**：
1. `web/src/components/chat/RunTracePanel.tsx` — `ToolStepRow`：
   - `step.actorName` 存在时在 name-chip 旁渲染绿色 `badge-agent`（`actorName`）
   - 卡片左缘绿色描边（`border-left: 3px solid var(--agent)`）
2. `web/src/components/chat/MessageBubble.tsx` — `role === 'agent'` 分支：
   - 绿色 agent 气泡（头像 + `actorName` + 标签「子 Agent 回复」/「最终回答」+ markdown 内容）
   - 样式对齐 mockup v2 `.agent-bubble`
3. `web/src/components/chat/MessageList.tsx` — 透传 `role: 'agent'` 消息（无需大改，确认不渲染空气泡）

**done criteria**：组件测试覆盖 agent 气泡 + 徽章 + 描边；mockup v2 视觉对齐。

### WU-5 — Prompt 调度指引

**文件**：
1. `src/prompts/dispatch-guideline.ts`（新增）— 共享中文指引常量 `DISPATCH_GUIDELINE`
2. `chat.ts` — `buildSystemPrompt` 的 `extraSystemPrompt` 追加 `DISPATCH_GUIDELINE`
3. **不含 `bin/my-agent-web.ts`**（其 prompt 追加并入 WU-02，避免同文件并行冲突）

**done criteria**：CLI 与 web（WU-02 侧）prompt 均含指引；`npm run check` 通过；有单测断言常量内容非空。

### WU-6 — 验证 + verification-lite

**命令**：
```powershell
Set-Location "d:\studyspace\project\my-agent"
npm run check
npx vitest run test/orchestration src/web/server/routes/messages.test.ts
Set-Location "d:\studyspace\project\my-agent\web"
pnpm exec tsc -b
pnpm exec vitest run tests/features/chat/
```

**覆盖补充**：
- `unwrapWorkerPayload` 单测（剥离 + 反转义边界：内容含 `<`/`&`/引号；`aborted` 属性）
- `tools.test.ts` 断言 `agent_reply.text` 不含 `<worker-result`
- endTurn 时序：hand_off_to 场景断言 SSE `agent_message` 帧在 `done` 帧前输出

**产物**：`.ai-runtime-artifacts/verifications/2026-08-12-subagent-render-verification-lite.md`

## 风险点

1. **agent 消息顺序**：`agent_message` 插入到该 run 最后一条 assistant 之后、下一个 user 之前；`insertAgentMessage` 算法在 WU-3 锁测试（WU-3/WU-4 联合验证）。
2. **history 回放**：agent 消息不持久化 → 回放路径无 `role: 'agent'`，前端需静默（不渲染空气泡）。dispatch_to/hand_off_to 的 tool_result 仍在 history（现状），回放时按简短确认策略显示。
3. **`isFinal`（hand_off_to）**：验证 endTurn 语义下 `agent_message` 帧在 `done` 前输出（WU-6 集成断言）。
4. **StreamEvent 类型扩展**：`tool_start`/`tool_end` 加可选字段，确认现有消费方（SSE 适配层 / CLI）不受影响。
5. **dispatch_to/hand_off_to 现有测试**：改触发 `agent_reply` 后，`tools.test.ts` 中依赖返回 `content` 前缀的断言需同步更新。
6. **双显示**：agent 气泡承载正文、trace 只留简短确认——WU-3 的 resultDetail 策略 + WU-4 视觉验证。
7. **CLI 不消费 `agent_reply`**：`chat.ts` onWorkerEvent 行为不变（仍显示前缀字符串 tool_result），WU-2 不改该回调。

## References 检查

- `harness-kit/references/definition-of-done.md`：✅ 视觉/DOM 双轴（WU-4）；无重复逻辑（WU-3 `stripWorkerEnvelope` 单点）；tsc + vitest 跑过（WU-6）。
- `harness-kit/references/testing-patterns.md`：✅ AAA；WU-3 纯函数（`stripWorkerEnvelope`）可测；mock 最小化。

## Next

**（写入后暂停 — routing.md § 阶段门禁）**

- 确认 plan → 说「开始实现」或「并行执行」
- 调整 plan → 直接说修改意见
- 想先看 dispatch 拆解 → 审 `.ai-runtime-artifacts/plans/2026-08-12-subagent-render-dispatch.md`
