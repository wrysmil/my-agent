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
      document.getElementById("chat-title").textContent =
        session?.name || "新对话";

      // WU-1.5 提供 sessions:getMessages IPC（从 PersistentSession JSONL 读取消息）
      const raw = await window.myAgent.invoke("sessions:getMessages", sessionId);
      const messages = Array.isArray(raw) ? raw : (raw?.messages ?? []);

      if (messages.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💬</div><div>开始对话</div></div>`;
        return;
      }

      container.innerHTML = "";
      this.renderHistoryMessages(messages);
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      console.error("[chat] 加载历史失败:", err);
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div>加载失败</div></div>`;
    }
  },

  /** 渲染 JSONL 历史消息：user/assistant 气泡 + 工具调用卡片。 */
  renderHistoryMessages(messages) {
    // toolUseId -> { name, input }，用于把后续 tool_result 与调用配对
    const pendingToolUses = new Map();

    for (const msg of messages) {
      const role = msg?.role;
      const rawContent = msg?.content;
      const text = this.extractText(rawContent);
      const blocks = Array.isArray(rawContent) ? rawContent : [];
      const toolUses = blocks.filter((b) => b?.type === "tool_use");
      const toolResults = blocks.filter((b) => b?.type === "tool_result");

      if (role === "assistant") {
        for (const tu of toolUses) {
          pendingToolUses.set(tu.id, { name: tu.name, input: tu.input });
        }
        if (text) this.appendAssistantMessage(text);
      } else {
        // user（含 tool_result）/ tool / 未知角色
        for (const tr of toolResults) {
          const tu = pendingToolUses.get(tr.toolUseId);
          if (tu) {
            this.appendHistoryToolCard({
              name: tu.name,
              input: tu.input,
              result: tr,
            });
            pendingToolUses.delete(tr.toolUseId);
          } else {
            // 孤儿 tool_result（无配对调用），以通用卡片展示
            this.appendHistoryToolCard({
              name: "工具结果",
              input: null,
              result: tr,
            });
          }
        }
        if (text) this.appendUserMessage(text);
      }
    }

    // 未匹配到结果（异常中断）的 tool_use，补一张已完成卡片
    for (const tu of pendingToolUses.values()) {
      this.appendHistoryToolCard({ name: tu.name, input: tu.input, result: null });
    }
  },

  /** 从消息内容提取纯文本（兼容字符串或 ContentBlock 数组）。 */
  extractText(content) {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
      .filter((b) => b && b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
  },

  /** 历史回显：工具调用 + 执行结果的合并卡片（复用 tool-call-card 样式）。 */
  appendHistoryToolCard({ name, input, result }) {
    const container = document.getElementById("chat-messages");
    const el = document.createElement("div");
    el.className = "message";
    el.style.paddingLeft = "42px";

    const card = document.createElement("div");
    card.className = `tool-call-card${result?.isError ? " error" : ""}`;
    card.style.maxWidth = "88%";
    card.style.width = "100%";

    const inputPreview = input ? JSON.stringify(input).slice(0, 120) : "";
    const resultText = result ? String(result.content ?? "") : "";
    const statusText = result
      ? (result.isError
          ? `❌ ${resultText.slice(0, 100) || "执行失败"}`
          : `✅ ${resultText.slice(0, 100) || "完成"}`)
      : "✅ 完成";

    card.innerHTML = `
      <div class="tool-call-header">
        <span>🔧 <strong>${this.escapeHtml(name)}</strong>${inputPreview ? ` · ${this.escapeHtml(inputPreview)}` : ""}</span>
        <span style="color:#aaa;font-size:11px;">▼</span>
      </div>
      <div class="tool-call-body">
        <pre style="margin:0;white-space:pre-wrap;font-size:11px;">${input ? this.escapeHtml(JSON.stringify(input, null, 2)) : "(无输入)"}</pre>
        ${result ? `<pre style="margin:6px 0 0;white-space:pre-wrap;font-size:11px;color:#555;">→ ${this.escapeHtml(resultText)}</pre>` : ""}
      </div>
      <div class="tool-call-status ${result?.isError ? "error" : "success"}">
        ${this.escapeHtml(statusText)}
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

  async send() {
    // 防止并发发送：当前流未结束时忽略新的发送请求
    if (this.currentStream) return;

    const input = document.getElementById("chat-input");
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    input.style.height = "auto";

    // 发送中禁用按钮，防止误操作
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = true;

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
      const sendBtn = document.getElementById("btn-send");
      if (sendBtn) sendBtn.disabled = false;

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
      const sendBtn = document.getElementById("btn-send");
      if (sendBtn) sendBtn.disabled = false;
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
    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;
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
    // 若正在生成，先取消流，避免后续回调写入已清空的容器
    if (this.currentStream) {
      this.currentStream.cancel();
      this.currentStream = null;
    }
    this.currentAssistantEl = null;
    this.currentSessionId = null;

    const container = document.getElementById("chat-messages");
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div>开始一段新对话</div>
      </div>
    `;

    document.getElementById("chat-title").textContent = "新对话";

    const sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;

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
