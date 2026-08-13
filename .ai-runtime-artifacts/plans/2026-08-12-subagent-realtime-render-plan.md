---
artifact: implementation-plan
title: 子 Agent 实时流式气泡渲染实施计划（v3.4）
status: approved
approved: true
date: 2026-08-12
route: writing-plans
tier: Tier 2（多 WU 并行）
---

# 子 Agent 实时流式气泡渲染 — 实施计划（v3.4）

## 目标

实现派发 `dispatch_to` / `hand_off_to` / `run_worker` 后，子 Agent 气泡实时展开步骤 + 主 Agent 派发/等待/新建气泡完整流程。

## WU 分层

### WU-01：后端 — 新 SSE 事件 emit（bin/my-agent-web.ts）

**文件**：`bin/my-agent-web.ts`

**内容**：在 `onWorkerEvent` 回调中，对每个 worker 事件判断类型后 emit 新的 SSE 行：

| 后端 emit | 触发时机 | 字段 |
|---|---|---|
| `event: dispatch_started` | `dispatch_to` / `hand_off_to` 进入执行时 | `actorId, actorName, toolName, toolId, isFinal` |
| `event: worker_step_start` | worker 每个 thinking/tool 步骤开始 | `actorId, kind, label, stepId` |
| `event: worker_text_delta` | worker 文本增量（替代被丢弃的 text_delta） | `actorId, text, stepId` |
| `event: worker_step_end` | worker 步骤结束 | `actorId, stepId, summary, isError` |
| `event: dispatch_done` | worker 全流程结束（最后 tool_end 之后） | `actorId, toolName` |

**注意**：`run_worker` 不 emit `dispatch_started` / `dispatch_done`（无可见回复）。

**已有类型扩展**：在 `WorkerProgressEvent` union 中追加新成员，或在 `SSE` envelope 层新增事件类型（`KNOWN_EVENTS` + `sse.ts` 解析）。

**测试**：后端 orchestration tools 测试覆盖。

---

### WU-02：前端 SSE 路由 + Agent 气泡状态机（useChatStream.ts）

**文件**：`web/src/features/chat/useChatStream.ts`

**内容**：

1. **`KNOWN_EVENTS`** 追加：`dispatch_started`, `worker_step_start`, `worker_text_delta`, `worker_step_end`, `dispatch_done`

2. **事件处理器**（`handleSseEvent` switch case）：
   - `dispatch_started` → `createAgentBubble(sessionId, runId, actorId, actorName, isFinal=false, toolName)`
   - `worker_step_start` → `pushInternalBlock(sessionId, actorId, {type, kind, label, stepId})`
   - `worker_text_delta` → `appendText(sessionId, actorId, text)`（agent 气泡 text 追加）
   - `worker_step_end` → `finalizeBlock(sessionId, actorId, stepId, summary)`
   - `dispatch_done` → `closeAgentBubble(sessionId, actorId)` + `emit mainResume(sessionId)`
   - `agent_reply` → 现有逻辑（appendText + closeBubble，isFinal 标记）

3. **Store 操作函数**（新增或复用）：
   - `createAgentMessage(sessionId, runId, actorId, ...)` — 创建 role='agent' 消息，插入到当前 assistant 之后
   - `updateAgentMessageBlocks(sessionId, actorId, updater)` — 修改 agent 消息内部 blocks
   - `appendTextToAgentMessage(sessionId, actorId, textDelta)` — 追加文本
   - `finalizeAgentMessage(sessionId, actorId)` — 标 done

4. **`mainResume`** 逻辑（`dispatch_done` 后触发）：
   - 找到当前主 Agent 消息（`role='assistant'`, `runId=currentRunId`）
   - 将该消息标 `streamState='done'`
   - **创建新的主 Agent 消息**（新的 `runId` = `genId()`），`streamState='generating'`，插入到原消息之后
   - 新消息的 `runId` 隔离，确保后续 SSE 事件路由到新气泡

**类型**：`AgentMessage` interface 可能需要新增 `internalBlocks?: Block[]` 字段存储气泡内嵌步骤（也可复用 `blocks` 字段，agent 消息的 `blocks` 就是内嵌步骤）。

**测试**：新增 `useChatStream.agentBubbleStateMachine.test.ts` 覆盖所有事件序列。

---

### WU-03：MessageBubble Agent 气泡渲染（web/src/components/chat/）

**文件**：`web/src/components/chat/MessageBubble.tsx`

**内容**：

1. **Agent 气泡 layout**（`role === 'agent'`）：
   ```
   Avatar(C) + [name] + [tag: "子 Agent 回复"/"最终回答"] + [status]
   summary-line: [✓] ["已完成 X 步 · Y 个工具"] [▾]
   agent-trace（可折叠，working 时 open）：
     internal thinkingBlock / toolCallBlock / toolResultBlock
   text-body（typewriter）
   ```

2. **样式**：
   - 左边框：`border: 1px solid rgba(14,159,110,.30)`
   - 背景：`background: rgba(14,159,110,.08)`
   - 工作态：`border-color: #0e9f6e` + `box-shadow: 0 0 0 2px rgba(14,159,110,.18)`
   - Avatar：`linear-gradient(135deg, #0e9f6e, #34d399)`

3. **内部 trace 渲染**：复用 `RunTracePanel` 子集 — 从 `blocks`（即 `internalBlocks`）渲染 thinking + tool_call + tool_result 列表，点击展开详情

4. **typewriter**：读取 `text` 字段内容，带绿色闪烁光标（`animation: blink`）

5. **status 状态**：从 `streamState` 或气泡 `status` 字段推导（`generating`/`done`）

**测试**：扩增 `web/tests/features/chat/message-bubble-agent.test.tsx`，覆盖 agent 气泡 working 态 / done 态 / 折叠 trace。

---

### WU-04：History 路径增强 + run_worker 语义（rebuildDispatchAgentMessages）

**文件**：`web/src/features/chat/useChatStream.ts`

**内容**：

1. **`rebuildDispatchAgentMessages` 增强**：
   - 对每个 dispatch_to / hand_off_to 的 `tool_call`，同时配对 `tool_result`（已有）
   - **重建 `internalBlocks`**：将 tool_call + tool_result 转换为 `Block[]`（thinkingBlock / toolCallBlock / toolResultBlock），填入 agent 气泡的 `blocks` 字段
   - 这样刷新页面后，agent 气泡内的 trace 步骤也完整显示（不仅 text）

2. **`run_worker` 特殊处理**：
   - `run_worker` 工具调用存在于主 Agent trace（被过滤后不显示）
   - `run_worker` 不创建 agent 气泡（因为没有可见输出）
   - **不需要** `dispatch_started` / `dispatch_done` 事件

3. **主 Agent 多气泡 history 重建**：
   - 一次 dispatch 后主 Agent 有 #1（等待态）和 #2（收尾）两条消息
   - 历史路径下：识别 `streamState` 或 `messageId` 分隔，同一 runId 可能有多个 assistant 消息（需 `messageId` 区分）
   - 如果 JSONL 中每条消息有 `messageId`，按 `messageId` 分组；否则按 `turnId` 或顺序推断

**测试**：扩增 `useChatStream.parseHistory.test.ts`（上一批已建）覆盖：
- dispatch_to 带 internalBlocks 的 history 重建
- run_worker 不生成 agent 气泡
- 主 Agent 多气泡场景

---

## 实施顺序

```
WU-01（后端 emit） ─────────────────────────┐
                                             ▼
WU-02（前端 SSE 路由）──┬── WU-03（MessageBubble）── WU-04（History 增强）
                        │                          │
                        └──────────────────────────┘
                                    ↓
                         WU-05（集成测试）
                         WU-06（Playwright 冒烟）
```

**并行策略**：
- WU-01 独立（后端）
- WU-02 + WU-03 可并行（前后端独立，接口是 `createAgentMessage` 等 store 函数）
- WU-04 依赖 WU-02（事件路由确定后才能建 history 派生）

## 验收标准

1. **dispatch_to 派发**：派发瞬间 coder 绿色气泡立即出现；coder 的 thinking / 工具调用实时展开在气泡内；coder 文本 typewriter 流入；主 Agent 气泡在等待态（灰色）；coder 完成后主 Agent 新建紫色气泡写收尾
2. **hand_off_to**：同上，但主 Agent 不新建气泡（终态）
3. **run_worker**：无 agent 气泡；主 Agent 等待后立即继续
4. **刷新页面**：agent 气泡（含内部 steps）和主 Agent 多气泡都能从 history 正确重建
5. **现有功能不退化**：非 dispatch 工具调用的主 Agent trace、MessageBubble 布局等不受影响

## 测试清单

| WU | 测试 |
|---|---|
| WU-01 | `test/orchestration/tools.test.ts` 覆盖三个工具的 SSE emit |
| WU-02 | `useChatStream.agentBubbleStateMachine.test.ts` 8 个序列覆盖 |
| WU-03 | `message-bubble-agent.test.tsx` 扩增：working / done / 折叠 trace |
| WU-04 | `useChatStream.parseHistory.test.ts` 扩增 3 个用例 |
| WU-05 | 全量前端测试（`vitest run`，排除 bundle / chat-stream-state）|
| WU-06 | Playwright 冒烟：派发 → coder 气泡实时展开 → 刷新 → 气泡仍在 |

## 风险点

1. **SSE 事件类型扩展**：新增 `KNOWN_EVENTS` 是否破坏现有 SSE 解析？需向后兼容（未知事件类型不 throw）
2. **Store `updateAgentMessageBlocks` race**：同一 actorId 多个并发 dispatch 的 agent 气泡需要按 actorId 精确路由（不用 runId）
3. **run_worker 边界**：`run_worker` 的 tool_result 内容（`<worker-result>`）是否该显示在主 Agent trace 里？（按 spec：run_worker 私有结果只进 trace，不生成 agent 气泡）
4. **主 Agent 多气泡的 runId 管理**：dispatch_done 后新 runId 必须与旧消息隔离，确保后续主 Agent 文本流路由正确