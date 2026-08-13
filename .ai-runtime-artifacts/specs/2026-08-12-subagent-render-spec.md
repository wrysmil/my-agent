---
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
skills_evidence:
  - skipped: brainstorming (skill 正文本体缺失于 .cursor/skills/brainstorming，仅 .DS_Store；按 spec.harness-overlay.md 流程与项目既有 spec 结构执行)
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md（v4 双气泡，已落地）
  - .ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md（runTrace 派生层契约）
  - .superpowers/brainstorm/subagent-render-v2/content/index.html（推荐方案 B+C mockup，用户已确认）
  - 用户确认：方案 B+C、三工具中文可读名、调度工具使用指引加入 system prompt
  - 会话查证：bin/my-agent-web.ts onWorkerEvent 转发、Actor 类型、dispatch_to/hand_off_to 返回值格式
status: draft
approved: false
created_at: 2026-08-12
---

# 子 Agent 调度渲染（run_worker / dispatch_to / hand_off_to 前端呈现）

# 1. 背景

后端已注入三个调度工具（上一批修复，`bin/my-agent-web.ts`），worker 事件会实时转发：
`onWorkerEvent(tool_start/tool_end)` → `StreamEvent(id: sub:xxx)` → SSE 适配层 → `tool_use`/`tool_result` 帧 → 前端 `useChatStream` 建块 → `runTrace` 派生 → `RunTracePanel` 渲染。

但前端渲染存在 4 个缺口：

1. **子 Agent 身份丢失**：worker 事件 id 是 `sub:${actorId}:${seq}`，`onWorkerEvent` 转发时**只取 `ev.actor.id`，丢弃 `ev.actor.name` / `ev.actor.kind`** → 前端无法显示「coder」徽章，只能当普通工具平铺。
2. **dispatch_to / hand_off_to 的可见回复没有独立气泡**：这两个工具的结果是带前缀字符串（`\n## 💬 name 说：\n\n…` / `\n## 🎯 name 回答：\n\n…`）作为 tool_result 返回，前端只在 trace 里当普通工具结果展示，语义（"这是子 Agent 直接对用户说的话"）丢失。
3. **run_worker 结果带 XML 信封**：`dispatch.ts` 返回 `<worker-result from="...">` XML，前端直接展示原始 XML，不友好。
4. **worker 活动不持久化**：worker 事件只在实时 SSE 里转发，不写 session 历史；刷新后只剩 run_worker 的 XML 结果。

此外，**system prompt 只渲染了三个工具的一行 summary**（`getToolsSystemPromptBlock` → `catalog.ts` 的 `summary`），未包含"何时用、结果用户怎么看"的用法指引；模型靠工具 `description` 字段（英文）理解语义，但不知道"可见回复会变成绿色气泡"。

# 2. 目标

- **方案 B（trace 内平铺 + 徽章）**：子 Agent 的工具步骤在主 trace 里平铺，附绿色「`coder`」徽章 + 左侧绿色描边标识归属。
- **方案 C（独立 Agent 气泡）**：dispatch_to / hand_off_to 的可见回复渲染为独立绿色气泡（头像 + 名字 + 「子 Agent 回复」/「最终回答」标签）。
- **三个工具的中文可读名**：`run_worker → 派生子 Agent`、`dispatch_to → 派发子 Agent`、`hand_off_to → 移交子 Agent`，进 `toolActionLabel` 映射。
- **调度工具使用指引进入 system prompt**（CLI + web 双端），明确"何时用哪个 + 结果用户怎么看"。
- run_worker 的 XML 信封在前端渲染层剥离，展示纯文本。

# 3. 非目标

- **不持久化 worker 活动**：子 Agent 过程仅实时展示，刷新后不保留（留后续批次）。run_worker 最终 XML 结果仍在 history 中（现状不变）。
- 不改 SSE envelope 协议（`{sessionId, runId, streamId, seq, event, data}`）——只**新增事件类型**，不改现有帧。
- 不改 `ChatStreamEnvelope`、不改 JSONL 持久化协议。
- 不重写 `RunTracePanel` 整体交互（沿用 v4 双气泡结构）。

# 4. 设计

## 4.1 中文可读名（`runTrace.ts` 的 `TOOL_ACTION_LABELS`）

| 工具名 | 中文可读名 | 语义 |
|---|---|---|
| `run_worker` | 派生子 Agent | 私密结果只回主 Agent |
| `dispatch_to` | 派发子 Agent | 回复对用户可见，主 Agent 继续 |
| `hand_off_to` | 移交子 Agent | 子 Agent 直接回答，本轮结束 |

## 4.2 数据契约缺口修复：actor 身份透传

**现状缺口**：`bin/my-agent-web.ts` 的 `onWorkerEvent` 只取 `ev.actor.id`。

**修复**：转发 worker 事件时携带 `actorName` / `actorKind`：

- `StreamEvent.tool_start` / `tool_end` 增加**可选**字段：
  ```typescript
  { type: "tool_start"; name: string; id: string; input: unknown; actorName?: string; actorKind?: ActorKind }
  { type: "tool_end"; name: string; id: string; result: string; isError?: boolean; durationMs?: number; actorName?: string; actorKind?: ActorKind }
  ```
- `bin/my-agent-web.ts` 转发时补上 `actorName: ev.actor.name, actorKind: ev.actor.kind`。
- SSE 适配层 `adaptStreamEventWithEnvelope` 的 `tool_start`/`tool_end` 分支**透传**这两个字段到 `tool_use`/`tool_result` 帧（可选字段，缺省不写）。

**前端消费**：
- `useChatStream` 建 `tool_call`/`tool_result` block 时读 `actorName`/`actorKind`（可选），存入 block。
- `runTrace.ts` 的 `ToolTraceStep` 增加**可选** `actorName`/`actorKind`；派生时从 block 带出。
- `RunTracePanel` 的 `ToolStepRow`：当 `step.actorName` 存在时，在 name-chip 旁渲染绿色 `badge-agent`（`actorName`）+ 卡片左缘加绿色描边（`border-left: 3px solid`）。

## 4.3 可见回复 → 独立 Agent 气泡（方案 C）

**契约缺口**：dispatch_to / hand_off_to 结果是带前缀字符串，无法结构化。

**修复**：新增 `agent_message` 事件承载可见回复，与 tool_result 解耦：

- `WorkerProgressEvent` 增加一种类型：
  ```typescript
  | { type: "agent_reply"; actor: Actor; text: string; isFinal: boolean }
  ```
  `isFinal: true` 表示 hand_off_to（该气泡即最终答案）；`false` 表示 dispatch_to（主 Agent 还会收尾）。
  **⚠️ `text` 必须是剥离 XML 信封 + 反转义后的纯文本**（走 `unwrapWorkerPayload`，见 §4.4）——禁止直接传 `runNestedDispatch` 的原始 `result`（那是 `<worker-result from="...">` 信封，前端气泡会渲染原始 XML）。
- `src/orchestration/tools.ts` 的 `dispatch_to` / `hand_off_to` 工具 `execute` 完成后，**不再依赖字符串前缀**，改调 `opts.onWorkerEvent({ type: "agent_reply", actor, text: unwrapWorkerPayload(result), isFinal })`；返回给 commander 的 `content` 保留原样（commander 上下文需要），但不再依赖前缀解析。
- `bin/my-agent-web.ts` 的 `onWorkerEvent` 处理 `agent_reply`：入队一个新的 `StreamEvent`：
  ```typescript
  { type: "agent_message"; actorId: string; actorName: string; actorKind: string; text: string; isFinal: boolean }
  ```
- SSE 适配层 `adaptStreamEventWithEnvelope` 增加 `case "agent_message"` → `emit("agent_message", {...})`。
- 前端 `useChatStream` 处理 `agent_message` SSE：创建 `role: "agent"` 的 `ChatMessage`（新增可选 `actorName`/`isFinal` 字段），插入到当前 assistant 消息之后。一个 run 内多个 `agent_message` 按顺序追加。
  **插入算法**：新增 `insertAgentMessage(msgs, runId, agentMsg)` — 定位该 run 最后一条 `role: 'assistant'` 消息的 index，在其后 `splice` 插入；agent 消息挂 `runId`。多个 agent_message 按到达顺序依次插入（每个都锚定「该 run 最后一条 assistant」之后，天然有序）。agent 消息 `id` 用现有 `nextBlockId()` 风格生成。
- `ChatMessage.role` 扩展为 `'user' | 'assistant' | 'agent'`。
- `MessageBubble` 增加 `role === 'agent'` 分支：渲染绿色 agent 气泡（绿色底 + 头像 + `actorName` + 标签「子 Agent 回复」/「最终回答」+ markdown 内容），样式对齐 mockup v2 的 `.agent-bubble`。

**trace 中 dispatch_to / hand_off_to 的 tool_result 呈现（避免与 agent 气泡双显示）**：
- 该步骤的 `resultDetail` 只展示简短确认文案（如「已回复用户（见上方子 Agent 气泡）」），不再显示完整结果正文；
- `resultPreview` 沿用截断；`stripWorkerEnvelope` 仍对其生效（history 回放路径兜底，保证旧数据不裸奔 XML）；
- 实时路径下 agent 气泡承载正文，trace 只留调度痕迹；回放路径（无气泡）下 trace 显示剥离后的结果（内容降级为文本，可接受）。

## 4.4 run_worker XML 信封剥离

- `runTrace.ts` 新增 `stripWorkerEnvelope(text: string): string` 纯函数（可测），语义 = **剥离 `<worker-result from="...">` / `<worker-error from="...">` 标签 + XML 实体反转义**（`dispatch.ts` 的 `buildWorkerResultPayload` 用 `escapeXml` 转义了 body，剥离标签后须反转义 `&lt;`/`&gt;`/`&amp;`/`&quot;`/`&apos;`，否则渲染出 `&lt;div&gt;` 而非 `<div>`）。
- 后端 `src/orchestration/dispatch.ts` 新增配套导出 `unwrapWorkerPayload(result: string): string`（供 `tools.ts` 的 `agent_reply.text` 使用，剥离 + 反转义）。两个函数逻辑同源（后端信源、前端渲染层各持一份等价实现），用各自的单测锁语义。
- `ToolTraceStep.resultDetail` 走 `stripWorkerEnvelope`；`resultPreview` 沿用现有截断。
- **dispatch_to / hand_off_to 的 tool_result 在 trace 中只展示简短确认**（见 §4.3「双显示」策略），不再重复 agent 气泡正文；`stripWorkerEnvelope` 仍对其生效（history 回放路径兜底，保证旧数据不裸奔 XML）。

## 4.5 System Prompt 调度指引

在 `webSystemPrompt`（`bin/my-agent-web.ts`）与 CLI（`chat.ts`）的 `buildSystemPrompt` 中，向 `extraSystemPrompt` **追加**一段中文指引（统一文案，建议下沉到共享常量或 `system-prompt-builder` 的可选参数）：

```text
子 Agent 调度（当任务适合拆给专职 agent 时优先使用）：
- run_worker 派生子 Agent：子任务结果私密，只回主 Agent 综合，用户只看到最终综合回答；适合并行调研、代码生成、扫描等。
- dispatch_to 派发子 Agent：子 Agent 的回复用户可见（绿色气泡）；适合用户明确想看子 Agent 产出的场景，主 Agent 继续收尾。
- hand_off_to 移交子 Agent：完全交给子 Agent 回答，本轮结束；仅当任务完全归属该专职 agent 且无需主 Agent 收尾时使用。
```

**落点**：
- `bin/my-agent-web.ts`：`buildSystemPrompt({ extraSystemPrompt: config.agent.systemPrompt + dispatchGuideline, toolsBlock })`。
- `chat.ts`：同构追加。
- 建议把 `dispatchGuideline` 定义为共享常量（如 `src/prompts/dispatch-guideline.ts`），双端引用，避免复制。

# 5. 数据 / 接口

## 5.1 后端

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | `StreamEvent` 增加 `agent_message` 事件；`tool_start`/`tool_end` 加可选 `actorName`/`actorKind` |
| `src/orchestration/dispatch.ts` | `WorkerProgressEvent` 增加 `agent_reply` 类型；新增导出 `unwrapWorkerPayload(result)`（剥离信封 + 反转义） |
| `src/orchestration/tools.ts` | dispatch_to / hand_off_to 完成后发 `agent_reply`（`text` 用 `unwrapWorkerPayload` 纯文本，替代字符串前缀语义） |
| `src/web/server/routes/messages.ts` | `adaptStreamEventWithEnvelope`：`tool_start`/`tool_end` 透传 actor 字段；新增 `case "agent_message"` |
| `bin/my-agent-web.ts` | `onWorkerEvent` 转发 actor 身份；处理 `agent_reply` → `agent_message` 入队 |
| `src/prompts/dispatch-guideline.ts`（新增） | 共享调度指引常量 |
| `chat.ts` | 追加 dispatchGuideline |

## 5.2 前端

| 文件 | 改动 |
|---|---|
| `web/src/features/chat/types.ts` | `Block`/`ToolCallBlock`/`ToolResultBlock` 加可选 `actorName`/`actorKind`；`ChatMessage.role` 加 `'agent'`；`ChatMessage` 加可选 `actorName`/`isFinal`；新增 `SseAgentMessageData` |
| `web/src/features/chat/useChatStream.ts` | 处理 `agent_message` → 创建 agent 消息；tool block 记录 actor 字段 |
| `web/src/features/chat/runTrace.ts` | `ToolTraceStep` 加可选 actor 字段；新增 `stripWorkerEnvelope`；`TOOL_ACTION_LABELS` 加三个中文名 |
| `web/src/components/chat/RunTracePanel.tsx` | `ToolStepRow` 渲染 `badge-agent` + 绿色左描边 |
| `web/src/components/chat/MessageBubble.tsx` | `role === 'agent'` 分支渲染绿色 agent 气泡 |
| `web/src/components/chat/MessageList.tsx` | 透传 `role: 'agent'` 消息（无需大改） |

# 6. 实现范围

## 6.1 不改动

- `web/src/features/chat/chatRuntimeStore.ts` 存储结构（agent 消息走现有 `ChatMessage` 数组，仅新增 role 值）
- SSE envelope、JSONL 持久化协议
- `dispatch.ts` 的 `runNestedDispatch` 主流程（仅 `WorkerProgressEvent` 类型扩展）
- `RunTracePanel` 的折叠/展开交互

## 6.2 风险点

1. **agent 消息的 run 归属**：`agent_message` 需要挂到当前 run 下，且 `MessageList` 按消息数组渲染——`insertAgentMessage` 锚定「该 run 最后一条 assistant」之后、下一个 user 之前（§4.3 已定义算法）。
2. **history 回放**：agent 消息不持久化 → 刷新后 `parseHistoryMessages` 不会产生 `role: 'agent'`，需保证前端对 `role: 'agent'` 的处理在回放路径上**缺失时静默**（不渲染空气泡）。dispatch_to/hand_off_to 的 tool_result 仍在 history 里（现状），回放时该工具结果按 §4.3 呈现策略显示剥离后内容。
3. **`isFinal`（hand_off_to）**：主 Agent 不再补充内容，前端该气泡即最终回答；`agent_reply` 在 execute 内同步入队 workerQueue，由 runStream 排空——需集成断言 `agent_message` 帧在 `done` 前输出（§7.2）。
4. **信封剥离遗漏**：`agent_reply.text` 必须走 `unwrapWorkerPayload`；`stripWorkerEnvelope` 必须含反转义——两处均已锁测试（§7.1/§7.2）。

# 7. 测试

## 7.1 单元 / 组件（vitest）

- `runTrace`：`toolActionLabel` 三映射；`stripWorkerEnvelope` 剥离 XML **+ 反转义**；`ToolTraceStep.actorName` 派生；dispatch_to/hand_off_to 步骤 resultDetail 为简短确认。
- 后端 `unwrapWorkerPayload`：剥离 `<worker-result>`/`<worker-error>`（含 aborted 属性）+ 反转义（含内容中含 `<`、`&`、引号的边界）。
- `MessageBubble`：`role: 'agent'` 渲染绿色气泡 + 标签（「子 Agent 回复」/「最终回答」）；`actorName` 显示。
- `RunTracePanel`：带 `actorName` 的 step 显示徽章 + 左描边。
- `useChatStream`：`agent_message` SSE → 创建 agent 消息；`insertAgentMessage` 锚定「该 run 最后一条 assistant」之后；多 agent_message 顺序正确。

## 7.2 集成 / E2E

- 后端：`test/orchestration/tools.test.ts` 断言 dispatch_to/hand_off_to 触发 `agent_reply`，且 `text` **已剥离信封**（不含 `<worker-result`）。
- SSE：`messages.test.ts` 断言 `agent_message` 事件透传、tool 帧带 actor 字段。
- endTurn 时序：构造 hand_off_to 场景，断言 SSE 流中 `agent_message` 帧在 `done` 帧**之前**输出。

## 7.3 tsc / lint / vitest

- `npm run check` 零新增错误（基线错误除外）
- `pnpm -C web exec tsc -b` 零误差
- 全量 vitest 相关用例通过

# 8. 验收

- ✅ 子 Agent 工具步骤在 trace 平铺，带绿色「coder」徽章 + 左缘绿描边（方案 B）
- ✅ dispatch_to 可见回复渲染为独立绿色 agent 气泡（「子 Agent 回复」标签）
- ✅ hand_off_to 渲染为「最终回答」标签的 agent 气泡
- ✅ 三工具中文可读名：派生子 Agent / 派发子 Agent / 移交子 Agent
- ✅ run_worker 结果不再显示 `<worker-result>` XML 标签
- ✅ system prompt 含调度工具使用指引（CLI + web 双端）
- ✅ 刷新后不渲染空 agent 气泡（回放路径静默）

# 9. References 检查

- `harness-kit/references/definition-of-done.md` § 视觉 / DOM / 无重复逻辑：`stripWorkerEnvelope` / `unwrapWorkerPayload` 与中文映射单点归属，不散落组件；「双显示」策略避免同一内容两处渲染
- `harness-kit/references/accessibility-checklist.md` § 颜色非唯一信息源：徽章用「文字 + 色块」双通道（green badge 带文字 `coder`，非纯色区分）
- `harness-kit/references/testing-patterns.md` § AAA；XML 剥离 + 反转义纯函数化可测（前后端各自单测锁语义）
- `harness-kit/references/orchestration-patterns.md` § 调度指引文案与工具语义对齐，避免"提示词承诺渲染不存在的形态"

# 10. Next

**（写入后暂停，等用户明确继续 — routing.md § 阶段门禁）**

- 确认方案无误 → 说「写计划」或「制定实施计划」
- 变更范围小、无需计划 → 说「直接实现」或「直接做」
- 需要调整方案 → 直接说修改意见
