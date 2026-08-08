/**
 * app.keymap.js — 全站键盘快捷键（F16 / WU-06c）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.7
 *           + § 4.4.6 (IIFE 模式) + § 4.3 (零运行时依赖)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-06c
 *
 * 职责:
 *   - 注册全站 keydown / keyup 监听到 document
 *   - 在 <input> / <textarea> 内禁用非 Enter/Esc 快捷键(spec § 5.7 末段)
 *   - 提供 installKeymap / uninstallKeymap / setBindings 三个 API
 *
 * 快捷键(与 spec § 5.7 + WU-06c 描述对齐):
 *   - Cmd/Ctrl + K       — 打开命令面板(F18 留白时 -> noop + toast「功能开发中」)
 *   - Cmd/Ctrl + N       — 新建会话(派发 my-agent:new-session)
 *   - Cmd/Ctrl + ,       — 打开设置(派发 my-agent:panel-change { panel: 'settings' })
 *   - Cmd/Ctrl + /       — 切到主菜单(派发 my-agent:panel-change { panel: 'home' })
 *   - Cmd/Ctrl + Enter   — chat 发送(仅当 focus 在 composer)
 *   - Cmd/Ctrl + .       — chat 停止生成(全局可触发,内部检查 streaming)
 *   - Cmd/Ctrl + B       — 折叠/展开 sidebar
 *   - Esc                — 关闭最上层 modal(监听 keydown 在 document)
 *   - up / down              — chat 历史上下(仅当 focus 在 composer 且输入空)
 *   - 1 / 2 / 3 / 4 / 5 / 6 — 主菜单直接选(spec § 5.7)
 *
 * 测试:    test/web/app.test.ts(同一份测试覆盖 installKeymap 行为)。
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  // 可编辑元素标签(用于判定「是否在 input/textarea 内」)
  var EDITABLE_TAGS = { INPUT: 1, TEXTAREA: 1, SELECT: 1 };

  // 主菜单 6 张卡片快捷数字
  var MENU_DIGIT_KEYS = ['1', '2', '3', '4', '5', '6'];

  // 状态:当前已注册的所有 listener + 是否已安装
  var state = {
    installed: false,
    listeners: [], // { target, type, listener, opts }
    // 默认 binding 表(key -> { cmd?, shift?, alt?, handler, inEditable? })
    bindings: [],
  };

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function noop() {}

  function isMac() {
    if (!global.navigator || !global.navigator.platform) return false;
    var p = String(global.navigator.platform).toLowerCase();
    return p.indexOf('mac') >= 0 || p.indexOf('darwin') >= 0;
  }

  function isEditableTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    if (!tag) return false;
    if (EDITABLE_TAGS[tag.toUpperCase()]) return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function isInComposer(target) {
    if (!target) return false;
    if (typeof target.closest !== 'function') return false;
    var selectors = ['.chat-composer', '#chat-composer', '[aria-label="消息输入"]'];
    for (var i = 0; i < selectors.length; i++) {
      try {
        if (target.closest(selectors[i])) return true;
      } catch (_e) { /* ignore */ }
    }
    return false;
  }

  function dispatchDoc(type, detail) {
    if (!global.document || typeof global.CustomEvent !== 'function' || typeof global.document.dispatchEvent !== 'function') return false;
    try {
      global.document.dispatchEvent(new global.CustomEvent(type, {
        detail: detail || {},
        bubbles: true,
        cancelable: true,
      }));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function showToast(msg, status) {
    var C = global.MyAgent && global.MyAgent.components;
    if (C && typeof C.Toast === 'function') {
      try {
        var t = new C.Toast();
        if (typeof t.show === 'function') {
          t.show({ message: String(msg), status: status || 'info' });
          return;
        }
      } catch (_e) { /* ignore */ }
    }
    if (global.console && typeof global.console.warn === 'function') {
      global.console.warn('[keymap]', msg);
    }
  }

  // ------------------------------------------------------------------
  // 默认 binding 列表
  //   - key 形如 'k', 'arrowup', 'enter', 'escape', 'comma'
  //   - cmd  -> 需要 Cmd(Win/Linux: Ctrl);mac 自动适配
  // ------------------------------------------------------------------

  function buildDefaultBindings() {
    var mac = isMac();
    return [
      // Cmd/Ctrl + K
      {
        key: 'k', cmd: true,
        inEditable: false,
        handler: function () {
          // F18 未实现命令面板时:noop + toast
          var slash = global.MyAgent && global.MyAgent.slash;
          if (slash && typeof slash.openCommandPalette === 'function') {
            try { slash.openCommandPalette(); return; } catch (_e) { /* ignore */ }
          }
          showToast('命令面板功能开发中', 'info');
        },
      },
      // Cmd/Ctrl + N
      {
        key: 'n', cmd: true,
        inEditable: false,
        handler: function () {
          dispatchDoc('my-agent:new-session', {});
        },
      },
      // Cmd/Ctrl + ,
      {
        key: ',', cmd: true,
        inEditable: false,
        handler: function () {
          dispatchDoc('my-agent:panel-change', { panel: 'settings' });
        },
      },
      // Cmd/Ctrl + /
      {
        key: '/', cmd: true,
        inEditable: false,
        handler: function () {
          dispatchDoc('my-agent:panel-change', { panel: 'home' });
        },
      },
      // Cmd/Ctrl + .  -> 停止生成
      {
        key: '.', cmd: true,
        inEditable: false,
        handler: function () {
          var s = global.MyAgent && global.MyAgent.state;
          var st = s && s.chatState && s.chatState.get ? s.chatState.get() : null;
          if (st && st.abortController && typeof st.abortController.abort === 'function') {
            try { st.abortController.abort(); } catch (_e) { /* ignore */ }
          }
        },
      },
      // Cmd/Ctrl + B -> 折叠/展开 sidebar
      {
        key: 'b', cmd: true,
        inEditable: false,
        handler: function () {
          dispatchDoc('my-agent:sidebar-toggle', {});
        },
      },
      // Esc -> 关闭最上层 modal
      {
        key: 'escape', cmd: false,
        inEditable: true,
        handler: function () {
          dispatchDoc('my-agent:modal-close-top', {});
        },
      },
      // up / down -> chat 历史上下(仅当 focus 在 composer 且输入空)
      {
        key: 'arrowup', cmd: false,
        inEditable: false,
        handler: function (ev) {
          // 仅当 composer 内 + 输入为空
          if (!ev || !isInComposer(ev.target)) return;
          if (ev.target && typeof ev.target.value === 'string' && ev.target.value.length > 0) return;
          dispatchDoc('my-agent:chat-history-prev', {});
        },
      },
      {
        key: 'arrowdown', cmd: false,
        inEditable: false,
        handler: function (ev) {
          if (!ev || !isInComposer(ev.target)) return;
          if (ev.target && typeof ev.target.value === 'string' && ev.target.value.length > 0) return;
          dispatchDoc('my-agent:chat-history-next', {});
        },
      },
      // 主菜单 1-6
      ...MENU_DIGIT_KEYS.map(function (k) {
        return {
          key: k, cmd: false,
          inEditable: false,
          handler: function (ev) {
            if (ev && isEditableTarget(ev.target)) return;
            var idx = parseInt(k, 10) - 1;
            dispatchDoc('my-agent:menu-action', { menuId: 'digit-' + (idx + 1), label: '' });
          },
        };
      }),
    ];
  }

  // ------------------------------------------------------------------
  // keydown 主 handler
  // ------------------------------------------------------------------

  function matchBinding(ev, binding) {
    if (!ev || !binding) return false;
    var evKey = typeof ev.key === 'string' ? ev.key.toLowerCase() : '';
    if (binding.key !== evKey && binding.key !== ev.key) return false;
    if (binding.cmd) {
      if (!(ev.metaKey || ev.ctrlKey)) return false;
    } else {
      if (ev.metaKey || ev.ctrlKey) return false;
    }
    if (binding.shift && !ev.shiftKey) return false;
    if (binding.alt && !ev.altKey) return false;
    return true;
  }

  function onKeydown(ev) {
    if (!ev) return;
    var inEditable = isEditableTarget(ev.target);
    var bindings = state.bindings;
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i];
      if (!matchBinding(ev, b)) continue;
      // 可编辑元素过滤:非 Enter/Esc 的快捷键在 <input>/<textarea> 内禁用
      if (inEditable && !b.inEditable) {
        // 跳过但仍允许 Cmd+Enter 触发 chat-send
        continue;
      }
      try {
        b.handler(ev);
      } catch (err) {
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('[keymap] handler 抛错:', err);
        }
      }
      // 阻止浏览器默认(Cmd+K 等)
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      return true;
    }
    return false;
  }

  function onKeydownCapture(ev) {
    // Cmd/Ctrl + Enter -> chat 发送(在 composer 内触发;即使 inEditable 也允许)
    if (!ev) return;
    if (!(ev.metaKey || ev.ctrlKey)) return;
    if (ev.key !== 'Enter') return;
    if (!isInComposer(ev.target)) return;
    // 找到最近的 <form>(closest 在某些环境下不支持纯标签选择器,改用向上遍历)
    var node = ev.target;
    var form = null;
    while (node) {
      if (node.tagName && String(node.tagName).toUpperCase() === 'FORM') { form = node; break; }
      node = node.parentNode;
    }
    if (!form && ev.target.closest && typeof ev.target.closest === 'function') {
      try { form = ev.target.closest('form'); } catch (_e) { /* ignore */ }
    }
    if (form && typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit();
      } catch (_e) {
        try { form.submit(); } catch (_e2) { /* ignore */ }
      }
    } else if (form && typeof form.dispatchEvent === 'function') {
      try {
        form.dispatchEvent(new global.CustomEvent('submit', { bubbles: true, cancelable: true }));
      } catch (_e) { /* ignore */ }
    }
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
  }

  // ------------------------------------------------------------------
  // install / uninstall
  // ------------------------------------------------------------------

  function addListener(target, type, listener, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener, opts || false);
    state.listeners.push({ target: target, type: type, listener: listener, opts: opts || false });
  }

  function installKeymap() {
    if (state.installed) return true;
    if (!global.document) return false;
    // 默认 bindings
    state.bindings = buildDefaultBindings();
    addListener(global.document, 'keydown', onKeydown, false);
    addListener(global.document, 'keydown', onKeydownCapture, true);
    state.installed = true;
    return true;
  }

  function uninstallKeymap() {
    for (var i = 0; i < state.listeners.length; i++) {
      var entry = state.listeners[i];
      if (entry.target && typeof entry.target.removeEventListener === 'function') {
        try {
          entry.target.removeEventListener(entry.type, entry.listener, entry.opts);
        } catch (_e) { /* ignore */ }
      }
    }
    state.listeners = [];
    state.bindings = [];
    state.installed = false;
  }

  // 测试钩子:用自定义 bindings 替换
  function setBindings(bindings) {
    if (Array.isArray(bindings)) state.bindings = bindings;
  }

  // ------------------------------------------------------------------
  // 暴露
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.appKeymap = {
    installKeymap: installKeymap,
    uninstallKeymap: uninstallKeymap,
    setBindings: setBindings,
    // 测试 / 调试
    _internal: {
      isMac: isMac,
      isEditableTarget: isEditableTarget,
      isInComposer: isInComposer,
      matchBinding: matchBinding,
      buildDefaultBindings: buildDefaultBindings,
      onKeydown: onKeydown,
      onKeydownCapture: onKeydownCapture,
      state: state,
      MENU_DIGIT_KEYS: MENU_DIGIT_KEYS.slice(),
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
