// electron/renderer/js/pages/chat.js
const ChatPage = {
  currentSessionId: null,
  currentStream: null,
  currentAssistantEl: null,
  _cancelFn: null,
  _initialized: false,
  _currentFullText: '',

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

    // 订阅权限推送（阶段5）
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
    if (this.currentSessionId && typeof startPolling === 'function') {
      startPolling(this.currentSessionId);
    }
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
        (function(sessionId) {
          item.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            if (typeof SessionsPage !== 'undefined' && SessionsPage.showRowMenu) {
              SessionsPage.showRowMenu(sessionId, e);
            }
          });
        })(s.id);
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

    if (id && typeof startPolling === 'function') {
      startPolling(id);
    }
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

  /** 用户点击发送——消息入队，不直接发送。 */
  async send() {
    if (this.currentStream) return;

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

    var sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = true;

    var container = document.getElementById("chat-messages");
    var empty = container.querySelector(".empty-state");
    if (empty) empty.remove();

    this.appendUserMessage(message);

    // 委托全局队列处理；回退兼容 state.js 未加载
    if (typeof enqueueMessage === 'function') {
      enqueueMessage(this.currentSessionId || '__new__', msg);
    } else {
      await this._sendOneMessage(this.currentSessionId || '__new__', msg);
    }
  },

  cancel() {
    if (this._cancelFn) {
      this._cancelFn();
      this._cancelFn = null;
    }
    this.currentStream = null;
    this.currentAssistantEl = null;

    var sid = this.currentSessionId || '__new__';
    if (typeof messageQueues !== 'undefined') messageQueues.delete(sid);

    var container = document.getElementById("chat-messages");
    var cursor = container && container.querySelector(".streaming-cursor");
    if (cursor) cursor.remove();

    var sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;

    var notice = document.createElement("div");
    notice.className = "retry-notice";
    notice.textContent = typeof t === 'function' ? t('chat.streaming_cancel') : '已停止生成并清空待发送队列';
    if (container) {
      container.appendChild(notice);
      container.scrollTop = container.scrollHeight;
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

  /**
   * 发送单条消息（由 processMessageQueue 调用）。
   * 将原 send() 的核心流式逻辑迁移至此。
   */
  async _sendOneMessage(sessionId, msg) {
    var self = this;
    var container = document.getElementById("chat-messages");

    var assistantResult = this.appendAssistantMessage("");
    this.currentAssistantEl = assistantResult.el;
    this._currentFullText = '';

    var onEvent = function (ev) {
      self._handleStreamEvent(ev, assistantResult.el, container);
    };

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
        if (typeof stopPolling === 'function') stopPolling('__new__');
        if (typeof startPolling === 'function') startPolling(result.sessionId);
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

  /**
   * 处理流事件（从 send 的 onEvent 回调提取）。
   */
  _handleStreamEvent: function (ev, bubbleEl, container) {
    var self = this;
    switch (ev.type) {
      case 'text_delta':
        this._currentFullText = (this._currentFullText || '') + ev.text;
        bubbleEl.innerHTML = typeof renderMarkdown === 'function'
          ? renderMarkdown(this._currentFullText)
          : this.escapeHtml(this._currentFullText).replace(/\n/g, '<br>');
        this._highlightMentions(bubbleEl);
        container.scrollTop = container.scrollHeight;
        break;

      case 'tool_start':
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
    if (this.currentSessionId && typeof stopPolling === 'function') {
      stopPolling(this.currentSessionId);
    }

    if (this.currentStream) {
      this.currentStream.cancel();
      this.currentStream = null;
    }
    this.currentAssistantEl = null;
    this.currentSessionId = null;
    this._currentFullText = '';

    var container = document.getElementById("chat-messages");
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💬</div><div>开始一段新对话</div></div>';

    document.getElementById("chat-title").textContent = "新对话";

    var sendBtn = document.getElementById("btn-send");
    if (sendBtn) sendBtn.disabled = false;

    document.getElementById("chat-input").focus();

    this.loadSessionList();
  },

  formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  },

  /**
   * 轮询检测到新消息时的回调（由 state.js 的 startPolling 定时器调用）。
   */
  onPollMessages: function (sessionId, newMessages) {
    if (sessionId !== this.currentSessionId) return;
    if (!newMessages || newMessages.length === 0) return;

    var container = document.getElementById("chat-messages");
    if (!container) return;

    var pollNotice = container.querySelector('.poll-notice');
    if (!pollNotice) {
      var notice = document.createElement('div');
      notice.className = 'retry-notice poll-notice';
      notice.textContent = typeof t === 'function' ? t('chat.poll_detected') : '检测到进行中的助手响应，正在同步...';
      container.appendChild(notice);
    }

    if (this.currentSessionId) {
      this.loadHistory(this.currentSessionId);
    }
  },

  /**
   * 在渲染后的消息 DOM 中高亮 @-mention。
   */
  _highlightMentions: function (rootEl) {
    if (!rootEl) return;
    var knownNames = this._collectMentionNames();
    if (knownNames.length === 0) return;

    knownNames.sort(function (a, b) { return b.length - a.length; });
    var escaped = knownNames.map(function (n) {
      return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    var re = new RegExp('(' + escaped.join('|') + ')', 'g');

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
      re.lastIndex = 0;
      span.innerHTML = node.textContent.replace(re, '<span class="msg-mention">$1</span>');
      if (node.parentNode) {
        node.parentNode.replaceChild(span, node);
      }
    }
  },

  /**
   * 收集可用于 @-mention 高亮的已知名称。
   */
  _collectMentionNames: function () {
    var names = [];
    if (typeof conversations !== 'undefined' && Array.isArray(conversations)) {
      for (var i = 0; i < conversations.length; i++) {
        var n = conversations[i].name;
        if (n && names.indexOf(n) === -1) names.push(n);
      }
    }
    if (typeof _agentsCache !== 'undefined' && _agentsCache) {
      var agents = Array.isArray(_agentsCache) ? _agentsCache : [];
      for (var j = 0; j < agents.length; j++) {
        var an = agents[j].name;
        if (an && names.indexOf(an) === -1) names.push(an);
      }
    }
    var builtins = ['My Agent', 'Claude', 'Claude Code', 'Codex'];
    for (var k = 0; k < builtins.length; k++) {
      if (names.indexOf(builtins[k]) === -1) names.push(builtins[k]);
    }
    return names;
  },

  /**
   * 处理 Bash 权限推送 — 弹出确认对话框。
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
    } catch (_) { /* 主进程可能未实现 */ }
  },

  /**
   * 处理文件删除确认推送。
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
    } catch (_) { /* 主进程可能未实现 */ }
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
