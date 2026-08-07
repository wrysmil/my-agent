---
artifact: implementation-plan
route: writing-plans
skills:
  - writing-plans
skills_evidence:
  - skipped: writing-plans (not found on this platform)
dispatch: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage2-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-07-frontend-implementation-all-stages.md § 第二阶段
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
created_at: 2026-08-07
status: draft
approved: false
---

# 阶段2：IPC 通信增强 — 实现计划

> **For agentic workers:** 本计划含 3 个 WU，GROUP-1 内 2 个并行 WU + GROUP-2 串行依赖。

**Goal:** 规范化前端与 Main 进程的通信协议 — 将 stream 模式从 `{on, cancel}` 事件监听改为 `{promise, cancel}` Promise 模式；新增推送事件频道白名单；建立统一 IPC 路由层；Main 进程适配新的流协议。

**Architecture:** IPC 通道协议变更：preload `stream()` 返回 `{promise, cancel}`（替代 `{on, cancel}`），内部通过 `myagent.streamStart` / `myagent.streamCancel` 与 Main 进程通信；`invoke()` 统一为单 payload 对象；`onPushEvent()` 加频道白名单。

**Tech Stack:** Electron CJS preload + Node.js ESM IPC handler（`dist/src/ipc/`）+ 纯 JS 渲染层（IIFE）。

---

## 一、项目现状摸底

### 1.1 当前 IPC 协议（preload.cjs → main.cjs）

```
渲染进程                            Main 进程
─────────                          ─────────
api.chat.send({message, sessionId})
  └→ window.myAgent.stream("chat:stream", payload)
       └→ preload.cjs: ipcRenderer.send("chat:stream", {streamId, ...payload})
            └→ main.cjs → chat.js: ipcMain.on("chat:stream", handler)
                 └→ event.sender.send("stream:text_delta", {streamId, payload})
                      └→ preload stream.on("text_delta", callback)  ← 事件模式
```

**问题：**
1. `stream.on(event, cb)` 返回 unsubscribe 函数，调用方需手动管理多个 listener
2. 流结束/错误无统一的 Promise 语义（无法 `await stream.promise`）
3. `on(channel, cb)` 无推送白名单，任意 channel 可监听
4. `invoke(channel, ...args)` 参数透传不一致（有时 `invoke('ch', id)`，有时 `invoke('ch', {id})`）

### 1.2 阶段2 涉及文件

| 文件 | 操作 | 当前行数(估) | 说明 |
|---|---|---|---|
| `dist/electron/preload.cjs` | 重写 | ~37 | stream 模式 + push 白名单 + 统一 invoke |
| `src/renderer/js/ipc/ipc-shim.js` | 新建 | — | IPC 路由垫片（替代 api.js 的直接调用） |
| `src/renderer/js/ipc/api.js` | 废弃 | ~63 | 现有 api.js 改为从 ipc-shim.js re-export |
| `dist/electron/main.cjs` | 修改 | ~114 | 新增 myagent.invoke / streamStart / streamCancel |
| `dist/src/ipc/chat.js` | 重写 | ~25 | 适配新的 stream 协议 |
| `src/renderer/js/features/chat.js` | 修改 | ~700 | stream 调用从 `{on, cancel}` 改为 `{promise, cancel}` |

### 1.3 涉及的后端 IPC handler（只读参考）

| 文件 | 说明 |
|---|---|
| `dist/src/ipc/sessions.js` | `ipcMain.handle('sessions:*')` — 6 个 handler |
| `dist/src/ipc/config.js` | `ipcMain.handle('config:*' / 'providers:*' / 'app:*')` — 10+ handler |
| `dist/src/ipc/skills.js` | `ipcMain.handle('skills:*')` — 3 个 handler |
| `dist/src/ipc/chat.js` | `ipcMain.on('chat:stream' / 'chat:stream:cancel')` + `handle('chat:cancel')` |

---

## 二、Task 拆解

### Task 2.1：Preload API 增强（独立 WU）

**产出：** 重写 `dist/electron/preload.cjs`

**依赖：** 无（纯 preload 层，不依赖其他 WU）

**当前代码 → 目标代码变更：**

#### 2.1.1 invoke 统一为单 payload

```js
// 当前：透传可变参数
invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)

// 目标：统一走 myagent.invoke，单 payload 对象
invoke: (channel, payload) =>
  ipcRenderer.invoke('myagent.invoke', { channel, payload: payload || {} }),
```

#### 2.1.2 stream 改为 {promise, cancel}

```js
// 当前：{on, cancel} 事件模式
stream: (channel, payload) => {
  const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  ipcRenderer.send(channel, { streamId, ...payload });
  return {
    on: (event, callback) => {
      const listener = (_ev, data) => {
        if (data.streamId === streamId) callback(data.payload);
      };
      ipcRenderer.on(`stream:${event}`, listener);
      return () => ipcRenderer.removeListener(`stream:${event}`, listener);
    },
    cancel: () => ipcRenderer.send(`${channel}:cancel`, { streamId }),
  };
}

// 目标：{promise, cancel} Promise 模式
stream: function(channel, payload, onEvent) {
  const requestId = _nextRequestId();
  const channelKey = `stream:${requestId}`;
  let settled = false, cancelled = false;

  const promise = new Promise((resolve, reject) => {
    const listener = (_evt, ev) => {
      if (!ev || settled) return;
      if (ev.type === 'done') {
        settled = true;
        ipcRenderer.removeListener(channelKey, listener);
        cancelled ? reject(new Error('stream cancelled')) : resolve(ev.payload);
        return;
      }
      if (ev.type === 'error') {
        settled = true;
        ipcRenderer.removeListener(channelKey, listener);
        reject(new Error(ev.payload?.message || 'stream error'));
        return;
      }
      try { onEvent(ev); }
      catch (err) { settled = true; ipcRenderer.removeListener(channelKey, listener); reject(err); }
    };
    ipcRenderer.on(channelKey, listener);
    ipcRenderer.send('myagent.streamStart', { requestId, channel, payload });
  });

  const cancel = () => {
    if (settled || cancelled) return;
    cancelled = true;
    ipcRenderer.send('myagent.streamCancel', requestId);
  };
  return { promise, cancel };
},
```

#### 2.1.3 推送事件加白名单

```js
// 当前：任意 channel 可监听
on: (channel, callback) => { ... }

// 目标：白名单频道 + 别名
onPushEvent: function(channel, handler) {
  if (!_isAllowedPushChannel(channel))
    throw new Error(`push channel not allowed: ${channel}`);
  const listener = (_evt, payload) => { try { handler(payload); } catch(_) {} };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
},

// 白名单前缀
const PUSH_EVENT_PREFIXES = [
  'bash:', 'bridge:', 'delete_file.',
  'skills:', 'config:', 'conversations:'
];
```

#### 2.1.4 辅助函数

```js
let _reqCounter = 0;
function _nextRequestId() {
  _reqCounter = (_reqCounter + 1) % 0x7fffffff;
  return `req-${Date.now().toString(36)}-${_reqCounter.toString(36)}`;
}

function _isAllowedPushChannel(channel) {
  if (typeof channel !== 'string') return false;
  return PUSH_EVENT_PREFIXES.some(p => channel.startsWith(p));
}
```

**验收：**
- `window.myAgent.stream('test', {}, (ev) => console.log(ev))` 返回 `{promise, cancel}`
- `window.myAgent.onPushEvent('bash:permission', cb)` 成功注册
- `window.myAgent.onPushEvent('unknown:channel', cb)` 抛出 Error

---

### Task 2.2：Main 进程 Handler 适配（独立 WU，与 2.1 并行）

**产出：** 修改 `dist/electron/main.cjs` + 重写 `dist/src/ipc/chat.js`

**依赖：** 无（与 2.1 共享协议契约，文件不相交）

#### 2.2.1 main.cjs 新增统一 handler

在 `initIpc()` 中新增三个 handler：

```js
// === 统一 invoke 入口（包装现有 channel → handler 映射）===
ipcMain.handle('myagent.invoke', async (_evt, { channel, payload }) => {
  // 委托给现有的 ipcMain.handle 注册
  // Electron 的 ipcMain.handle 已提供 channel→handler 映射，
  // 这里做一次透传：调用原有 handler
  // 注意：Electron 不支持直接调用其他 handler，
  // 因此改为在 preload 层直接 invoke 原 channel（保持向后兼容）
  // —— 实际上 invoke 这层包装主要是规范化参数格式
});
```

**调整策略：** 考虑到 Electron 不支持跨 handler 调用，`invoke` 保持直接透传但统一参数格式：

```js
// preload.cjs
invoke: (channel, payload) => {
  // 向后兼容：如果 payload 是简单值（string/number），作为单参数传递
  // 如果 payload 是对象，展开为参数（适配现有 handler 的 (...args) 签名）
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return ipcRenderer.invoke(channel, payload);
  }
  return ipcRenderer.invoke(channel, payload);
},
```

实际上，**不做 myagent.invoke 包装** — 保持现有 channel 直传（`ipcRenderer.invoke('sessions:list', opts)`），因为现有 handler 已按 channel 命名空间组织良好，强行加一层 myagent.invoke 反而引入不必要的间接层。

**关键修改：main.cjs 新增 stream 管理：**

```js
// 在 initIpc() 中
const activeStreams = new Map(); // requestId → { abort: () => void }

ipcMain.on('myagent.streamStart', (event, { requestId, channel, payload }) => {
  const channelKey = `stream:${requestId}`;
  
  if (channel === 'chat:send') {
    // 委托给 chat handler 的流式发送
    const { runChatStream } = require('../src/ipc/chat.js');
    const abort = runChatStream(event, requestId, payload);
    activeStreams.set(requestId, { abort });
  }
  // 后续可扩展其他 stream channel
});

ipcMain.on('myagent.streamCancel', (_event, requestId) => {
  const stream = activeStreams.get(requestId);
  if (stream) {
    stream.abort();
    activeStreams.delete(requestId);
  }
});
```

#### 2.2.2 chat.js handler 重写

```js
// dist/src/ipc/chat.js — 新 stream 协议
import { ipcMain } from "electron";

export function runChatStream(event, requestId, payload) {
  const channelKey = `stream:${requestId}`;
  let aborted = false;

  const emit = (type, data) => {
    if (aborted) return;
    event.sender.send(channelKey, { type, ...data });
  };

  // 占位实现：Echo + 模拟流式输出
  const { message, sessionId } = payload || {};
  const text = `Echo: ${message || '(empty)'}`;
  let index = 0;

  const timer = setInterval(() => {
    if (aborted) {
      clearInterval(timer);
      return;
    }
    if (index < text.length) {
      emit('text_delta', { text: text[index] });
      index++;
    } else {
      clearInterval(timer);
      emit('done', { sessionId: sessionId || 'placeholder' });
    }
  }, 30);

  return {
    abort: () => {
      aborted = true;
      clearInterval(timer);
    }
  };
}

// 保留兼容旧协议的 chat:stream handler（过渡期）
export function registerChatIpc(deps) {
  // 不再注册 chat:stream / chat:stream:cancel
  // 新协议全部走 myagent.streamStart / myagent.streamCancel
  // 保留 chat:cancel 兼容
  ipcMain.handle("chat:cancel", async (_event, sessionId) => {
    return { ok: true };
  });
}
```

**验收：**
- Main 进程收到 `myagent.streamStart` 后正确触发流式输出
- `myagent.streamCancel` 能中止正在进行的流
- preload 的 `stream()` 返回的 `promise` 在流完成后 resolve，cancel 后 reject

---

### Task 2.3：IPC 路由垫片 + 聊天适配（依赖 2.1 + 2.2）

**产出：** `src/renderer/js/ipc/ipc-shim.js`（新建）+ 修改 `src/renderer/js/features/chat.js`

**依赖：** WU 2.1（preload 新 API）+ WU 2.2（Main 进程新 handler）

#### 2.3.1 ipc-shim.js 路由表

```js
// src/renderer/js/ipc/ipc-shim.js
// 统一 IPC 调用入口（替代直接调 window.myAgent.invoke）
const IPC = {
  // Agent
  agents: {
    list: () => window.myAgent.invoke('agents:list'),
    get: (id) => window.myAgent.invoke('agents:get', { id }),
    create: (data) => window.myAgent.invoke('agents:create', data),
    update: (id, data) => window.myAgent.invoke('agents:update', { id, ...data }),
    delete: (id) => window.myAgent.invoke('agents:delete', { id }),
  },

  // Session
  sessions: {
    list: (opts) => window.myAgent.invoke('sessions:list', opts),
    get: (id) => window.myAgent.invoke('sessions:get', { id }),
    delete: (id) => window.myAgent.invoke('sessions:delete', { id }),
    rename: (id, name) => window.myAgent.invoke('sessions:rename', { id, name }),
    archive: (id) => window.myAgent.invoke('sessions:archive', { id }),
    unarchive: (id) => window.myAgent.invoke('sessions:unarchive', { id }),
  },

  // Chat (stream)
  chat: {
    send: (sessionId, text, onEvent) =>
      window.myAgent.stream('chat:send', { sessionId, text }, onEvent),
    cancel: (sessionId) =>
      window.myAgent.invoke('chat:cancel', { sessionId }),
  },

  // Config
  config: {
    get: () => window.myAgent.invoke('config:get'),
    update: (patch) => window.myAgent.invoke('config:update', patch),
  },

  // Skills
  skills: {
    list: () => window.myAgent.invoke('skills:list'),
    get: (id) => window.myAgent.invoke('skills:get', { id }),
    setEnabled: (id, enabled) => window.myAgent.invoke('skills:setEnabled', { id, enabled }),
  },

  // Providers
  providers: {
    list: () => window.myAgent.invoke('providers:list'),
    save: (data) => window.myAgent.invoke('providers:save', data),
    delete: (id) => window.myAgent.invoke('providers:delete', { id }),
    test: (id) => window.myAgent.invoke('providers:test', { id }),
  },

  // App
  app: {
    getVersion: () => window.myAgent.invoke('app:getVersion'),
  },
};
```

#### 2.3.2 api.js 兼容层

保留 `src/renderer/js/ipc/api.js` 作为薄兼容层，指向 `IPC`：

```js
// src/renderer/js/ipc/api.js — 从 ipc-shim.js 的 IPC 对象重新导出
// 保持与现有 chat.js / sessions.js / skills.js / settings.js 的兼容
const api = {
  sessions: IPC.sessions,
  chat: {
    send(input) {
      // 兼容旧接口：{ message, sessionId } → (sessionId, text, onEvent)
      const onEvent = input._onEvent; // 内部字段
      return IPC.chat.send(input.sessionId, input.message, onEvent);
    },
    cancel(id) { return IPC.chat.cancel(id); },
  },
  config: IPC.config,
  skills: IPC.skills,
  providers: IPC.providers,
  app: IPC.app,
};
```

#### 2.3.3 chat.js 流式调用适配

chat.js 中的 `send()` 方法从 `stream.on('event', cb)` 改为 `{promise, cancel}`：

```js
// 当前 (chat.js send 方法):
const stream = api.chat.send({ message, sessionId: this.currentSessionId });
this.currentStream = stream;

stream.on("text_delta", (ev) => { fullText += ev.text; ... });
stream.on("tool_start", (ev) => { ... });
stream.on("tool_end", (ev) => { ... });
stream.on("retry", (ev) => { ... });
stream.on("done", (ev) => { this.currentStream = null; ... });
stream.on("error", (ev) => { ... });

// cancel 方法:
if (this.currentStream) { this.currentStream.cancel(); }

// 目标:
const onEvent = (ev) => {
  switch (ev.type) {
    case 'text_delta':
      fullText += ev.text;
      assistantEl.innerHTML = renderMarkdown(fullText);
      container.scrollTop = container.scrollHeight;
      break;
    case 'tool_start':
      this.appendToolCallCard({ name: ev.name, input: ev.input, status: 'running' });
      break;
    case 'tool_end':
      // 更新最后一个 tool card 状态
      break;
    case 'retry':
      // 渲染重试通知
      break;
  }
};

const { promise, cancel } = IPC.chat.send(this.currentSessionId, message, onEvent);
this._cancelFn = cancel;

promise.then((result) => {
  this.currentStream = null;
  this._cancelFn = null;
  this.currentAssistantEl = null;
  if (result && result.sessionId) {
    this.currentSessionId = result.sessionId;
    this.loadSessionList();
  }
  // 恢复发送按钮
}).catch((err) => {
  this.currentStream = null;
  this._cancelFn = null;
  // 渲染错误
});

// cancel 方法改为:
if (this._cancelFn) { this._cancelFn(); this._cancelFn = null; }
```

**验收：**
- `IPC.chat.send(sessionId, text, cb)` 返回 `{promise, cancel}` 对象
- 聊天发送消息 → 流式接收 → 消息渲染正常（与重构前行为一致）
- 点击"停止"按钮能中止当前流
- 现有 features（sessions/skills/settings）通过 `api.*` 兼容层仍可正常工作

---

## 三、依赖图

```
┌─────────────────────┐     ┌──────────────────────────────┐
│ WU-01 (preload.cjs) │     │ WU-02 (main.cjs + chat.js)    │
│ 独立                 │     │ 独立                          │
└─────────┬───────────┘     └──────────────┬───────────────┘
          │                                │
          └────────────┬───────────────────┘
                       │ GROUP-1 完成
                       ▼
          ┌────────────────────────────────┐
          │ WU-03 (ipc-shim.js + chat.js)  │
          │ 依赖: WU-01 + WU-02            │
          └────────────────────────────────┘
                       │
                       ▼
              阶段2 完成
```

**GROUP-1 可并行（2 WU）：** WU-01 和 WU-02 文件完全不相交，且共享同一协议契约（spec §2.2）。
**GROUP-2 串行（1 WU）：** WU-03 需要新的 preload API + Main 进程 handler 就绪后才能集成。

---

## 四、验证计划

### 4.1 自动化检查

- [ ] `dist/electron/preload.cjs` 语法有效（Electron 加载不报错）
- [ ] `dist/src/ipc/chat.js` 语法有效（ESM import 正确）
- [ ] `src/renderer/js/ipc/ipc-shim.js` 无语法错误
- [ ] `src/renderer/js/features/chat.js` 无语法错误

### 4.2 手动验证（Electron 中）

- [ ] **preload API：** DevTools console 中 `window.myAgent.stream('test', {}, e => console.log(e))` 返回 `{promise, cancel}`
- [ ] **推送白名单：** `window.myAgent.onPushEvent('bash:test', cb)` 成功；`onPushEvent('evil:channel', cb)` 抛错
- [ ] **流式聊天：** 发送消息 → 字符逐字输出 → 完成后 promise resolve
- [ ] **停止生成：** 发送消息 → 点击停止 → promise reject with 'stream cancelled'
- [ ] **IPC 路由：** `IPC.sessions.list()` 返回会话列表（与旧 `api.sessions.list()` 行为一致）
- [ ] **兼容性：** sessions / skills / settings 页面通过 api.js 兼容层正常工作

### 4.3 回归验证

- [ ] 无 console 错误
- [ ] 4 个页面正常导航
- [ ] Chat 消息渲染不变（文本/Markdown/工具调用卡片）

---

## 五、Plan 自检

- [ ] 每个 Task 产出文件明确，无模糊描述
- [ ] WU-01 和 WU-02 完全独立（文件不相交，共享协议契约），可并行派发
- [ ] WU-03 依赖关系清晰（GROUP-1 完成后执行）
- [ ] 验收标准可操作（非"看起来好"）
- [ ] 现有功能全部保持可用（向后兼容通过 api.js 兼容层保证）
- [ ] 通信协议变更不破坏已有 IPC handler（sessions/config/skills/providers 不变）
- [ ] 预估代码量 ~200 行（preload ~80 + chat handler ~50 + ipc-shim ~50 + chat.js 适配 ~50）

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 并行派发 → 确认后走 `orchestration` → `2026-08-07-frontend-stage2-dispatch.md`
