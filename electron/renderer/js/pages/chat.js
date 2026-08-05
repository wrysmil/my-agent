// electron/renderer/js/pages/chat.js
const ChatPage = {
  currentSessionId: null,
  currentStream: null,
  currentAssistantEl: null,
  _initialized: false,

  init() {
    if (this._initialized) {
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

    const { sessions } = await api.sessions.list({ limit: 50 });
    this.renderSessionList(sessions);

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

    const container = document.getElementById("chat-messages");
    const empty = container.querySelector(".empty-state");
    if (empty) empty.remove();

    this.appendUserMessage(message);

    const { el: assistantEl } = this.appendAssistantMessage("");
    this.currentAssistantEl = assistantEl;
    let fullText = "";

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
    el.style.paddingLeft = "42px";

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
