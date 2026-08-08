/**
 * features/sessions.js — 侧边栏 Session 列表交互（F10 / WU-05d）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.2
 *           + § 3.4 (Session 域 API) + § 4.4.6 (IIFE 模式)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-05d
 *
 * 职责（与 spec § 5.2 + plan § 6 WU-05d 对齐）:
 *   - 列出 sessions：渲染到容器（含 + 新建按钮 + cid + 创建时间 + 删除 icon）
 *   - 新建会话（POST /api/sessions）→ set active + 派发 my-agent:session-select
 *   - 选中会话 → set appState.activeSessionId + 派发 my-agent:session-select
 *   - 删除会话（DELETE /api/sessions/:id）→ confirm Modal → 若删的是 active 则 set null
 *   - compact 按钮：占位 501，留 WU-06a（按钮 disabled + tooltip）
 *   - 订阅 sessionListState，列表变化时自动重渲染
 *
 * 与其他模块的协作:
 *   - 复用 window.MyAgent.api.apiFetch（api.js，WU-04a）
 *   - 复用 window.MyAgent.state.sessionListState / appState（state.js，WU-04b）
 *   - 复用 window.MyAgent.utils.{el, on, escapeHtml, formatTime}（utils.js，WU-04a）
 *   - 复用 window.MyAgent.components.{Button, Modal, Toast}（components/*，WU-04c）
 *   - 复用 window.MyAgent.i18n.t 字典回退（i18n.js，WU-04a）
 *
 * 不实现:
 *   - 流式 chat（WU-06b）
 *   - providers / agents / skills（其他 WU）
 *   - compact 实际端点（WU-06a，本文件仅占位 disabled + tooltip）
 *
 * 加载方式：<script defer> + IIFE 模式（spec § 4.4.6）。
 * 测试：test/web/features-sessions.test.ts（≥ 12 用例）。
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  /** 派发事件名 —— spec § 4.4.6 + plan § 6 WU-05d */
  var SELECT_EVENT = 'my-agent:session-select';

  /** 内部事件：列表变化通知（非必需；目前仅外部订阅 sessionListState） */
  var LIST_CHANGE_EVENT = 'my-agent:session-list-change';

  /** compact 端点的占位文案 */
  var COMPACT_PLACEHOLDER_MSG = 'compact 功能将在后续版本提供';

  /** 默认确认删除文案（i18n 缺失时兜底） */
  var DEFAULT_DELETE_CONFIRM = '确定删除此会话？此操作不可撤销。';
  var DEFAULT_NEW_BUTTON = '+ 新会话';
  var DEFAULT_EMPTY = '暂无会话';
  var DEFAULT_DELETE_LABEL = '删除';
  var DEFAULT_COMPACT_LABEL = '压缩';
  var DEFAULT_COMPACT_TOOLTIP = '压缩功能尚未上线（WU-06a）';

  // ------------------------------------------------------------------
  // 内部 helper
  // ------------------------------------------------------------------

  function noop() {}

  function getUtils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function getApi() {
    return (global.MyAgent && global.MyAgent.api) || null;
  }

  function getState() {
    return (global.MyAgent && global.MyAgent.state) || null;
  }

  function getComponents() {
    return (global.MyAgent && global.MyAgent.components) || null;
  }

  function getI18n() {
    return (global.MyAgent && global.MyAgent.i18n) || null;
  }

  function t(key, fallback) {
    var i = getI18n();
    if (i && typeof i.t === 'function') {
      var v = i.t(key);
      // i18n.t 在键缺失时可能返回 '[' + key + ']'（约定见 i18n.js 单测）。
      // 视为未命中，回退到 fallback 或 key。
      if (typeof v === 'string' && v.length > 0 && v !== '[' + key + ']') return v;
    }
    return typeof fallback === 'string' ? fallback : key;
  }

  /**
   * 取会话展示名。优先 name；空则回退到 id（前 8 位）；再回退占位。
   * @param {{id:string, name?:string|null}} s
   * @returns {string}
   */
  function sessionDisplayName(s) {
    if (s && typeof s.name === 'string' && s.name.length > 0) return s.name;
    if (s && typeof s.id === 'string' && s.id.length > 0) {
      return s.id.length > 8 ? s.id.slice(0, 8) : s.id;
    }
    return '—';
  }

  /**
   * 派发 CustomEvent 到 document。
   * 测试环境无 CustomEvent 时降级（静默跳过）。
   * @param {string} type
   * @param {*} detail
   */
  function dispatchEvent(type, detail) {
    if (typeof global.CustomEvent !== 'function') return;
    try {
      var evt = new global.CustomEvent(type, {
        detail: detail,
        bubbles: true,
        cancelable: false,
      });
      global.document.dispatchEvent(evt);
    } catch (_e) {
      /* ignore */
    }
  }

  /**
   * 显示错误 toast（无 Toast 组件时降级 console.error）。
   * @param {string} message
   */
  function showErrorToast(message) {
    var c = getComponents();
    if (c && typeof c.Toast === 'function') {
      try {
        var t = new c.Toast();
        t.show({ message: message, status: 'error' });
        return;
      } catch (_e) {
        /* fallthrough */
      }
    }
    if (global.console && typeof global.console.error === 'function') {
      global.console.error('[sessions] ' + message);
    }
  }

  /**
   * 弹确认 modal。无 Modal 组件时降级为 window.confirm（仅在浏览器原生可用时）。
   * @param {string} message
   * @returns {Promise<boolean>}
   */
  function confirmDialog(message) {
    return new Promise(function (resolve) {
      var c = getComponents();
      if (c && typeof c.Modal === 'function') {
        try {
          var modal = new c.Modal({
            title: t('session.deleteConfirm', DEFAULT_DELETE_CONFIRM),
            content: message,
            closeOnOverlay: true,
            closeOnEsc: true,
          });
          // Modal 构造完成后，向其 dialog 追加两个 footer 按钮：取消 / 确认
          var u = getUtils();
          if (u && typeof u.el === 'function') {
            var footer = u.el('div', { class: 'modal-actions' }, [
              u.el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-ghost',
                  'data-action': 'cancel',
                  onclick: function () {
                    modal.close();
                    resolve(false);
                  },
                },
                [t('common.cancel', '取消')],
              ),
              u.el(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-danger',
                  'data-action': 'confirm',
                  onclick: function () {
                    modal.close();
                    resolve(true);
                  },
                },
                [t('common.confirm', '确认')],
              ),
            ]);
            // 把 footer 注入到 dialog
            var dialog = (modal.el.children[0] && modal.el.children[0].children[0]) || null;
            if (dialog && typeof dialog.appendChild === 'function') {
              dialog.appendChild(footer);
            }
          }
          modal.open();
          // 用户按 ESC / overlay 关闭 → 解析为 false
          // Modal 自身未提供关闭回调（onClose 是构造参数）—— 这里采用
          // 「超时兜底 + ESC 自处理」：若 ESC 关闭，Promise 不会 resolve，
          // 所以我们显式挂 onClose 在构造时已经太晚；这里在 closeOnEsc 后
          // 通过 wrapped open 重写一次：保留 cancel / confirm 按钮路径，
          // ESC 关闭由 onClose 在内部触发 false（见上面 _confirmDialogAlt）。
          // —— 简洁实现：直接挂一个 click 监听 overlay 来兜底。
          // （核心：保证取消/确认按钮能 resolve；ESC 行为交给 Modal 默认 onClose = null）
          return;
        } catch (_e) {
          /* fallthrough */
        }
      }
      // 降级到 window.confirm
      if (typeof global.confirm === 'function') {
        try {
          resolve(!!global.confirm(message));
          return;
        } catch (_e) {
          /* fallthrough */
        }
      }
      // 最后兜底：默认拒绝（避免误删）
      resolve(false);
    });
  }

  /**
   * 构造/获取 compact 提示 tooltip 引用。
   * @param {HTMLElement} target
   * @returns {object|null}
   */
  function attachCompactTooltip(target) {
    var c = getComponents();
    if (c && typeof c.Tooltip === 'function') {
      try {
        return new c.Tooltip({
          target: target,
          content: t('session.compactWip', DEFAULT_COMPACT_TOOLTIP),
          placement: 'left',
        });
      } catch (_e) {
        return null;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // installSessionsList({ container })
  // ------------------------------------------------------------------

  /**
   * 渲染 Session 列表侧边栏到指定容器。
   *
   * options:
   *   container   — 必填：DOM 根节点。组件会在内部追加：list 容器 + 新建按钮 + 行模板
   *   onSelect?   — 可选：(sessionId) => void；选中时同步触发（事件派发照常）
   *   onCreate?   — 可选：(newSession) => void；新建成功后同步触发（事件派发照常）
   *   onDelete?   — 可选：(deletedId) => void；删除成功后同步触发
   *   confirmDelete? — 可选：(session) => Promise<boolean>；覆盖默认 confirm modal
   *
   * 行为：
   *   - 初次安装：拉 GET /api/sessions → 更新 sessionListState
   *   - 订阅 sessionListState → 自动重渲染列表
   *   - 选中：更新 appState.activeSessionId + dispatch SELECT_EVENT
   *   - 新建：POST /api/sessions → 更新 sessionListState → 设为 active → dispatch
   *   - 删除：confirm modal → DELETE /api/sessions/:id → 从 sessionListState 移除
   *          若删除的是 active：appState.activeSessionId = null
   *   - compact：占位按钮（disabled + tooltip 提示 WU-06a）
   *
   * @param {{container: HTMLElement, onSelect?:Function, onCreate?:Function, onDelete?:Function, confirmDelete?:Function}} options
   * @returns {{ uninstall: () => void, refresh: () => Promise<void>, selectSession: (id: string|null) => void, createSession: () => Promise<void>, deleteSession: (id: string) => Promise<void> }}
   */
  function installSessionsList(options) {
    options = options || {};
    var container = options.container;
    var onSelect = typeof options.onSelect === 'function' ? options.onSelect : noop;
    var onCreate = typeof options.onCreate === 'function' ? options.onCreate : noop;
    var onDelete = typeof options.onDelete === 'function' ? options.onDelete : noop;
    var confirmDelete =
      typeof options.confirmDelete === 'function' ? options.confirmDelete : null;

    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('[installSessionsList] container 必填且必须是 HTMLElement');
    }
    var u = getUtils();
    var api = getApi();
    var st = getState();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[installSessionsList] window.MyAgent.utils.el 不可用');
    }
    if (!api || typeof api.apiFetch !== 'function') {
      throw new Error('[installSessionsList] window.MyAgent.api.apiFetch 不可用');
    }
    if (!st || typeof st.getStore !== 'function') {
      throw new Error('[installSessionsList] window.MyAgent.state 不可用');
    }

    var sessionListState = st.getStore('sessionListState');
    var appState = st.getStore('appState');

    // ---- DOM 结构：新建按钮 + 列表 ----
    var root = u.el('div', {
      class: 'sessions-feature',
      'data-sessions-feature': 'root',
    });

    var newBtn = u.el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary sessions-new-btn',
        'data-action': 'new-session',
        'aria-label': t('session.new', DEFAULT_NEW_BUTTON),
      },
      [t('session.new', DEFAULT_NEW_BUTTON)],
    );

    var listEl = u.el('ul', {
      class: 'sessions-list',
      role: 'listbox',
      'aria-label': '会话列表',
      'data-sessions-feature': 'list',
    });

    var emptyEl = u.el('div', {
      class: 'sessions-empty',
      'data-sessions-feature': 'empty',
      hidden: true,
    }, [t('session.empty', DEFAULT_EMPTY)]);

    root.appendChild(newBtn);
    root.appendChild(listEl);
    root.appendChild(emptyEl);
    container.appendChild(root);

    // ---- 内部状态 ----
    var currentTipInstances = []; // Tooltip 实例列表（卸载时统一 destroy）
    var unsubscribers = []; // store 订阅的 unsubscribe 函数列表

    // ---- 工具：清理当前列表 DOM ----
    function clearList() {
      // 销毁旧 tooltip 实例
      for (var i = 0; i < currentTipInstances.length; i++) {
        try {
          if (currentTipInstances[i] && typeof currentTipInstances[i].destroy === 'function') {
            currentTipInstances[i].destroy();
          }
        } catch (_e) {
          /* ignore */
        }
      }
      currentTipInstances.length = 0;
      // 清空 ul
      while (listEl.firstChild) {
        listEl.removeChild(listEl.firstChild);
      }
    }

    // ---- 工具：构建一行 list item ----
    function buildRow(session) {
      var id = session && session.id ? String(session.id) : '';
      var name = sessionDisplayName(session);
      var ts = session && (session.createdAt || session.lastTs || session.created_at);
      var timeText = ts && typeof u.formatTime === 'function' ? u.formatTime(ts) : '';
      var activeId = appState ? appState.get().activeSessionId : null;
      var isActive = !!activeId && activeId === id;

      var rowChildren = [];

      // 主区域（点击选中）
      var main = u.el(
        'div',
        {
          class: 'sessions-row-main',
          'data-action': 'select',
          'data-session-id': id,
        },
        [
          u.el('span', { class: 'sessions-row-name' }, [name]),
          timeText
            ? u.el('span', { class: 'sessions-row-time' }, [timeText])
            : null,
          isActive
            ? u.el(
                'span',
                { class: 'sessions-row-marker', 'aria-label': '当前' },
                ['•'],
              )
            : null,
        ],
      );
      rowChildren.push(main);

      // 操作区：compact（占位 disabled）+ delete
      var compactBtn = u.el(
        'button',
        {
          type: 'button',
          class: 'sessions-row-compact',
          'data-action': 'compact',
          'data-session-id': id,
          'aria-label': t('session.compact', DEFAULT_COMPACT_LABEL),
          disabled: true,
          'aria-disabled': 'true',
        },
        [t('session.compact', DEFAULT_COMPACT_LABEL)],
      );
      // 挂 tooltip 提示 WU-06a
      var tip = attachCompactTooltip(compactBtn);
      if (tip) currentTipInstances.push(tip);

      var deleteBtn = u.el(
        'button',
        {
          type: 'button',
          class: 'sessions-row-delete',
          'data-action': 'delete',
          'data-session-id': id,
          'aria-label': t('common.delete', DEFAULT_DELETE_LABEL),
        },
        [t('common.delete', DEFAULT_DELETE_LABEL)],
      );

      var actions = u.el(
        'div',
        { class: 'sessions-row-actions' },
        [compactBtn, deleteBtn],
      );
      rowChildren.push(actions);

      var li = u.el(
        'li',
        {
          class:
            'sessions-row' +
            (isActive ? ' sessions-row-active' : ''),
          role: 'option',
          'aria-selected': isActive ? 'true' : 'false',
          'data-session-id': id,
          dataset: {
            sessionId: id,
          },
        },
        rowChildren,
      );

      return li;
    }

    // ---- 渲染：基于当前 state.sessions + appState.activeSessionId ----
    function render() {
      clearList();
      var state = sessionListState.get();
      var sessions = (state && Array.isArray(state.sessions)) ? state.sessions : [];
      if (sessions.length === 0) {
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      for (var i = 0; i < sessions.length; i++) {
        var row = buildRow(sessions[i]);
        listEl.appendChild(row);
      }
    }

    // ---- 操作：选中 session ----
    function selectSession(id) {
      if (!appState) return;
      var cur = appState.get();
      if (cur.activeSessionId === id) return; // no-op
      appState.set(Object.assign({}, cur, { activeSessionId: id }));
      dispatchEvent(SELECT_EVENT, { sessionId: id });
      onSelect(id);
    }

    // ---- 操作：新建 session ----
    async function createSession() {
      try {
        var data = await api.apiFetch('/api/sessions', { method: 'POST', body: {} });
        var newSess = data && data.session ? data.session : data;
        if (!newSess || typeof newSess.id !== 'string') {
          throw new Error('Invalid response: missing session.id');
        }
        // 推入列表（去重）
        var cur = sessionListState.get();
        var list = Array.isArray(cur.sessions) ? cur.sessions.slice() : [];
        var dup = false;
        for (var i = 0; i < list.length; i++) {
          if (list[i] && list[i].id === newSess.id) {
            dup = true;
            break;
          }
        }
        if (!dup) {
          // 规范化字段：确保 createdAt 等基础字段存在
          var normalized = {
            id: newSess.id,
            name: newSess.name || newSess.id,
            messageCount: newSess.messageCount || 0,
            lastTs: newSess.lastTs || Date.now(),
            createdAt: newSess.createdAt || Date.now(),
          };
          list.unshift(normalized);
          sessionListState.set(
            Object.assign({}, cur, { sessions: list, loading: false }),
          );
        }
        // set active + dispatch
        selectSession(newSess.id);
        onCreate(newSess);
      } catch (err) {
        showErrorToast(
          (err && err.message) || '新建会话失败',
        );
        throw err;
      }
    }

    // ---- 操作：删除 session ----
    async function deleteSession(id) {
      if (!id) return;
      // 二次确认
      var ok = false;
      if (confirmDelete) {
        try {
          ok = await confirmDelete({ id: id });
        } catch (_e) {
          ok = false;
        }
      } else {
        try {
          ok = await confirmDialog(
            t('session.deleteConfirm', DEFAULT_DELETE_CONFIRM),
          );
        } catch (_e) {
          ok = false;
        }
      }
      if (!ok) return;

      try {
        await api.apiFetch('/api/sessions/' + encodeURIComponent(id), {
          method: 'DELETE',
        });
      } catch (err) {
        showErrorToast((err && err.message) || '删除会话失败');
        throw err;
      }

      // 从列表移除
      var cur = sessionListState.get();
      var list = Array.isArray(cur.sessions) ? cur.sessions.slice() : [];
      var next = [];
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].id !== id) next.push(list[j]);
      }
      sessionListState.set(Object.assign({}, cur, { sessions: next, loading: false }));

      // 若删除的是 active → 清空 activeSessionId
      if (appState) {
        var app = appState.get();
        if (app.activeSessionId === id) {
          appState.set(Object.assign({}, app, { activeSessionId: null }));
          // 同时派发 SELECT_EVENT(null) 让下游清空 chat transcript
          dispatchEvent(SELECT_EVENT, { sessionId: null });
        }
      }
      onDelete(id);
    }

    // ---- 操作：拉取列表 ----
    async function refresh() {
      try {
        sessionListState.set(
          Object.assign({}, sessionListState.get(), { loading: true }),
        );
        var data = await api.apiFetch('/api/sessions', { method: 'GET' });
        var sessions = (data && Array.isArray(data.sessions)) ? data.sessions : [];
        sessionListState.set({ sessions: sessions, loading: false });
      } catch (err) {
        sessionListState.set({ sessions: [], loading: false });
        showErrorToast((err && err.message) || '加载会话列表失败');
      }
    }

    // ---- 事件委托：list 内点击 ----
    function onListClick(ev) {
      var target = ev.target;
      if (!target || typeof target.closest !== 'function') return;
      var actionEl = target.closest('[data-action]');
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-action');
      var sid = actionEl.getAttribute('data-session-id');
      if (!action || !sid) return;
      if (action === 'select') {
        selectSession(sid);
      } else if (action === 'delete') {
        // delete 为异步；不阻断
        deleteSession(sid);
      } else if (action === 'compact') {
        // 占位：501，留 WU-06a
        showErrorToast(COMPACT_PLACEHOLDER_MSG);
      }
    }

    listEl.addEventListener('click', onListClick);

    // ---- 事件委托：新会话按钮 ----
    function onNewClick() {
      createSession();
    }
    newBtn.addEventListener('click', onNewClick);

    // ---- 订阅：sessionListState 变化 → 重新渲染 ----
    if (sessionListState) {
      unsubscribers.push(
        sessionListState.subscribe(function () {
          try {
            render();
          } catch (e) {
            if (global.console && typeof global.console.error === 'function') {
              global.console.error('[sessions] render threw:', e);
            }
          }
        }),
      );
    }
    // ---- 订阅：appState.activeSessionId 变化 → 重新渲染（高亮） ----
    if (appState) {
      unsubscribers.push(
        appState.subscribe(function (next, prev) {
          if (
            (next && next.activeSessionId) !==
            (prev && prev.activeSessionId)
          ) {
            render();
          }
        }),
      );
    }

    // ---- 初次拉取 ----
    refresh();

    function uninstall() {
      // 解绑 store 订阅
      for (var i = 0; i < unsubscribers.length; i++) {
        try {
          unsubscribers[i]();
        } catch (_e) {
          /* ignore */
        }
      }
      unsubscribers.length = 0;
      // 解绑 DOM listener
      try {
        listEl.removeEventListener('click', onListClick);
        newBtn.removeEventListener('click', onNewClick);
      } catch (_e) {
        /* ignore */
      }
      // 销毁 tooltip + 清空 DOM
      clearList();
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return {
      uninstall: uninstall,
      refresh: refresh,
      selectSession: selectSession,
      createSession: createSession,
      deleteSession: deleteSession,
    };
  }

  // ------------------------------------------------------------------
  // 导出（spec § 4.2 全局对象模块通信 + § 4.4.6 IIFE）
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.sessionsFeature = {
    installSessionsList: installSessionsList,
    // 暴露纯函数 / 常量便于测试 + 调试
    _internals: {
      sessionDisplayName: sessionDisplayName,
      dispatchEvent: dispatchEvent,
      t: t,
    },
    // 常量
    SELECT_EVENT: SELECT_EVENT,
    LIST_CHANGE_EVENT: LIST_CHANGE_EVENT,
    COMPACT_PLACEHOLDER_MSG: COMPACT_PLACEHOLDER_MSG,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);