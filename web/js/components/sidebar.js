/**
 * sidebar.js — 左侧主导航（spec § 5.2 / F7 / WU-05a）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Sidebar。
 * - 视觉构造走 window.MyAgent.utils.el()（防 XSS）。
 * - 装饰性图标用 window.MyAgent.icons.iconHtml(name)。
 *
 * 职责（spec § 5.2 + accessibility-checklist § Essential Checks）：
 *   - logo + 5 个主导航按钮 + 新建会话按钮 + session list 容器 + 设置入口
 *   - session list 通过 subscribe('sessionListState', listener) 自动刷新
 *   - 新建会话：派发 CustomEvent 'my-agent:new-session'
 *   - 切 panel：派发 CustomEvent 'my-agent:panel-change' + detail: { panel }
 *   - 选中 session：派发 CustomEvent 'my-agent:session-select' + detail: { sessionId }
 *   - 键盘可达：Tab + Enter + Space
 *
 * 暴露的实例 API：
 *   - sidebar.el        —— 构造好的 <aside> DOM 节点
 *   - sidebar.destroy() —— 解除所有内部 listener（idempotent）
 *
 * 构造选项 options：
 *   {
 *     onPanelChange?:  (panel: string) => void,   // 可选回调（同时也会派发 CustomEvent）
 *     onSessionSelect?:(sessionId: string) => void,
 *     className?:      string,
 *     id?:             string,
 *   }
 */
(function (global) {
  'use strict';

  /** 5 个主导航面板 ID（与 panels.js 面板构造器一一对应）。 */
  var NAV_PANELS = ['home', 'chat', 'sessions', 'providers', 'agents'];

  /** 主导航按钮的 label / icon / 默认 aria-label（i18n 不参与时直接用此 fallback）。 */
  var NAV_ITEMS = [
    { panel: 'home',      icon: 'sparkles',       label: '主菜单' },
    { panel: 'chat',      icon: 'message-square', label: '对话' },
    { panel: 'sessions',  icon: 'history',        label: '历史会话' },
    { panel: 'providers', icon: 'zap',            label: '提供商' },
    { panel: 'agents',    icon: 'users',          label: '子 Agent' },
  ];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function icons() {
    return global.MyAgent && global.MyAgent.icons;
  }

  function storeLib() {
    return global.MyAgent && global.MyAgent.state;
  }

  function genId(prefix) {
    return (
      (prefix || 'sidebar') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  /**
   * 把 SVG 字符串包成一个真实的 DOM 节点（与 button.js svgFragment 同模式；
   * icons.js 输出是受控的 SVG 字符串，无 XSS 风险）。
   * @param {string} svgHtml
   * @param {string} [className]
   * @returns {HTMLElement}
   */
  function svgFragment(svgHtml, className) {
    if (!svgHtml) return null;
    var wrap = document.createElement('span');
    wrap.className = className || 'sidebar-icon-slot';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = svgHtml; // eslint-disable-line no-unsanitized
    return wrap;
  }

  /**
   * 安全派发 CustomEvent —— 统一使用 'my-agent:' 前缀（与 spec § 4.4.6 一致）。
   * @param {HTMLElement} target
   * @param {string} eventName
   * @param {object} [detail]
   */
  function emit(target, eventName, detail) {
    var evt;
    try {
      evt = new global.CustomEvent(eventName, {
        bubbles: true,
        cancelable: true,
        detail: detail || {},
      });
    } catch (_e) {
      // 旧环境不支持 CustomEvent 构造器 —— 退化路径（少见）
      evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(eventName, true, true, detail || {});
    }
    target.dispatchEvent(evt);
  }

  /**
   * 构造一个 Sidebar 实例。
   * @param {object} [options]
   * @returns {{ el: HTMLElement, destroy: () => void }}
   */
  function Sidebar(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Sidebar] window.MyAgent.utils.el 不可用；请确认 utils.js 已先加载');
    }

    var onPanelChange = typeof options.onPanelChange === 'function' ? options.onPanelChange : null;
    var onSessionSelect = typeof options.onSessionSelect === 'function' ? options.onSessionSelect : null;
    var rootId = options.id ? String(options.id) : genId('sidebar');
    var extraClass = options.className ? String(options.className) : '';

    // ── 销毁跟踪
    var destroyed = false;
    var offFns = [];

    // ── logo（h1 语义：站点名 / 应用名；aria-label 描述性）
    var iconLib = icons();
    var logoIconSlot = null;
    if (iconLib && typeof iconLib.iconHtml === 'function') {
      logoIconSlot = svgFragment(iconLib.iconHtml('sparkles', 20), 'sidebar-logo-icon');
    }
    var logoChildren = [];
    if (logoIconSlot) logoChildren.push(logoIconSlot);
    logoChildren.push('my-agent');
    var logo = u.el(
      'h1',
      { class: 'sidebar-logo', 'aria-label': 'my-agent 控制台' },
      logoChildren
    );

    // ── 主导航（role=navigation + aria-label="主导航"）
    var navButtons = []; // { panel, btn, label }
    var navChildren = [];
    NAV_ITEMS.forEach(function (item) {
      var btnIcon = null;
      if (iconLib && typeof iconLib.iconHtml === 'function') {
        btnIcon = svgFragment(iconLib.iconHtml(item.icon, 16), 'sidebar-nav-icon');
      }
      var btnChildren = [];
      if (btnIcon) btnChildren.push(btnIcon);
      btnChildren.push(String(item.label));

      var btnId = rootId + '-nav-' + item.panel;
      var btn = u.el(
        'button',
        {
          type: 'button',
          class: 'sidebar-nav-btn',
          id: btnId,
          role: 'tab',
          'aria-label': String(item.label),
          tabindex: '0',
        },
        btnChildren
      );
      navButtons.push({ panel: item.panel, btn: btn, label: item.label });
      navChildren.push(btn);
    });
    var nav = u.el(
      'nav',
      { class: 'sidebar-primary', role: 'navigation', 'aria-label': '主导航' },
      navChildren
    );

    // ── session list 区域
    var sessionListTitleId = rootId + '-sessions-title';
    var sessionListTitle = u.el(
      'h2',
      { class: 'sidebar-section-title', id: sessionListTitleId },
      ['会话']
    );
    var sessionList = u.el('ul', {
      class: 'sidebar-session-list',
      role: 'list',
      id: rootId + '-sessions',
      'aria-labelledby': sessionListTitleId,
    });
    // 空状态占位 —— 真实数据由 sessions.js / features 注入
    var sessionEmpty = u.el('li', {
      class: 'sidebar-session-empty',
      role: 'presentation',
    }, ['暂无会话']);
    sessionList.appendChild(sessionEmpty);

    var newSessionBtnIcon = null;
    if (iconLib && typeof iconLib.iconHtml === 'function') {
      newSessionBtnIcon = svgFragment(iconLib.iconHtml('plus', 14), 'sidebar-new-session-icon');
    }
    var newSessionChildren = [];
    if (newSessionBtnIcon) newSessionChildren.push(newSessionBtnIcon);
    newSessionChildren.push('新会话');
    var newSessionBtn = u.el(
      'button',
      {
        type: 'button',
        class: 'sidebar-new-session',
        id: rootId + '-new-session',
        'aria-label': '新建会话',
        tabindex: '0',
      },
      newSessionChildren
    );

    var sessionsSection = u.el(
      'section',
      { class: 'sidebar-sessions', 'aria-label': '会话列表' },
      [sessionListTitle, sessionList, newSessionBtn]
    );

    // ── footer（设置入口 + 退出占位）
    var settingsIcon = null;
    if (iconLib && typeof iconLib.iconHtml === 'function') {
      settingsIcon = svgFragment(iconLib.iconHtml('settings', 14), 'sidebar-settings-icon');
    }
    var settingsChildren = [];
    if (settingsIcon) settingsChildren.push(settingsIcon);
    settingsChildren.push('设置');
    var settingsBtn = u.el(
      'button',
      {
        type: 'button',
        class: 'sidebar-settings-link',
        id: rootId + '-settings',
        'aria-label': '打开设置',
        tabindex: '0',
      },
      settingsChildren
    );
    var footer = u.el(
      'div',
      { class: 'sidebar-footer', role: 'contentinfo' },
      [settingsBtn]
    );

    // ── 根 aside（role=complementary —— 与 index.html 现有 sidebar 一致；
    //   这里同时挂 role=navigation 的内部 nav；WAI-ARIA 允许嵌套）
    var rootClasses = ['app-sidebar', 'sidebar'];
    if (extraClass) rootClasses.push(extraClass);
    var root = u.el(
      'aside',
      {
        class: rootClasses.join(' '),
        id: rootId,
        role: 'complementary',
        'aria-label': '侧边栏',
      },
      [logo, nav, sessionsSection, footer]
    );

    // ─────────────────────────────
    // 行为：派发 CustomEvent + 调用可选 callback
    // ─────────────────────────────

    function changePanel(panel) {
      if (NAV_PANELS.indexOf(panel) < 0) return; // 拒绝非法 panel
      // aria-selected 同步
      navButtons.forEach(function (b) {
        b.btn.setAttribute('aria-selected', b.panel === panel ? 'true' : 'false');
      });
      try {
        if (onPanelChange) onPanelChange(panel);
      } catch (err) {
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('[Sidebar] onPanelChange 抛错:', err);
        }
      }
      emit(root, 'my-agent:panel-change', { panel: panel });
    }

    function selectSession(sessionId) {
      if (!sessionId || typeof sessionId !== 'string') return;
      try {
        if (onSessionSelect) onSessionSelect(sessionId);
      } catch (err) {
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('[Sidebar] onSessionSelect 抛错:', err);
        }
      }
      emit(root, 'my-agent:session-select', { sessionId: sessionId });
    }

    function triggerNewSession() {
      emit(root, 'my-agent:new-session', {});
    }

    // ── 主导航按钮 click + keyboard
    navButtons.forEach(function (b) {
      b.btn.addEventListener('click', function () {
        changePanel(b.panel);
      });
      b.btn.addEventListener('keydown', function (ev) {
        var k = ev.key;
        if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
          ev.preventDefault();
          changePanel(b.panel);
        }
      });
    });

    // ── 新建会话按钮 click + keyboard
    newSessionBtn.addEventListener('click', function () {
      triggerNewSession();
    });
    newSessionBtn.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        ev.preventDefault();
        triggerNewSession();
      }
    });

    // ── session list 委托：点击 <li data-session-id="..."> → selectSession
    var sessionListClick = function (ev) {
      var t = ev.target;
      while (t && t !== sessionList) {
        if (t.nodeType === 1) {
          var sid = t.getAttribute && t.getAttribute('data-session-id');
          if (sid) {
            selectSession(sid);
            return;
          }
        }
        t = t.parentNode;
      }
    };
    sessionList.addEventListener('click', sessionListClick);
    offFns.push(function () {
      sessionList.removeEventListener('click', sessionListClick);
    });

    // ─────────────────────────────
    // session list 订阅 sessionListState
    // ─────────────────────────────

    function renderSessionList(state) {
      // 清空（保留空状态节点占位由「暂无会话」文本节点处理）
      while (sessionList.firstChild) {
        sessionList.removeChild(sessionList.firstChild);
      }
      var sessions = state && Array.isArray(state.sessions) ? state.sessions : [];
      if (sessions.length === 0) {
        sessionList.appendChild(sessionEmpty);
        return;
      }
      sessions.forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        var sid = s.id != null ? String(s.id) : '';
        if (!sid) return;
        var name = s.name != null ? String(s.name) : sid;
        var li = u.el('li', {
          class: 'sidebar-session-item',
          role: 'listitem',
          tabindex: '0',
          'data-session-id': sid,
          'aria-label': '会话：' + name,
        }, [name]);
        sessionList.appendChild(li);
      });
    }

    // 订阅 sessionListState —— 若 state 尚未加载则不订阅（不抛错）
    var unsubscribe = null;
    var stateApi = storeLib();
    if (stateApi && typeof stateApi.getStore === 'function') {
      var store = stateApi.getStore('sessionListState');
      if (store && typeof store.subscribe === 'function') {
        unsubscribe = store.subscribe(function (next, _prev) {
          try {
            renderSessionList(next);
          } catch (err) {
            if (global.console && typeof global.console.error === 'function') {
              global.console.error('[Sidebar] render sessionList 抛错:', err);
            }
          }
        });
        // 初次同步当前值
        try {
          renderSessionList(store.get());
        } catch (_e) {
          /* 静默 */
        }
      }
    }

    // ─────────────────────────────
    // 销毁
    // ─────────────────────────────

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      // 解除 subscribe
      if (typeof unsubscribe === 'function') {
        try { unsubscribe(); } catch (_e) { /* 静默 */ }
      }
      // 解除其它显式 listener
      for (var i = 0; i < offFns.length; i++) {
        try { offFns[i](); } catch (_e) { /* 静默 */ }
      }
      offFns = [];
      // 摘除节点
      if (root.parentNode) {
        root.parentNode.removeChild(root);
      }
    }

    return { el: root, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Sidebar = Sidebar;
  // 暴露面板 ID 列表 —— 供 panels.js / app.js 校验一致性
  global.MyAgent.components.Sidebar.NAV_PANELS = NAV_PANELS.slice();
})(typeof globalThis !== 'undefined' ? globalThis : this);
