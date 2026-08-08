# Chat 流式渲染问题修复方案

> 状态：draft | 2026-08-08

## 问题诊断

### 1. 流式 SSE 解析正常，但前端只处理 text_delta

**现象：** AI 输出看起来是阻塞的，一次性全部出现。

**根因分析：**

前端 `parseSseStream` 正确实现了 SSE 流解析（`AsyncGenerator`），`useChatStream` 也用 `for await...of` 消费。问题不在 SSE 层面，而在：

- 前端仅处理 `content_block_delta` 事件（提取 `delta.text`），其他 9 种 SSE 事件被忽略：
  - `content_block_start` / `content_block_stop` → 忽略
  - `tool_use` → **完全忽略**（工具调用不渲染）
  - `tool_result` → **完全忽略**（工具结果不渲染）
  - `message_start` / `message_delta` / `message_stop` → 忽略
  - `usage` / `ping` / `error` → 部分处理
- `ChatMessage` 类型只有 `{ role, text }` — 没有结构化内容块概念

### 2. 后端 AgentRunEvent 与 StreamEvent 类型不匹配

**严重问题：** `adaptStreamEvent()` 期望 `StreamEvent`（`shared/types.ts`），但 runner 产出的是 `AgentRunEvent`（`agent/types.ts`）。

| Runner 事件 | StreamEvent 适配 | 实际行为 |
|---|---|---|
| `text_delta` | → `content_block_delta` | ✅ 正常工作 |
| `tool_delta` | 无对应处理 | ❌ 落入 default → ping |
| `tool_start` | 无对应处理 | ❌ 落入 default → ping |
| `tool_end` | 无对应处理 | ❌ 落入 default → ping |
| `tool_progress` | 无对应处理 | ❌ 落入 default → ping |

工具调用的所有流式事件在后端 SSE 适配层被静默丢弃。

### 3. Thinking 块完全没有支持

- `MessageContent` 有 `ThinkingContent` 类型但未被流式传输
- 前端无任何 thinking block 渲染逻辑
- 模型 extended thinking 内容被丢失

### 4. 思考动画位置错误

`StreamIndicator`（三个跳动点）放在 `ChatPage` header 中（右上角），应该在消息气泡内部。

### 5. 内容撑开容器

`MessageBubble` 使用 `max-w-[80%]` 但内部 Markdown 渲染的代码块/表格无 overflow 保护。

---

## 修复方案

参考 Orkas 项目的设计模式（气泡内分层：process → activity → final + thinking dots），结合本项目 React + Tailwind 技术栈。

### Phase 1: 前端消息数据模型重构

**目标：** `ChatMessage` 从简单文本升级为结构化内容块。

```typescript
// 新类型定义
interface ContentBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'agent_call' | 'error';
  status: 'pending' | 'streaming' | 'done' | 'error';
}

interface TextBlock extends ContentBlock {
  type: 'text';
  text: string;  // 流式累积
}

interface ThinkingBlock extends ContentBlock {
  type: 'thinking';
  thinking: string;  // 流式累积
  collapsed?: boolean;  // 默认折叠
}

interface ToolCallBlock extends ContentBlock {
  type: 'tool_call';
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;  // 流式累积的 JSON 参数
  inputRaw: string;  // 原始 JSON 流
}

interface ToolResultBlock extends ContentBlock {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  content: string;  // 工具输出
  isError: boolean;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];  // 替代 text: string
  /** 流式状态 */
  streamState?: 'thinking' | 'generating' | 'tool_executing' | 'done';
}
```

### Phase 2: 后端 SSE 事件协议增强

**2a. 修复 AgentRunEvent → StreamEvent 适配**

在 `postMessageStream` 中增加 `AgentRunEvent` → SSE 的转换逻辑：

```
AgentRunEvent.tool_delta  → content_block_start(tool_use) + tool_use (delta)
AgentRunEvent.tool_start  → tool_use (complete input)
AgentRunEvent.tool_end    → tool_result
```

**2b. 增加 thinking 流式事件**

新增 SSE 事件类型 `thinking_delta`，当 provider 返回 thinking/reasoning 内容时流式发送。

### Phase 3: 前端组件重构

```
chat-bubble
├── [data-role="process"]     ← 折叠的过程追踪（工具调用列表）
│   ├── stream-process-line   ← 每行一个工具调用/步骤
│   └── stream-process-line.is-expandable  ← 可展开查看结果
├── [data-role="thinking"]    ← 思考块（可折叠，默认折叠）
│   ├── toggle 按钮
│   └── thinking 文本内容
├── [data-role="thinking-dots"] ← 思考中动画（三个跳动点）
├── [data-role="activity"]    ← 活动条（当前动作 + 计时器）
└── [data-role="final"]       ← AI 最终文本回复（Markdown 渲染）
```

**新增组件：**

| 组件 | 职责 | 参考 Orkas |
|---|---|---|
| `ThinkingBlock` | 可折叠思考内容渲染 | `.stream-process` (折叠) |
| `ToolCallBadge` | 工具调用标签（工具名 + 状态图标） | `_PROCESS_KIND_ICON` |
| `ToolResultPreview` | 工具结果可展开预览 | `_streamingAppendToolResultRow` |
| `ActivityStrip` | 当前状态 + 工具计数 + 运行计时 | `.stream-activity` |
| `ThinkingDots` | 三个跳动点（替代 header 中的 StreamIndicator） | `.stream-thinking` |

**组件树变更：**

```
MessageBubble
  ├── ThinkingDots         (streaming & no content yet → 显示动画)
  ├── ThinkingBlock[]       (collapsible thinking blocks)
  ├── ProcessTracker        (tool calls list, collapsible <details>)
  │   └── ToolResultPreview
  ├── ActivityStrip         (current action label + elapsed time)
  └── FinalMarkdown         (the actual text response)
```

### Phase 4: useChatStream 重构

**4a. 处理全部 13 种 SSE 事件：**

```typescript
switch (evt.event) {
  case 'message_start':     → 创建 assistant message placeholder
  case 'content_block_start': → 根据 content_block.type 创建对应 block
  case 'content_block_delta':  → 追加到当前 block
  case 'content_block_stop':   → 标记当前 block 完成
  case 'tool_use':          → 创建/更新 ToolCallBlock
  case 'tool_result':       → 创建 ToolResultBlock
  case 'thinking_delta':    → 创建/更新 ThinkingBlock
  case 'message_delta':     → 更新 stop_reason
  case 'message_stop':      → 标记消息完成
  case 'usage':             → 更新 token 用量显示
  case 'done':              → 流结束
  case 'error':             → 错误 block
}
```

**4b. rAF 节流：**

Orkas 使用 `requestAnimationFrame` 节流最终文本渲染，避免每个 token 都触发一次 Markdown 重渲染。本项目同样需要：

```typescript
// 每帧最多更新一次最终文本
function appendFinalDelta(msgId: string, piece: string) {
  const msg = messages.find(...)
  msg.streamBuf += piece
  if (!msg._rafScheduled) {
    msg._rafScheduled = true
    requestAnimationFrame(() => {
      msg._rafScheduled = false
      // 用 msg.streamBuf 更新消息
    })
  }
}
```

### Phase 5: 布局/溢出修复

**5a. 气泡内容溢出保护：**

```css
/* MessageBubble */
.chat-bubble {
  max-width: 80%;
  min-width: 0;           /* 防止 flex 子项溢出 */
  overflow-wrap: break-word;
  word-break: break-word;
}

/* Markdown 代码块 */
.chat-bubble pre {
  overflow-x: auto;       /* 代码块横向滚动 */
  max-width: 100%;
}

/* Markdown 表格 */
.chat-bubble table {
  display: block;
  overflow-x: auto;
  max-width: 100%;
}
```

**5b. MessageList 容器：**

```tsx
<div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-2">
  {/* 消息列表 */}
</div>
```

### Phase 6: 思考动画位置移动

**变更前：**
```tsx
// ChatPage.tsx header
{status === 'streaming' && <StreamIndicator />}
```

**变更后：**
```tsx
// MessageBubble 内部
{isStreaming && !hasContent && <ThinkingDots />}
```

`ThinkingDots` 组件在气泡内渲染，当流开始但还没有内容时显示。

---

## 涉及文件清单

### 后端

| 文件 | 变更 |
|---|---|
| `src/shared/types.ts` | 增加 `thinking_delta` StreamEvent 类型 |
| `src/web/server/routes/messages.ts` | 修复 `adaptStreamEvent` 处理 `AgentRunEvent` 的 tool 事件；增加 thinking 事件适配 |
| `src/agent/runner.ts` | 增加 thinking content 的流式 yield（如果 provider 支持） |

### 前端

| 文件 | 变更 |
|---|---|
| `web/src/features/chat/useChatStream.ts` | **重写**：ContentBlock 数据模型 + 全部 SSE 事件处理 + rAF 节流 |
| `web/src/components/chat/MessageBubble.tsx` | **重写**：结构化内容渲染 |
| `web/src/components/chat/MessageList.tsx` | 适配新数据结构 + overflow 修复 |
| `web/src/pages/ChatPage.tsx` | 移除 header 中的 StreamIndicator |
| `web/src/components/chat/ThinkingDots.tsx` | **新增**：气泡内思考动画 |
| `web/src/components/chat/ThinkingBlock.tsx` | **新增**：可折叠 thinking 内容 |
| `web/src/components/chat/ToolCallBlock.tsx` | **新增**：工具调用展示 |
| `web/src/components/chat/ToolResultBlock.tsx` | **新增**：工具结果展示 |
| `web/src/components/chat/ProcessTracker.tsx` | **新增**：过程追踪面板 |
| `web/src/components/chat/ActivityStrip.tsx` | **新增**：活动状态条 |
| `web/src/components/chat/StreamIndicator.tsx` | 标记 deprecated 或删除 |

---

## 实施顺序

1. **数据模型** — 先定义 ContentBlock 类型（前端 + shared types）
2. **后端适配修复** — 修复 AgentRunEvent → SSE 转换
3. **useChatStream 重写** — 结构化事件处理
4. **组件开发** — ThinkingDots → ThinkingBlock → ToolCallBlock → ToolResultBlock → ProcessTracker → ActivityStrip
5. **MessageBubble 重构** — 集成所有子组件
6. **布局修复** — overflow + 思考动画位置
7. **测试验证** — 端到端流式测试

---

## 参考

- Orkas `conversation.js` 流式渲染架构（气泡内分层：process → activity → final + thinking dots）
- Orkas `strip-structural-blocks.js` 结构化块剥离逻辑
- 本项目 `src/shared/types.ts` StreamEvent 类型定义
- 本项目 `src/agent/types.ts` AgentRunEvent 类型定义
