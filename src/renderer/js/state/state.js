/**
 * state.js — 全局状态管理
 *
 * 不使用 Redux/Vuex/任何框架。所有状态是模块级顶层变量，
 * 各模块通过全局作用域直接读写。经典 <script> 标签模式下，后加载文件可访问这些变量。
 */

// ============================================================
// 视图状态
// ============================================================

/** 当前激活页面: 'chat' | 'sessions' | 'agents' | 'skills' | 'settings' */
var currentView = 'chat';

/** 当前会话 ID，null 表示新对话 */
var currentSessionId = null;

// ============================================================
// 会话
// ============================================================

/** 会话列表（侧边栏数据源） */
var conversations = [];

/** 每个会话的挂起状态: sessionId → { loadingEl, controller, aborted } */
var pendingConvs = new Map();

/** 每个会话的排队消息: sessionId → [{ id, content, timestamp }, ...] */
var messageQueues = new Map();

// ============================================================
// 缓存
// ============================================================

/** Agent 摘要缓存（名称/头像，用于 @-mention 和侧边栏） */
var _agentsCache = null;
var _agentsCacheIsSummary = true;

/** Skill 列表缓存 */
var _skillsCache = null;

// ============================================================
// 轮询状态（阶段5）
// ============================================================

var pollTimers = new Map();

var pollMsgCounts = new Map();

function startPolling(sessionId) {
  if (pollTimers.has(sessionId)) return;
  var timer = setInterval(async function () {
    try {
      var raw = await window.myAgent.invoke('sessions:getMessages', sessionId);
      var messages = Array.isArray(raw) ? raw : (raw && raw.messages ? raw.messages : []);
      var lastCount = pollMsgCounts.get(sessionId) || 0;
      if (messages.length > lastCount) {
        pollMsgCounts.set(sessionId, messages.length);
        if (typeof ChatPage !== 'undefined' && typeof ChatPage.onPollMessages === 'function') {
          ChatPage.onPollMessages(sessionId, messages.slice(lastCount));
        }
      }
    } catch (_) { /* 忽略轮询错误 */ }
  }, 3000);
  pollTimers.set(sessionId, timer);
}

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

function enqueueMessage(sessionId, msg) {
  var queue = messageQueues.get(sessionId);
  if (!queue) {
    queue = [];
    messageQueues.set(sessionId, queue);
  }
  queue.push(msg);
  if (queue.length === 1) {
    processMessageQueue(sessionId);
  }
}

async function processMessageQueue(sessionId) {
  var queue = messageQueues.get(sessionId);
  if (!queue || queue.length === 0) {
    messageQueues.delete(sessionId);
    return;
  }
  var msg = queue[0];
  try {
    if (typeof ChatPage !== 'undefined' && typeof ChatPage._sendOneMessage === 'function') {
      await ChatPage._sendOneMessage(sessionId, msg);
    }
  } catch (err) {
    messageQueues.delete(sessionId);
    return;
  }
  queue.shift();
  if (queue.length === 0) {
    messageQueues.delete(sessionId);
  }
  processMessageQueue(sessionId);
}

// ============================================================
// 视图切换
// ============================================================

/**
 * 切换到指定视图。
 * @param {string} view - 目标视图名
 * @param {string} [sessionId] - 目标会话 ID（仅 chat 视图使用）
 * @param {object} [opts] - 额外选项
 */
function setView(view, sessionId, opts) {
  opts = opts || {};
  var prevView = currentView;
  currentView = view;
  currentSessionId = sessionId || null;

  // 1. 切换面板可见性
  var panels = document.querySelectorAll('.page');
  for (var i = 0; i < panels.length; i++) {
    panels[i].classList.remove('active');
  }
  var page = document.getElementById('page-' + view);
  if (page) page.classList.add('active');

  // 2. 高亮侧边栏按钮
  var icons = document.querySelectorAll('.sidebar-icon');
  for (var j = 0; j < icons.length; j++) {
    icons[j].classList.remove('active');
  }
  // 用 .sidebar-icon 限定，避免匹配到 #sidebar-logo（也有 data-nav="chat"）
  var btn = document.querySelector('.sidebar-icon[data-nav="' + view + '"]');
  if (btn) btn.classList.add('active');

  // 3. 会话面板 — 仅对话页显示
  var sessionPanel = document.getElementById('session-panel');
  if (sessionPanel) {
    if (view === 'chat') {
      sessionPanel.classList.remove('collapsed');
    } else {
      sessionPanel.classList.add('collapsed');
    }
  }

  // 4. 按需初始化页面
  _initPage(view);

  // 5. 持久化最后视图
  _saveLastView(view, sessionId);
}

/**
 * 从 localStorage 恢复上次视图和会话。
 */
function _restoreLastView() {
  try {
    var raw = localStorage.getItem('myagent:lastView');
    if (raw) {
      var data = JSON.parse(raw);
      if (data.view) {
        setView(data.view, data.sessionId || null);
        return;
      }
    }
  } catch (_) { /* ignore */ }
  // 默认显示对话框
  setView('chat');
}

function _saveLastView(view, sessionId) {
  try {
    localStorage.setItem('myagent:lastView', JSON.stringify({
      view: view,
      sessionId: sessionId || null,
    }));
  } catch (_) { /* ignore */ }
}

// ============================================================
// 页面按需初始化
// ============================================================

var _pagesInitialized = {};

function _initPage(view) {
  if (_pagesInitialized[view]) return; // 首次初始化后不重复调用

  var initFn;
  switch (view) {
    case 'chat':
      initFn = (typeof ChatPage !== 'undefined' && ChatPage.init) ? ChatPage.init.bind(ChatPage) : null;
      break;
    case 'sessions':
      initFn = (typeof SessionsPage !== 'undefined' && SessionsPage.init) ? SessionsPage.init.bind(SessionsPage) : null;
      break;
    case 'skills':
      initFn = (typeof SkillsPage !== 'undefined' && SkillsPage.init) ? SkillsPage.init.bind(SkillsPage) : null;
      break;
    case 'settings':
      initFn = (typeof SettingsPage !== 'undefined' && SettingsPage.init) ? SettingsPage.init.bind(SettingsPage) : null;
      break;
    case 'agents':
      initFn = (typeof AgentsPage !== 'undefined' && AgentsPage.init) ? AgentsPage.init.bind(AgentsPage) : null;
      break;
  }

  if (initFn) {
    _pagesInitialized[view] = true;
    initFn();
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 生成页面 ID（用于 CSS class/id 映射）。
 */
function _viewToPageId(view) {
  return 'page-' + view;
}
