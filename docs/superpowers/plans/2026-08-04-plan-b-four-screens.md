# Plan B: 四屏 UI 实现

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现四个核心页面的完整前端 —— 对话页（消息流 + 流式接收）、会话管理页（表格 + 筛选 + 批量操作）、设置页（二级导航 + 表单）、Skills 管理页（卡片网格 + 标签筛选）。

**Architecture:** 每个页面一个独立 JS 文件 + CSS 文件。所有页面共享 `App.navigate()` 路由与 `api.js` 通信层。对话页通过 `window.myAgent.stream()` 接收流式事件。会话管理/设置/Skills 通过 `window.myAgent.invoke()` 走请求-响应模式。

**Tech Stack:** 原生 HTML/CSS/JS（无框架/无 bundler），marked（Markdown 渲染）

**Prerequisites:** Plan A（Electron 壳 + CSS 基础设施 + IPC）已完成。`App.navigate()` 路由与 `api.js` 已就位。

**Source spec:** [2026-08-04-my-agent-desktop-ui-design.md](../specs/2026-08-04-my-agent-desktop-ui-design.md) §4.1-4.4

---

## File Structure

```
electron/renderer/
├── index.html                       # 修改：替换占位 HTML 为完整页面
├── css/
│   ├── chat.css                     # 🆕 对话页专属样式
│   ├── sessions.css                 # 🆕 会话管理页专属样式
│   ├── settings.css                 # 🆕 设置页专属样式
│   └── skills.css                   # 🆕 Skills 管理页专属样式
├── js/
│   ├── app.js                       # 修改：完善路由 + 启动逻辑
│   └── pages/
│       ├── chat.js                  # 🆕 对话页逻辑
│       ├── sessions.js              # 🆕 会话管理页逻辑
│       ├── settings.js              # 🆕 设置页逻辑
│       └── skills.js                # 🆕 Skills 管理页逻辑
└── modules/
    ├── markdown.js                  # 已有
    └── icons.js                     # 已有
```

---

### Task 1: 对话页 — CSS 样式

**Files:**
- Create: `electron/renderer/css/chat.css`

- [ ] **Step 1: 实现 chat.css**

```css
/* electron/renderer/css/chat.css */

/* ===== 会话列表面板 ===== */
#session-panel {
  width: 260px;
  min-width: 260px;
  border-right: 1px solid var(--border-light);
  background: var(--bg-main);
  display: flex;
  flex-direction: column;
}

#session-panel.collapsed {
  display: none;
}

.session-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.session-panel-title {
  font-weight: 600;
  font-size: var(--text-md);
  color: var(--color-text);
}

.session-panel-search {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.session-group-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  padding: 8px 12px 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.session-group-label .toggle {
  margin-left: auto;
  cursor: pointer;
}

.session-item {
  padding: 9px 12px;
  border-radius: var(--radius-md);
  margin-bottom: 2px;
  font-size: var(--text-base);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.12s;
}

.session-item:hover {
  background: var(--bg-hover);
}

.session-item.active {
  background: var(--color-primary-bg);
  border-left: 3px solid var(--color-primary);
}

.session-item-name {
  font-weight: 500;
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-preview {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-panel-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--border-light);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  display: flex;
  justify-content: space-between;
}

/* ===== 对话顶栏 ===== */
#chat-topbar {
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
  background: var(--bg-main);
  flex-shrink: 0;
}

.chat-topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat-topbar-title {
  font-weight: 600;
  color: var(--color-text);
}

.chat-topbar-path {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
}

.chat-topbar-right {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #888;
  font-size: var(--text-sm);
}

/* ===== 流式指示 ===== */
.streaming-cursor {
  display: inline-block;
  color: var(--color-primary);
  animation: blink 0.8s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* ===== 重试提示 ===== */
.retry-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: var(--color-warning-bg);
  color: var(--color-warning);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

/* ===== 对话区输入框覆盖 ===== */
#chat-input-area {
  padding: 18px 24px 22px;
}

.input-wrapper {
  max-width: 780px;
  margin: 0 auto;
}

.input-context-bar {
  max-width: 780px;
  margin: 0 auto 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/renderer/css/chat.css
git commit -m "feat(renderer): add chat page CSS styles"
```

---

### Task 2: 对话页 — JavaScript 逻辑

**Files:**
- Create: `electron/renderer/js/pages/chat.js`
- Modify: `electron/renderer/index.html` — 添加 `<script src="js/pages/chat.js"></script>`

- [ ] **Step 1: 实现 chat.js**

```js
// electron/renderer/js/pages/chat.js
const ChatPage = {
  currentSessionId: null,
  currentStream: null,
  currentAssistantEl: null,
  _initialized: false,  // 防止重复绑定事件

  init() {
    if (this._initialized) {
      // 已初始化，仅刷新会话列表
      this.loadSessionList();
      return;
    }
    this._initialized = true;
    const sendBtn = document.getElementById("btn-send");
    const input = document.getElementById("chat-input");
    const stopBtn = document.getElementById("btn-stop");

    sendBtn.addEventListener("click", () => this.send());
    if (stopBtn) stopBtn.addEventListener("click", () => this.cancel());

    input.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // Ctrl+K 聚焦输入框
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        input.focus();
      }
    });

    // 加载会话列表
    this.loadSessionList();
  },

  async loadSessionList() {
    try {
      const { sessions } = await api.sessions.list({ limit: 50 });
      this.renderSessionList(sessions);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  },

  renderSessionList(sessions) {
    const container = document.getElementById("session-list");
    if (!container) return;

    if (sessions.length === 0) {
      container.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">暂无对话</div>`;
      return;
    }

    // 按更新时间分组
    const groups = this.groupSessions(sessions);

    container.innerHTML = "";
    for (const [label, items] of Object.entries(groups)) {
      const groupEl = document.createElement("div");
      groupEl.className = "session-group-label";
      groupEl.innerHTML = `${label} <span class="toggle" style="cursor:pointer;">⌄</span>`;
      container.appendChild(groupEl);

      for (const s of items) {
        const item = document.createElement("div");
        item.className = `session-item${s.id === this.currentSessionId ? " active" : ""}`;
        item.innerHTML = `
          <div class="session-item-name">${this.escapeHtml(s.name || "新对话")}</div>
          <div class="session-item-preview">${s.model} · ${this.formatTokens(s.inputTokens + s.outputTokens)}</div>
        `;
        item.addEventListener("click", () => this.switchSession(s.id));
        container.appendChild(item);
      }
    }
  },

  groupSessions(sessions) {
    const now = Date.now();
    const today = [];
    const yesterday = [];
    const thisWeek = [];
    const older = [];

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const yesterdayMs = todayMs - 86400_000;
    const weekMs = todayMs - 7 * 86400_000;

    for (const s of sessions) {
      if (s.updatedAt >= todayMs) today.push(s);
      else if (s.updatedAt >= yesterdayMs) yesterday.push(s);
      else if (s.updatedAt >= weekMs) thisWeek.push(s);
      else older.push(s);
    }

    const result = {};
    if (today.length) result["今天"] = today;
    if (yesterday.length) result["昨天"] = yesterday;
    if (thisWeek.length) result["本周"] = thisWeek;
    if (older.length) result["更早"] = older;
    return result;
  },

  async switchSession(id) {
    this.currentSessionId = id;
    const container = document.getElementById("chat-messages");
    container.innerHTML = "";

    // 重新渲染会话列表高亮
    const { sessions } = await api.sessions.list({ limit: 50 });
    this.renderSessionList(sessions);

    // 加载历史消息
    this.loadHistory(id);
  },

  async loadHistory(sessionId) {
    const container = document.getElementById("chat-messages");
    container.innerHTML = `<div class="empty-state">加载中...</div>`;

    try {
      const session = await api.sessions.get(sessionId);
      if (!session) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><div>会话不存在</div></div>`;
        return;
      }

      // 更新顶栏
      document.getElementById("chat-title").textContent =
        session.name || "新对话";

      // TODO: 从 JSONL 加载消息历史（Plan C 实现）
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><div>开始对话</div></div>`;
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败</div></div>`;
    }
  },

  async send() {
    const input = document.getElementById("chat-input");
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    input.style.height = "auto";

    // 清除空状态
    const container = document.getElementById("chat-messages");
    const empty = container.querySelector(".empty-state");
    if (empty) empty.remove();

    // 用户消息
    this.appendUserMessage(message);

    // 助手消息容器
    const { el: assistantEl } = this.appendAssistantMessage("");
    this.currentAssistantEl = assistantEl;
    let fullText = "";

    // 发送流式请求
    const stream = api.chat.send({
      message,
      sessionId: this.currentSessionId,
    });
    this.currentStream = stream;

    stream.on("text_delta", (ev) => {
      fullText += ev.text;
      assistantEl.innerHTML = renderMarkdown(fullText);
      container.scrollTop = container.scrollHeight;
    });

    stream.on("tool_start", (ev) => {
      this.appendToolCallCard({
        name: ev.name,
        input: ev.input,
        status: "running",
      });
      container.scrollTop = container.scrollHeight;
    });

    stream.on("tool_end", (ev) => {
      // 更新上一个工具卡片的状态
      // AgentRunEvent.tool_end 字段: name, id, result, isError, errorCode, durationMs
      const cards = container.querySelectorAll(".tool-call-card");
      const lastCard = cards[cards.length - 1];
      if (lastCard) {
        const statusEl = lastCard.querySelector(".tool-call-status");
        if (statusEl) {
          if (ev.isError) {
            statusEl.className = "tool-call-status error";
            lastCard.classList.add("error");
            const errMsg = ev.errorCode
              ? `❌ ${ev.result} · ${ev.errorCode}`
              : `❌ ${ev.result}`;
            statusEl.textContent = errMsg;
          } else {
            statusEl.className = "tool-call-status success";
            const summary = ev.result
              ? String(ev.result).slice(0, 100)
              : "完成";
            const timing = ev.durationMs ? ` · ${ev.durationMs}ms` : "";
            statusEl.innerHTML = `✅ ${this.escapeHtml(summary)}${timing}`;
          }
        }
      }
      container.scrollTop = container.scrollHeight;
    });

    stream.on("retry", (ev) => {
      const notice = document.createElement("div");
      notice.className = "retry-notice";
      notice.textContent = `🔄 重试 #${ev.attempt}: ${ev.reason}`;
      container.appendChild(notice);
      container.scrollTop = container.scrollHeight;
    });

    stream.on("done", (ev) => {
      this.currentStream = null;
      this.currentAssistantEl = null;

      if (ev.sessionId) {
        this.currentSessionId = ev.sessionId;
        this.loadSessionList();
      }

      // 移除流式光标
      const cursor = container.querySelector(".streaming-cursor");
      if (cursor) cursor.remove();
    });

    stream.on("error", (ev) => {
      assistantEl.innerHTML +=
        `<div style="color:#ff6b6b;margin-top:8px;">❌ ${this.escapeHtml(ev.message)}</div>`;
      this.currentStream = null;
      this.currentAssistantEl = null;
    });
  },

  cancel() {
    if (this.currentStream) {
      this.currentStream.cancel();
      this.currentStream = null;
    }
    // 给当前消息追加取消标记
    if (this.currentAssistantEl) {
      this.currentAssistantEl.innerHTML +=
        `<div style="color:#999;margin-top:8px;font-style:italic;">⏹ 已停止生成</div>`;
      this.currentAssistantEl = null;
    }
  },

  appendUserMessage(text) {
    const container = document.getElementById("chat-messages");
    const el = document.createElement("div");
    el.className = "message message-user";
    el.innerHTML = `
      <div class="message-bubble">${this.escapeHtml(text)}</div>
      <div class="message-avatar message-avatar-user">Q</div>
    `;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  appendAssistantMessage(text) {
    const container = document.getElementById("chat-messages");
    const el = document.createElement("div");
    el.className = "message message-assistant";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = text
      ? renderMarkdown(text)
      : `<span class="streaming-cursor">▍</span>`;

    el.innerHTML = `<div class="message-avatar message-avatar-assistant">M</div>`;
    el.appendChild(bubble);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return { el: bubble, wrapper: el };
  },

  appendToolCallCard({ name, input, status }) {
    const container = document.getElementById("chat-messages");
    const el = document.createElement("div");
    el.className = "message";
    el.style.paddingLeft = "42px";  // 对齐头像后的内容

    const card = document.createElement("div");
    card.className = "tool-call-card";
    card.style.maxWidth = "88%";
    card.style.width = "100%";

    const inputPreview = input
      ? JSON.stringify(input).slice(0, 120)
      : "";

    card.innerHTML = `
      <div class="tool-call-header">
        <span>🔧 <strong>${this.escapeHtml(name)}</strong>${inputPreview ? ` · ${this.escapeHtml(inputPreview)}` : ""}</span>
        <span style="color:#aaa;font-size:11px;">▼</span>
      </div>
      <div class="tool-call-body">
        <pre style="margin:0;white-space:pre-wrap;font-size:11px;">${input ? this.escapeHtml(JSON.stringify(input, null, 2)) : "(无输入)"}</pre>
      </div>
      <div class="tool-call-status success">
        ${status === "running" ? "⏳ 执行中..." : "✅ 完成"}
      </div>
    `;

    // 折叠/展开
    const header = card.querySelector(".tool-call-header");
    const body = card.querySelector(".tool-call-body");
    header.addEventListener("click", () => {
      if (body) body.classList.toggle("expanded");
      const arrow = header.querySelector("span:last-child");
      if (arrow) {
        arrow.textContent = body && body.classList.contains("expanded")
          ? "▲" : "▼";
      }
    });

    el.appendChild(card);
    container.appendChild(el);
  },

  newSession() {
    this.currentSessionId = null;
    this.currentAssistantEl = null;

    const container = document.getElementById("chat-messages");
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div>开始一段新对话</div>
      </div>
    `;

    document.getElementById("chat-title").textContent = "新对话";
    document.getElementById("chat-input").focus();

    // 刷新会话列表以反映当前状态
    this.loadSessionList();
  },

  formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  },

  escapeHtml(str) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  },
};
```

- [ ] **Step 2: 更新 index.html 的对话页 HTML**

将 `#page-chat` 的占位内容替换为完整的对话页结构：

```html
<!-- 会话列表面板（在 #sidebar 和 #main 之间） -->
<aside id="session-panel">
  <div class="session-panel-header">
    <span class="session-panel-title">对话</span>
    <button class="btn btn-icon btn-ghost" id="btn-new-session" title="新建对话">+</button>
  </div>
  <div class="session-panel-search">
    <input class="input input-search" id="session-search" placeholder="🔍 搜索对话">
  </div>
  <div class="session-list" id="session-list"></div>
  <div class="session-panel-footer">
    <span id="session-count">共 0 个对话</span>
    <span class="btn btn-ghost btn-sm" data-nav="sessions">管理</span>
  </div>
</aside>

<!-- 对话页（原有主区） -->
<section id="page-chat" class="page active">
  <div id="chat-topbar">
    <div class="chat-topbar-left">
      <span class="chat-topbar-title" id="chat-title">新对话</span>
    </div>
    <div class="chat-topbar-right">
      <span class="chip" id="topbar-model">🧠 deepseek-chat</span>
      <span id="topbar-tokens" style="cursor:pointer;">📊 0</span>
      <span id="topbar-tools" style="cursor:pointer;">🔄 0</span>
      <button class="btn btn-icon btn-ghost">⋯</button>
    </div>
  </div>
  <div id="chat-messages">
    <div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div>开始一段新对话</div>
      <div style="margin-top:4px;font-size:12px;">Enter 发送，Shift+Enter 换行</div>
    </div>
  </div>
  <div id="chat-input-area">
    <div class="input-context-bar">
      <span class="chip" id="ctx-project">📁 my-agent ⌄</span>
      <span class="chip" id="ctx-model">🧠 deepseek-chat ⌄</span>
      <span class="chip" id="ctx-tools">🧩 工具已启用</span>
    </div>
    <div class="input-wrapper">
      <textarea id="chat-input" rows="2"
        placeholder="输入消息... Enter 发送，Shift+Enter 换行"></textarea>
      <div class="input-toolbar">
        <div class="input-toolbar-left">
          <button class="btn btn-icon btn-ghost" title="附件">📎</button>
          <button class="btn btn-icon btn-ghost" title="Slash 命令">/</button>
        </div>
        <div class="input-toolbar-right">
          <button class="btn btn-sm btn-secondary" id="btn-stop">停止</button>
          <button class="btn btn-primary" id="btn-send">发送 ➤</button>
        </div>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;color:#bbb;margin-top:8px;">
      My Agent 可能产生错误，请核实重要信息 · 工具结果已脱敏
    </div>
  </div>
</section>
```

- [ ] **Step 3: 在 index.html 中引入 chat.js + chat.css**

```html
<!-- 在 index.html <head> 中已有 link 标签后添加 -->
<link rel="stylesheet" href="css/chat.css">

<!-- 在 <body> 末尾已有 script 标签后添加 -->
<script src="js/pages/chat.js"></script>
```

- [ ] **Step 4: 更新 app.js 启动逻辑以初始化 ChatPage**

```js
// electron/renderer/js/app.js — 更新 navigate() 方法

navigate(page) {
  // 更新侧栏
  document.querySelectorAll(".sidebar-icon").forEach((icon) => {
    icon.classList.toggle("active", icon.dataset.nav === page);
  });

  // 更新页面
  document.querySelectorAll(".page").forEach((p) => {
    p.classList.toggle("active", p.id === `page-${page}`);
  });

  // 会话面板仅在对话页显示
  const sessionPanel = document.getElementById("session-panel");
  if (sessionPanel) {
    sessionPanel.classList.toggle("collapsed", page !== "chat");
  }

  this.currentPage = page;

  // 初始化页面
  if (page === "chat") {
    ChatPage.init();
  }
  if (page === "sessions") {
    SessionsPage.init();
  }
  if (page === "settings") {
    SettingsPage.init();
  }
  if (page === "skills") {
    SkillsPage.init();
  }
},
```

- [ ] **Step 5: 验证对话页**

```bash
npm run dev
```

Expected: 对话页显示会话列表面板 + 空消息区 + 输入框。输入文字点击发送，能看到用户消息气泡和 echo 回复（占位 IPC 返回 echo）。

- [ ] **Step 6: Commit**

```bash
git add electron/renderer/css/chat.css \
        electron/renderer/js/pages/chat.js \
        electron/renderer/index.html \
        electron/renderer/js/app.js
git commit -m "feat(renderer): implement chat page with message bubbles, tool call cards, and streaming"
```

---

### Task 3: 会话管理页

**Files:**
- Create: `electron/renderer/css/sessions.css`
- Create: `electron/renderer/js/pages/sessions.js`
- Modify: `electron/renderer/index.html`

- [ ] **Step 1: 实现 sessions.css**

```css
/* electron/renderer/css/sessions.css */

/* ===== 筛选条 ===== */
#sessions-filter-bar {
  padding: 14px 28px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  gap: 12px;
  align-items: center;
  background: var(--bg-secondary);
}

#sessions-filter-bar .input {
  flex: 1;
  height: 34px;
  font-size: var(--text-base);
  border-radius: var(--radius-md);
  padding: 4px 14px;
}

#sessions-filter-bar .select {
  height: 34px;
  font-size: var(--text-base);
}

/* ===== 批量操作条 ===== */
#sessions-batch-bar {
  padding: 10px 28px;
  background: var(--color-primary-bg);
  border-bottom: 1px solid var(--border-input);
  display: none;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
}

#sessions-batch-bar.visible {
  display: flex;
}

.batch-bar-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.batch-bar-count {
  font-weight: 500;
  color: var(--color-primary);
}

.batch-bar-actions {
  display: flex;
  gap: 8px;
}

/* ===== 表格 ===== */
#sessions-table-wrap {
  flex: 1;
  overflow-y: auto;
}

#sessions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

#sessions-table th {
  text-align: left;
  padding: 14px 8px;
  color: var(--color-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--border-light);
  position: sticky;
  top: 0;
  background: var(--bg-main);
}

#sessions-table td {
  padding: 14px 8px;
  border-bottom: 1px solid var(--border-light);
  color: var(--color-text-secondary);
}

#sessions-table tr.selected {
  background: var(--color-primary-bg);
}

#sessions-table tr:hover {
  background: var(--bg-hover);
}

#sessions-table tr.selected:hover {
  background: var(--color-primary-bg);
}

#sessions-table .session-name {
  color: var(--color-text);
  font-weight: 500;
}

#sessions-table .session-preview {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  margin-top: 2px;
}

#sessions-table .col-checkbox {
  width: 32px;
  text-align: center;
}

#sessions-table .col-actions {
  width: 60px;
  text-align: right;
}

#sessions-table .col-count {
  text-align: right;
}

#sessions-table .col-tokens {
  text-align: right;
}

/* ===== 分页 ===== */
#sessions-pagination {
  padding: 12px 28px;
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.pagination-btns {
  display: flex;
  gap: 4px;
}

.pagination-btns button {
  background: var(--bg-main);
  border: 1px solid var(--border-input);
  color: var(--color-text);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--text-sm);
}

.pagination-btns button.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.pagination-btns button:disabled {
  color: #ccc;
  cursor: not-allowed;
}
```

- [ ] **Step 2: 实现 sessions.js**

```js
// electron/renderer/js/pages/sessions.js
const SessionsPage = {
  sessions: [],
  selected: new Set(),
  page: 1,
  pageSize: 20,
  total: 0,

  async init() {
    this.bindEvents();
    await this.load();
  },

  bindEvents() {
    document.getElementById("sessions-search").addEventListener(
      "input",
      () => this.debounceSearch()
    );
    document.getElementById("sessions-filter-project").addEventListener(
      "change",
      () => this.load()
    );
    document.getElementById("sessions-filter-time").addEventListener(
      "change",
      () => this.load()
    );
    document.getElementById("select-all").addEventListener(
      "change",
      (e) => this.toggleSelectAll(e.target.checked)
    );
    document.getElementById("btn-batch-delete").addEventListener(
      "click",
      () => this.batchDelete()
    );
    document.getElementById("btn-batch-export").addEventListener(
      "click",
      () => this.batchExport()
    );
  },

  debounceSearch() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.load(), 300);
  },

  async load() {
    const search = document.getElementById("sessions-search").value.trim();
    // 注意：项目和时间的筛选当前为 UI 占位 — 后端 api.sessions.list()
    // 仅支持 search/offset/limit。筛选参数后续需扩展 IPC 接口。
    // 当前阶段通过 load() 重新拉取全量数据。
    const projectFilter = document.getElementById("sessions-filter-project").value;
    const timeFilter = document.getElementById("sessions-filter-time").value;
    try {
      const { sessions, total } = await api.sessions.list({
        search: search || undefined,
        offset: (this.page - 1) * this.pageSize,
        limit: this.pageSize,
      });
      // 客户端侧的时间筛选（后端接口扩展后移除此逻辑）
      let filtered = sessions;
      if (timeFilter) {
        filtered = this.filterByTime(sessions, timeFilter);
      }
      this.sessions = filtered;
      this.total = timeFilter ? filtered.length : total;
      this.render();
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  },

  filterByTime(sessions, filter) {
    const now = Date.now();
    const ranges = {
      today: now - 86400_000,
      week: now - 7 * 86400_000,
      month: now - 30 * 86400_000,
    };
    const since = ranges[filter];
    if (!since) return sessions;
    return sessions.filter(s => s.updatedAt >= since);
  },

  render() {
    this.renderTable();
    this.renderPagination();
    this.updateBatchBar();
  },

  renderTable() {
    const tbody = document.getElementById("sessions-tbody");
    if (this.sessions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:60px;color:#999;">
            没有匹配的会话
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = this.sessions
      .map(
        (s) => `
      <tr class="${this.selected.has(s.id) ? "selected" : ""}">
        <td class="col-checkbox">
          <input type="checkbox" data-id="${s.id}"
            ${this.selected.has(s.id) ? "checked" : ""}>
        </td>
        <td>
          <div class="session-name">${this.esc(s.name || "新对话")}</div>
        </td>
        <td>📁 —</td>
        <td>${this.esc(s.model)}</td>
        <td class="col-count">${s.messageCount}</td>
        <td class="col-tokens">${this.formatTokens(s.inputTokens + s.outputTokens)}</td>
        <td>${this.formatTime(s.updatedAt)}</td>
        <td class="col-actions">
          <button class="btn btn-icon btn-ghost row-menu" data-id="${s.id}">⋯</button>
        </td>
      </tr>`
      )
      .join("");

    // 绑定 checkbox 事件
    tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.updateBatchBar();
        this.updateRowHighlight();
      });
    });

    // 绑定行菜单事件
    tbody.querySelectorAll(".row-menu").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showRowMenu(btn.dataset.id, btn);
      });
    });
  },

  renderPagination() {
    const totalPages = Math.ceil(this.total / this.pageSize);
    const el = document.getElementById("pagination-info");
    const btns = document.getElementById("pagination-btns");

    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(this.page * this.pageSize, this.total);
    el.textContent = `显示 ${this.total > 0 ? start : 0} - ${end} / ${this.total}`;

    let html = `<button ${this.page <= 1 ? "disabled" : ""}>‹</button>`;
    for (let i = 1; i <= totalPages && i <= 5; i++) {
      html += `<button class="${i === this.page ? "active" : ""}">${i}</button>`;
    }
    html += `<button ${this.page >= totalPages ? "disabled" : ""}>›</button>`;
    btns.innerHTML = html;

    // 分页点击
    btns.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        if (b.textContent === "‹") this.goToPage(this.page - 1);
        else if (b.textContent === "›") this.goToPage(this.page + 1);
        else this.goToPage(Number.parseInt(b.textContent));
      });
    });
  },

  goToPage(p) {
    this.page = p;
    this.load();
  },

  toggleSelectAll(checked) {
    if (checked) {
      this.sessions.forEach((s) => this.selected.add(s.id));
    } else {
      this.selected.clear();
    }
    this.render();
  },

  updateBatchBar() {
    const bar = document.getElementById("sessions-batch-bar");
    const count = document.getElementById("batch-count");
    if (this.selected.size > 0) {
      bar.classList.add("visible");
      count.textContent = `已选 ${this.selected.size} 个会话`;
    } else {
      bar.classList.remove("visible");
    }
  },

  updateRowHighlight() {
    const rows = document.querySelectorAll("#sessions-tbody tr");
    rows.forEach((row) => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) {
        row.classList.toggle("selected", this.selected.has(cb.dataset.id));
      }
    });
  },

  async batchDelete() {
    if (this.selected.size === 0) return;
    if (!confirm(`确定删除 ${this.selected.size} 个会话？此操作不可撤销。`)) return;

    for (const id of this.selected) {
      try {
        await api.sessions.delete(id);
      } catch (err) {
        console.error(`Failed to delete ${id}:`, err);
      }
    }
    this.selected.clear();
    await this.load();
  },

  batchExport() {
    const ids = [...this.selected].join(",");
    alert(`导出功能暂未实现。已选: ${ids}`);
  },

  showRowMenu(id, anchor) {
    // 简单的右键菜单
    const action = confirm(
      "选择操作:\n确定=删除, 取消=重命名"
    );
    if (action) {
      this.deleteSingle(id);
    } else {
      const name = prompt("新名称:");
      if (name) {
        api.sessions.rename(id, name).then(() => this.load());
      }
    }
  },

  async deleteSingle(id) {
    if (!confirm("确定删除此会话？")) return;
    await api.sessions.delete(id);
    await this.load();
  },

  formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  },

  formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;

    if (diff < 60_000) return "刚刚";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  },

  esc(s) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(s).replace(/[&<>"']/g, (c) => map[c]);
  },
};
```

- [ ] **Step 3: 更新 index.html 会话管理页 HTML**

```html
<section id="page-sessions" class="page">
  <div class="topbar">
    <div class="topbar-title">
      <h2 style="margin:0;font-size:18px;">会话管理</h2>
      <span id="sessions-stats" style="color:#999;font-size:13px;">共 0 个会话</span>
    </div>
    <div class="topbar-actions">
      <button class="btn btn-secondary">📥 导出全部</button>
      <button class="btn btn-primary" id="btn-new-session-2">＋ 新建</button>
    </div>
  </div>

  <div id="sessions-filter-bar">
    <input class="input" id="sessions-search" placeholder="🔍 搜索会话标题或内容...">
    <select class="select" id="sessions-filter-project">
      <option value="">📁 全部项目</option>
    </select>
    <select class="select" id="sessions-filter-time">
      <option value="">📅 全部时间</option>
      <option value="today">今天</option>
      <option value="week">本周</option>
      <option value="month">本月</option>
    </select>
  </div>

  <div id="sessions-batch-bar">
    <div class="batch-bar-info">
      <span class="batch-bar-count" id="batch-count">已选 0 个会话</span>
    </div>
    <div class="batch-bar-actions">
      <button class="btn btn-secondary btn-sm">📦 归档</button>
      <button class="btn btn-secondary btn-sm" id="btn-batch-export">📥 导出</button>
      <button class="btn btn-danger btn-sm" id="btn-batch-delete">🗑️ 删除</button>
    </div>
  </div>

  <div id="sessions-table-wrap">
    <table id="sessions-table">
      <thead>
        <tr>
          <th class="col-checkbox"><input type="checkbox" id="select-all"></th>
          <th>会话</th>
          <th>项目</th>
          <th>模型</th>
          <th class="col-count">消息</th>
          <th class="col-tokens">Token</th>
          <th>更新时间</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>
      <tbody id="sessions-tbody"></tbody>
    </table>
  </div>

  <div id="sessions-pagination">
    <span id="pagination-info">显示 0 - 0 / 0</span>
    <div class="pagination-btns" id="pagination-btns"></div>
  </div>
</section>
```

- [ ] **Step 4: 在 index.html 中引入 sessions.css + sessions.js**

```html
<link rel="stylesheet" href="css/sessions.css">
<!-- ... -->
<script src="js/pages/sessions.js"></script>
```

- [ ] **Step 5: 在 app.js 导航钩子中初始化 SessionsPage**

```js
// app.js navigate() 方法中
if (page === "sessions") {
  SessionsPage.init();
}
```

- [ ] **Step 6: 验证**

```bash
npm run dev
```

- 点击侧栏 📋 → 切换到会话管理页
- 表格加载会话列表
- 勾选行 → 批量操作条浮现
- 删除按钮弹出确认

- [ ] **Step 7: Commit**

```bash
git add electron/renderer/css/sessions.css \
        electron/renderer/js/pages/sessions.js \
        electron/renderer/index.html \
        electron/renderer/js/app.js
git commit -m "feat(renderer): implement sessions management page with table, filter, batch ops, and pagination"
```

---

### Task 4: 设置页

**Files:**
- Create: `electron/renderer/css/settings.css`
- Create: `electron/renderer/js/pages/settings.js`
- Modify: `electron/renderer/index.html`

- [ ] **Step 1: 实现 settings.css**

```css
/* electron/renderer/css/settings.css */

/* ===== 设置二级导航 ===== */
#settings-subnav {
  width: 200px;
  min-width: 200px;
  border-right: 1px solid var(--border-light);
  background: var(--bg-main);
  display: flex;
  flex-direction: column;
  padding: 14px 0;
}

.settings-subnav-label {
  padding: 8px 18px;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-subnav-item {
  padding: 8px 18px;
  color: var(--color-text-secondary);
  font-size: var(--text-base);
  cursor: pointer;
  border-right: 3px solid transparent;
  transition: all 0.12s;
}

.settings-subnav-item:hover {
  background: var(--bg-hover);
}

.settings-subnav-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  border-right-color: var(--color-primary);
  font-weight: 500;
}

#settings-version {
  padding: 14px 18px;
  border-top: 1px solid var(--border-light);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-top: auto;
}

/* ===== 设置主区 ===== */
#settings-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

.settings-section {
  margin-bottom: 28px;
}

.settings-section h3 {
  margin: 0 0 14px;
  font-size: var(--text-md);
  color: var(--color-text);
}

.settings-field-group {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.settings-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
}

.settings-field + .settings-field {
  border-top: 1px solid var(--border-default);
  padding-top: 14px;
  margin-top: 4px;
}

.settings-field-label {
  font-size: var(--text-base);
  color: var(--color-text);
  font-weight: 500;
}

.settings-field-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-top: 2px;
}

.settings-field-control {
  min-width: 200px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.settings-field-control .select {
  min-width: 200px;
}

.settings-field-control input[type="range"] {
  width: 140px;
  accent-color: var(--color-primary);
}

.settings-field-control input[type="number"] {
  width: 100px;
}

.settings-field-control .value-display {
  font-size: var(--text-base);
  color: var(--color-text);
  width: 36px;
  text-align: right;
}

/* ===== Provider 卡片 ===== */
.provider-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  margin-bottom: 10px;
}

.provider-card.disconnected {
  border-style: dashed;
  border-color: var(--border-input);
}

.provider-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.provider-card-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #fff;
  font-size: 14px;
  flex-shrink: 0;
}

.provider-card-info {
  flex: 1;
}

.provider-card-name {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-card-models {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-top: 2px;
}

.badge {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: 4px;
}

.badge-connected {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.badge-disconnected {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

/* ===== 表单底部 ===== */
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}
```

- [ ] **Step 2: 实现 settings.js**

```js
// electron/renderer/js/pages/settings.js
const SettingsPage = {
  currentTab: "models",
  config: null,

  async init() {
    this.bindSubnav();
    this.bindEvents();
    await this.loadConfig();
    this.switchTab(this.currentTab);
  },

  bindSubnav() {
    document.querySelectorAll(".settings-subnav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const tab = item.dataset.tab;
        this.switchTab(tab);
      });
    });
  },

  bindEvents() {
    // Temperature 滑块
    const tempSlider = document.getElementById("setting-temperature");
    const tempValue = document.getElementById("temp-value");
    if (tempSlider && tempValue) {
      tempSlider.addEventListener("input", () => {
        tempValue.textContent = tempSlider.value;
      });
    }

    // 保存按钮
    const saveBtn = document.getElementById("btn-save-settings");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.save());
    }

    // 恢复默认
    const resetBtn = document.getElementById("btn-reset-settings");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetDefaults());
    }
  },

  async loadConfig() {
    try {
      this.config = await api.config.get();
      this.renderModelsTab();
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  },

  /** 从后端加载 Provider 列表并渲染卡片 */
  async loadProviders() {
    try {
      const providers = await api.providers.list();
      this.renderProviderCards(providers);
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  },

  /** 渲染动态 Provider 卡片 */
  renderProviderCards(providers) {
    const container = document.getElementById("provider-cards");
    if (!container) return;

    if (providers.length === 0) {
      container.innerHTML = `
        <div style="padding:24px;text-align:center;color:#999;">
          暂无配置的 Provider。<br><br>
          <button class="btn btn-sm btn-primary" id="btn-add-first-provider">＋ 添加第一个 Provider</button>
        </div>`;
      document.getElementById("btn-add-first-provider")?.addEventListener(
        "click", () => this.showProviderForm()
      );
      return;
    }

    const PROVIDER_CONFIG = {
      anthropic:  { icon: "A", color: "#d97706", label: "Anthropic" },
      openai:     { icon: "O", color: "#10a37f", label: "OpenAI" },
      deepseek:   { icon: "DS", color: "linear-gradient(135deg,#6c5ce7,#a29bfe)", label: "DeepSeek" },
      moonshot:   { icon: "M", color: "#6366f1", label: "Moonshot" },
      doubao:     { icon: "D", color: "#22c55e", label: "Doubao" },
    };

    container.innerHTML = providers.map((p) => {
      const cfg = PROVIDER_CONFIG[p.provider] ?? { icon: "?", color: "#999", label: p.provider };
      const iconStyle = cfg.color.startsWith("linear-gradient")
        ? `background:${cfg.color};`
        : `background:${cfg.color};`;
      const connected = p.isEnabled;
      return `
      <div class="provider-card ${connected ? "" : "disconnected"}">
        <div class="provider-card-header">
          <div class="provider-card-icon" style="${iconStyle}">${cfg.icon}</div>
          <div class="provider-card-info">
            <div class="provider-card-name">
              ${this.esc(p.name || cfg.label)}
              <span class="badge ${connected ? "badge-connected" : "badge-disconnected"}">
                ${connected ? "● 已启用" : "● 已禁用"}
              </span>
            </div>
            <div class="provider-card-models">${(p.models ?? []).join(" · ") || "无模型"}</div>
          </div>
          <button class="btn btn-sm btn-secondary edit-provider" data-id="${p.id}">编辑</button>
          <button class="btn btn-icon btn-ghost delete-provider" data-id="${p.id}">⋯</button>
        </div>
      </div>`;
    }).join("");

    // 绑定编辑/删除事件
    container.querySelectorAll(".edit-provider").forEach(btn =>
      btn.addEventListener("click", () => this.showProviderForm(btn.dataset.id))
    );
    container.querySelectorAll(".delete-provider").forEach(btn =>
      btn.addEventListener("click", () => this.deleteProvider(btn.dataset.id))
    );
  },

  /** 显示 Provider 编辑弹窗 */
  async showProviderForm(editId) {
    // 如果是编辑模式，预加载已有配置
    let existingEntry = null;
    if (editId) {
      const list = await api.providers.list();
      existingEntry = list.find(x => x.id === editId) ?? null;
    }

    const PROVIDER_TYPES = [
      { id: "anthropic", label: "Anthropic", hint: "api.anthropic.com" },
      { id: "openai", label: "OpenAI", hint: "api.openai.com" },
      { id: "deepseek", label: "DeepSeek", hint: "api.deepseek.com" },
      { id: "moonshot", label: "Moonshot (月之暗面)", hint: "api.moonshot.cn" },
      { id: "doubao", label: "Doubao (豆包)", hint: "ark.cn-beijing.volces.com" },
    ];

    const formHtml = `
      <div class="modal-overlay" id="provider-form-modal">
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-header">
            <h3>${editId ? "编辑" : "添加"} Provider</h3>
            <button class="btn btn-icon btn-ghost modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="settings-field">
              <label class="settings-field-label">厂商</label>
              <select class="select" id="pf-provider" style="width:100%;">${PROVIDER_TYPES.map(
                t => `<option value="${t.id}">${t.label}</option>`
              ).join("")}</select>
            </div>
            <div class="settings-field">
              <label class="settings-field-label">显示名称</label>
              <input class="input" id="pf-name" placeholder="如：我的 DeepSeek" style="width:100%;">
            </div>
            <div class="settings-field">
              <label class="settings-field-label">API Key</label>
              <input class="input" type="password" id="pf-api-key" placeholder="sk-..." style="width:100%;">
              <div class="settings-field-desc">密钥将加密存储到本地数据库</div>
            </div>
            <div class="settings-field">
              <label class="settings-field-label">Base URL（可选）</label>
              <input class="input" id="pf-base-url" placeholder="默认 API 地址" style="width:100%;">
            </div>
            <div class="settings-field">
              <label class="settings-field-label">模型列表（逗号分隔）</label>
              <input class="input" id="pf-models" placeholder="deepseek-chat, deepseek-reasoner" style="width:100%;">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-close">取消</button>
            <button class="btn btn-primary" id="btn-save-provider">保存</button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML("beforeend", formHtml);

    // 如果是编辑模式，填充已有数据
    if (existingEntry) {
      document.getElementById("pf-provider").value = existingEntry.provider;
      document.getElementById("pf-name").value = existingEntry.name;
      document.getElementById("pf-base-url").value = existingEntry.baseUrl;
      document.getElementById("pf-models").value = (existingEntry.models ?? []).join(", ");
      // 编辑模式下 API Key 留空表示不修改
      document.getElementById("pf-api-key").placeholder = "留空则不修改已有密钥";
    }

    // 绑定事件
    document.getElementById("btn-save-provider").addEventListener("click", async () => {
      await api.providers.save({
        id: editId ?? undefined,
        provider: document.getElementById("pf-provider").value,
        name: document.getElementById("pf-name").value,
        apiKey: document.getElementById("pf-api-key").value,
        baseUrl: document.getElementById("pf-base-url").value,
        models: document.getElementById("pf-models").value
          .split(",").map(s => s.trim()).filter(Boolean),
      });
      document.getElementById("provider-form-modal").remove();
      this.loadProviders();
    });

    document.querySelectorAll("#provider-form-modal .modal-close").forEach(b =>
      b.addEventListener("click", () =>
        document.getElementById("provider-form-modal").remove())
    );
  },

  /** 删除 Provider */
  async deleteProvider(id) {
    if (!confirm("确定删除此 Provider？")) return;
    await api.providers.delete(id);
    this.loadProviders();
  },

  switchTab(tab) {
    this.currentTab = tab;

    // 更新二级导航高亮
    document.querySelectorAll(".settings-subnav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.tab === tab);
    });

    // 渲染对应内容
    const content = document.getElementById("settings-content");
    switch (tab) {
      case "models":
        this.renderModelsTab();
        break;
      case "tools":
        this.renderToolsTab();
        break;
      case "paths":
        this.renderPathsTab();
        break;
      case "context":
        this.renderContextTab();
        break;
      case "appearance":
        this.renderAppearanceTab();
        break;
      case "developer":
        this.renderDeveloperTab();
        break;
      default:
        content.innerHTML = `<div class="empty-state">即将实现</div>`;
    }
  },

  renderModelsTab() {
    const content = document.getElementById("settings-content");
    content.innerHTML = `
      <div class="settings-section">
        <h3>默认模型</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主对话模型</div>
              <div class="settings-field-desc">用于所有新建会话</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-main-model">
                <option>🧠 deepseek-chat</option>
                <option>🤖 claude-sonnet-4</option>
                <option>⚡ gpt-4o</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">规划/反思模型</div>
              <div class="settings-field-desc">用于 plan_set / 错误反思（可选用更便宜的）</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-plan-model">
                <option>🧠 deepseek-chat</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <h3 style="margin:0;">Provider 配置</h3>
          <button class="btn btn-sm btn-primary" id="btn-add-provider">＋ 添加</button>
        </div>

        <div id="provider-cards">
          <div style="padding:16px;text-align:center;color:#999;">加载中...</div>
        </div>
      </div>

      <div class="settings-section">
        <h3>生成参数</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Temperature</div>
              <div class="settings-field-desc">越高越发散</div>
            </div>
            <div class="settings-field-control">
              <input type="range" id="setting-temperature" min="0" max="1" step="0.1" value="0.7">
              <span class="value-display" id="temp-value">0.7</span>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Max tokens</div>
              <div class="settings-field-desc">单次回复上限</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="4096" id="setting-max-tokens" style="width:100px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">请求超时</div>
              <div class="settings-field-desc">超过此时长自动放弃</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-timeout">
                <option>60 秒</option>
                <option selected>120 秒</option>
                <option>300 秒</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-actions">
        <button class="btn btn-secondary" id="btn-reset-settings">恢复默认</button>
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;

    this.bindEvents();
    this.loadProviders();  // 从后端加载 Provider 列表

    // 绑定「添加 Provider」按钮
    document.getElementById("btn-add-provider")?.addEventListener(
      "click", () => this.showProviderForm()
    );
  },

  renderToolsTab() {
    const tools = [
      { name: "read_file", desc: "读取文件内容，支持行范围", enabled: true },
      { name: "write_file", desc: "写入/创建文件", enabled: true },
      { name: "bash", desc: "执行 Shell 命令", enabled: true },
      { name: "grep_files", desc: "正则搜索文件内容", enabled: true },
      { name: "list_dir", desc: "列出目录结构", enabled: true },
      { name: "glob_files", desc: "通配符匹配文件名", enabled: true },
      { name: "fetch_url", desc: "HTTP GET 请求", enabled: false },
      { name: "run_skill", desc: "调用已安装的 Skill", enabled: true },
    ];

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>内置工具启用状态</h3>
        <div class="settings-field-group">
          ${tools
            .map(
              (t, i) => `
            <div class="settings-field">
              <div>
                <div class="settings-field-label">🔧 ${t.name}</div>
                <div class="settings-field-desc">${t.desc}</div>
              </div>
              <div class="settings-field-control">
                <input type="checkbox" ${t.enabled ? "checked" : ""}
                  id="tool-${i}" style="accent-color:var(--color-primary);">
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  renderPathsTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>路径与权限</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">工作目录白名单</div>
              <div class="settings-field-desc">Agent 只能访问以下目录</div>
            </div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <textarea class="input" rows="4" style="width:100%;font-family:monospace;font-size:12px;"
            placeholder="每行一个目录路径">D:/studyspace/project/my-agent
        D:/studyspace/源码学习/Orkas</textarea>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  renderContextTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>上下文压缩</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">压缩触发阈值</div>
              <div class="settings-field-desc">上下文窗口使用率超过此值触发压缩</div>
            </div>
            <div class="settings-field-control">
              <select class="select">
                <option>70%</option>
                <option selected>82%</option>
                <option>90%</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">保留最近</div>
              <div class="settings-field-desc">压缩后最少保留的完整轮次</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="2" style="width:80px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">压缩预算</div>
              <div class="settings-field-desc">单次会话最多压缩次数</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="5" style="width:80px;">
            </div>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  renderAppearanceTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>外观</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主题</div>
            </div>
            <div class="settings-field-control">
              <select class="select">
                <option selected>亮色</option>
                <option>暗色</option>
                <option>跟随系统</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">字体大小</div>
            </div>
            <div class="settings-field-control">
              <select class="select">
                <option>小</option>
                <option selected>中</option>
                <option>大</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  renderDeveloperTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>开发者</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Mock LLM</div>
              <div class="settings-field-desc">离线调试模式，不调用真实 API</div>
            </div>
            <div class="settings-field-control">
              <input type="checkbox" style="accent-color:var(--color-primary);">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Trace 模式</div>
              <div class="settings-field-desc">记录完整 LLM 请求/响应</div>
            </div>
            <div class="settings-field-control">
              <input type="checkbox" style="accent-color:var(--color-primary);">
            </div>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3>版本</h3>
        <p style="color:#666;font-size:13px;" id="version-info">加载中...</p>
      </div>
    `;
    this.bindEvents();
    // Renderer 中没有 process.versions（contextIsolation: true），
    // 必须通过 IPC 从 Main 进程获取版本信息
    this.loadVersionInfo();
  },

  async loadVersionInfo() {
    try {
      const info = await api.app.getVersion();
      document.getElementById("version-info").textContent =
        `my-agent v${info.version} · Electron ${info.electron} · Node ${info.node}`;
    } catch {
      document.getElementById("version-info").textContent = "my-agent v0.3.0";
    }
  },

  resetDefaults() {
    if (!confirm("恢复默认设置？")) return;
    // TODO: 调用 config:update 重置
    this.switchTab(this.currentTab);
  },

  async save() {
    try {
      await api.config.update({
        temperature: Number.parseFloat(
          document.getElementById("setting-temperature")?.value ?? "0.7"
        ),
        maxTokens: Number.parseInt(
          document.getElementById("setting-max-tokens")?.value ?? "4096"
        ),
      });
      this.showToast("设置已保存");
    } catch (err) {
      this.showToast("保存失败: " + err.message);
    }
  },

  showToast(msg) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2000);
  },
};
```

- [ ] **Step 3: 更新 index.html 设置页 HTML**

```html
<section id="page-settings" class="page" style="flex-direction:row;">
  <!-- 二级导航 -->
  <nav id="settings-subnav">
    <div class="settings-subnav-label">设置</div>
    <div class="settings-subnav-item active" data-tab="models">🤖 模型</div>
    <div class="settings-subnav-item" data-tab="tools">🔧 工具</div>
    <div class="settings-subnav-item" data-tab="paths">📁 路径与权限</div>
    <div class="settings-subnav-item" data-tab="context">🧠 上下文</div>
    <div class="settings-subnav-item" data-tab="appearance">🎨 外观</div>
    <div class="settings-subnav-item" data-tab="developer">🧪 开发者</div>
    <div id="settings-version">v0.3.0 · Electron 33</div>
  </nav>
  <!-- 主区 -->
  <div id="settings-main">
    <div class="topbar" style="border-bottom:1px solid var(--border-light);">
      <h2 style="margin:0;font-size:18px;" id="settings-tab-title">🤖 模型设置</h2>
    </div>
    <div class="settings-content" id="settings-content"></div>
  </div>
</section>
```

- [ ] **Step 4: 在 index.html 引入 + app.js 钩子**

```html
<link rel="stylesheet" href="css/settings.css">
<script src="js/pages/settings.js"></script>
```

```js
// app.js navigate() 中
if (page === "settings") {
  SettingsPage.init();
}
```

- [ ] **Step 5: 验证**

```bash
npm run dev
```

- 点击 ⚙️ → 设置页
- 二级导航点击切换 tab：模型 / 工具 / 路径 / 上下文 / 外观 / 开发者
- 拖动 Temperature 滑块 → 数值同步更新
- 切换 Provider 卡片显示三种状态

- [ ] **Step 6: Commit**

```bash
git add electron/renderer/css/settings.css \
        electron/renderer/js/pages/settings.js \
        electron/renderer/index.html \
        electron/renderer/js/app.js
git commit -m "feat(renderer): implement settings page with subnav and 6 tabs"
```

---

### Task 5: Skills 管理页

**Files:**
- Create: `electron/renderer/css/skills.css`
- Create: `electron/renderer/js/pages/skills.js`
- Modify: `electron/renderer/index.html`

- [ ] **Step 1: 实现 skills.css**

```css
/* electron/renderer/css/skills.css */

.skills-chip-bar {
  padding: 14px 28px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  gap: 8px;
  align-items: center;
  background: var(--bg-secondary);
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 20px 28px;
}

.skills-group-label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 28px;
  margin-top: 20px;
}

.skills-group-label:first-child {
  margin-top: 0;
}

.skill-card {
  background: var(--bg-main);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 14px;
  transition: box-shadow 0.15s;
}

.skill-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.skill-card.disabled {
  opacity: 0.65;
}

.skill-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.skill-card-icon-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-card-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.skill-card-name {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
}

.skill-card-category {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.skill-card-desc {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
  margin: 6px 0 10px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.skill-card-source {
  font-size: var(--text-xs);
}

.skill-card-config {
  cursor: pointer;
  color: var(--color-primary);
}

.skill-card-config:hover {
  text-decoration: underline;
}

/* Toggle switch */
.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  cursor: pointer;
}

.toggle-switch input {
  display: none;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: #ddd;
  border-radius: 10px;
  transition: background 0.2s;
}

.toggle-slider::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(16px);
}
```

- [ ] **Step 2: 实现 skills.js**

```js
// electron/renderer/js/pages/skills.js
const SkillsPage = {
  skills: [],
  filterCategory: "all",
  showEnabledOnly: false,

  async init() {
    this.bindEvents();
    await this.load();
  },

  bindEvents() {
    // 分类 chip 点击
    document.querySelectorAll(".skills-chip-bar .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.filterCategory = chip.dataset.category;
        this.render();
      });
    });

    // "仅显示已启用"
    const toggle = document.getElementById("show-enabled-only");
    if (toggle) {
      toggle.addEventListener("change", () => {
        this.showEnabledOnly = toggle.checked;
        this.render();
      });
    }
  },

  async load() {
    try {
      this.skills = await api.skills.list();
      // 如果后端返回空，使用示例数据
      if (this.skills.length === 0) {
        this.skills = this.getMockSkills();
      }
      this.render();
    } catch (err) {
      console.error("Failed to load skills:", err);
      this.skills = this.getMockSkills();
      this.render();
    }
  },

  render() {
    // 更新 chip 高亮
    document.querySelectorAll(".skills-chip-bar .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.category === this.filterCategory);
    });

    // 更新统计
    const enabledCount = this.skills.filter((s) => s.enabled !== false).length;
    document.getElementById("skills-stats").textContent =
      `已启用 ${enabledCount} / ${this.skills.length}`;

    // 筛选
    let filtered = this.skills;
    if (this.filterCategory !== "all") {
      filtered = filtered.filter((s) => s.category === this.filterCategory);
    }
    if (this.showEnabledOnly) {
      filtered = filtered.filter((s) => s.enabled !== false);
    }

    const enabled = filtered.filter((s) => s.enabled !== false);
    const disabled = filtered.filter((s) => s.enabled === false);

    const container = document.getElementById("skills-grid");
    let html = "";

    if (enabled.length > 0) {
      html += `<div class="skills-group-label">已启用 (${enabled.length})</div>`;
      html += `<div class="skills-grid">${enabled.map((s) => this.renderCard(s)).join("")}</div>`;
    }

    if (disabled.length > 0) {
      html += `<div class="skills-group-label" style="margin-top:20px;">未启用 (${disabled.length})</div>`;
      html += `<div class="skills-grid">${disabled.map((s) => this.renderCard(s)).join("")}</div>`;
    }

    if (filtered.length === 0) {
      html = `<div class="empty-state"><div class="empty-state-icon">🧩</div><div>没有匹配的 Skill</div></div>`;
    }

    container.innerHTML = html;

    // 绑定 toggle 事件
    container.querySelectorAll(".toggle-switch input").forEach((cb) => {
      cb.addEventListener("change", async (e) => {
        const id = e.target.dataset.id;
        const enabled = e.target.checked;
        await api.skills.setEnabled(id, enabled);
        // 更新本地状态
        const skill = this.skills.find((s) => s.id === id);
        if (skill) skill.enabled = enabled;
        this.render();
      });
    });
  },

  renderCard(s) {
    const colors = {
      "code-review": "#dbeafe",
      "commit-message": "#dcfce7",
      summarize: "#fef3c7",
      "git-workflow": "#fee2e2",
      "sql-helper": "#ede9fe",
      "deep-research": "#dbeafe",
      "web-search": "#f3f4f6",
      "image-gen": "#f3f4f6",
      "pdf-reader": "#f3f4f6",
    };
    const iconBg = colors[s.id] || "#f3f4f6";

    // emoji 在 UI 层拼接，不污染数据层的 category 键
    const CATEGORY_EMOJI = {
      "开发": "💻", "写作": "📝", "数据": "📊", "研究": "🔍", "创意": "🎨",
    };
    const displayCategory = s.category
      ? `${CATEGORY_EMOJI[s.category] || ""} ${s.category}`
      : "未分类";

    return `
      <div class="skill-card ${s.enabled === false ? "disabled" : ""}">
        <div class="skill-card-header">
          <div class="skill-card-icon-row">
            <div class="skill-card-icon" style="background:${iconBg};">
              ${s.icon || "📦"}
            </div>
            <div>
              <div class="skill-card-name">${this.esc(s.name)}</div>
              <div class="skill-card-category">${displayCategory}</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" data-id="${s.id}" ${s.enabled !== false ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="skill-card-desc">${this.esc(s.description || "")}</div>
        <div class="skill-card-footer">
          <span class="skill-card-source">📦 ${s.version || "v1.0.0"} · ${s.source || "内置"}</span>
          <span class="skill-card-config">配置</span>
        </div>
      </div>`;
  },

  getMockSkills() {
    // category 使用纯语义键（不含 emoji）；emoji 由 renderCard 在 UI 层拼接
    return [
      {
        id: "code-review",
        name: "code-review",
        category: "开发",
        icon: "🔍",
        description: "自动审查 PR / commit，识别 bug、安全问题与风格问题。",
        enabled: true,
        version: "v1.2.0",
        source: "内置",
      },
      {
        id: "commit-message",
        name: "commit-message",
        category: "开发",
        icon: "📝",
        description: "基于 staged diff 生成 Conventional Commits 规范的提交信息。",
        enabled: true,
        version: "v0.9.0",
        source: "内置",
      },
      {
        id: "summarize",
        name: "summarize",
        category: "写作",
        icon: "📋",
        description: "摘要长文档/对话/网页内容，支持中文输出与多级压缩。",
        enabled: true,
        version: "v1.0.1",
        source: "自定义",
      },
      {
        id: "git-workflow",
        name: "git-workflow",
        category: "开发",
        icon: "🌿",
        description: "规范化 Git 工作流：branch 命名 / PR 模板 / rebase 冲突解决。",
        enabled: true,
        version: "v2.0.0",
        source: "市场",
      },
      {
        id: "sql-helper",
        name: "sql-helper",
        category: "数据",
        icon: "📊",
        description: "自然语言转 SQL、查询优化建议、EXPLAIN 解读。",
        enabled: true,
        version: "v1.1.0",
        source: "市场",
      },
      {
        id: "deep-research",
        name: "deep-research",
        category: "研究",
        icon: "🔬",
        description: "多轮检索 + 交叉验证，生成带引用源的研究报告。",
        enabled: true,
        version: "v0.5.0",
        source: "自定义",
      },
      {
        id: "web-search",
        name: "web-search",
        category: "研究",
        icon: "🌐",
        description: "联网搜索（需配置 search API Key）。",
        enabled: false,
        version: "v1.0.0",
        source: "市场",
      },
      {
        id: "image-gen",
        name: "image-gen",
        category: "创意",
        icon: "🎨",
        description: "文字生成配图（需 DALL-E / Stable Diffusion key）。",
        enabled: false,
        version: "v0.8.0",
        source: "市场",
      },
      {
        id: "pdf-reader",
        name: "pdf-reader",
        category: "数据",
        icon: "📑",
        description: "读取 PDF 文本、表格、图片，结构化输出。",
        enabled: false,
        version: "v1.0.2",
        source: "市场",
      },
    ];
  },

  esc(s) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(s).replace(/[&<>"']/g, (c) => map[c]);
  },
};
```

- [ ] **Step 3: 更新 index.html Skills 管理页 HTML**

```html
<section id="page-skills" class="page">
  <div class="topbar">
    <div class="topbar-title">
      🧩 Skills 管理
      <span id="skills-stats" style="color:#999;font-size:13px;font-weight:400;">已启用 0 / 0</span>
    </div>
    <div class="topbar-actions">
      <button class="btn btn-secondary">📥 从市场安装</button>
      <button class="btn btn-secondary">📂 打开目录</button>
      <button class="btn btn-primary">＋ 新建 Skill</button>
    </div>
  </div>

  <div class="skills-chip-bar">
    <span style="font-size:12px;color:#999;margin-right:4px;">分类：</span>
    <button class="chip active" data-category="all">全部</button>
    <button class="chip" data-category="开发">💻 开发</button>
    <button class="chip" data-category="写作">📝 写作</button>
    <button class="chip" data-category="数据">📊 数据</button>
    <button class="chip" data-category="研究">🔍 研究</button>
    <button class="chip" data-category="创意">🎨 创意</button>
    <label style="margin-left:auto;font-size:12px;color:#666;display:flex;align-items:center;gap:4px;cursor:pointer;">
      <input type="checkbox" id="show-enabled-only" style="accent-color:var(--color-primary);">
      仅显示已启用
    </label>
  </div>

  <div class="content-area" id="skills-grid"></div>
</section>
```

- [ ] **Step 4: 在 index.html 引入 + app.js 钩子**

```html
<link rel="stylesheet" href="css/skills.css">
<script src="js/pages/skills.js"></script>
```

```js
// app.js navigate() 中
if (page === "skills") {
  SkillsPage.init();
}
```

- [ ] **Step 5: 验证**

```bash
npm run dev
```

- 点击 🧩 → Skills 管理页
- 卡片网格 3 列展示
- 点击分类 chip 切换筛选
- Toggle 开关切换启用/禁用
- 「仅显示已启用」只显示启用的 Skill

- [ ] **Step 6: Commit**

```bash
git add electron/renderer/css/skills.css \
        electron/renderer/js/pages/skills.js \
        electron/renderer/index.html \
        electron/renderer/js/app.js
git commit -m "feat(renderer): implement skills management page with card grid, category filter, and toggle switches"
```

---

## Summary

**Task 1-2**: 对话页（CSS + JS + 流式接收 + 工具卡片 + 消息气泡 + 会话列表面板）  
**Task 3**: 会话管理页（表格 + 多维筛选 + 批量操作 + 分页）  
**Task 4**: 设置页（二级导航 + 6 个 tab + Provider 卡片 + 表单滑块）  
**Task 5**: Skills 管理页（卡片网格 + 分类 chip + Toggle 开关 + 启用/禁用）

**Output**: 四个页面全部可交互，侧栏导航切换流畅，对话页能流式接收 echo 回复，会话管理能列表/筛选/删除，设置能切换 tab，Skills 能启用/禁用卡片。

**Next plan**: [Plan C: 核心功能补全](2026-08-04-plan-c-core-features.md) — 上下文压缩 / 路径沙箱 / 工具结果溢出 / Skill 机制升级 / manage_execution_plan 工具。
