/**
 * features/menu.js — 主菜单 9 个 Bento Grid 菜单项（F8 / WU-05b）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.1
 *           + § 4.4.6 (IIFE 模式) + § 5.3 (Bento Grid)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 F8
 *
 * 职责（与 spec § 5.1 + plan § 6 WU-05b 对齐）:
 *   - 渲染 9 个 Bento Grid 菜单卡片（3×3 网格；CSS Grid `repeat(3, 1fr)`）
 *   - 每张卡片：图标（Lucide SVG）+ 主标题 + 描述短句 + 数字彩①-⑨
 *   - a11y：role="grid" + 每张 role="gridcell" tabindex="0" + aria-label
 *   - 键盘 Enter / Space 触发；hover/focus 高亮 + scale 动画（CSS 负责）
 *   - 与 HomePanel(WU-05a) 集成: 监听 'my-agent:menu-action' 事件, 路由
 *
 * 路由策略（每个 id → 行为；spec § 5.1）:
 *   - chat      → onNavigate({ panel: 'chat' })                          → 对话面板
 *   - sessions  → onNavigate({ panel: 'sessions' })                      → 历史会话面板
 *   - providers → onNavigate({ panel: 'providers' })                     → 提供商设置面板
 *   - agents    → onNavigate({ panel: 'agents' }) + 派发 tab-change('agents')
 *   - skills    → onNavigate({ panel: 'agents' }) + 派发 tab-change('skills')
 *   - menu      → onNavigate({ panel: 'home' })                           → 回到主菜单
 *   - theme     → 调 themeModule.applyTheme(轮转) + 派发 'my-agent-theme-change'
 *   - compact   → 派发 'my-agent:compact-request'（F11 chat.js 接管; WU-06a 实现）
 *   - settings  → onNavigate({ panel: 'settings' })                      → 设置面板
 *
 * 与其他模块的协作:
 *   - 复用 window.MyAgent.utils.el（utils.js，WU-04a）
 *   - 复用 window.MyAgent.iconHtml / hasIcon（icons.js，WU-04a；F4）
 *   - 复用 window.MyAgent.i18n.t + inline dict fallback（i18n.js，WU-04a）
 *   - 复用 window.MyAgent.themeModule.{applyTheme,getStoredTheme}
 *     （theme.js，WU-03a；F0；注意真实挂在 themeModule 不是 theme）
 *
 * 不实现:
 *   - HomePanel 占位按钮（WU-05a 已落）
 *   - 实际 chat / sessions / providers / agents / settings 面板内容（其他 WU）
 *   - compact 端点实际实现（WU-06a；本文件仅派发 'my-agent:compact-request'）
 *
 * 加载方式: <script defer> + IIFE 模式（spec § 4.4.6）。
 * 测试: test/web/features-menu.test.ts（≥ 12 用例）。
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  /** WU-05a HomePanel 派发的菜单动作事件 */
  var MENU_ACTION_EVENT = 'my-agent:menu-action';

  /** F0 / F18: 主题变更事件（theme.js init 监听; F18 /theme 派发） */
  var THEME_CHANGE_EVENT = 'my-agent-theme-change';

  /** F11 chat.js / WU-06a compact: 压缩请求事件 */
  var COMPACT_REQUEST_EVENT = 'my-agent:compact-request';

  /** AgentsPanel 切换 tab（agents / skills 共享同一 panel） */
  var TAB_CHANGE_EVENT = 'my-agent:tab-change';

  /** 主题三态轮转：dark → light → system → dark */
  var THEME_CYCLE = ['dark', 'light', 'system'];

  /** 默认主题（localStorage 缺值时） */
  var DEFAULT_THEME = 'system';

  /** 9 个菜单项（id 是稳定的内部标识；label/desc 走 i18n + inline fallback） */
  var MENU_ITEMS = [
    { id: 'chat',      icon: 'message-square', i18nKey: 'menu.chat',      fallbackZh: '开始对话',   fallbackEn: 'Chat',      descZh: '开启一段新对话',     descEn: 'Start a new conversation',      digit: 1, color: 1, route: { panel: 'chat' } },
    { id: 'sessions',  icon: 'history',        i18nKey: 'menu.sessions',  fallbackZh: '历史对话',   fallbackEn: 'Sessions',  descZh: '查看历史会话列表',   descEn: 'Browse previous sessions',       digit: 2, color: 2, route: { panel: 'sessions' } },
    { id: 'providers', icon: 'settings',       i18nKey: 'menu.providers', fallbackZh: '设置模型',   fallbackEn: 'Providers', descZh: '配置 AI 模型与 Key', descEn: 'Configure model providers',     digit: 3, color: 3, route: { panel: 'providers' } },
    { id: 'agents',    icon: 'users',          i18nKey: 'menu.agents',    fallbackZh: '子Agent管理',fallbackEn: 'Agents',    descZh: '查看并管理子Agent', descEn: 'View and manage sub-agents',     digit: 4, color: 4, route: { panel: 'agents', tab: 'agents' } },
    { id: 'skills',    icon: 'sparkles',       i18nKey: 'menu.skills',    fallbackZh: '技能',       fallbackEn: 'Skills',    descZh: '浏览可用技能',       descEn: 'Browse available skills',        digit: 5, color: 5, route: { panel: 'agents', tab: 'skills' } },
    { id: 'menu',      icon: 'zap',            i18nKey: 'menu.title',     fallbackZh: '主菜单',     fallbackEn: 'Menu',      descZh: '返回 9 项主菜单',    descEn: 'Back to the main menu',          digit: 6, color: 6, route: { panel: 'home' } },
    { id: 'theme',     icon: 'sparkles',       i18nKey: 'menu.theme',     fallbackZh: '切换主题',   fallbackEn: 'Theme',     descZh: '在深色 / 浅色 / 跟随系统间切换', descEn: 'Cycle dark / light / system', digit: 7, color: 1, route: { kind: 'theme' } },
    { id: 'compact',   icon: 'loader-2',       i18nKey: 'menu.compact',   fallbackZh: '压缩会话',   fallbackEn: 'Compact',   descZh: '压缩当前会话（即将上线）', descEn: 'Compact current session (soon)', digit: 8, color: 2, route: { kind: 'compact' } },
    { id: 'settings',  icon: 'settings',       i18nKey: 'menu.settings',  fallbackZh: '设置',       fallbackEn: 'Settings',  descZh: '通用偏好与端口信息', descEn: 'Preferences & port info',        digit: 9, color: 3, route: { panel: 'settings' } },
  ];

  /** i18n 缺键时兜底（spec § 5.1 注: 每个菜单在 zh / en 都有默认文） */
  var INLINE_DICT = {
    zh: {
      'menu.theme': '切换主题',
      'menu.compact': '压缩会话',
    },
    en: {
      'menu.theme': 'Theme',
      'menu.compact': 'Compact',
    },
  };

  // ------------------------------------------------------------------
  // 内部 helper
  // ------------------------------------------------------------------

  function noop() {}

  function getUtils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function getIcons() {
    return (global.MyAgent && global.MyAgent.icons) || null;
  }

  function getI18n() {
    return (global.MyAgent && global.MyAgent.i18n) || null;
  }

  function getThemeModule() {
    return (global.MyAgent && global.MyAgent.themeModule) || null;
  }

  function getState() {
    return (global.MyAgent && global.MyAgent.state) || null;
  }

  /**
   * 取翻译：i18n.t → INLINE_DICT[currentLang] → INLINE_DICT.zh → fallbackZh → key
   * @param {string} key
   * @param {string} fallbackZh
   * @param {string} fallbackEn
   * @returns {string}
   */
  function tr(key, fallbackZh, fallbackEn) {
    var i = getI18n();
    if (i && typeof i.t === 'function') {
      var v = i.t(key);
      // i18n.js 缺键时返回 key 本身（约定）；视为未命中
      if (typeof v === 'string' && v.length > 0 && v !== key) return v;
    }
    // 内部 inline fallback
    var lang = (i && typeof i.getLang === 'function') ? i.getLang() : 'zh';
    var dict = INLINE_DICT[lang] || INLINE_DICT.zh || {};
    if (dict[key]) return dict[key];
    if (lang === 'en' && fallbackEn) return fallbackEn;
    return fallbackZh || key;
  }

  /**
   * 派发 CustomEvent 到 document（无 CustomEvent 时降级静默）。
   * @param {string} type
   * @param {*} detail
   */
  function emit(type, detail) {
    if (typeof global.CustomEvent !== 'function') return;
    try {
      var evt = new global.CustomEvent(type, {
        detail: detail,
        bubbles: true,
        cancelable: false,
      });
      // 优先派到 document 上（HomePanel 也走 document）；找不到则派到 window
      var target = (global.document && global.document.dispatchEvent) ? global.document : global;
      target.dispatchEvent(evt);
    } catch (_e) {
      /* ignore */
    }
  }

  /**
   * 取下一个主题（dark → light → system → dark）。
   * @param {string} current
   * @returns {string}
   */
  function nextTheme(current) {
    if (!current || THEME_CYCLE.indexOf(current) < 0) return THEME_CYCLE[0];
    return THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  }

  /**
   * 取当前主题（用于 theme 轮转起算值）。
   * @returns {string}
   */
  function currentTheme() {
    var tm = getThemeModule();
    if (tm && typeof tm.getStoredTheme === 'function') {
      try {
        var t = tm.getStoredTheme();
        if (t && THEME_CYCLE.indexOf(t) >= 0) return t;
      } catch (_e) { /* fallthrough */ }
    }
    // 退化: 读 <html data-theme>
    try {
      var dt = global.document && global.document.documentElement
        ? global.document.documentElement.getAttribute('data-theme') : null;
      if (dt && THEME_CYCLE.indexOf(dt) >= 0) return dt;
    } catch (_e) { /* fallthrough */ }
    return DEFAULT_THEME;
  }

  // ------------------------------------------------------------------
  // 路由 dispatcher —— 每个菜单 id → 路由动作
  // ------------------------------------------------------------------

  /**
   * 执行一次菜单动作。
   * @param {{id:string, label?:string}} payload
   * @param {(route:object) => void} onNavigate
   */
  function runAction(payload, onNavigate) {
    if (!payload || typeof payload !== 'object') return;
    var id = String(payload.id || '');
    var item = null;
    for (var i = 0; i < MENU_ITEMS.length; i++) {
      if (MENU_ITEMS[i].id === id) { item = MENU_ITEMS[i]; break; }
    }
    if (!item) return;

    var route = item.route || {};
    if (route.kind === 'theme') {
      var cur = currentTheme();
      var next = nextTheme(cur);
      var tm = getThemeModule();
      try {
        if (tm && typeof tm.setStoredTheme === 'function') tm.setStoredTheme(next);
      } catch (_e) { /* ignore */ }
      try {
        if (tm && typeof tm.applyTheme === 'function') tm.applyTheme(next);
      } catch (_e) { /* ignore */ }
      emit(THEME_CHANGE_EVENT, { theme: next, prev: cur });
      // 同步触发 onNavigate（panel=settings; 设置面板显示新主题）
      try { if (typeof onNavigate === 'function') onNavigate({ panel: 'settings' }); } catch (_e) { /* ignore */ }
      return;
    }

    if (route.kind === 'compact') {
      emit(COMPACT_REQUEST_EVENT, { menuId: id, label: payload.label || '' });
      // 不调 onNavigate（F11 chat.js 自己监听 COMPACT_REQUEST_EVENT；WU-06a 实装）
      return;
    }

    // 普通路由：onNavigate({ panel, tab? }) + 可选 tab-change
    try {
      if (typeof onNavigate === 'function') {
        onNavigate({ panel: route.panel || 'home' });
      }
    } catch (_e) {
      /* ignore */
    }
    if (route.tab) {
      emit(TAB_CHANGE_EVENT, { tab: route.tab });
    }
  }

  // ------------------------------------------------------------------
  // installMainMenu({ container, onNavigate })
  // ------------------------------------------------------------------

  /**
   * 渲染 9 项 Bento Grid 菜单到指定容器。
   *
   * options:
   *   container   — 必填: DOM 根节点；组件在其内部构造 grid + 9 个 gridcell
   *   onNavigate  — 必填: (route) => void；route 形如 { panel, tab? }
   *                         或 { kind: 'theme' | 'compact' }（theme/compact 不走该回调）
   *
   * 行为:
   *   - 首次构造: 渲染 grid + 9 张卡片, 每张含 icon + digit + label + desc
   *   - 监听 'my-agent:menu-action' 事件: 由 HomePanel(WU-05a) 派发;
   *     menu.js 接管路由 (HomePanel 不知道具体路由, 仅发 menuId/label)
   *   - 点击卡片: 同上
   *   - 键盘 Enter / Space: 同点击
   *
   * @param {{container: HTMLElement, onNavigate?: (route:object)=>void}} options
   * @returns {{ uninstall: () => void, rerender: () => void, runAction: (payload:object) => void }}
   */
  function installMainMenu(options) {
    options = options || {};
    var container = options.container;
    var onNavigate = typeof options.onNavigate === 'function' ? options.onNavigate : noop;

    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('[installMainMenu] container 必填且必须是 HTMLElement');
    }
    var u = getUtils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[installMainMenu] window.MyAgent.utils.el 不可用');
    }

    var root = u.el('div', {
      class: 'main-menu bento-grid menu-feature-root',
      role: 'grid',
      id: 'main-menu-grid',
      'aria-label': tr('menu.title', '主菜单', 'Main Menu'),
      'aria-rowcount': '3',
      'aria-colcount': '3',
    }, []);

    // 渲染 9 张
    function renderAll() {
      // 清旧
      while (root.firstChild) root.removeChild(root.firstChild);
      MENU_ITEMS.forEach(function (item, idx) {
        var label = tr(item.i18nKey, item.fallbackZh, item.fallbackEn);
        var desc = tr(item.i18nKey + '.desc', item.descZh, item.descEn);
        var icons = getIcons();
        var iconHtml = icons && typeof icons.iconHtml === 'function'
          ? icons.iconHtml(item.icon, 24)
          : '';
        var card = u.el('button', {
          type: 'button',
          class: 'menu-card bento-card menu-color-' + item.color,
          role: 'gridcell',
          tabindex: '0',
          'data-menu-id': item.id,
          'data-color-index': String(item.color),
          'aria-label': label,
          'aria-rowindex': String(Math.floor(idx / 3) + 1),
          'aria-colindex': String((idx % 3) + 1),
        }, []);
        // 卡片内部结构: digit 圈 + 图标 + 标题 + 描述 + chevron
        var digit = u.el('span', { class: 'menu-card-digit', 'aria-hidden': 'true' }, [String(item.digit)]);
        var iconWrap = u.el('span', { class: 'menu-card-icon', 'aria-hidden': 'true' });
        // 直接 innerHTML 写入 icon（iconHtml 已 escape + 来自 ICON_PATHS，可信）
        try { iconWrap.innerHTML = iconHtml || ''; } catch (_e) { /* fallthrough */ }
        var labelEl = u.el('span', { class: 'menu-card-label' }, [label]);
        var descEl = u.el('span', { class: 'menu-card-desc' }, [desc]);
        card.appendChild(digit);
        card.appendChild(iconWrap);
        card.appendChild(labelEl);
        card.appendChild(descEl);
        root.appendChild(card);
      });
    }
    renderAll();

    // 点击事件代理（grid 上挂一个 listener；event.target.closest('[data-menu-id]')）
    function onClick(ev) {
      var target = ev && ev.target;
      // 在 fake DOM 里 ev.target 已经是 button（如果点击的是按钮）
      var btn = target && typeof target.closest === 'function'
        ? target.closest('[data-menu-id]')
        : null;
      if (!btn) {
        // fallback: 直接看 target 自身
        var mid = target && target.getAttribute && target.getAttribute('data-menu-id');
        if (mid) btn = target;
      }
      if (!btn) return;
      var id = btn.getAttribute('data-menu-id');
      var labelText = '';
      try {
        var labelEl = btn.querySelector ? btn.querySelector('.menu-card-label') : null;
        if (labelEl && typeof labelEl.textContent === 'string') labelText = labelEl.textContent;
      } catch (_e) { /* fallthrough */ }
      runAction({ id: id, label: labelText }, onNavigate);
    }

    // 键盘事件代理（Enter / Space）
    function onKeydown(ev) {
      var k = ev && ev.key;
      if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
      var target = ev && ev.target;
      var mid = target && target.getAttribute && target.getAttribute('data-menu-id');
      if (!mid) return;
      try {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      } catch (_e) { /* ignore */ }
      runAction({ id: mid }, onNavigate);
    }

    // 监听 HomePanel 派发的 menu-action 事件（在 document 上）
    function onMenuActionEvent(ev) {
      var detail = ev && ev.detail;
      if (!detail || typeof detail !== 'object') return;
      runAction({ id: String(detail.menuId || ''), label: detail.label }, onNavigate);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    if (global.document && typeof global.document.addEventListener === 'function') {
      global.document.addEventListener(MENU_ACTION_EVENT, onMenuActionEvent);
    }
    container.appendChild(root);

    return {
      /** 卸载: 清掉 document 监听（root 上的 click/keydown 由 DOM 节点摘除自动失效） */
      uninstall: function uninstall() {
        try {
          if (global.document && typeof global.document.removeEventListener === 'function') {
            global.document.removeEventListener(MENU_ACTION_EVENT, onMenuActionEvent);
          }
        } catch (_e) { /* ignore */ }
        try {
          if (root.parentNode) root.parentNode.removeChild(root);
        } catch (_e) { /* ignore */ }
      },
      /** 重渲染（i18n.setLang 后调用） */
      rerender: function rerender() {
        renderAll();
      },
      /** 直接触发一个菜单动作（供 app.js / 测试用） */
      runAction: function runActionPub(payload) {
        runAction(payload, onNavigate);
      },
      /** 暴露给单测的 root（不依赖 IIFE 内部） */
      root: root,
    };
  }

  // ------------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.menuFeature = {
    installMainMenu: installMainMenu,
    /** 派发事件名常量（供测试 / 其他模块订阅） */
    MENU_ACTION_EVENT: MENU_ACTION_EVENT,
    THEME_CHANGE_EVENT: THEME_CHANGE_EVENT,
    COMPACT_REQUEST_EVENT: COMPACT_REQUEST_EVENT,
    TAB_CHANGE_EVENT: TAB_CHANGE_EVENT,
    /** 9 项菜单元数据（测试断言 + 文档） */
    MENU_ITEMS: MENU_ITEMS.slice(),
    /** 内部 helper（供单测断言） */
    _nextTheme: nextTheme,
    _currentTheme: currentTheme,
    _runAction: runAction,
    _INLINE_DICT: INLINE_DICT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);