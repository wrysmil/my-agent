/**
 * app.js — 启动流水线 + 全站事件路由（F15 / WU-06c）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.7
 *           + § 4.4.6 (IIFE 模式) + § 5.2 (主页面布局)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-06c
 *
 * 职责:
 *   - 挂载 window.MyAgent.theme 别名（指向 window.MyAgent.themeModule；
 *     F0 shared/theme.js 实际挂在 themeModule 节点名 —— 不是 theme 别名）
 *   - 初始化 state.js 的内置 store（load persisted settings；storeRegistry
 *     创建是副作用,本函数确保在 boot 时已经存在）
 *   - 装 sidebar + panels 到 <aside> + <main>
 *   - 装 providersFeature / sessionsFeature / agentsFeature / skillsFeature /
 *     settingsFeature / menuFeature / chatFeature 到对应 panel
 *   - 绑事件路由（panel-change / session-select / session-delete / agent-launch /
 *     skill-use / theme-change / compact-request / menu-action / tab-change /
 *     lang-change）
 *   - 双向桥接两个主题事件名（my-agent:theme-change = my-agent-theme-change）
 *   - 监听系统主题变化（prefers-color-scheme change -> 重新应用 theme）
 *   - 注册全站快捷键（appKeymap.install）
 *   - 注册全局错误捕获（window.onerror -> Toast）
 *
 * 加载方式: <script defer> + IIFE 模式;在所有 features 之后加载。
 * 测试:    test/web/app.test.ts（≥ 12 用例）。
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  // 事件名(与 spec § 4.4.6 + 各 feature 文件对齐)
  var EVENT_PANEL_CHANGE = 'my-agent:panel-change';
  var EVENT_SESSION_SELECT = 'my-agent:session-select';
  var EVENT_SESSION_DELETE = 'my-agent:session-delete';
  var EVENT_AGENT_LAUNCH = 'my-agent:agent-launch';
  var EVENT_SKILL_USE = 'my-agent:skill-use';
  var EVENT_THEME_CHANGE_COLON = 'my-agent:theme-change'; // F18 + F14
  var EVENT_THEME_CHANGE_DASH = 'my-agent-theme-change'; // F0
  var EVENT_COMPACT_REQUEST = 'my-agent:compact-request';
  var EVENT_MENU_ACTION = 'my-agent:menu-action';
  var EVENT_TAB_CHANGE = 'my-agent:tab-change';
  var EVENT_LANG_CHANGE = 'my-agent:lang-change';
  var EVENT_NEW_SESSION = 'my-agent:new-session';

  // 面板 ID 列表
  var PANELS = ['home', 'chat', 'sessions', 'providers', 'agents', 'skills', 'settings'];

  // 当前激活会话 / view(由 bootApp 闭包持有)
  var state = {
    booted: false,
    bootedAt: null,
    documentListeners: [], // { type, listener }
    windowListeners: [], // { type, listener }
    installations: {}, // name -> { uninstall }
    chatInstalledFor: null, // 记录 chatFeature 当前绑定的 sessionId
    lastView: null,
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function noop() {}

  function safe(fn, fallback) {
    try { fn(); } catch (_e) { /* ignore */ }
  }

  function pickFirst(doc, selectors) {
    if (!doc || typeof doc.getElementById !== 'function') return null;
    for (var i = 0; i < selectors.length; i++) {
      var s = selectors[i];
      var el = (typeof s === 'string' && s.indexOf('#') === 0)
        ? doc.getElementById(s.slice(1))
        : doc.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function pickSidebar(doc) {
    return pickFirst(doc, ['#sidebar', '.app-sidebar', 'aside[role="complementary"]', 'aside']);
  }

  function pickMain(doc) {
    return pickFirst(doc, ['#content', '#main-content', 'main[role="main"]', 'main']);
  }

  function pickPanel(doc, name) {
    return pickFirst(doc, ['#panel-' + name, '[data-panel="' + name + '"]']);
  }

  function getLib(name) {
    var lib = global.MyAgent && global.MyAgent[name];
    return lib || null;
  }

  function addDocumentListener(type, listener) {
    if (!global.document || typeof global.document.addEventListener !== 'function') return;
    global.document.addEventListener(type, listener);
    state.documentListeners.push({ type: type, listener: listener });
  }

  function addWindowListener(type, listener) {
    if (!global || typeof global.addEventListener !== 'function') return;
    global.addEventListener(type, listener);
    state.windowListeners.push({ type: type, listener: listener });
  }

  function removeAllListeners() {
    var d = global.document;
    for (var i = 0; i < state.documentListeners.length; i++) {
      var entry = state.documentListeners[i];
      if (d && typeof d.removeEventListener === 'function') {
        try { d.removeEventListener(entry.type, entry.listener); } catch (_e) { /* ignore */ }
      }
    }
    state.documentListeners = [];
    var w = global;
    for (var j = 0; j < state.windowListeners.length; j++) {
      var wentry = state.windowListeners[j];
      if (w && typeof w.removeEventListener === 'function') {
        try { w.removeEventListener(wentry.type, wentry.listener); } catch (_e) { /* ignore */ }
      }
    }
    state.windowListeners = [];
  }

  function destroyInstallation(name) {
    var inst = state.installations[name];
    if (!inst) return;
    if (typeof inst.uninstall === 'function') {
      try { inst.uninstall(); } catch (_e) { /* ignore */ }
    }
    delete state.installations[name];
  }

  function destroyAllInstallations() {
    Object.keys(state.installations).forEach(destroyInstallation);
    state.chatInstalledFor = null;
  }

  function showToast(msg, status) {
    var C = getLib('components');
    if (C && typeof C.Toast === 'function') {
      try {
        var t = new C.Toast();
        if (typeof t.show === 'function') {
          t.show({ message: String(msg), status: status || 'info' });
          return;
        }
      } catch (_e) { /* ignore */ }
    }
    // 降级: console.error
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[app] toast fallback:', msg);
    }
  }

  // ------------------------------------------------------------------
  // 步骤 1:挂载 theme 别名(关键! spec § 4.4.1 + F18 features/theme.js
  //   都通过 window.MyAgent.theme.setTheme / getTheme / getSystemTheme 调用,
  //   但 F0 web/js/shared/theme.js 实际挂在 window.MyAgent.themeModule,
  //   因此本文件必须挂别名 + 桥接事件)
  // ------------------------------------------------------------------

  function installThemeAlias() {
    var themeModule = global.MyAgent && global.MyAgent.themeModule;
    if (!themeModule) return false;
    if (global.MyAgent.theme && global.MyAgent.theme === themeModule) return true;
    global.MyAgent.theme = themeModule;
    return true;
  }

  // ------------------------------------------------------------------
  // 步骤 2:初始化 state stores(load persisted settings)
  //   state.js 是 IIFE 自启,载入时已创建 6 个内置 store;
  //   本步骤只确认存在性 + 触发 settingsState 的 subscribe 默认回调
  // ------------------------------------------------------------------

  function ensureStateStores() {
    var s = getLib('state');
    if (!s) return false;
    var required = ['appState', 'chatState', 'providerState', 'sessionListState', 'agentState', 'settingsState'];
    for (var i = 0; i < required.length; i++) {
      var store = s[required[i]];
      if (!store) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 步骤 3:装 sidebar + panels 到 DOM 占位
  //   - sidebar: 构造 components.Sidebar() -> 挂到 <aside>(若不存在则创建)
  //   - panels: 不构造新 DOM;复用 index.html 已有的 <section data-panel=...>
  // ------------------------------------------------------------------

  function installSidebar(doc) {
    var C = getLib('components');
    if (!C || typeof C.Sidebar !== 'function') return null;
    var target = pickSidebar(doc);
    if (!target) return null;
    try {
      var sidebar = new C.Sidebar();
      // 替换原内容(WU-05a 已构造完整 DOM;原 sidebar 元素作为 placeholder)
      target.innerHTML = '';
      while (target.firstChild) target.removeChild(target.firstChild);
      target.appendChild(sidebar.el);
      return { sidebar: sidebar, target: target };
    } catch (_e) {
      return null;
    }
  }

  // 不构造新 panel DOM;仅返回 panel 元素引用(由 features.install 各自用)
  function resolvePanels(doc) {
    var out = {};
    for (var i = 0; i < PANELS.length; i++) {
      var name = PANELS[i];
      var el = pickPanel(doc, name);
      if (el) out[name] = el;
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 步骤 4/5:装 features(各 feature 接受 { container })
  //   - skillsFeature 接管 skills panel(不依赖 agentsFeature 的
  //     buildSkillsPlaceholder;spec § 5.5)
  //   - settingsFeature 接管 settings panel
  // ------------------------------------------------------------------

  function installFeatures(doc, panels) {
    var out = {};

    // providers
    var providersFeature = getLib('providersFeature');
    if (providersFeature && typeof providersFeature.installProvidersView === 'function' && panels.providers) {
      try {
        var region = panels.providers.querySelector('#providers-table-region') || panels.providers;
        var inst = providersFeature.installProvidersView({ container: region });
        out.providers = inst;
        state.installations.providers = inst;
      } catch (_e) { /* ignore */ }
    }

    // sessions
    var sessionsFeature = getLib('sessionsFeature');
    if (sessionsFeature && typeof sessionsFeature.installSessionsList === 'function') {
      // 优先挂到 sidebar 里的 #session-list;否则放 sessions panel
      var sessionTarget = null;
      var sidebar = doc.querySelector('#session-list') || doc.querySelector('.sidebar-session-list');
      if (sidebar) sessionTarget = sidebar;
      else if (panels.sessions) sessionTarget = panels.sessions;
      if (sessionTarget) {
        try {
          var sinst = sessionsFeature.installSessionsList({ container: sessionTarget });
          out.sessions = sinst;
          state.installations.sessions = sinst;
        } catch (_e) { /* ignore */ }
      }
    }

    // agents
    var agentsFeature = getLib('agentsFeature');
    if (agentsFeature && typeof agentsFeature.installAgentsView === 'function' && panels.agents) {
      try {
        var region = panels.agents.querySelector('#agents-list-region') || panels.agents;
        var ainst = agentsFeature.installAgentsView({ container: region });
        out.agents = ainst;
        state.installations.agents = ainst;
      } catch (_e) { /* ignore */ }
    }

    // skills(由 skillsFeature 接管,不用 agentsFeature 的 buildSkillsPlaceholder)
    var skillsFeature = getLib('skillsFeature');
    if (skillsFeature && typeof skillsFeature.installSkillsView === 'function' && panels.skills) {
      try {
        var sregion = panels.skills.querySelector('#skills-list-region') || panels.skills;
        var skinst = skillsFeature.installSkillsView({ container: sregion });
        out.skills = skinst;
        state.installations.skills = skinst;
      } catch (_e) { /* ignore */ }
    }

    // settings
    var settingsFeature = getLib('settingsFeature');
    if (settingsFeature && typeof settingsFeature.installSettingsView === 'function' && panels.settings) {
      try {
        var setregion = panels.settings.querySelector('#settings-region') || panels.settings;
        var setinst = settingsFeature.installSettingsView({ container: setregion });
        out.settings = setinst;
        state.installations.settings = setinst;
      } catch (_e) { /* ignore */ }
    }

    // menu(挂到 home panel 的 bento-grid 容器;HomePanel 已由 index.html 构造)
    var menuFeature = getLib('menuFeature');
    if (menuFeature && typeof menuFeature.installMainMenu === 'function' && panels.home) {
      try {
        var bento = panels.home.querySelector('#bento-grid') || panels.home;
        var menuInst = menuFeature.installMainMenu({ container: bento });
        out.menu = menuInst;
        state.installations.menu = menuInst;
      } catch (_e) { /* ignore */ }
    }

    return out;
  }

  // ------------------------------------------------------------------
  // 步骤 6:装 chatFeature(lazy:仅 activeView === 'chat' 时实例化)
  //   - installChatView({ container, sessionId }) 自身会先 uninstall
  //   - 同一 session 重复 install 应幂等(避免重新绑定事件)
  // ------------------------------------------------------------------

  function getChatContainer(doc, panels) {
    if (!panels.chat) return null;
    // 优先用 panel 内的 .chat-transcript(由 ChatPanel 构造) 或 panel 自身
    var transcript = panels.chat.querySelector('.chat-transcript');
    if (transcript) return transcript.parentNode || panels.chat;
    return panels.chat;
  }

  function installChat(doc, panels, sessionId) {
    var chatFeature = getLib('chatFeature');
    if (!chatFeature || typeof chatFeature.installChatView !== 'function') return false;
    var container = getChatContainer(doc, panels);
    if (!container) return false;
    if (state.chatInstalledFor === sessionId && chatFeature.isInstalled && chatFeature.isInstalled()) {
      return true;
    }
    try {
      chatFeature.installChatView({ container: container, sessionId: sessionId });
      state.chatInstalledFor = sessionId;
      return true;
    } catch (_e) {
      return false;
    }
  }

  function ensureChatForActiveView(doc, panels) {
    var appState = getLib('state') && getLib('state').appState;
    if (!appState) return;
    var view = appState.get().activeView;
    if (view === 'chat') {
      var sessionId = appState.get().activeSessionId;
      installChat(doc, panels, sessionId);
    }
  }

  // ------------------------------------------------------------------
  // 步骤 7:事件路由
  // ------------------------------------------------------------------

  function setActiveView(doc, panels, view) {
    var s = getLib('state');
    if (!s || !s.appState) return;
    var cur = s.appState.get();
    if (cur.activeView === view) return;
    s.appState._setRaw(Object.assign({}, cur, { activeView: view }));
    state.lastView = view;
    // 显示/隐藏 panel
    showPanel(doc, panels, view);
    ensureChatForActiveView(doc, panels);
  }

  function showPanel(doc, panels, view) {
    // 收集所有 panel 元素(data-panel 属性 OR .panel className)
    var collected = [];
    if (typeof doc.querySelectorAll === 'function') {
      try {
        var byData = doc.querySelectorAll('[data-panel]');
        for (var i = 0; i < byData.length; i++) collected.push(byData[i]);
      } catch (_e) { /* ignore */ }
      try {
        var byClass = doc.querySelectorAll('.panel');
        for (var j = 0; j < byClass.length; j++) {
          if (collected.indexOf(byClass[j]) < 0) collected.push(byClass[j]);
        }
      } catch (_e) { /* ignore */ }
    }
    for (var k = 0; k < collected.length; k++) {
      var el = collected[k];
      var name = el.getAttribute && el.getAttribute('data-panel');
      if (name === view || (name === 'main-menu' && view === 'home')) {
        el.hidden = false;
        try {
          if (typeof el.removeAttribute === 'function') el.removeAttribute('hidden');
        } catch (_e) { /* ignore */ }
      } else {
        try {
          if (typeof el.setAttribute === 'function') el.setAttribute('hidden', '');
        } catch (_e) { /* ignore */ }
      }
    }
  }

  function setActiveSession(id) {
    var s = getLib('state');
    if (!s || !s.appState) return;
    var cur = s.appState.get();
    if (cur.activeSessionId === id) return;
    s.appState._setRaw(Object.assign({}, cur, { activeSessionId: id }));
  }

  function wireEventRoutes(doc, panels) {
    // 1) panel-change -> setActiveView + 切 panel 显示 + lazy chat
    addDocumentListener(EVENT_PANEL_CHANGE, function (ev) {
      var detail = ev && ev.detail;
      if (!detail || typeof detail.panel !== 'string') return;
      setActiveView(doc, panels, detail.panel);
    });

    // 2) session-select -> activeSessionId + chatFeature.install
    addDocumentListener(EVENT_SESSION_SELECT, function (ev) {
      var detail = ev && ev.detail;
      if (!detail || typeof detail.sessionId !== 'string') return;
      setActiveSession(detail.sessionId);
      // 切到 chat(若未在 chat)
      var s = getLib('state');
      if (s && s.appState) {
        var cur = s.appState.get();
        if (cur.activeView !== 'chat') {
          setActiveView(doc, panels, 'chat');
        } else {
          installChat(doc, panels, detail.sessionId);
        }
      }
    });

    // 3) session-delete -> sessionsFeature.deleteSession
    addDocumentListener(EVENT_SESSION_DELETE, function (ev) {
      var detail = ev && ev.detail;
      if (!detail || typeof detail.sessionId !== 'string') return;
      var sf = state.installations.sessions;
      if (sf && typeof sf.deleteSession === 'function') {
        try { sf.deleteSession(detail.sessionId); } catch (_e) { /* ignore */ }
      }
    });

    // 4) agent-launch -> switch to chat + 注入 systemPrompt(填到 textarea)
    addDocumentListener(EVENT_AGENT_LAUNCH, function (ev) {
      var detail = ev && ev.detail;
      setActiveView(doc, panels, 'chat');
      // 注入 systemPrompt 到 chat composer
      if (detail && panels.chat) {
        var ta = panels.chat.querySelector('textarea');
        if (ta && typeof detail.agentName === 'string') {
          var prompt = '/agent ' + detail.agentId;
          if (ta.value) prompt = ta.value + '\n' + prompt;
          ta.value = prompt;
          try { ta.focus(); } catch (_e) { /* ignore */ }
        }
      }
    });

    // 5) skill-use -> switch to chat + 注入 skill context
    addDocumentListener(EVENT_SKILL_USE, function (ev) {
      var detail = ev && ev.detail;
      setActiveView(doc, panels, 'chat');
      if (detail && panels.chat) {
        var ta = panels.chat.querySelector('textarea');
        if (ta && typeof detail.skillName === 'string') {
          var prompt = '/skill ' + detail.skillId;
          if (ta.value) prompt = ta.value + '\n' + prompt;
          ta.value = prompt;
          try { ta.focus(); } catch (_e) { /* ignore */ }
        }
      }
    });

    // 6/7) theme event bridge(双向) — 用 _bridged 标记防止无限循环
    addDocumentListener(EVENT_THEME_CHANGE_COLON, function (ev) {
      // 转发到 dash 命名,供 F0 监听
      var detail = ev && ev.detail;
      if (!global.document || typeof global.CustomEvent !== 'function') return;
      if (ev && ev._bridged) return; // 已桥接过,不再二次桥接
      try {
        var evt = new global.CustomEvent(EVENT_THEME_CHANGE_DASH, {
          detail: detail || {},
          bubbles: true,
          cancelable: false,
        });
        evt._bridged = true;
        global.document.dispatchEvent(evt);
      } catch (_e) { /* ignore */ }
    });
    addDocumentListener(EVENT_THEME_CHANGE_DASH, function (ev) {
      // 转发到 colon 命名
      var detail = ev && ev.detail;
      if (!global.document || typeof global.CustomEvent !== 'function') return;
      if (ev && ev._bridged) return;
      try {
        var evt = new global.CustomEvent(EVENT_THEME_CHANGE_COLON, {
          detail: detail || {},
          bubbles: true,
          cancelable: false,
        });
        evt._bridged = true;
        global.document.dispatchEvent(evt);
      } catch (_e) { /* ignore */ }
    });

    // 8) compact-request -> chatFeature 触发 compact
    addDocumentListener(EVENT_COMPACT_REQUEST, function (_ev) {
      var chatFeature = getLib('chatFeature');
      if (chatFeature && typeof chatFeature.triggerCompact === 'function') {
        try { chatFeature.triggerCompact(); } catch (_e) { /* ignore */ }
      }
      // 降级: 派发回 chat 内部监听的事件
      // chat.js 已监听 my-agent:compact-request,无需转发
    });

    // 9) menu-action -> menuFeature.runAction
    addDocumentListener(EVENT_MENU_ACTION, function (ev) {
      var detail = ev && ev.detail;
      var menuInst = state.installations.menu;
      if (menuInst && typeof menuInst.runAction === 'function' && detail) {
        try {
          menuInst.runAction({ id: String(detail.menuId || ''), label: detail.label });
        } catch (_e) { /* ignore */ }
      }
    });

    // 10) tab-change -> agentsFeature 切 tab
    addDocumentListener(EVENT_TAB_CHANGE, function (ev) {
      var detail = ev && ev.detail;
      if (!detail || typeof detail.tab !== 'string') return;
      var agentsInst = state.installations.agents;
      if (agentsInst && typeof agentsInst.setActiveTab === 'function') {
        try { agentsInst.setActiveTab(detail.tab); } catch (_e) { /* ignore */ }
      }
    });

    // 11) lang-change -> re-render 所有 view
    addDocumentListener(EVENT_LANG_CHANGE, function (_ev) {
      Object.keys(state.installations).forEach(function (key) {
        var inst = state.installations[key];
        if (inst && typeof inst.rerender === 'function') {
          try { inst.rerender(); } catch (_e) { /* ignore */ }
        }
        if (inst && typeof inst.refresh === 'function') {
          try { inst.refresh(); } catch (_e) { /* ignore */ }
        }
      });
    });

    // 12) new-session -> sessionsFeature.createSession
    addDocumentListener(EVENT_NEW_SESSION, function (_ev) {
      var sf = state.installations.sessions;
      if (sf && typeof sf.createSession === 'function') {
        try { sf.createSession(); } catch (_e) { /* ignore */ }
      }
    });
  }

  // ------------------------------------------------------------------
  // 步骤 8:监听 theme polyfill(system change -> 重新应用)
  //   shared/theme.js 内部已监听 prefers-color-scheme;
  //   此处仅触发一次重新应用(防御:防止 system polyfill 失效时遗漏)
  // ------------------------------------------------------------------

  function installSystemThemeWatch() {
    if (!global.matchMedia) return;
    var mql = global.matchMedia('(prefers-color-scheme: dark)');
    if (typeof mql.addEventListener === 'function') {
      var cb = function (_e) {
        var tm = global.MyAgent && global.MyAgent.theme;
        if (tm && typeof tm.applyTheme === 'function') {
          try { tm.applyTheme('system'); } catch (_e) { /* ignore */ }
        }
      };
      mql.addEventListener('change', cb);
      state.windowListeners.push({ type: '__mql__', listener: cb });
    }
  }

  // ------------------------------------------------------------------
  // 步骤 9:注册全站快捷键
  // ------------------------------------------------------------------

  function installKeymap() {
    var keymap = global.MyAgent && global.MyAgent.appKeymap;
    if (!keymap || typeof keymap.installKeymap !== 'function') return false;
    try {
      keymap.installKeymap();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // 步骤 10:全局错误捕获
  // ------------------------------------------------------------------

  function installErrorTrap() {
    if (!global || typeof global.addEventListener !== 'function') return;
    var onerr = function (message, source, lineno, colno, error) {
      var msg = (error && error.message) ? error.message : String(message);
      showToast('运行时错误: ' + msg, 'error');
      if (global.console && typeof global.console.error === 'function') {
        global.console.error('[app] window.onerror:', message, source, lineno, colno, error);
      }
    };
    global.addEventListener('error', onerr);
    state.windowListeners.push({ type: 'error', listener: onerr });
  }

  // ------------------------------------------------------------------
  // bootApp(options?)
  //   options 为可选覆盖,允许测试 mock DOM root / features
  //     {
  //       doc?: Document,
  //       sidebar?: HTMLElement,
  //       main?: HTMLElement,
  //       panels?: { home?, chat?, sessions?, providers?, agents?, skills?, settings? },
  //     }
  // ------------------------------------------------------------------

  function bootApp(opts) {
    if (state.booted) {
      // 幂等:teardown 后再 boot(避免重复监听)
      teardown();
    }
    opts = opts || {};
    var doc = opts.doc || global.document;
    if (!doc) {
      throw new Error('[app.bootApp] document 不可用');
    }

    // 步骤 1
    installThemeAlias();

    // 步骤 2
    ensureStateStores();

    // 步骤 3
    var sidebar = installSidebar(doc);
    var panels = opts.panels || resolvePanels(doc);
    if (opts.main && !panels.home) {
      // 用户传 main 进来但 panels 未传;尽量复用 main 内子 panel
      panels = resolvePanels(doc);
    }

    // 步骤 4/5
    installFeatures(doc, panels);

    // 步骤 6:chat lazy — 仅当 activeView === 'chat' 时
    ensureChatForActiveView(doc, panels);

    // 步骤 7
    wireEventRoutes(doc, panels);

    // 步骤 8
    installSystemThemeWatch();

    // 步骤 9
    installKeymap();

    // 步骤 10
    installErrorTrap();

    // 初始化时根据 store 里的 activeView 显示对应 panel
    var s = getLib('state');
    if (s && s.appState) {
      var initView = s.appState.get().activeView || 'main-menu';
      // 兼容:index.html 的 home panel data-panel="main-menu",我们用 'home'
      if (initView === 'main-menu') initView = 'home';
      state.lastView = initView;
      showPanel(doc, panels, initView);
    }

    state.booted = true;
    state.bootedAt = Date.now();

    return {
      booted: true,
      bootedAt: state.bootedAt,
      panels: panels,
      sidebar: sidebar ? sidebar.sidebar : null,
      chatInstalledFor: state.chatInstalledFor,
      installations: Object.keys(state.installations).slice(),
    };
  }

  // ------------------------------------------------------------------
  // teardown() — 卸载所有监听 + 卸载所有 feature
  // ------------------------------------------------------------------

  function teardown() {
    removeAllListeners();
    destroyAllInstallations();
    // 卸载 keymap
    var keymap = global.MyAgent && global.MyAgent.appKeymap;
    if (keymap && typeof keymap.uninstallKeymap === 'function') {
      try { keymap.uninstallKeymap(); } catch (_e) { /* ignore */ }
    }
    state.booted = false;
    state.bootedAt = null;
    state.lastView = null;
  }

  // ------------------------------------------------------------------
  // 暴露
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.app = {
    bootApp: bootApp,
    teardown: teardown,
    // 常量(测试可断言)
    PANELS: PANELS.slice(),
    EVENTS: {
      PANEL_CHANGE: EVENT_PANEL_CHANGE,
      SESSION_SELECT: EVENT_SESSION_SELECT,
      SESSION_DELETE: EVENT_SESSION_DELETE,
      AGENT_LAUNCH: EVENT_AGENT_LAUNCH,
      SKILL_USE: EVENT_SKILL_USE,
      THEME_CHANGE_COLON: EVENT_THEME_CHANGE_COLON,
      THEME_CHANGE_DASH: EVENT_THEME_CHANGE_DASH,
      COMPACT_REQUEST: EVENT_COMPACT_REQUEST,
      MENU_ACTION: EVENT_MENU_ACTION,
      TAB_CHANGE: EVENT_TAB_CHANGE,
      LANG_CHANGE: EVENT_LANG_CHANGE,
      NEW_SESSION: EVENT_NEW_SESSION,
    },
    // 测试钩子
    _internal: {
      state: state,
      showPanel: showPanel,
      setActiveView: setActiveView,
      setActiveSession: setActiveSession,
      installChat: installChat,
      pickSidebar: pickSidebar,
      pickMain: pickMain,
      pickPanel: pickPanel,
      installThemeAlias: installThemeAlias,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
