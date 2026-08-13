---
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .agents/skills/document-review/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-12-subagent-render-spec.md
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-plan.md
  - .ai-runtime-artifacts/plans/2026-08-12-subagent-render-dispatch.md
  - 代码核对：bin/my-agent-web.ts / src/orchestration/tools.ts / src/orchestration/dispatch.ts / src/shared/types.ts / src/web/server/routes/messages.ts / chat.ts / src/tools/catalog.ts / web/src/features/chat/{types,useChatStream,runTrace}.ts / web/src/components/chat/{MessageBubble,MessageList,RunTracePanel}.tsx
created_at: 2026-08-12
---

# 子 Agent 调度渲染 — 文档审查报告（spec + plan + dispatch）

## 文档类型
规格文档（spec）+ 实施计划（plan）+ 并行执行图（dispatch）

## 审查规则加载
- [x] 通用审查流程
- [x] 规格文档特定规则（review-rules/spec.md）
- [x] 代码现状核对（用户强调"之前交互改了很久"，逐项对照当前代码验证 spec 假设）

## 审查结果

### 1. 文档完整性 — 基本完整

spec 覆盖了 4 缺口 + prompt 指引，文件与改动点清单齐全（§5.1/§5.2），测试与验收（§7/§8）齐备。**但有 2 个实现层面的契约缺口未定义**（见 BUG-1 / BUG-2），会导致实现后直接出 bug。

### 2. 逻辑清晰度 — 基本清晰

缺口描述与当前代码**逐项核对全部属实**（onWorkerEvent 丢 actor 身份、字符串前缀、XML 信封、SSE 不透传、role 无 agent 等）。但 agent_message 的数据来源（XML 信封）与双显示问题未被识别。

### 3. 环境准备完整性 — 不适用（无外部环境依赖）

本批无新增依赖、无环境变量、无外部服务。

### 4. 缺失项清单（BUG，按优先级）

#### P0-1：agent_message.text 是 XML 信封，绿色气泡会显示原始 XML
- **证据**：`src/orchestration/dispatch.ts:233-247` 的 `buildWorkerResultPayload` 返回 `<worker-result from="...">` 信封；`runNestedDispatch` 的 result 就是它。`tools.ts` 的 dispatch_to/hand_off_to `execute` 拿到的 `result` 是完整信封。
- **spec 缺陷**：§4.3 写 `onWorkerEvent({ type: "agent_reply", actor, text: result })` → `agent_message.text` 将是 `<worker-result from="coder">\n...`。§4.4 的 `stripWorkerEnvelope` 只作用于 runTrace 的 tool_result，**未覆盖 agent_message**。
- **结果**：前端绿色气泡直接渲染 XML 标签 → 验收「dispatch_to 可见回复渲染为独立气泡」不达标。
- **修复建议**：`agent_reply` 发出前剥离信封（在 `tools.ts` 或 `dispatch.ts` 增加纯函数 `unwrapWorkerPayload(result): string`，复用 buildWorkerResultPayload 的反向逻辑），使 `agent_message.text` 即纯文本。`stripWorkerEnvelope` 保留给 run_worker 的 tool_result（history 回放路径）。

#### P0-2：dispatch_to / hand_off_to 内容双显示（agent 气泡 + trace tool_result）
- **证据**：spec §4.3 明确"返回给 commander 的 `content` 保留原样"（含 `## 💬 name 说：` 前缀 + XML 信封）→ 该 tool_result 会进 trace 且**持久化到 history**（spec §3 承认 run_worker 结果仍在 history；dispatch_to 同理）。
- **结果**：同一段内容在 agent 气泡 **和** trace 详情里各显示一次。且 history 回放时**没有 agent 气泡**（不持久化），只有 trace 里的 tool_result → 刷新后同一内容只剩 trace 里的 XML + 前缀。
- **修复建议**：spec 需明确 dispatch_to/hand_off_to 的 tool_result 在 trace 中的呈现策略。推荐：trace 中该步骤 resultDetail 改为简短确认文案（如「已回复用户（见上方子 Agent 气泡）」），不重复内容；`stripWorkerEnvelope` 对这两个工具仍生效（兜底历史回放路径）。

#### P1-3：dispatch.md 存在并行文件冲突 — WU-02 与 WU-05 同改 `bin/my-agent-web.ts`
- **证据**：WU-02 改 `bin/my-agent-web.ts` 的 `onWorkerEvent`；WU-05 改 `bin/my-agent-web.ts` 的 `buildSystemPrompt`。dispatch.md 依赖图里 WU-05 `依赖: 无`，会与 WU-02 并行 → 同一文件两处并行写。
- **修复建议**：WU-05 拆为「chat.ts + dispatch-guideline.ts」独立执行；`bin/my-agent-web.ts` 的 prompt 追加并归到 WU-02（依赖 WU-01，本就串行）。

#### P1-4：`WorkerProgressEvent` 扩展后 CLI `chat.ts` 的 onWorkerEvent switch 不处理 `agent_reply`
- **证据**：`chat.ts:455-469` switch 只有 text_delta/tool_start/tool_end，无 default。类型联合增加 `agent_reply` 后 TS 不报错（非 exhaustive），但 CLI 行为不变——CLI 下 dispatch_to 仍显示 `## 💬 name 说：` 字符串 tool_result（现状可接受）。
- **修复建议**：plan WU-2 明确「CLI 不消费 agent_reply，行为不变」，避免实现者误改 CLI 或误判为遗漏。

#### P1-5：agent_message 前端插入/更新路径未细化（useChatStream）
- **证据**：`useChatStream.ts` 的 `updateAssistantForRun` 只更新 assistant 消息；agent 消息是独立 ChatMessage，无现成插入路径。
- **spec 缺陷**：§4.3 只写"插入到当前 assistant 消息之后"，未定义：按 runId 定位最后一条 assistant 的算法、agent 消息 id 生成、多个 agent_message 的追加顺序保证。
- **修复建议**：plan WU-3 补充实现细节（新增 `insertAgentMessage(msgs, runId, agentMsg)`；agent 消息挂 runId；`message_start` 已保证 assistant 存在，插入锚点为「该 run 最后一条 assistant 之后」）。

#### P1-6：stripWorkerEnvelope 需要 XML 实体反转义
- **证据**：`dispatch.ts:235` `buildWorkerResultPayload` 用 `escapeXml` 转义 body（`<`→`&lt;`）。`stripWorkerEnvelope` 只剥标签不 unescape → 渲染 `&lt;div&gt;` 而非 `<div>`。
- **修复建议**：`stripWorkerEnvelope` 定义为「剥离标签 + 反转义」的纯函数，并配单测（含嵌套 `<`、`&` 内容）。plan 测试节已列此项，但语义要写明 unescape。

#### P2-7：plan 验证命令路径错误
- **证据**：plan WU-6 前端命令 `vitest run tests/features/chat/ tests/components/chat/`；实际**无 `web/tests/components/chat/` 目录**（组件测试在 `web/tests/features/chat/`：run-trace-panel.test.tsx、message-bubble-cycle.test.tsx 等）。
- **修复建议**：改为 `pnpm -C web exec vitest run tests/features/chat/`（或分文件列出）。后端命令 `npx vitest run test/orchestration src/web/server/routes/messages.test.ts` 路径正确（两文件均存在）。

#### P2-8：hand_off_to endTurn 时序验证方法缺失
- **证据**：`tools.ts:234` hand_off_to 返回 `endTurn: true`。agent_reply 在 execute 内同步入队 workerQueue，`my-agent-web.ts` runStream 包装在 yield 内层事件前排空 workerQueue。endTurn 后 runner 是否还 yield 事件、agent_message 是否在 done 前被排空——spec 风险点 3 提及但无验证步骤。
- **修复建议**：WU-6 集成验证加一步：构造 hand_off_to 场景，断言 SSE 流中 `agent_message` 帧在 `done` 帧之前。

### 5. 改进建议（汇总）

1. **修 spec**（P0-1/P0-2）：定义 `agent_reply.text` 为剥离信封的纯文本；定义 dispatch_to/hand_off_to 在 trace 中的 resultDetail 呈现策略（建议简短确认，避免双显示）。
2. **修 plan**（P1-5/P1-6/P2-7）：useChatStream 插入细节、stripWorkerEnvelope unescape 语义、验证命令路径。
3. **修 dispatch**（P1-3）：WU-05 移除 `bin/my-agent-web.ts`，其 web 侧改动并入 WU-02；并落实 WORKTREE-INIT（Tier 2 编排要求，当前标 n/a）。
4. **补充测试**：`unwrapWorkerPayload` 单测（剥离 + 反转义）；agent_message 插入顺序单测；hand_off_to endTurn 时序集成断言。

## Next
- 审查未通过（含 2 个 P0）→ **先修 spec/plan/dispatch** 再执行「并行执行」
- 或：先修 P0-1/P0-2（影响 UI 正确性），P1 项在实现时按修复建议执行
- 需要讨论 → 组织评审会议
