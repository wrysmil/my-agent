---
artifact: plan
route: writing-plans
spec: .ai-runtime-artifacts/specs/2026-08-10-chat-session-stream-isolation-spec.md
stack: .ai-runtime-artifacts/stack/2026-08-10-chat-session-stream-stack.md
created_at: 2026-08-10
status: draft
approved: false
---

# Chat 会话流隔离、缓存与恢复 — 实施计划

## 1. 概述

本计划将 [spec](../specs/2026-08-10-chat-session-stream-isolation-spec.md) 分解为可执行的工作单元 (WU)，按 P0 → P1 分阶段交付。

### 1.1 架构全景

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React 19)                  │
│                                                         │
│  ChatPage (key={sessionId})                             │
│    └─ useChatStream(sessionId)                          │
│         └─ chatRuntimeStore (Zustand 5)                 │
│              ├─ sessions: Map<sid, SessionRuntime>      │
│              └─ runs: Map<rid, RunRuntime>              │
│                   ├─ abortController                    │
│                   ├─ pendingTextBuffer + rAF handle     │
│                   └─ lastSeq                           │
│                                                         │
│  React Query ← 仅负责 history 快照 + session 列表       │
│  chatRuntimeStore ← 负责实时 streaming state            │
├─────────────────────────────────────────────────────────┤
│                    SSE Channel                          │
│                                                         │
│  Envelope: { sessionId, runId, streamId, seq, event, data }│
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Backend (Node.js)                     │
│                                                         │
│  P0: SseHub (现有) + 新 envelope + 新 seq 分配          │
│  P1: RunRegistry (新增)                                 │
│       ├─ runId → { controller, status, eventBuffer,    │
│       │             subscribers, lastSeq }              │
│       └─ sessionId → activeRunId                       │
│                                                         │
│  Runner 独立于 SSE 连接运行                              │
│  SSE route 只订阅事件，不拥有 runner                     │
└─────────────────────────────────────────────────────────┘
```

### 1.2 交付节奏

| 阶段 | 目标 | 预估 WU | 依赖 |
|------|------|---------|------|
| P0 | 消除串流和状态污染 | 12 WU | 无 |
| P1 | 可靠后台运行与恢复 | 8 WU | P0 完成 |
| P2 | 体验完善（草稿/滚动/徽标） | 4 WU | P1 完成 |

---

## 2. P0：消除串流和状态污染

### 2.1 文件变更总览

```
变更文件 (P0):

前端 (web/src/features/chat/):
  ✏️  types.ts                    — 扩展稳定 ID + ChatStreamEnvelope 类型
  🆕  chatRuntimeStore.ts         — Zustand store: SessionRuntime + RunRuntime
  ✏️  useChatStream.ts            — 重写：接入 store，删除旧机制
  ✏️  MessageList.tsx             — 接入 store selector，key={sessionId}
  ✏️  ChatPage.tsx                — 接入 store，传递 sessionId 给子组件

后端 (src/):
  ✏️  shared/types.ts             — Message/MessageContent 增加可选 id/runId
  ✏️  agent/session-serde.ts      — SerializedMessage 增加可选 id/runId
  ✏️  web/server/sse.ts           — SseHub 增加 runId 维度；seq 分配器
  ✏️  web/server/routes/messages.ts — 新 envelope；runId/streamId 生成；409 保护
  ✏️  web/server/routes/sessions.ts — history 返回 revision + message ID
  ✏️  web/server/validators/sessions.ts — 新增 clientMessageId + runId 字段

测试:
  🆕  web/src/features/chat/chatRuntimeStore.test.ts
  🆕  web/src/features/chat/useChatStream.test.ts
  ✏️  web/src/features/chat/types.test.ts
  ✏️  src/web/server/routes/messages.test.ts
  ✏️  src/agent/session-serde.test.ts
  ✏️  e2e/chat-session-isolation.spec.ts (Playwright)
```

### 2.2 WU 分解

#### WU-00: 稳定 ID 类型层（前后端同步）

**目标**：在不改变运行时行为的前提下，为所有核心类型增加可选 ID 字段。

**前端 `web/src/features/chat/types.ts`**：

```typescript
// 新增：ChatStreamEnvelope（从 P0 开始所有 SSE 事件匹配此形状）
export interface ChatStreamEnvelope {
  sessionId: string;
  runId: string;
  streamId: string;
  seq: number;
  event: string;
  data: Record<string, unknown>;
}

// ChatMessage 新增可选字段
export interface ChatMessage {
  id: string;              // 已有
  role: 'user' | 'assistant';
  blocks: Block[];
  text?: string;
  // 🆕 稳定身份
  clientMessageId?: string;  // 前端生成的用户消息 UUID
  messageId?: string;        // 服务端生成的稳定 ID
  runId?: string;            // 所属 run
  streamState?: 'thinking' | 'generating' | 'tool_executing' | 'done';
  activeToolCount?: number;
  streamStartTime?: number;
  usage?: { ... };
}

// ContentBlock 新增可选 id
export interface ContentBlock {
  id: string;              // 已有（前端本地 ID）
  blockId?: string;         // 🆕 服务端生成的稳定 block ID
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result';
  status: BlockStatus;
}
```

**后端 `src/shared/types.ts`**：

```typescript
export type Message = {
  role: MessageRole;
  content: MessageContent[];
  turnId?: number;
  // 🆕 稳定身份
  id?: string;      // messageId
  runId?: string;   // 所属 run
};

// MessageContent 各子类型增加可选 id
export type TextContent = {
  type: "text"; text: string;
  id?: string;  // 🆕 blockId
};
export type ThinkingContent = {
  type: "thinking"; thinking: string; thinkingSignature?: string;
  id?: string;  // 🆕 blockId
};
// ToolUseContent 已有 id（tool-use ID），作为 blockId
// ToolResultContent 增加可选 id
```

**后端 `src/agent/session-serde.ts`**：

```typescript
export type SerializedMessage = {
  role: MessageRole;
  content: MessageContent[];
  turnId?: number;
  ts: number;
  // 🆕
  id?: string;
  runId?: string;
};
```

**旧 JSONL 兼容**（在 serde 加载时处理）：

```typescript
// 加载旧记录时派生稳定 ID
function ensureMessageId(msg: SerializedMessage, sessionId: string, index: number): string {
  if (msg.id) return msg.id;
  // legacy:<sha256(sessionId|recordIndex|role|turnId)> 前 16 字符
  const hash = createHash('sha256')
    .update(`${sessionId}|${index}|${msg.role}|${msg.turnId ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  return `legacy:${hash}`;
}

function ensureBlockId(block: MessageContent, messageId: string, blockIndex: number): string {
  if (block.type === 'tool_use') return block.id; // tool_use 已有 id
  if ('id' in block && block.id) return block.id as string;
  return `${messageId}:${blockIndex}`;
}
```

**验证**：
- serde round-trip：新 ID 写入 JSONL → 读取 → ID 保留
- 旧 JSONL（无 id 字段）→ 派生 ID 稳定（同一文件两次读取结果一致）

---

#### WU-01: 前端 chatRuntimeStore（Zustand 5）

**目标**：建立独立的运行时状态容器，每个 session/run 的状态完全隔离。

**文件**：`web/src/features/chat/chatRuntimeStore.ts`（新建）

```typescript
import { create } from 'zustand';
import type { ChatMessage, ChatStatus, Block } from './types';

// ============================================================
// RunRuntime
// ============================================================
export interface RunRuntime {
  sessionId: string;
  runId: string;
  streamId: string | null;
  abortController: AbortController | null;
  lastSeq: number;
  pendingTextBuffer: string;
  rafHandle: number | null;
  rafScheduled: boolean;
  status: 'queued' | 'running' | 'completing' | 'succeeded' | 'failed' | 'aborted';
}

// ============================================================
// SessionRuntime
// ============================================================
export interface SessionRuntime {
  sessionId: string;
  messages: ChatMessage[];
  historyLoaded: boolean;
  historyRevision: number;          // 最新已知 JSONL revision
  activeRunId: string | null;
  status: ChatStatus;               // 该 session 的 UI 状态
  error: string | null;
  /** 用户输入草稿 */
  draft?: string;
}

// ============================================================
// Store
// ============================================================
interface ChatRuntimeState {
  sessions: Record<string, SessionRuntime>;
  runs: Record<string, RunRuntime>;

  // Session 操作
  ensureSession: (sessionId: string) => void;
  removeSession: (sessionId: string) => void;
  setSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  setSessionHistoryLoaded: (sessionId: string, loaded: boolean, revision: number) => void;
  setSessionStatus: (sessionId: string, status: ChatStatus) => void;
  setSessionError: (sessionId: string, error: string | null) => void;
  setActiveRun: (sessionId: string, runId: string | null) => void;

  // Run 操作
  createRun: (sessionId: string, runId: string) => void;
  removeRun: (runId: string) => void;
  setRunStreamId: (runId: string, streamId: string) => void;
  setRunAbortController: (runId: string, ac: AbortController | null) => void;
  setRunLastSeq: (runId: string, seq: number) => void;
  setRunStatus: (runId: string, status: RunRuntime['status']) => void;
  getRun: (runId: string) => RunRuntime | undefined;

  // Message 更新（带 sessionId + runId 校验）
  updateMessage: (
    sessionId: string,
    runId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[],
  ) => void;

  // rAF 缓冲
  appendTextBuffer: (runId: string, text: string) => void;
  flushTextBuffer: (runId: string) => void;
  cancelRaf: (runId: string) => void;

  // 查询
  getSession: (sessionId: string) => SessionRuntime | undefined;
}
```

**关键规则实现**：

1. `updateMessage(sessionId, runId, updater)` — 写入前校验 `activeRunId === runId`，拒绝过期 run 的更新
2. `appendTextBuffer(runId, text)` — buffer 属于指定 run，不与"当前最后一条消息"耦合
3. `ensureSession(sessionId)` — 幂等创建；切换页面不 dispose，应用卸载只断开 subscriber
4. LRU 驱逐：非当前 + 无 activeRun 的 session 最多保留 20 个，超限删除最久未访问的

```typescript
// LRU 驱逐逻辑（伪代码）
const MAX_CACHED_SESSIONS = 20;
const sessionAccessOrder: string[] = [];

function evictIfNeeded(currentSessionId: string) {
  const evictable = sessionAccessOrder
    .filter(sid => sid !== currentSessionId && !state.sessions[sid]?.activeRunId);
  while (evictable.length > MAX_CACHED_SESSIONS) {
    const oldest = evictable.shift()!;
    disposeSession(oldest);
  }
}
```

**验证**：
- `ensureSession('A')` → `ensureSession('B')` → 两者独立存在
- `updateMessage('A', 'run-1', fn)` 只影响 `sessions['A'].messages`
- `appendTextBuffer('run-1', 'hello')` 不影响 run-2

---

#### WU-02: 前端 useChatStream 重写

**目标**：将 `useChatStream` 从"单一 state hook"改为"chatRuntimeStore 的消费端 + 发送逻辑"。

**文件**：`web/src/features/chat/useChatStream.ts`（大幅重写）

**删除的旧机制**：
- `module-level generationBySession` Map
- `streamGenerationRef` / `staleEventLoggedRef`
- `inFlightBySessionRef` 快照搬运
- `computeInflightTail` / `messageFingerprint` / `isSameTailMessage`
- `controllerRef` 的跨会话复用
- `switch effect` 中的快照 + controller = null

**新架构**（伪代码）：

```typescript
export function useChatStream(sessionId: string) {
  const store = useChatRuntimeStore();
  const session = store.getSession(sessionId);
  const activeRunId = session?.activeRunId ?? null;

  // 确保 SessionRuntime 存在
  useEffect(() => {
    if (sessionId) store.ensureSession(sessionId);
  }, [sessionId]);

  // 加载历史（仅首次 / sessionId 变化时）
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    apiGet<SessionHistoryResponse>(`/api/sessions/${sessionId}/history`)
      .then((data) => {
        if (cancelled) return;
        const messages = parseHistoryWithIds(data.messages, sessionId);
        // 合并 overlay：persisted 中不存在相同 messageId → 保留 overlay
        const merged = mergePersistedWithOverlay(
          messages,
          store.getSession(sessionId)?.messages ?? [],
          data.revision,
        );
        store.setSessionMessages(sessionId, merged);
        store.setSessionHistoryLoaded(sessionId, true, data.revision);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  // send() — 核心发送逻辑
  const send = useCallback(async (text: string, options?: ChatOptions) => {
    const clientMessageId = crypto.randomUUID();  // 浏览器生成
    const ctrl = new AbortController();

    // 创建 run
    const runId = crypto.randomUUID();  // P0：前端先生成，P1 后由服务端分配
    store.createRun(sessionId, runId);
    store.setRunAbortController(runId, ctrl);
    store.setActiveRun(sessionId, runId);
    store.setSessionStatus(sessionId, 'submitting');

    // 添加 user 消息（带 clientMessageId）
    const userMsg: ChatMessage = {
      id: `user-${clientMessageId}`,
      role: 'user',
      blocks: [],
      text,
      clientMessageId,
      runId,
    };
    store.setSessionMessages(sessionId, [...(session?.messages ?? []), userMsg]);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, clientMessageId, model: options?.model }),
        signal: ctrl.signal,
      });

      // 消费 SSE，每条事件带 envelope
      for await (const evt of parseSseStream(res.body)) {
        const env = evt.data as ChatStreamEnvelope;

        // 身份校验
        if (env.sessionId !== sessionId || env.runId !== runId) {
          logger.warn('事件身份不匹配，丢弃', { expected: { sessionId, runId }, got: env });
          continue;
        }

        // seq 去重
        const run = store.getRun(runId);
        if (run && env.seq <= run.lastSeq) continue;
        store.setRunLastSeq(runId, env.seq);

        // 分发事件
        handleStreamEvent(store, sessionId, runId, env);
      }
    } catch (err) {
      // stale run 的异常静默处理
      if (store.getRun(runId)?.status === 'succeeded') return;
      // ... 错误处理
    }
  }, [sessionId, store]);

  // abort() — 精确按 (sessionId, runId) 中止
  const abort = useCallback(() => {
    const runId = store.getSession(sessionId)?.activeRunId;
    if (!runId) return;
    store.getRun(runId)?.abortController?.abort();
    store.setRunAbortController(runId, null);
    store.setRunStatus(runId, 'aborted');
    store.setSessionStatus(sessionId, 'aborted');
  }, [sessionId, store]);

  return {
    status: session?.status ?? 'idle',
    messages: session?.messages ?? [],
    send,
    abort,
    retry,
    historyLoaded: session?.historyLoaded ?? false,
  };
}
```

**`handleStreamEvent` 分发逻辑**：

```typescript
function handleStreamEvent(
  store: ChatRuntimeStore,
  sessionId: string,
  runId: string,
  env: ChatStreamEnvelope,
): void {
  switch (env.event) {
    case 'message_start':
      store.setSessionStatus(sessionId, 'streaming');
      store.setRunStreamId(runId, env.data.streamId as string);
      store.setRunStatus(runId, 'running');
      // 创建 assistant 消息（带 messageId）
      store.updateMessage(sessionId, runId, (msgs) => [
        ...msgs,
        {
          id: `asst-${env.data.messageId || crypto.randomUUID()}`,
          role: 'assistant',
          blocks: [],
          messageId: env.data.messageId as string,
          runId,
          streamState: 'thinking',
          streamStartTime: Date.now(),
        },
      ]);
      break;

    case 'content_block_delta': {
      const delta = env.data.delta as { type: string; text?: string };
      if (delta.type === 'text_delta' && delta.text) {
        store.appendTextBuffer(runId, delta.text);  // rAF 节流写入
      }
      break;
    }

    case 'thinking_delta': {
      const thinking = env.data.thinking as string;
      store.updateMessage(sessionId, runId, (msgs) => {
        // 更新最后一个 assistant 消息的 thinking block
      });
      break;
    }

    // ... tool_use, tool_result, message_stop, done, error, aborted
  }
}
```

**rAF 节流（按 run 隔离）**：

```typescript
// 在 store 中实现
appendTextBuffer: (runId, text) => {
  const run = get().runs[runId];
  if (!run || run.status !== 'running') return;

  const nextBuffer = run.pendingTextBuffer + text;
  set((s) => ({
    runs: { ...s.runs, [runId]: { ...run, pendingTextBuffer: nextBuffer } },
  }));

  if (!run.rafScheduled) {
    const handle = requestAnimationFrame(() => {
      const current = get().runs[runId];
      if (!current) return;
      const buf = current.pendingTextBuffer;
      if (!buf) return;
      // 写入该 run 对应 session 的最后一条 assistant 消息
      const sid = current.sessionId;
      get().updateMessage(sid, runId, (msgs) => {
        // 找最后一条 assistant，追加 text
      });
      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: {
            ...s.runs[runId],
            pendingTextBuffer: '',
            rafHandle: null,
            rafScheduled: false,
          },
        },
      }));
    });
    set((s) => ({
      runs: {
        ...s.runs,
        [runId]: { ...s.runs[runId], rafHandle: handle, rafScheduled: true },
      },
    }));
  }
},
```

**验证**：
- A streaming → 切 B → B 的 messages 不包含 A 的事件
- A streaming → 切 B → send B → B 正常生成 → 切回 A → A 的 streaming 内容连续
- A 与 B 的 generation 相同（P0 不再依赖 generation）→ 不串流

---

#### WU-03: 历史合并（两层模型）

**目标**：删除文本指纹合并，改用 `messageId` + `revision` 驱动的两层合并。

**实现位置**：`chatRuntimeStore.ts` 中的 `mergePersistedWithOverlay` + `useChatStream.ts` 中的 history 加载 effect

**合并逻辑**：

```typescript
interface SessionHistoryResponse {
  sessionId: string;
  revision: number;
  messages: SerializedMessage[];  // 每条带 id/runId
}

function mergePersistedWithOverlay(
  persisted: ChatMessage[],
  overlay: ChatMessage[],         // store 中已有的 optimistic 消息
  historyRevision: number,
): ChatMessage[] {
  const result = [...persisted];
  const persistedIds = new Set(persisted.map(m => m.messageId).filter(Boolean));

  for (const ovMsg of overlay) {
    // 规则 1: persisted 中不存在相同 messageId → 保留 overlay
    if (!ovMsg.messageId || !persistedIds.has(ovMsg.messageId)) {
      // 找到该 overlay 对应的 user 消息位置，插入其后
      const userIdx = findPrecedingUserMessage(result, ovMsg);
      if (userIdx >= 0) {
        // 避免重复插入
        const alreadyExists = result.some(
          (m, i) => i > userIdx && m.messageId === ovMsg.messageId
        );
        if (!alreadyExists) {
          result.splice(userIdx + 1, 0, ovMsg);
        }
      }
      continue;
    }

    // 规则 2: persisted 中存在相同 messageId → revision 足够 → persisted 替换
    // (revision 比较在前端通过 persistedRevision 字段完成)
  }

  return result;
}
```

**SSE 终态事件携带 `persistedRevision`**：

```typescript
// message_stop / done / error / aborted 事件 data 中增加:
{
  persistedRevision: number;    // JSONL 当前 revision
  messageId: string;            // assistant message 的稳定 ID
}
```

**触发 history refetch**：收到终态事件 → 等 500ms（让 JSONL 落盘）→ `apiGet(history)` → `mergePersistedWithOverlay` → 满足条件则原子替换 overlay。

**验证**：
- history refetch 后消息数不增加（相同 messageId 不重复插入）
- 旧 history 响应不覆盖新 session 的数据
- tool/thinking block 不因切回而重复或永久 streaming

---

#### WU-04: 后端 SSE Envelope + Seq + RunId

**目标**：所有 SSE 事件统一携带 `{ sessionId, runId, streamId, seq, event, data }` envelope；每个物理 frame 唯一 seq。

**文件**：`src/web/server/sse.ts` + `src/web/server/routes/messages.ts`

**SseHub 扩展**：

```typescript
// sse.ts
type LiveStream = {
  controller: AbortController;
  cid: string;       // sessionId
  runId: string;     // 🆕
  closed: boolean;
};

export class SseHub {
  // 🆕 按 runId 查找
  getByRunId(runId: string): LiveStream | undefined { ... }

  // 🆕 检查 session 是否有 active run
  hasActiveRun(cid: string): boolean { ... }

  register(cid: string, runId: string): { streamId: string; controller: AbortController } {
    // ...
  }
}
```

**routes/messages.ts — 核心变更**：

```typescript
async function postMessageStream(...) {
  // 1) 加载 session（同现）
  // 2) 校验 body（新增 clientMessageId）

  // 3) 🆕 并发保护：同 session 已有非终态 run → 409
  if (hub.hasActiveRun(sessionId)) {
    sendJsonError(res, 409, 'RUN_ALREADY_ACTIVE', ...);
    return;
  }

  // 4) 🆕 生成 runId + streamId
  const runId = randomUUID();
  const { streamId, controller } = hub.register(sessionId, runId);

  // 5) 🆕 生成 assistant messageId
  const assistantMessageId = randomUUID();

  // 6) SSE response
  const sse = sseResponse(res, { streamId, ... });

  // 7) 🆕 唯一 seq 分配器
  let seqCounter = 0;
  const nextSeq = () => ++seqCounter;

  // 8) ⚠️ 首条 message_start 必须含 runId/streamId/messageId
  writeEnvelopeEvent(res, {
    sessionId, runId, streamId,
    seq: nextSeq(),
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: assistantMessageId,
        role: 'assistant',
        stream_id: streamId,
        run_id: runId,
        cid: sessionId,
      },
    },
  });

  // 9) Runner 事件适配 → 所有事件走 writeEnvelopeEvent
  for await (const ev of runner.runStream(params)) {
    writeEnvelopeEvent(res, {
      sessionId, runId, streamId,
      seq: nextSeq(),
      event: mapEventType(ev),
      data: adaptEventData(ev),
    });
  }

  // 10) done 事件携带 persistedRevision
  const revision = session.getMessageCount(); // JSONL 有效行数
  writeEnvelopeEvent(res, {
    sessionId, runId, streamId,
    seq: nextSeq(),
    event: 'done',
    data: { ok: true, streamId, runId, persistedRevision: revision, messageId: assistantMessageId },
  });
}
```

**`writeEnvelopeEvent` 实现**：

```typescript
function writeEnvelopeEvent(res: ServerResponse, env: ChatStreamEnvelope): void {
  writeEvent(res, {
    id: env.seq,
    event: env.event,
    data: {
      sessionId: env.sessionId,
      runId: env.runId,
      streamId: env.streamId,
      seq: env.seq,
      event: env.event,
      data: env.data,
    },
  });
}
```

**abort 端点改为按 sessionId 校验**：

```typescript
// POST /api/sessions/:id/runs/:runId/abort
// 或保留 POST /api/sessions/:id/messages/abort（P0 兼容）
// 使用 (sessionId, runId) 精确 abort
```

**验证**：
- 两个不同 session 并发 → 各自独立 run
- 同 session 重复 POST → 409
- 所有 SSE 事件包含 sessionId/runId/streamId/seq

---

#### WU-05: JSONL 写入带 ID

**目标**：新写入的消息 JSONL 行包含 `id`、`runId`；content block 包含 `id`。

**文件**：`src/agent/persistent-session.ts`（append 逻辑）

```typescript
// 写入 assistant 消息时
const msg: SerializedMessage = {
  role: 'assistant',
  content: blocks.map((b, i) => ({ ...b, id: b.id ?? `${messageId}:${i}` })),
  turnId,
  ts: Date.now(),
  id: messageId,      // 🆕
  runId,              // 🆕
};
```

**验证**：
- 新 JSONL 行包含 `"id"` 和 `"runId"` 字段
- 旧 JSONL 行读取不报错（字段 optional）
- history API 返回的消息包含 id/runId

---

#### WU-06: History API 扩展

**目标**：`GET /api/sessions/:id/history` 返回 `revision` + 每条消息带 `id`/`runId`。

**文件**：`src/web/server/routes/sessions.ts`

```typescript
// history handler 修改
const messages = session.getMessages(); // SerializedMessage[]
const revision = messages.length;      // JSONL 有效行数

// 为没有 id 的旧消息派生 id，为没有 blockId 的旧 block 派生
const enriched = messages.map((m, i) => ({
  ...m,
  id: m.id ?? deriveLegacyMessageId(sessionId, i, m),
  content: m.content.map((b, j) => ({
    ...b,
    id: (b as any).id ?? `${m.id}:${j}`,
  })),
}));

res.end(JSON.stringify({
  sessionId,
  revision,
  messages: enriched,
}));
```

**验证**：
- history 返回的 JSON 包含 `revision` 字段
- 每条消息有 `id`（新写入用原值，旧记录用派生值）
- 两次相同请求返回的派生 ID 一致

---

#### WU-07: 前端接入 chatRuntimeStore + 删除旧机制

**目标**：把所有使用旧 `useChatStream` 返回值的组件改为从 store selector 读取。

**文件**：`ChatPage.tsx`、`MessageList.tsx`、相关组件

```typescript
// ChatPage.tsx
function ChatPage() {
  const { sessionId } = useParams();
  const { status, messages, send, abort, historyLoaded } = useChatStream(sessionId!);

  return (
    <div>
      <MessageList key={sessionId} messages={messages} status={status} />
      <Composer onSend={send} onAbort={abort} disabled={!historyLoaded} status={status} />
    </div>
  );
}

// MessageList.tsx — key={sessionId} 重置滚动 observer
function MessageList({ messages, status }: Props) {
  // 只接收当前 session 的数据
  // ThinkingDots 仅当 status === 'streaming' 且 messages 最后一条 streamState 匹配时显示
}
```

**删除清单**（逐项确认）：
- [ ] `generationBySession` Map
- [ ] `streamGenerationRef`
- [ ] `staleEventLoggedRef`
- [ ] `inFlightBySessionRef`
- [ ] `computeInflightTail`
- [ ] `messageFingerprint`
- [ ] `isSameTailMessage`
- [ ] 切换 effect 中的 `controllerRef.current = null`
- [ ] callback 通过"当前最后一条 assistant 消息"定位更新目标
- [ ] 全局 `lastEventLru` 作为唯一重连去重（P0 改为 run 级 seq）

**验证**：
- 编译通过（TypeScript 无类型错误）
- 删除的符号无其他引用（grep 确认）

---

#### WU-08: rAF 按 run 隔离

**目标**：每个 run 独立维护 pending buffer + rAF handle，切换会话不清理后台 run 的 rAF。

已在 WU-01/WU-02 中实现（`chatRuntimeStore` 的 `appendTextBuffer` / `flushTextBuffer`）。

**额外规则**：
- done/error/abort 时同步 flush 该 run 的 buffer
- store dispose run 时 cancelAnimationFrame + 清空 buffer
- 切换会话不 cancel 后台 run 的 rAF

**验证**：
- 切换前排队 rAF → 切换后执行 → 写入原 session（非新 session）
- A 的 rAF 与 B 的 rAF 独立运行

---

#### WU-09: 服务端 session JSONL 写消息时带 runId + blockId

**目标**：runner 完成时把 assistant 消息写入 JSONL，包含稳定 messageId、runId 和各 block 的 blockId。

**文件**：`src/agent/runner.ts` 或 `persistent-session.ts`

在 runner 的 finalize 阶段（`message_end` 或 `done` 事件后），构造 `SerializedMessage` 时：

```typescript
const serialized: SerializedMessage = {
  role: 'assistant',
  content: finalBlocks.map((b, i) => ({
    ...b,
    id: b.type === 'tool_use' ? b.id : `${messageId}:${i}`,
  })),
  ts: Date.now(),
  id: messageId,
  runId,
  turnId: currentTurnId,
};
```

**验证**：
- 新生成的 JSONL 行包含完整 ID
- 重启后加载 → history API 返回 ID

---

#### WU-10: session 删除时级联清理

**目标**：删除 session 时先 abort active run，再清理 run、rAF、timer、draft 和 runtime。

**前端** (`chatRuntimeStore.ts`)：

```typescript
removeSession: (sessionId) => {
  const session = get().sessions[sessionId];
  if (!session) return;

  // 1. abort active run
  if (session.activeRunId) {
    const run = get().runs[session.activeRunId];
    run?.abortController?.abort();
    get().removeRun(session.activeRunId);
  }

  // 2. 清理 session runtime
  set((s) => {
    const { [sessionId]: _, ...rest } = s.sessions;
    return { sessions: rest };
  });
}
```

**后端**：`src/web/server/routes/sessions.ts` — DELETE handler

```typescript
// 1. 找到 active run → abort → 等待终态（最多 5s）
const activeStreams = hub.listForCid(sessionId);
for (const sid of activeStreams) hub.abort(sid);

// 2. 删除文件
sessionStore.delete(sessionId);
```

---

#### WU-11: 补齐测试（P0）

**测试文件清单**：

| 文件 | 测试内容 |
|------|----------|
| `web/src/features/chat/chatRuntimeStore.test.ts` | SessionRuntime 创建/隔离/LRU；RunRuntime 创建/删除；updateMessage 校验 sessionId+runId；rAF buffer 按 run 隔离 |
| `web/src/features/chat/useChatStream.test.ts` | A streaming → B → A；A/B generation 相同；切换前排队 rAF 切换后执行 |
| `web/src/features/chat/history-merge.test.ts` | 两层合并：persisted+overlay；相同 messageId 替换；revision 不足保留 overlay；重复 refetch 不增加；旧响应不覆盖新 session |
| `src/web/server/routes/messages.test.ts` | 两个 session 并发；同 session 返回 409；SSE envelope 完整性；seq 递增 |
| `src/agent/session-serde.test.ts` | 新 ID round-trip；旧 JSONL 派生 ID 稳定（相同输入→相同ID） |
| `e2e/chat-session-isolation.spec.ts` | Playwright：侧边栏快速切换 → DOM 不含其他会话文本；A/B 同时运行 → 分别回切 → 状态和布局正确 |

**测试基础设施**：
- 使用可控的延迟 ReadableStream / fake runner（不依赖真实模型）
- Vitest 单测 + Playwright E2E

**执行命令**：
```powershell
npm ci
npm run check
npm test

Set-Location web
npm ci
npm run build
npm test
npm run e2e
```

---

## 3. P1：可靠后台运行与恢复

### 3.1 文件变更总览

```
变更文件 (P1):

后端 (src/):
  🆕  web/server/run-registry.ts        — RunRegistry：runId → 状态/事件缓冲/订阅者
  ✏️  web/server/routes/messages.ts     — 新 API：create run、subscribe events、abort
  ✏️  web/server/routes/sessions.ts     — GET active run
  ✏️  web/server/sse.ts                 — SseHub 收窄为连接管理；seq 改为 run 级
  🆕  web/server/run-ledger.ts          — <sessionId>.runs.jsonl 轻量 ledger
  ✏️  web/server/graceful-shutdown.ts   — 等待 active run 终态

测试:
  🆕  src/web/server/run-registry.test.ts
  ✏️  src/web/server/routes/messages.test.ts
```

### 3.2 WU 分解

#### WU-12: RunRegistry

**文件**：`src/web/server/run-registry.ts`（新建）

```typescript
// ============================================================
// 类型
// ============================================================
export type RunStatus =
  | 'queued' | 'running' | 'completing' | 'succeeded'
  | 'failed' | 'aborting' | 'aborted' | 'interrupted';

export interface RunEntry {
  runId: string;
  sessionId: string;
  status: RunStatus;
  controller: AbortController;
  eventBuffer: CachedEvent[];       // 环形缓冲区
  subscribers: Set<Subscriber>;
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
  userMessageId: string;
  assistantMessageId: string;
}

interface CachedEvent {
  seq: number;
  event: string;
  data: unknown;
  timestamp: number;
}

interface Subscriber {
  res: ServerResponse;
  lastAckedSeq: number;
  pendingBytes: number;
}

// ============================================================
// 容量参数
// ============================================================
const MAX_EVENTS_PER_RUN = 1000;
const MAX_BUFFER_BYTES_PER_RUN = 2 * 1024 * 1024;  // 2 MiB
const MAX_GLOBAL_BUFFER_BYTES = 64 * 1024 * 1024;   // 64 MiB
const TERMINAL_RUN_TTL_MS = 5 * 60 * 1000;           // 5 min
const SUBSCRIBER_BACKPRESSURE_LIMIT = 1024 * 1024;   // 1 MiB
const SLOW_SUBSCRIBER_TIMEOUT_MS = 5000;

export class RunRegistry {
  private runs = new Map<string, RunEntry>();
  private sessionRuns = new Map<string, string>();  // sessionId → active runId

  // 创建 run
  create(sessionId: string, params: CreateRunParams): RunEntry { ... }

  // 终态 run（检查 session active 释放）
  transition(runId: string, status: RunStatus): void { ... }

  // 订阅
  subscribe(runId: string, res: ServerResponse): Subscriber { ... }
  unsubscribe(runId: string, subscriber: Subscriber): void { ... }

  // 重放
  replay(runId: string, fromSeq: number): CachedEvent[] { ... }

  // 查询
  getActive(sessionId: string): RunEntry | null { ... }
  get(runId: string): RunEntry | undefined { ... }

  // 清理
  evictTerminal(): void { ... }
  private enforceBufferLimits(): void { ... }
}
```

**状态机**：

```
queued → running → completing → succeeded
                  \→ failed
queued/running/completing → aborting → aborted
queued/running/completing/aborting --重启--> interrupted
```

**实现要点**：

1. **Runner 独立运行**：`POST /api/sessions/:sid/runs` 创建 run 后，在后台启动 runner；SSE route 只订阅事件
2. **Session 互斥**：同 session 只能有一个非终态 run；新请求 → 409
3. **事件缓冲**：环形缓冲区 + 全局内存上限；超限淘汰最旧终态 run
4. **背压**：subscriber 待发送 > 1 MiB 或 5s 无法写入 → 断开该 subscriber，不终止 run
5. **TTL**：终态 run 保留 5 分钟供重连

---

#### WU-13: P1 API 端点

**文件**：`src/web/server/routes/messages.ts`（新增路由）

```typescript
// 🆕 POST /api/sessions/:sessionId/runs
// 创建 run 并返回 runId（不阻塞等待，立即返回 202）
async function createRun(req, res, sessionStore, runRegistry) {
  // 1. 校验 session 存在
  // 2. 检查无 active run → 否则 409
  // 3. 生成 runId, messageId
  // 4. 创建 RunEntry → RunRegistry
  // 5. 后台启动 runner.runStream()
  // 6. 返回 202 { run: { runId, sessionId, status, ... } }
}

// 🆕 GET /api/sessions/:sessionId/runs/active
// 查询是否有 active run（用于刷新后恢复）
async function getActiveRun(req, res, runRegistry) {
  const run = runRegistry.getActive(sessionId);
  return { run: run ? runSummary(run) : null };
}

// 🆕 GET /api/sessions/:sessionId/runs/:runId/events
// SSE 订阅事件流；支持 Last-Event-ID 重放
async function subscribeEvents(req, res, runRegistry) {
  const lastEventId = parseLastEventId(req.headers['last-event-id']);
  const run = runRegistry.get(runId);
  if (!run) return 404;
  if (run.status is terminal && lastEventId >= run.lastSeq) return 200 空;

  // 1. 重放缓存事件（seq > lastEventId）
  // 2. 注册 subscriber
  // 3. 新事件实时推送
}

// POST /api/sessions/:sessionId/runs/:runId/abort
// （P0 已有雏形，P1 走 RunRegistry）
```

**旧 API 兼容**：

`POST /api/sessions/:sessionId/messages/stream` 在 P1 作为兼容适配器保留：
内部调用 `RunRegistry.create()` + `subscribeEvents()`，不直接操作 runner。

---

#### WU-14: 重连与重放

**前端重连逻辑**（`useChatStream.ts`）：

```typescript
// 进入会话时检查是否有 active run
useEffect(() => {
  if (!sessionId || historyLoaded) return;
  apiGet<{ run: RunSummary | null }>(`/api/sessions/${sessionId}/runs/active`)
    .then(({ run }) => {
      if (!run) return;
      // 有 active run → 订阅事件流（Last-Event-ID = store 中已知的 lastSeq）
      const knownSeq = store.getRun(run.runId)?.lastSeq ?? -1;
      subscribeToRun(sessionId, run.runId, knownSeq);
    });
}, [sessionId, historyLoaded]);
```

**重放**：
- 客户端发送 `Last-Event-ID: <已知最大 seq>`
- 服务端从缓存中取 `seq > Last-Event-ID` 的事件重放
- 缓存不足（seq 早于最老缓存）→ 返回 410 → 客户端走 history + active-run 查询

---

#### WU-15: Run Ledger

**文件**：`src/web/server/run-ledger.ts`（新建）

```typescript
// <sessionId>.runs.jsonl 格式
interface RunLedgerEntry {
  runId: string;
  sessionId: string;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
  userMessageId: string;
  assistantMessageId: string;
}

// 操作
export function appendRunLedgerEntry(sessionId: string, entry: RunLedgerEntry): void;
export function readRunLedger(sessionId: string): RunLedgerEntry[];

// 启动时恢复：将非终态 run 标记为 interrupted
export function recoverInterruptedRuns(sessionId: string): RunLedgerEntry[];
```

**崩溃恢复**：
- 进程重启 → 扫描所有 `<sid>.runs.jsonl`
- `status NOT IN ('succeeded', 'failed', 'aborted')` → 追加 `interrupted` 条目
- 前端查询 active run → null → 显示 interrupted 标识

---

#### WU-16: Graceful Shutdown

**文件**：`src/web/server/graceful-shutdown.ts`（修改）

现有 graceful shutdown 增加 RunRegistry 集成：

```typescript
async function shutdown() {
  // 1. 停止接受新请求
  // 2. 遍历所有 active run
  //    - 等待终态，最多 10s
  //    - 超时 → abort + 写 interrupted ledger
  // 3. 关闭 HTTP server
  // 4. 清理
}
```

---

#### WU-17: 背压与 Buffer 清理

在 `RunRegistry` 中实现：

```typescript
// 事件写入时检查
private appendEvent(runId: string, event: CachedEvent): void {
  const run = this.runs.get(runId);
  // 检查 run 级上限
  while (run.eventBuffer.length >= MAX_EVENTS_PER_RUN) {
    run.eventBuffer.shift();
  }
  // 检查全局上限
  this.enforceGlobalLimit();
  run.eventBuffer.push(event);
}

// 慢 subscriber 检测（定时器，每 5s）
private checkSlowSubscribers(): void {
  for (const run of this.runs.values()) {
    for (const sub of run.subscribers) {
      if (sub.pendingBytes > SUBSCRIBER_BACKPRESSURE_LIMIT) {
        this.unsubscribe(run.runId, sub);
      }
    }
  }
}

// 终态清理
private evictTerminal(): void {
  const now = Date.now();
  for (const [id, run] of this.runs) {
    if (isTerminal(run.status) && (now - run.updatedAt) > TERMINAL_RUN_TTL_MS) {
      this.runs.delete(id);
      this.ledgerCleanup(id);
    }
  }
}
```

---

#### WU-18: P1 测试

| 文件 | 测试内容 |
|------|----------|
| `src/web/server/run-registry.test.ts` | 状态机转换 + 幂等终态；event buffer 上限 + 淘汰；subscriber 管理；慢 subscriber 断开；global cap 清理；终态 TTL 清理 |
| `src/web/server/routes/messages.test.ts` (P1 扩展) | disconnect → reconnect → replay；replay buffer 过期 → 410 → history 回退；兼容 `/messages/stream` 不创建重复 runner |
| `src/web/server/run-ledger.test.ts` | 重启后标记 interrupted；ledger 读写 round-trip |

---

#### WU-19: P1 前端恢复

**文件**：`web/src/features/chat/useChatStream.ts`

```typescript
// 刷新后恢复：查询 active run → 订阅事件流
async function recoverActiveRun(sessionId: string) {
  const { run } = await apiGet<{ run: RunSummary | null }>(
    `/api/sessions/${sessionId}/runs/active`
  );
  if (!run || isTerminal(run.status)) return;

  // 从 store 的 lastSeq+1 开始订阅
  const lastSeq = store.getRun(run.runId)?.lastSeq ?? -1;
  const res = await fetch(
    `/api/sessions/${sessionId}/runs/${run.runId}/events`,
    { headers: lastSeq >= 0 ? { 'Last-Event-ID': String(lastSeq) } : {} }
  );
  // 消费 SSE 流（同 send() 的 for-await 循环）
  for await (const evt of parseSseStream(res.body!)) {
    handleStreamEvent(store, sessionId, run.runId, evt);
  }
}
```

---

## 4. P2：体验完善（概要）

| WU | 内容 |
|----|------|
| WU-20 | 每会话草稿保存（store.sessions[sid].draft） |
| WU-21 | 滚动位置恢复（session 级 scrollTop） |
| WU-22 | 侧边栏徽标（后台运行中 / 已完成） |
| WU-23 | 断线重连提示 + interrupted run 展示 |

---

## 5. 实施顺序与依赖

```
P0:
  WU-00 (类型层) ──┬── WU-01 (store) ── WU-02 (hook 重写)
                   │                     └── WU-08 (rAF 隔离)
                   ├── WU-03 (历史合并)
                   ├── WU-04 (后端 envelope + runId)
                   ├── WU-05 (JSONL 写 ID)
                   ├── WU-06 (history API 扩展)
                   └── WU-09 (runner 写 ID)

  WU-07 (接入组件 + 删除旧机制) ← 依赖 WU-01/02/03
  WU-10 (级联清理) ← 依赖 WU-01/04
  WU-11 (测试) ← 依赖 WU-00~10

P1:
  WU-12 (RunRegistry) ── WU-13 (P1 API)
                      ── WU-14 (重连重放)
                      ── WU-17 (背压清理)
  WU-15 (Run Ledger) ← 依赖 WU-12
  WU-16 (Graceful Shutdown) ← 依赖 WU-12/15
  WU-18 (P1 测试) ← 依赖 WU-12~17
  WU-19 (前端恢复) ← 依赖 WU-12/13/14
```

建议执行顺序：
1. WU-00 → WU-04 → WU-05 → WU-06 → WU-09（后端 ID 基础设施）
2. WU-01 → WU-02 → WU-03 → WU-08（前端 store + hook）
3. WU-07 + WU-10（组件接入 + 清理）
4. WU-11（写测试，验证 P0 全部验收标准）
5. P0 完成 → 提交 → P1 同理

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 旧 JSONL 无 ID | 派生 ID 不稳定 | 使用 sessionId+index+role+turnId 做确定性派生；测试覆盖 |
| Zustand 5 与 React 19 兼容性 | 类型/运行时问题 | 项目已使用 Zustand 5.0.14 + React 19.1.0，经验证兼容 |
| P0→P1 协议兼容 | 前端新旧协议混用 | P0 envelope 已预留 sessionId/runId/streamId/seq；前端接受无 envelope 的旧事件仅在过渡期 |
| 大重构导致回归 | 现有功能受损 | 先写可稳定失败的测试，再改实现；P0/P1 分开提交 |
| 性能（store 订阅粒度） | 不必要重渲染 | 使用 Zustand selector 按 sessionId 订阅；`useShallow` 比较 |

---

## 7. 协议迁移与回滚

1. **P0 发布顺序**：后端宽松读 + 新字段双写 → 前端新 store
2. **兼容窗口**：前端接受无 envelope 旧事件（仅进入当前 session/run），升级完成后关闭
3. **P1 发布顺序**：后端 RunRegistry + 新 API → 前端 create/subscribe；旧 `messages/stream` 保留一个版本
4. **回滚前端**：后端保留旧适配入口
5. **回滚后端**：新前端检测新 API 404 → 降级到 P0 入口（不承诺刷新重连）
6. **JSONL 字段**：全程 optional，旧版本忽略
7. **Run Ledger**：旁路文件，回滚可停止读取但不得删除

---

## 8. 环境与命令

```powershell
# 环境：Windows PowerShell 7+、Node.js 22.x、npm（lockfileVersion 3）

# 根目录
npm ci
npm run check
npm test

# 前端
Set-Location web
npm ci
npm run build
npm test
npm run e2e
```

预期：所有命令 exit code 0；P0/P1 对应新增测试全数通过。无需真实 provider key。
