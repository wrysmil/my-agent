---
artifact: verification-lite
status: draft
approved: false
task: 子 Agent 调度渲染全量验证（WU-06，批次 2026-08-12-subagent-render）
created_at: 2026-08-12
---

# Verification Lite — 子 Agent 调度渲染（run_worker / dispatch_to / hand_off_to 前端呈现）

> 验证角色：test-engineer（WU-06）。只验证，不改业务代码。
> 基线对比方法：`git stash push -u` → 跑命令 → `git stash pop`，确认差异属预存在基线。
> 证据纪律：以下所有命令均于本轮验证期**新鲜执行**（非引用先前 WU 的 self-check），输出与计数已逐条记录。

## 范围

本批次 5 个实现 WU 的变更文件：

| WU | 文件 | 说明 |
|---|---|---|
| WU-01 后端契约 | `src/shared/types.ts`、`src/orchestration/dispatch.ts`、`test/orchestration/dispatch.test.ts` | `StreamEvent.agent_message` + tool 帧 actor 字段；`WorkerProgressEvent.agent_reply`；`unwrapWorkerPayload` |
| WU-02 后端接线 | `src/orchestration/tools.ts`、`src/web/server/routes/messages.ts`、`src/web/server/routes/messages.test.ts`、`bin/my-agent-web.ts`、`test/orchestration/tools.test.ts` | dispatch_to/hand_off_to 发 `agent_reply`；SSE 帧透传 actor + `agent_message`；web 入口转发 actor 身份 + prompt 追加指引 |
| WU-05 CLI prompt | `src/prompts/dispatch-guideline.ts`（新增）、`test/prompts/dispatch-guideline.test.ts`（新增）、`chat.ts` | 共享调度指引常量；CLI system prompt 追加 |
| WU-03 前端数据层 | `web/src/features/chat/types.ts`、`web/src/features/chat/useChatStream.ts`、`web/src/features/chat/runTrace.ts`、`web/tests/features/chat/use-chat-stream-agent-message.test.ts`（新增）、`web/tests/features/chat/runTrace.test.ts` | role `'agent'`；`insertAgentMessage`；中文工具名 + `stripWorkerEnvelope` |
| WU-04 前端组件 | `web/src/components/chat/RunTracePanel.tsx`、`web/src/components/chat/MessageBubble.tsx`、`web/src/lib/sse.ts`、`web/tests/features/chat/message-bubble-agent.test.tsx`（新增）、`web/tests/features/chat/run-trace-panel.test.tsx`、`web/tests/unit/sse.test.ts` | 徽章 + 绿描边；agent 气泡；`KNOWN_EVENTS` 补 `agent_message` |

## 验证

| # | 命令 | 结果 | 输出摘要 |
|---|---|---|---|
| 1 | `npm run check`（项目根） | PASS（无新增；exit 2 为基线） | 21 条错误全为本批改动前已存在：`src/agent/runner.ts` TS2393×2 + TS2322（thinking_delta）、`test/providers/*` 模块解析错误、`test/tools-page-api.test.ts` TS18046×2。`git stash push -u` 后基线重跑：**21 条逐条同文件同行完全一致**，`git stash pop` 恢复 |
| 2 | `npx vitest run test/orchestration test/prompts src/web/server/routes/messages.test.ts` | PASS | **6 文件 85/85 通过**：dispatch-guideline 4 / actor 8 / agent-spec 5 / dispatch 22 / tools 13 / messages 33。运行时 vite warning `Duplicate member "compactNow"` 为 runner.ts 基线问题，与本批无关 |
| 3 | `pnpm exec tsc -b`（web） | PASS | 零误差（exit 0，无输出） |
| 4 | `pnpm exec vitest run tests/features/chat/ tests/unit/sse.test.ts` | PASS | **13 文件 178/178 通过**：runTrace 42 / trace-bubble 8 / chatRuntimeStore 24 / sse 4 / generating-indicator 4 / merge-persisted-with-overlay 7 / chat-session-stream-isolation 25 / use-chat-stream-agent-message **7**（新增）/ message-bubble-cycle 5 / message-bubble-agent **4**（新增）/ trace-bubble-session-switch 4 / run-trace-panel-matrix 17 / run-trace-panel 27 |
| 5 | `pnpm exec vitest run tests/unit/`（可选补充） | 4 失败 = 预存在基线 | **28 文件 134/138**。4 失败：`tests/unit/bundle.test.ts`（JS 体积预算 `1848166 > 700000` + CSS `78794 > 50000`，2 项）+ `tests/unit/chat-stream-state.test.ts`（sessionId 视图重置 `length 2 but got 1`，2 项）。`git stash push -u` 后基线重跑同两文件：**同样 4 失败、测试名与断言逐字一致** → 确认为预存在，与本批无关（未修），`git stash pop` 恢复 |

> 补充：`useChatStream.ts` 为本批改动文件，故 tests/unit 中 `chat-stream-state.test.ts` 的 2 项失败**必须**用 stash 基线复现排除——已确认基线同样失败，非本批引入。

## 关键契约核对（11 点）

| # | 契约 | 证据（亲自核对源码） | 结果 |
|---|---|---|---|
| 1 | `src/shared/types.ts`：`StreamEvent` 含 `agent_message`；`tool_start`/`tool_end` 有可选 `actorName`/`actorKind` | L119 / L122 可选 actor 字段；L141 `type: "agent_message"`（actorId/actorName/actorKind/text/isFinal） | PASS |
| 2 | `src/orchestration/dispatch.ts`：`WorkerProgressEvent` 含 `agent_reply`；`unwrapWorkerPayload` 导出且剥离信封 + 反转义 | L24 `agent_reply`；L266-270 `unwrapWorkerPayload`（`WORKER_RESULT_RE` / `WORKER_ERROR_RE` 剥离 + L273-280 `unescapeXml`，`&amp;` 最后替换）；单测 dispatch.test.ts L336-362 覆盖剥离/aborted 属性/反转义 `'<div> & "x"'`/无信封透传/空串/纯空白 | PASS |
| 3 | `src/orchestration/tools.ts`：dispatch_to/hand_off_to 触发 `agent_reply`，text 无 XML 信封 | L185-190（dispatch_to，`unwrapWorkerPayload(result)`，isFinal:false）与 L243-248（hand_off_to，isFinal:true）；`return { content: result }` 保留原样给 commander；tools.test.ts L334-361 / L367-394 断言 `text` 不匹配 `<worker-result\|<worker-error` | PASS |
| 4 | `bin/my-agent-web.ts`：onWorkerEvent 转发 actor 身份 + `agent_reply` → `agent_message`；system prompt 追加 `DISPATCH_GUIDELINE` | L41 import；L148-149 / L162-163 `actorName/actorKind` 透传；L170-178 `agent_reply` → `agent_message`（actorName 兜底 `ev.actor.name \|\| ev.actor.id`）；L200-205 systemPrompt 追加 `DISPATCH_GUIDELINE` | PASS |
| 5 | `src/web/server/routes/messages.ts`：`tool_use`/`tool_result` 帧带 `actor_name`/`actor_kind`；`agent_message` 帧透传 | L609-610 / L642-643 条件展开 actor 字段（缺省不写）；L648-654 `case "agent_message"` → `emit("agent_message")`；断言 messages.test.ts L1887-1894（actor 字段）、L1931-1934（agent_message 帧字段完整） | PASS |
| 6 | `chat.ts`：system prompt 追加 `DISPATCH_GUIDELINE`；onWorkerEvent 未改 | `git diff chat.ts` 仅 2 处：import（L53）+ `extraSystemPrompt` 追加 `"\n\n" + DISPATCH_GUIDELINE`（L434）。onWorkerEvent 回调不在 diff 内 → 未改 | PASS |
| 7 | `web/src/features/chat/types.ts`：role 含 `'agent'`；`SseAgentMessageData` | L82 `role: 'user' \| 'assistant' \| 'agent'`；L271-279 `SseAgentMessageData`；L47-48/L61-62 tool block 可选 `actorName`/`actorKind`；L88/L90 `ChatMessage` 可选 `actorName`/`isFinal`；L296 并入 SSE data 联合 | PASS |
| 8 | `useChatStream.ts`：`agent_message` → `insertAgentMessage`（锚定最后一条 assistant 后） | L502-529 `insertAgentMessage`：倒序找该 run 最后一条 assistant → 越过其后的同 run agent 消息保持到达顺序 → splice 插入；无 assistant 追加末尾；返回新数组（不可变）。L1128-1146 `case 'agent_message'` 建 `role:'agent'` 消息（text 承载正文）并调用；单测 use-chat-stream-agent-message.test.ts 7 项全过 | PASS |
| 9 | `runTrace.ts`：三工具中文名；`stripWorkerEnvelope`；dispatch_to 简短确认 | L92-94 `run_worker→派生子 Agent` / `dispatch_to→派发子 Agent` / `hand_off_to→移交子 Agent`；L146 `stripWorkerEnvelope`；L216-220 dispatch_to/hand_off_to 的 resultDetail = `'已回复用户（见上方子 Agent 气泡）'`，其余走 `stripWorkerEnvelope` | PASS |
| 10 | `RunTracePanel.tsx`/`MessageBubble.tsx`：徽章 + 绿描边 + agent 气泡 | RunTracePanel.tsx L238 `hasActor` → L241 `border-l-2 border-l-emerald-500` 绿色左描边；L350-357 `data-testid="badge-agent"` 徽章（emerald 底 + 文字双通道）。MessageBubble.tsx L58-59 空 agent 静默（return null）；L84-100 `role === 'agent'` 分支 `data-testid="agent-bubble"` + `isFinal ? '最终回答' : '子 Agent 回复'` 标签 + actorName；单测 message-bubble-agent.test.tsx 4 项全过 | PASS |
| 11 | `web/src/lib/sse.ts`：`KNOWN_EVENTS` 含 `agent_message` | L8-17 `KNOWN_EVENTS` 含 `'agent_message'`；单测 sse.test.ts 4 项全过 | PASS |

## 发现的问题

- **无新增问题**。P0（`sse.ts KNOWN_EVENTS` 缺 `agent_message`，WU-03 阶段发现）已在 WU-04 修复并有 `sse.test.ts` 覆盖。
- 预存在基线（与本批无关，验证确认后未修）：
  1. `src/agent/runner.ts` TS2393 重复函数 ×2 + TS2322 `thinking_delta` 类型（`npm run check` 21 条错误的一部分）。
  2. `test/providers/*`、`test/tools-page-api.test.ts` tsc 解析错误（同一 21 条）。
  3. `web/tests/unit/bundle.test.ts` 体积预算 2 失败（dist 产物膨胀）。
  4. `web/tests/unit/chat-stream-state.test.ts` sessionId 视图重置 2 失败（stash 基线复现确认，与本批改动的 `useChatStream.ts` 无关）。

## TDD 覆盖核对

生产代码均有对应单测锁定（本 WU 验证其存在且全绿）：

- `unwrapWorkerPayload`：dispatch.test.ts L336-362 剥离/反转义/无信封/空串/纯空白
- `agent_reply` 事件：tools.test.ts L334-361（dispatch_to，isFinal:false）与 L367-394（hand_off_to，isFinal:true），text 无 XML 信封
- SSE 透传：messages.test.ts actor 字段 + agent_message 帧
- 前端 agent 消息插入：use-chat-stream-agent-message.test.ts（7 项：锚定插入/多消息顺序/无 assistant 追加/actor 字段写入）
- 组件渲染：message-bubble-agent.test.tsx（4 项：绿气泡 + 标签 + actorName + markdown）
- 中文工具名 + stripWorkerEnvelope：runTrace.test.ts（42 项）

### References 检查

`harness-kit/references/definition-of-done.md`：

- [x] Correctness：验收标准逐项由 11 点契约核对覆盖；本批契约由测试锁定（fail→pass）；既有测试全绿，无回归（后端 85/85、前端目标 178/178）
- [x] Correctness：边界/错误路径有覆盖（unwrapWorkerPayload 空串/无信封/aborted；agent_message 无 assistant 时追加末尾；history 回放空 agent 静默——MessageBubble L58-59）
- [x] Quality：`stripWorkerEnvelope` / `unwrapWorkerPayload` 与中文映射单点归属，未散落组件；「双显示」策略避免同一内容两处渲染（runTrace L216-220）
- [x] Quality：无 dead code / debug 输出（验证期未发现）；变更范围与本批 5 WU 一致
- [x] Quality：lint/格式——`tsc -b` 零误差；`npm run check` 无新增（stash 基线对比）
- [x] Integration：`KNOWN_EVENTS` 缺口（集成点遗漏）已修复并锁测试；SSE 协议未改，仅新增事件类型；JSONL 持久化未动
- [x] Documentation：调度指引已入 system prompt（CLI + web 双端共享常量 `src/prompts/dispatch-guideline.ts`）
- [x] Ship-readiness：agent_message 为新增可选项，向后兼容（缺省时前端静默不渲染）；刷新回放路径不产生空气泡

`harness-kit/references/testing-patterns.md`：

- [x] Test Structure（AAA）：新测试均 arrange-act-assert 结构（tools.test.ts agent_reply 段、dispatch.test.ts unwrapWorkerPayload 段）
- [x] Test Naming：命名表述行为（「dispatch_to 完成后触发 agent_reply（isFinal:false），text 不含 XML 信封」）
- [x] Mocking Patterns：仅在边界 mock（SSE/消息流），`unwrapWorkerPayload`/`stripWorkerEnvelope`/`insertAgentMessage` 均为纯函数直接断言
- [x] Common Assertions：`.not.toMatch(/<worker-result|<worker-error/)` 断言信封剥离；`.toHaveLength`/顺序断言插入锚定
- [x] Async Error Handling：SSE 相关测试均 `await`（messages.test.ts / use-chat-stream-agent-message.test.ts 全绿）
- [x] Test Anti-Patterns：无共享可变状态污染（各用例独立构造）、无永久 `test.skip`、断言具体值而非快照

## 未验证项

- 真实 LLM + 真实子 Agent 端到端运行（需 API key）：本次为命令级验证。端到端时序契约已锁：SSE 层新增用例（messages.test.ts「agent_message 帧在 tool_result 之后、done 之前输出」）断言帧序；`bin/my-agent-web.ts` 的 prefetch+drain 排空逻辑经结构走查确认（worker 事件在包络 tool_end 前、done 前被排空），未做独立单元化。

## Next

- 批次尾盘：本 verification-lite 作为 WU-06 产物，交由 GROUP 尾盘集体测试 / 集体审查。
