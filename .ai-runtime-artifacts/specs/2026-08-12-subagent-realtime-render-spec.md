---
artifact: implementation-spec
title: 子 Agent 实时流式气泡渲染（v3.4 方案）
status: approved
approved: true
date: 2026-08-12
route: writing-plans
tier: Tier 2（多 WU 并行）
---

# 子 Agent 实时流式气泡渲染 — 实现规格（v3.4）

## 背景与目标

已批准的 mockup（`subagent-render-v3-4`）定义了派发后子 Agent 的实时流式渲染方案：

| 时序 | 视觉 |
|---|---|
| 1 | 用户问题（蓝色右侧气泡） |
| 2 | **主 Agent 紫色气泡 #1**：思考 → 派发 dispatch_to → **等待态**（灰色虚线 · "等待 coder 回复"） |
| 3 | **coder 绿色气泡**：立即弹出（派发 tool_end 时创建）→ 内嵌 trace 步骤实时展开 → typewriter 文本流 → 完成 |
| 4 | **主 Agent 紫色气泡 #2**（新的 turn）：coder 完成 → 主 Agent 重新激活 → typewriter 收尾文本 → 完成 |

**关键约束（来自用户截图）**：
- `dispatch_to`：派发通知气泡（#2）+ coder 气泡（#3）+ 主 Agent 收尾（#4）
- `hand_off_to`：同上，但主 Agent 不再写收尾（#4 变成最终回答）
- `run_worker`：仅 coder 气泡（#3），无独立输出，完成后主 Agent 继续

## 现有系统状态（已实现）

| 组件 | 状态 |
|---|---|
| `run_worker` / `dispatch_to` / `hand_off_to` 工具定义 | ✅ `src/orchestration/tools.ts` |
| 后端 `onWorkerEvent` 流式转发 | ✅ `bin/my-agent-web.ts`（text_delta / tool_start / tool_end / agent_reply） |
| 前端 `agent_message` SSE 事件处理 | ✅ `useChatStream.ts`（`insertAgentMessage`） |
| 主 Agent trace 过滤 dispatch tool_call/tool_result | ✅ `runTrace.ts`（已过滤） |
| History 路径下 agent 气泡重建 | ✅ `parseHistoryMessages` + `rebuildDispatchAgentMessages` |

## 待实现缺口

### 1. 后端：新增 SSE 事件类型

现有 `onWorkerEvent` 只转发 `text_delta` / `tool_start` / `tool_end` / `agent_reply`，缺少：

| 事件类型 | 触发时机 | 用途 |
|---|---|---|
| `dispatch_started` | `dispatch_to` / `hand_off_to` 进入执行时 | 前端立即创建 coder 绿色气泡（占位） |
| `worker_text_delta` | worker 文本增量（替代被丢弃的 text_delta） | coder 气泡 typewriter 流 |
| `worker_step_start` | worker 每个 thinking/tool 步骤开始 | coder 气泡内嵌步骤展开 |
| `worker_step_end` | worker 每个步骤结束（含 result 摘要） | coder 气泡步骤状态更新 |
| `dispatch_done` | worker 执行完毕（最后 tool_end 之后） | 前端触发主 Agent 新气泡创建（#2） |

**注意**：`run_worker` 不应触发 `dispatch_started` / `dispatch_done`（因为没有可见回复）。

### 2. 前端：SSE 事件路由与 Agent 气泡状态机

新增 SSE 事件处理器（`useChatStream.ts`）：

```
收到 dispatch_started
  → 创建空的 role:'agent' 气泡（isFinal=false, status='working'）
  → 插入到当前主 Agent 消息之后

收到 worker_step_start(kind, label)
  → 推入对应 agent 气泡的 internalBlocks（thinkingBlock 或 toolCallBlock）
  → 更新气泡 summary 计数

收到 worker_text_delta
  → append 到 agent 气泡的 .text 字段（typewriter）

收到 worker_step_end
  → 找到对应 block，更新 status='done'
  → 更新气泡 summary

收到 dispatch_done
  → 关闭当前 agent 气泡（isFinal=false 的 done 态）
  → 若工具是 dispatch_to（不是 hand_off_to）：emit "main_resume"
    → 创建新的主 Agent 紫色气泡 #2
    → 旧气泡（#1）标 done

收到 agent_message（最终回复）
  → append 到当前 agent 气泡 .text
  → 若 hand_off_to：气泡标 isFinal=true
  → 气泡标 done
```

### 3. 前端：MessageBubble 渲染 Agent 气泡

Agent 气泡渲染需求（与 `v3.4` mockup 对齐）：

```
role=agent 气泡结构：
├── role-line: [avatar(C)] [name: coder] [tag: "子 Agent 回复"/"最终回答"] [status: 工作中…/已完成]
├── summary-line: [✓] ["已完成 X 步 · Y 个工具"] [▾/▴]
├── agent-trace（可折叠，working 时默认展开，完成后默认折叠）：
│   ├── thinkingBlock: [✦] [思考内容] · ✓
│   ├── toolCallBlock: [⚙] [工具名 · 参数摘要] · ✓
│   └── toolResultBlock: [结果摘要] · ✓
└── text-body（typewriter，带绿色光标 cursor）
```

**样式差异**（agent vs 主 Agent）：
- 左边框：翡翠绿 `border-emerald-500/30`
- 背景：`bg-emerald-500/10`
- 工作态：边框变实线 + `box-shadow: 0 0 0 2px rgba(14,159,110,.18)`
- Avatar 背景：`linear-gradient(135deg, #0e9f6e, #34d399)`

### 4. 主 Agent 新气泡机制

`dispatch_done` 触发 `main_resume` 逻辑（`useChatStream.ts`）：

1. 找到当前主 Agent 消息（`role='assistant'`, `runId`）
2. 将该消息的 `streamState` 设为 `'done'`，气泡状态标 completed
3. **创建新的主 Agent 消息**（新的 `runId`），`streamState='generating'`
4. 新消息追加到 messages 数组

**关键**：新消息的 `runId` 与旧消息不同，确保 SSE 事件路由隔离。

### 5. History 路径兼容

`rebuildDispatchAgentMessages`（上一批已实现）已能重建 agent 气泡 text。但需要增强：

- **新增 `internalBlocks` 派生**：从 tool_call + tool_result blocks 重建 thinkingBlock + toolCallBlock + toolResultBlock，填入 agent 气泡的 `blocks` 字段
- **主 Agent 多气泡重建**：同一次会话中主 Agent 可能有多条消息（#1 等待态 + #2 收尾），需要按 `messageId` 或 `runId` 区分

### 6. 三工具语义差异

| 工具 | dispatch_started | worker 步骤转发 | dispatch_done | agent_message | 主 Agent 新气泡 |
|---|---|---|---|---|---|
| `dispatch_to` | ✅ | ✅ text + steps | ✅ | ✅ text | ✅ |
| `hand_off_to` | ✅ | ✅ text + steps | ✅ | ✅ text | ❌（终态） |
| `run_worker` | ❌ | ✅（仅 steps，无 text） | ❌ | ❌ | ✅（立即恢复） |

## 数据流图

```
Backend (bin/my-agent-web.ts)
    │
    │ onWorkerEvent({ type: 'dispatch_started', actorId, actorName, toolName, toolId })
    │ onWorkerEvent({ type: 'worker_step_start', actorId, kind, label })
    │ onWorkerEvent({ type: 'worker_text_delta', actorId, text })
    │ onWorkerEvent({ type: 'worker_step_end', actorId, result })
    │ onWorkerEvent({ type: 'dispatch_done', actorId, toolName })
    │ onWorkerEvent({ type: 'agent_reply', actorId, text, isFinal })
    ▼
SSE envelope (KNOWNEVENTS)
    │
    ▼
useChatStream.ts (handleSseEvent)
    ├── dispatch_started → createAgentBubble(sessionId, runId, actorId, actorName, isFinal=false)
    ├── worker_step_start → pushBlockToAgentBubble(sessionId, actorId, block)
    ├── worker_text_delta → appendTextToAgentBubble(sessionId, actorId, text)
    ├── worker_step_end → finalizeBlockInAgentBubble(sessionId, actorId, blockId)
    ├── dispatch_done → closeAgentBubble(sessionId, actorId) + emit mainResume
    └── agent_reply → appendTextToAgentBubble + closeAgentBubble(sessionId, actorId, isFinal)
    │
    ▼
chatRuntimeStore
    ├── createAgentMessage(sessionId, runId, actorId, actorName, isFinal)
    ├── updateAgentMessageBlocks(sessionId, actorId, blocks)
    └── createNewAssistantMessage(sessionId, newRunId)  ← mainResume
    │
    ▼
MessageBubble (role=agent)
    └── render: role-line + summary + internal-trace + text-body
```

## 测试策略

1. **单元测试**：`useChatStream.ts` 新增事件处理器纯函数（mock store）
2. **集成测试**：`MessageBubble` agent 气泡渲染（已有 `message-bubble-agent.test.tsx` 扩增）
3. **E2E Playwright**：dispatch_to 派发 → coder 气泡实时展开 → 主 Agent 新气泡 → 刷新页面气泡仍在

## 依赖

- 上一批已实现 `runTrace.ts` dispatch tool 过滤、`rebuildDispatchAgentMessages`（history 路径）
- `dispatchTools` + `onWorkerEvent` 在 `bin/my-agent-web.ts` 已注入