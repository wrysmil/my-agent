/**
 * Chat 流式视图（F11 / WU-06b）。
 * fetch + ReadableStream SSE，安全 Markdown，工具卡片与 compact 流程。
 */
(function (global) {
  'use strict';

  var apiPath = function (id) { return '/api/sessions/' + encodeURIComponent(id) + '/messages/stream'; };
  var current = null;
  var rafPending = false;
  var lastSeq = {};

  function agent() { return global.MyAgent || {}; }
  function esc(v) { return String(v == null ? '' : v); }
  function toast(message, status) {
    var C = agent().components;
    if (C && typeof C.Toast === 'function') { try { new C.Toast().show({ message: message, status: status || 'error' }); return; } catch (_) {} }
  }
  function renderMarkdown(md) {
    var marked = agent().marked || global.marked;
    var purify = agent().DOMPurify || global.DOMPurify;
    var html = marked && typeof marked.parse === 'function' ? marked.parse(md) : esc(md).replace(/\n/g, '<br>');
    return purify && typeof purify.sanitize === 'function' ? purify.sanitize(html) : html;
  }
  function schedule() {
    if (!current || rafPending) return;
    rafPending = true;
    (global.requestAnimationFrame || function (f) { return setTimeout(f, 0); })(function () { rafPending = false; render(); });
  }
  function render() {
    if (!current) return;
    var log = current.log;
    log.textContent = '';
    current.messages.forEach(function (m) {
      var article = document.createElement('article');
      article.className = 'msg msg-' + (m.role || 'assistant');
      var body = document.createElement('div');
      body.className = 'msg-body';
      body.innerHTML = renderMarkdown(m.content || '');
      article.appendChild(body);
      var meta = document.createElement('small');
      meta.className = 'msg-meta';
      meta.textContent = (m.time || new Date().toLocaleTimeString()) + (m.tokens != null ? ' · ' + m.tokens + ' tokens' : '');
      article.appendChild(meta);
      log.appendChild(article);
    });
    current.tools.forEach(function (t) {
      var aside = document.createElement('aside'); aside.className = 'tool-card';
      var details = document.createElement('details');
      var summary = document.createElement('summary'); summary.textContent = t.name || '工具调用'; details.appendChild(summary);
      var pre = document.createElement('pre'); pre.textContent = t.content || JSON.stringify(t.input || {}, null, 2); details.appendChild(pre);
      aside.appendChild(details); log.appendChild(aside);
    });
    log.scrollTop = log.scrollHeight;
  }
  function eventPayload(data) { try { return JSON.parse(data); } catch (_) { return {}; } }
  function consumeLine(line) {
    if (!current) return;
    if (line.indexOf('id:') === 0) { current.seq = line.slice(3).trim(); lastSeq[current.sessionId] = current.seq; return; }
    if (line.indexOf('event:') === 0) { current.event = line.slice(6).trim(); return; }
    if (line.indexOf('data:') !== 0) return;
    var p = eventPayload(line.slice(5).trim()), type = current.event || p.type;
    if (type === 'content_block_delta') { var text = p.delta && (p.delta.text || p.delta.partial_json) || p.text || ''; current.messages[current.assistantIndex].content += text; }
    else if (type === 'message_start') { current.messages.push({ role: 'assistant', content: '', time: new Date().toLocaleTimeString() }); current.assistantIndex = current.messages.length - 1; }
    else if (type === 'tool_use') { current.tools.push({ name: p.name || '工具调用', input: p.input || {}, content: p.partial ? '' : null }); }
    else if (type === 'tool_result') { current.tools.push({ name: '工具结果', content: typeof p.content === 'string' ? p.content : JSON.stringify(p.content || p) }); }
    else if (type === 'usage') { if (current.assistantIndex >= 0) current.messages[current.assistantIndex].tokens = (p.usage || p).totalTokens || (p.usage || p).outputTokens; }
    else if (type === 'error') { current.error(p.error && p.error.message || p.message || '生成失败'); }
    else if (type === 'done' || type === 'message_stop' || type === 'aborted') { current.finish(); }
    schedule();
  }
  async function stream(content) {
    var c = current, controller = new global.AbortController();
    c.streaming = true; c.stop.hidden = false; c.send.disabled = true;
    var st = agent().state; if (st && st.beginStream) st.beginStream({ abortController: controller, streamId: c.sessionId });
    try {
      var headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
      if (lastSeq[c.sessionId] != null) headers['Last-Event-ID'] = String(lastSeq[c.sessionId]);
      var response = await global.fetch(apiPath(c.sessionId), { method: 'POST', headers: headers, body: JSON.stringify({ text: content }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('SSE 请求失败（' + response.status + '）');
      var reader = response.body.getReader(), decoder = new TextDecoder(), buffer = '';
      while (true) { var part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true }); var lines = buffer.split(/\r?\n/); buffer = lines.pop(); lines.forEach(consumeLine); }
      if (buffer) consumeLine(buffer);
    } catch (err) { if (!(err && err.name === 'AbortError')) c.error(err.message || '网络错误'); }
    finally { c.finish(); }
  }
  function compactFlow() {
    if (!current) return;
    var id = encodeURIComponent(current.sessionId), a = agent().api;
    var request = a && a.apiFetch ? a.apiFetch : function (path, o) { return global.fetch(path, o).then(function (r) { return r.json(); }); };
    Promise.resolve(request('/api/sessions/' + id + '/compact/preview', { method: 'POST', body: {} })).then(function (preview) {
      var ok = typeof global.confirm === 'function' ? global.confirm('预计压缩后节省 ' + ((preview && preview.tokensSaved) || '部分') + ' tokens，继续？') : true;
      if (!ok) return null; return request('/api/sessions/' + id + '/compact', { method: 'POST', body: {} });
    }).then(function (result) { if (result) toast('会话已压缩', 'success'); }).catch(function (e) { toast(e.message || '压缩失败', 'error'); });
  }
  function installChatView(opts) {
    opts = opts || {}; if (!opts.container || !opts.sessionId) throw new Error('container and sessionId are required');
    uninstall();
    var root = opts.container, log = document.createElement('div'); log.className = 'chat-transcript'; log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-relevant', 'additions');
    var form = document.createElement('form'); form.className = 'chat-composer';
    var textarea = document.createElement('textarea'); textarea.setAttribute('aria-label', '消息输入'); textarea.rows = 3;
    var send = document.createElement('button'); send.type = 'submit'; send.setAttribute('aria-label', '发送消息'); send.textContent = '发送';
    var stop = document.createElement('button'); stop.type = 'button'; stop.setAttribute('aria-label', '停止生成'); stop.textContent = '停止'; stop.hidden = true;
    form.append(textarea, send, stop); root.append(log, form);
    current = { container: root, log: log, send: send, stop: stop, sessionId: String(opts.sessionId), messages: [], tools: [], assistantIndex: -1, streaming: false };
    current.error = function (msg) { var e = document.createElement('div'); e.className = 'chat-error'; e.textContent = msg; log.appendChild(e); toast(msg, 'error'); };
    current.finish = function () { current.streaming = false; send.disabled = false; stop.hidden = true; var s = agent().state; if (s && s.endStream) s.endStream(); };
    form.addEventListener('submit', function (ev) { ev.preventDefault(); var text = textarea.value.trim(); if (!text || current.streaming) return; current.messages.push({ role: 'user', content: text, time: new Date().toLocaleTimeString() }); textarea.value = ''; schedule(); stream(text); });
    textarea.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); } });
    stop.addEventListener('click', function () { var s = agent().state, st = s && s.chatState && s.chatState.get ? s.chatState.get() : null; if (st && st.abortController) st.abortController.abort(); });
    current.onCompact = compactFlow; document.addEventListener('my-agent:compact-request', compactFlow);
    render(); return api;
  }
  function uninstall() { if (current) { document.removeEventListener('my-agent:compact-request', current.onCompact); if (current.container) current.container.textContent = ''; current = null; } }
  function sendMessage(content) { if (!current || current.streaming) return false; var text = esc(content).trim(); if (!text) return false; current.messages.push({ role: 'user', content: text, time: new Date().toLocaleTimeString() }); schedule(); stream(text); return true; }
  var api = { installChatView: installChatView, uninstall: uninstall, sendMessage: sendMessage };
  global.MyAgent = global.MyAgent || {}; global.MyAgent.chatFeature = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
