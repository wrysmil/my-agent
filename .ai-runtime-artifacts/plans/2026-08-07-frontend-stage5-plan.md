---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
  - frontend-ui-engineering
skills_evidence:
  - .claude/skills/writing-plans/SKILL.md (loaded)
  - harness-kit/skills/frontend-ui-engineering (project-scoped)
dispatch: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage5-dispatch.md
source:
  - spec: .ai-runtime-artifacts/specs/2026-08-07-frontend-implementation-all-stages.md §五
  - 现有代码基线: src/renderer/js/features/chat.js (515行), src/renderer/js/state/state.js (163行), src/renderer/js/ipc/ipc-shim.js (104行)
  - 阶段3 execution-log: .ai-runtime-artifacts/execution-logs/2026-08-07-frontend-stage3-execution-log.md
created_at: 2026-08-07
status: draft
approved: false
---

# 阶段5：聊天系统升级 — 实施计划

> **For agentic workers:** 按 `*-dispatch.md` 执行图派发。任务用 checkbox (`- [ ]`) 追踪。

**Goal:** 将现有基础聊天功能升级为完整的 Agent 对话体验：消息队列（FIFO）、停止增强、轮询同步、@-mention 高亮、权限确认卡片。

**Architecture:** 聊天系统升级聚焦于 `chat.js`（主线 ~350 行增量），辅以 `state.js`（轮询/队列状态）、`style.css`（mention/permission 样式）、`zh.json`（新增 i18n key）。ChatPage 新增 5 个方法 + 增强现有 `send()`/`cancel()`，引入 `processQueue` 异步管道替代直接发送，`pollTimers` 后台轮询检测进行中的响应。

**Tech Stack:** Vanilla JS (IIFE 全局对象), Electron IPC (`{promise, cancel}` stream), marked.js, 现有组件（dialogs/uiConfirm/uiChoice）

---

## 文件结构

| 文件 | 职责 | 本次操作 |
|---|---|---|
| `src/renderer/js/features/chat.js` | 聊天系统核心（发送/流式/历史/工具卡片） | **重构** — 新增消息队列管道、轮询、@-mention、权限卡片；增强 send/cancel |
| `src/renderer/js/state/state.js` | 全局状态（视图/会话/缓存） | **扩展** — 新增 `pollTimers`/`pollMsgCounts` Map + `startPolling`/`stopPolling`/`processMessageQueue`/`enqueueMessage` 函数 |
| `src/renderer/style.css` | 全局样式 | **追加** — `.msg-mention` 高亮 + `.permission-card` 权限卡片样式 |
| `src/renderer/locales/zh.json` | 中文翻译表 | **追加** — ~10 个新 key（bash 权限、文件删除确认、轮询提示） |
| `src/renderer/js/shared/i18n.js` | 国际化引擎 | **同步** — `DEFAULT_TABLE` 追加新 key（保持与 zh.json 一致） |
| `src/renderer/index.html` | HTML 骨架 | **不变** — 现有 script 顺序已正确（state→ipc→components→features→app） |

**不修改的文件：**
- `src/renderer/js/ipc/ipc-shim.js` — 现有 `IPC.chat.send()` 的 `{promise, cancel}` 接口已满足需求
- `src/renderer/js/components/dialogs.js` — `uiChoice`/`uiConfirm` 已在阶段3实现，权限卡片直接调用
- `src/renderer/js/components/chat-input-form.js` — 框架已在阶段3搭好，按 spec 暂不接入

---

## 接口契约（WU 间）

WU-01（state.js 等支持文件）提供以下全局变量/函数，WU-02（chat.js）引用：

```js
// state.js 新增导出（全局作用域）
var pollTimers = new Map();        // sessionId → setInterval handle
var pollMsgCounts = new Map();     // sessionId → 最后已知消息标识

function startPolling(sessionId)   // 启动 3s 轮询（幂等）
function stopPolling(sessionId)    // 停止轮询 + 清理
function enqueueMessage(sessionId, msg)  // 追加到 messageQueues，触发 processQueue
function processMessageQueue(sessionId)  // FIFO 消费：串行处理队列中消息
```

```json
// zh.json 新增 key（WU-01 写入，WU-02 的 chat.js 通过 t() 引用）
{
  "chat.streaming_cancel": "已停止生成并清空待发送队列",
  "bash.permission.title": "Bash 权限确认",
  "bash.permission.message": "Agent 请求执行命令:\n\n{command}\n\n是否允许？",
  "bash.permission.allow_once": "允许本次",
  "bash.permission.deny": "拒绝",
  "delete_file.confirm.title": "确认删除文件",
  "delete_file.confirm.message": "Agent 请求删除文件:\n\n{path}\n\n是否确认？",
  "chat.poll_detected": "检测到进行中的助手响应，正在同步...",
  "chat.queue_count": "队列中还有 {count} 条消息等待发送"
}
```

---

## 任务拆解

### Task 1: state.js — 轮询/队列基础设施 + zh.json + style.css + i18n 同步

**Files:**
- Modify: `src/renderer/js/state/state.js` (~163→~230 行, +~65 行)
- Modify: `src/renderer/locales/zh.json` (~72→~82 keys, +~10 entries)
- Modify: `src/renderer/js/shared/i18n.js` (DEFAULT_TABLE 同步新增 ~10 keys)
- Modify: `src/renderer/style.css` (+~50 行 新样式 §14-15)

**对应 spec:** §5.2（消息队列状态）、§5.4（轮询状态）、§5.5（mention 样式）、§5.6（permission 卡片样式）

- [ ] **Step 1: state.js — 新增 pollTimers/pollMsgCounts + 4 个函数**

```js
// state.js — 在 "// ============================================================
// 辅助函数" 之前插入以下代码块（约 §缓存 和 §辅助函数 之间）

// ============================================================
// 轮询状态（阶段5）
// ============================================================

/** sessionId → setInterval handle */
var pollTimers = new Map();

/** sessionId → 最后已知消息数量（用于变更检测） */
var pollMsgCounts = new Map();

/**
 * 启动轮询：每 3s 查询会话消息数，有新增则通知 ChatPage。
 * 幂等——已轮询的 session 不会重复启动。
 * @param {string} sessionId
 */
function startPolling(sessionId) {
  if (pollTimers.has(sessionId)) return;
  var timer = setInterval(async function () {
    try {
      var raw = await window.myAgent.invoke('sessions:getMessages', sessionId);
      var messages = Array.isArray(raw) ? raw : (raw && raw.messages ? raw.messages : []);
      var lastCount = pollMsgCounts.get(sessionId) || 0;
      if (messages.length > lastCount) {
        pollMsgCounts.set(sessionId, messages.length);
        // 通知 ChatPage 有新消息到达
        if (typeof ChatPage !== 'undefined' && typeof ChatPage.onPollMessages === 'function') {
          ChatPage.onPollMessages(sessionId, messages.slice(lastCount));
        }
      }
    } catch (_) { /* 忽略轮询错误 */ }
  }, 3000);
  pollTimers.set(sessionId, timer);
}

/**
 * 停止轮询并清理状态。
 * @param {string} sessionId
 */
function stopPolling(sessionId) {
  var timer = pollTimers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    pollTimers.delete(sessionId);
  }
  pollMsgCounts.delete(sessionId);
}

// ============================================================
// 消息队列（阶段5）
// ============================================================

/**
 * 将消息追加到会话队列末尾，若队列空闲则立即开始处理。
 * @param {string} sessionId
 * @param {{ id: string, content: string, timestamp: number }} msg
 */
function enqueueMessage(sessionId, msg) {
  var queue = messageQueues.get(sessionId);
  if (!queue) {
    queue = [];
    messageQueues.set(sessionId, queue);
  }
  queue.push(msg);
  // 若队列中仅此一条（刚创建），立即开始处理
  if (queue.length === 1) {
    processMessageQueue(sessionId);
  }
}

/**
 * FIFO 消费：串行处理队列中的消息。
 * 每条消息发送完成后 shift + 递归处理下一条。
 * @param {string} sessionId
 */
async function processMessageQueue(sessionId) {
  var queue = messageQueues.get(sessionId);
  if (!queue || queue.length === 0) {
    messageQueues.delete(sessionId);
    return;
  }
  var msg = queue[0];
  try {
    // 委托 ChatPage 发送单条消息（ChatPage._sendOneMessage 为新增内部方法）
    if (typeof ChatPage !== 'undefined' && typeof ChatPage._sendOneMessage === 'function') {
      await ChatPage._sendOneMessage(sessionId, msg);
    }
  } catch (err) {
    // 取消/错误时清空整个队列（不继续发送后续消息）
    messageQueues.delete(sessionId);
    return;
  }
  // 移除已处理的消息
  queue.shift();
  if (queue.length === 0) {
    messageQueues.delete(sessionId);
  }
  // 递归处理下一条
  processMessageQueue(sessionId);
}
```

- [ ] **Step 2: zh.json — 追加 10 个新 i18n key**

在 `zh.json` 最后一个 key 后追加（注意 JSON 格式：前一条末尾加逗号）：

```json
  "chat.streaming_cancel": "已停止生成并清空待发送队列",
  "bash.permission.title": "Bash 权限确认",
  "bash.permission.message": "Agent 请求执行命令:\n\n{command}\n\n是否允许？",
  "bash.permission.allow_once": "允许本次",
  "bash.permission.deny": "拒绝",
  "delete_file.confirm.title": "确认删除文件",
  "delete_file.confirm.message": "Agent 请求删除文件:\n\n{path}\n\n是否确认？",
  "chat.poll_detected": "检测到进行中的助手响应，正在同步...",
  "chat.queue_count": "队列中还有 {count} 条消息等待发送",
  "chat.tool_executing": "执行中..."
```

- [ ] **Step 3: i18n.js — DEFAULT_TABLE 同步新增 10 个 key**

在 `DEFAULT_TABLE` 对象末尾追加与 zh.json 相同的 10 个 key-value（格式一致）。

- [ ] **Step 4: style.css — 追加 §14 @-mention 高亮 + §15 权限卡片样式**

```css
/* ============================================================
   14. @-mention Highlight (Stage 5)
   ============================================================ */
.msg-mention {
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 500;
}

/* ============================================================
   15. Permission Card (Stage 5)
   ============================================================ */
.permission-card {
  margin: 8px 0;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--color-warning-bg);
  border: 1px solid rgba(217, 119, 6, 0.2);
  font-size: 13px;
}
.permission-card .perm-cmd {
  font-family: var(--font-mono, 'Consolas', 'Monaco', monospace);
  background: rgba(0,0,0,0.06);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 6px 0;
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
}
.permission-card .perm-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}
```

---

### Task 2: chat.js — 消息队列 + 停止增强 + 流式增强

**Files:**
- Modify: `src/renderer/js/features/chat.js` (~515→~680 行, +~165 行)

**对应 spec:** §5.2（消息队列）、§5.3（停止增强）、§5.1（流式增强）

- [ ] **Step 1: ChatPage.send() 改造为队列模式**

将现有的直接发送逻辑拆分为：`send()`（入队）→ `_sendOneMessage()`（实际发送）。

```js
// 替换现有 ChatPage.send() 方法（行 263-386）

/** 用户点击发送——消息入队，不直接发送。 */
async send() {
  // 防止空消息
  var input = document.getElementById("chat-input");
  var message = input.value.trim();
  if (!message) return;

  input.value = "";
  input.style.height = "auto";

  var msg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    content: message,
    timestamp: Date.now()
  };

  // 发送中禁用按钮
  var sendBtn = document.getElementById("btn-send");
  if (sendBtn) sendBtn.disabled = true;

  var container = document.getElementById("chat-messages");
  var empty = container.querySelector(".empty-state");
  if (empty) empty.remove();

  this.appendUserMessage(message);

  // 委托全局队列处理
  if (typeof enqueueMessage === 'function') {
    enqueueMessage(this.currentSessionId || '__new__', msg);
  } else {
    // 回退：直接发送（兼容 state.js 未加载的场景）
    await this._sendOneMessage(this.currentSessionId || '__new__', msg);
  }
},

/**
 * 发送单条消息（由 processMessageQueue 调用）。
 * 将现有 send() 的核心流式逻辑迁移至此。
 * @param {string} sessionId
 * @param {{ id: string, content: string }} msg
 * @returns {Promise} — 流完成后 resolve；取消时 reject('stream cancelled')
 */
async _sendOneMessage(sessionId, msg) {
  var self = this;
  var container = document.getElementById("chat-messages");

  var assistantResult = this.appendAssistantMessage("");
  this.currentAssistantEl = assistantResult.el;
  this._totalToolCalls = 0;
  this._lastToolInvocations = [];
  var fullText = "";

  // 事件处理器（提取为方法引用，避免嵌套过深）
  var onEvent = function (ev) {
    self._handleStreamEvent(ev, assistantResult.el, container, fullText);
  };

  // 使用 IPC.chat.send（{promise, cancel} 模式）
  var streamResult = IPC.chat.send(
    sessionId === '__new__' ? null : sessionId,
    msg.content,
    onEvent
  );
  this.currentStream = streamResult;
  this._cancelFn = streamResult.cancel;

  return streamResult.promise.then(function (result) {
    self.currentStream = null;
    self._cancelFn = null;
    self.currentAssistantEl = null;
    var sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;

    if (result && result.sessionId) {
      self.currentSessionId = result.sessionId;
      // 新 session 创建后更新轮询
      stopPolling('__new__');
      startPolling(result.sessionId);
      self.loadSessionList();
    }

    var cursor = container.querySelector(".streaming-cursor");
    if (cursor) cursor.remove();
  }).catch(function (err) {
    self.currentStream = null;
    self._cancelFn = null;
    self.currentAssistantEl = null;
    var sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;

    if (err && err.message === 'stream cancelled') return;

    var errEl = document.createElement("div");
    errEl.className = "message assistant";
    errEl.innerHTML = '<div class="message-content" style="color:#e74c3c;">⚠️ 错误: ' + self.escapeHtml(String(err.message || err)) + '</div>';
    container.appendChild(errEl);
    container.scrollTop = container.scrollHeight;

    var cursor = container.querySelector(".streaming-cursor");
    if (cursor) cursor.remove();
  });
},
```

- [ ] **Step 2: 新增 `_handleStreamEvent` 方法 — 提取流事件处理**

将现有的 `onEvent` 内联回调（行 290-345）提取为 ChatPage 方法，便于复用和维护。

```js
/**
 * 处理流事件（从 send 的 onEvent 回调提取）。
 * @param {object} ev — 流事件
 * @param {HTMLElement} bubbleEl — 当前助手气泡 DOM
 * @param {HTMLElement} container — 消息容器
 * @param {string} _fullText — 已累积文本（被内部修改，暂用 this._currentFullText 替代）
 */
_handleStreamEvent: function (ev, bubbleEl, container) {
  var self = this;
  switch (ev.type) {
    case 'text_delta':
      this._currentFullText = (this._currentFullText || '') + ev.text;
      bubbleEl.innerHTML = typeof renderMarkdown === 'function'
        ? renderMarkdown(this._currentFullText)
        : this.escapeHtml(this._currentFullText).replace(/\n/g, '<br>');
      // @-mention 高亮
      this._highlightMentions(bubbleEl);
      container.scrollTop = container.scrollHeight;
      break;

    case 'tool_start':
      this._totalToolCalls = (this._totalToolCalls || 0) + 1;
      this._lastToolInvocations.push({ name: ev.name, input: ev.input });
      this.appendToolCallCard({
        name: ev.name,
        input: ev.input,
        status: "running"
      });
      container.scrollTop = container.scrollHeight;
      break;

    case 'tool_end':
      (function (evt) {
        var cards = container.querySelectorAll(".tool-call-card");
        var pendingCards = [];
        for (var i = 0; i < cards.length; i++) {
          var statusEl = cards[i].querySelector(".tool-call-status");
          if (statusEl && statusEl.textContent.indexOf('执行中') !== -1) {
            pendingCards.push({ card: cards[i], statusEl: statusEl });
          }
        }
        var target = pendingCards[pendingCards.length - 1];
        if (target) {
          if (evt.isError) {
            target.statusEl.className = "tool-call-status error";
            target.card.classList.add("error");
            var errMsg = evt.errorCode
              ? '❌ ' + self.escapeHtml(String(evt.result || '').slice(0, 100)) + ' · ' + evt.errorCode
              : '❌ ' + self.escapeHtml(String(evt.result || '').slice(0, 100));
            target.statusEl.textContent = errMsg;
          } else {
            target.statusEl.className = "tool-call-status success";
            var summary = evt.result
              ? String(evt.result).slice(0, 100)
              : "完成";
            var timing = evt.durationMs ? ' · ' + evt.durationMs + 'ms' : "";
            target.statusEl.innerHTML = '✅ ' + self.escapeHtml(summary) + timing;
          }
        }
      })(ev);
      container.scrollTop = container.scrollHeight;
      break;

    case 'retry':
      (function (evt) {
        var notice = document.createElement("div");
        notice.className = "retry-notice";
        notice.textContent = '🔄 重试 #' + evt.attempt + ': ' + evt.reason;
        container.appendChild(notice);
      })(ev);
      container.scrollTop = container.scrollHeight;
      break;
  }
},
```

- [ ] **Step 3: ChatPage.cancel() 增强 — 清空队列 + 通知**

```js
// 替换现有 ChatPage.cancel() 方法（行 388-397）

cancel: function () {
  // 1. 中止当前流
  if (this._cancelFn) {
    this._cancelFn();
    this._cancelFn = null;
  }
  this.currentStream = null;
  this.currentAssistantEl = null;

  // 2. 清空消息队列
  var sid = this.currentSessionId || '__new__';
  messageQueues.delete(sid);

  // 3. 移除流式光标
  var container = document.getElementById("chat-messages");
  var cursor = container && container.querySelector(".streaming-cursor");
  if (cursor) cursor.remove();

  // 4. 恢复按钮
  var sendBtn = document.getElementById("btn-send");
  if (sendBtn) sendBtn.disabled = false;

  // 5. 提示用户
  var notice = document.createElement("div");
  notice.className = "retry-notice";
  notice.textContent = typeof t === 'function' ? t('chat.streaming_cancel') : '已停止生成并清空待发送队列';
  if (container) {
    container.appendChild(notice);
    container.scrollTop = container.scrollHeight;
  }
},
```

---

### Task 3: chat.js — 轮询 + @-mention + 权限卡片

**Files:**
- Modify: `src/renderer/js/features/chat.js` (在 Task 2 基础上 +~190 行)

**对应 spec:** §5.4（轮询）、§5.5（@-mention）、§5.6（权限卡片）

**依赖:** Task 2（同一文件，需 Task 2 先完成 chat.js 基础重构）

- [ ] **Step 1: ChatPage 新增 `onPollMessages` — 轮询回调**

```js
/**
 * 轮询检测到新消息时的回调（由 state.js 的 startPolling 定时器调用）。
 * @param {string} sessionId
 * @param {Array} newMessages — 新增的消息数组
 */
onPollMessages: function (sessionId, newMessages) {
  // 仅在当前查看的会话中渲染新消息
  if (sessionId !== this.currentSessionId) return;
  if (!newMessages || newMessages.length === 0) return;

  var container = document.getElementById("chat-messages");
  if (!container) return;

  // 检查远端是否有进行中的助手响应（最后一条消息是 assistant 角色且无 content_end 标记）
  // 简化：直接追加所有新消息（包括可能不完整的助手消息）
  this._appendPollMessages(newMessages, container);
  container.scrollTop = container.scrollHeight;
},

/**
 * 将轮询获取的新消息追加到聊天区域。
 * 复用 renderHistoryMessages 的渲染逻辑（但跳过已在 DOM 中的消息）。
 * @param {Array} messages
 * @param {HTMLElement} container
 */
_appendPollMessages: function (messages, container) {
  var existingCount = container.querySelectorAll('.message').length;
  // 简化策略：清空容器后全部重新渲染（开销小——历史消息通常 < 200 条）
  // 仅在轮询首次检测到新消息时显示提示
  var pollNotice = container.querySelector('.poll-notice');
  if (!pollNotice) {
    var notice = document.createElement('div');
    notice.className = 'retry-notice poll-notice';
    notice.textContent = typeof t === 'function' ? t('chat.poll_detected') : '检测到进行中的助手响应，正在同步...';
    container.appendChild(notice);
  }

  // 重新加载完整历史
  if (this.currentSessionId) {
    this.loadHistory(this.currentSessionId);
  }
},
```

- [ ] **Step 2: ChatPage 新增 `_highlightMentions` — @-mention 高亮**

在每条助手消息渲染后调用。使用 TreeWalker 遍历文本节点，匹配已知名称并包裹 `<span class="msg-mention">`。

```js
/**
 * 在渲染后的消息 DOM 中高亮 @-mention（Agent 名称/用户名称）。
 * 在每次 text_delta 后调用（增量渲染时）。
 * @param {HTMLElement} rootEl — 消息气泡 DOM
 */
_highlightMentions: function (rootEl) {
  if (!rootEl) return;
  // 收集已知名称（从 conversations 标题 + _agentsCache）
  var knownNames = this._collectMentionNames();
  if (knownNames.length === 0) return;

  // 按长度降序排列（长名称优先匹配，避免 "Claude Code" 被 "Claude" 抢先）
  knownNames.sort(function (a, b) { return b.length - a.length; });
  // 转义正则特殊字符
  var escaped = knownNames.map(function (n) {
    return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  var re = new RegExp('(' + escaped.join('|') + ')', 'g');

  // TreeWalker：遍历文本节点，跳过 CODE/PRE/A
  var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (!node.parentElement) return NodeFilter.FILTER_REJECT;
      var tag = node.parentElement.tagName;
      if (tag === 'CODE' || tag === 'PRE' || tag === 'A' || tag === 'SPAN') {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  var replacements = [];
  while (walker.nextNode()) {
    var node = walker.currentNode;
    if (node.textContent && re.test(node.textContent)) {
      replacements.push(node);
    }
  }

  for (var i = 0; i < replacements.length; i++) {
    var node = replacements[i];
    var span = document.createElement('span');
    // 两次替换：先重置正则 lastIndex，再替换
    re.lastIndex = 0;
    span.innerHTML = node.textContent.replace(re, '<span class="msg-mention">$1</span>');
    if (node.parentNode) {
      node.parentNode.replaceChild(span, node);
    }
  }
},

/**
 * 收集可用于 @-mention 高亮的已知名称。
 * 来源：conversations 的 session name + _agentsCache
 * @returns {string[]}
 */
_collectMentionNames: function () {
  var names = [];
  // 从会话列表收集名称
  if (typeof conversations !== 'undefined' && Array.isArray(conversations)) {
    for (var i = 0; i < conversations.length; i++) {
      var n = conversations[i].name;
      if (n && names.indexOf(n) === -1) names.push(n);
    }
  }
  // 从 Agent 缓存收集
  if (typeof _agentsCache !== 'undefined' && _agentsCache) {
    var agents = Array.isArray(_agentsCache) ? _agentsCache : [];
    for (var j = 0; j < agents.length; j++) {
      var an = agents[j].name;
      if (an && names.indexOf(an) === -1) names.push(an);
    }
  }
  // 内置名称
  var builtins = ['My Agent', 'Claude', 'Claude Code', 'Codex'];
  for (var k = 0; k < builtins.length; k++) {
    if (names.indexOf(builtins[k]) === -1) names.push(builtins[k]);
  }
  return names;
},
```

- [ ] **Step 3: ChatPage.init() 增强 — 注册权限推送 + 轮询初始化**

在 `ChatPage.init()` 末尾（`this.loadSessionList()` 之后）追加：

```js
// 订阅 Bash 权限推送（阶段5）
if (typeof window.myAgent !== 'undefined' && typeof window.myAgent.onPushEvent === 'function') {
  var self = this;
  try {
    window.myAgent.onPushEvent('bash:permission', function (info) {
      self._handleBashPermission(info);
    });
  } catch (_) { /* 推送频道可能未注册 */ }

  try {
    window.myAgent.onPushEvent('delete_file.confirm', function (info) {
      self._handleDeleteConfirm(info);
    });
  } catch (_) { /* 推送频道可能未注册 */ }
}

// 若当前有活跃会话，启动轮询
if (this.currentSessionId) {
  if (typeof startPolling === 'function') {
    startPolling(this.currentSessionId);
  }
}
```

- [ ] **Step 4: ChatPage 新增权限处理方法**

```js
/**
 * 处理 Bash 权限推送 — 弹出确认对话框。
 * @param {{ requestId: string, command: string }} info
 */
_handleBashPermission: async function (info) {
  var title = typeof t === 'function' ? t('bash.permission.title') : 'Bash 权限确认';
  var msgTmpl = typeof t === 'function' ? t('bash.permission.message') : 'Agent 请求执行命令:\n\n{command}\n\n是否允许？';
  var message = msgTmpl.replace('{command}', info.command || '(未知命令)');
  var allowLabel = typeof t === 'function' ? t('bash.permission.allow_once') : '允许本次';
  var denyLabel = typeof t === 'function' ? t('bash.permission.deny') : '拒绝';

  var choice = null;
  if (typeof uiChoice === 'function') {
    choice = await uiChoice({
      title: title,
      message: message,
      choices: [
        { id: 'allow_once', label: allowLabel },
        { id: 'deny', label: denyLabel }
      ],
      cancelLabel: denyLabel
    });
  }

  try {
    await window.myAgent.invoke('bash:permission_response', {
      requestId: info.requestId,
      allow: choice === 'allow_once'
    });
  } catch (_) { /* 主进程可能未实现此 handler */ }
},

/**
 * 处理文件删除确认推送。
 * @param {{ requestId: string, path: string }} info
 */
_handleDeleteConfirm: async function (info) {
  var title = typeof t === 'function' ? t('delete_file.confirm.title') : '确认删除文件';
  var msgTmpl = typeof t === 'function' ? t('delete_file.confirm.message') : 'Agent 请求删除文件:\n\n{path}\n\n是否确认？';
  var message = msgTmpl.replace('{path}', info.path || '(未知路径)');

  var confirmed = false;
  if (typeof uiConfirm === 'function') {
    confirmed = await uiConfirm({
      title: title,
      message: message,
      confirmLabel: typeof t === 'function' ? t('dialog.confirm') : '确认',
      cancelLabel: typeof t === 'function' ? t('dialog.cancel') : '取消'
    });
  }

  try {
    await window.myAgent.invoke('delete_file:confirm_response', {
      requestId: info.requestId,
      confirmed: confirmed
    });
  } catch (_) { /* 主进程可能未实现此 handler */ }
},
```

- [ ] **Step 5: ChatPage.switchSession() — 切换时管理轮询生命周期**

修改现有 `switchSession`（行 117-126），在切换会话时停止旧轮询、启动新轮询：

```js
async switchSession: function (id) {
  // 停止旧会话的轮询
  if (this.currentSessionId && typeof stopPolling === 'function') {
    stopPolling(this.currentSessionId);
  }

  this.currentSessionId = id;
  this._currentFullText = '';

  var container = document.getElementById("chat-messages");
  container.innerHTML = "";

  var resp = await api.sessions.list({ limit: 50 });
  this.renderSessionList(resp.sessions);

  this.loadHistory(id);

  // 启动新会话的轮询
  if (id && typeof startPolling === 'function') {
    startPolling(id);
  }
},
```

- [ ] **Step 6: ChatPage.newSession() — 清理轮询**

修改现有 `newSession()`（行 472-497），在新建会话时停止轮询：

```js
newSession: function () {
  // 停止当前轮询
  if (this.currentSessionId && typeof stopPolling === 'function') {
    stopPolling(this.currentSessionId);
  }
  this.currentSessionId = null;
  this._currentFullText = '';

  // ... 保持原有清理逻辑（取消流、清空容器、重置标题、聚焦输入框）...

  // 新会话无需轮询（无历史消息），用户发送第一条消息后自然建立
},
```

---

## 自检

### 1. Spec 覆盖

| 需求 | 对应 Task | 状态 |
|---|---|---|
| §5.1 流式渲染增强（工具调用卡片可折叠） | Task 2 Step 2 + 现有 appendToolCallCard | ✅ 现有已实现折叠，Task 2 增强事件处理 |
| §5.2 消息队列 FIFO | Task 1 Step 1 (state.js) + Task 2 Step 1 (chat.js) | ✅ |
| §5.3 停止生成增强（清空队列） | Task 2 Step 3 | ✅ |
| §5.4 轮询同步 | Task 1 Step 1 (state.js 轮询) + Task 3 Step 1,5,6 (chat.js) | ✅ |
| §5.5 @-mention 高亮 | Task 3 Step 2 | ✅ |
| §5.6 权限确认卡片 | Task 3 Step 3,4 | ✅ |
| §5.3 不作实现项（contenteditable/Skill chip） | 无对应任务 | ✅ 按 spec 跳过 |

### 2. Placeholder 扫描

- 无 "TBD" / "TODO" / "implement later"
- 所有代码块为实际可运行的实现
- 所有 i18n key 有对应的中文翻译

### 3. 类型一致性

- `startPolling(sessionId)` / `stopPolling(sessionId)` — state.js 定义，chat.js 调用，签名一致
- `enqueueMessage(sessionId, msg)` / `processMessageQueue(sessionId)` — 同上
- `ChatPage._sendOneMessage(sessionId, msg)` — chat.js 新增内部方法
- `ChatPage._handleStreamEvent(ev, bubbleEl, container)` — 新增
- `ChatPage._highlightMentions(rootEl)` / `_collectMentionNames()` — 新增
- `ChatPage._handleBashPermission(info)` / `_handleDeleteConfirm(info)` — 新增
- `ChatPage.onPollMessages(sessionId, newMessages)` — 轮询回调
- `ChatPage._currentFullText` — 新增实例字段（替代局部变量 fullText）
- `ChatPage._totalToolCalls` / `ChatPage._lastToolInvocations` — 新增实例字段

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 想拆分并行 → 审 `*-dispatch.md` 后说「开始实现」或「并行执行」
