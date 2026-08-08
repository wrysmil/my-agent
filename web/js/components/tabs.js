/**
 * tabs.js — Tabs 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Tabs。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - role="tablist" / role="tab" / role="tabpanel"
 *   - aria-selected 标记当前 tab
 *   - 键盘：← / → 在 tab 之间切换；Home / End 跳到首/尾；Enter / Space 激活
 *   - 每个 tabpanel 配 aria-labelledby 指向对应 tab
 *
 * 暴露的实例 API：
 *   - tabs.el         —— 根节点
 *   - tabs.select(id) —— 切到指定 tab
 *   - tabs.destroy()  —— 摘除节点 + 解除 listener
 *
 * 构造选项 options：
 *   {
 *     items:     Array<{ id: string, label: string, content?: Node | string, disabled?: boolean }>,
 *     activeId?: string,
 *     onChange?: function(newId, oldId),
 *     className?:string,
 *     id?:       string,
 *   }
 */
(function (global) {
  'use strict';

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'tabs') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function Tabs(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Tabs] window.MyAgent.utils.el 不可用');
    }

    var items = Array.isArray(options.items) ? options.items.slice() : [];
    if (items.length === 0) {
      // 兜底：空 tablist
      items = [{ id: 'empty', label: '' }];
    }

    var rootId = options.id ? String(options.id) : genId('tabs');
    var onChange = typeof options.onChange === 'function' ? options.onChange : null;
    var activeId = options.activeId || items[0].id;
    var tabButtons = []; // { id, btn, panel }

    // ── tablist
    var tabChildren = [];
    items.forEach(function (item, idx) {
      var tabId = rootId + '-tab-' + item.id;
      var panelId = rootId + '-panel-' + item.id;
      var btnAttrs = {
        type: 'button',
        role: 'tab',
        id: tabId,
        class: 'tab',
        'aria-controls': panelId,
        'aria-selected': item.id === activeId ? 'true' : 'false',
        tabindex: item.id === activeId ? '0' : '-1',
      };
      if (item.disabled) {
        btnAttrs.disabled = true;
        btnAttrs['aria-disabled'] = 'true';
      }
      var btn = u.el('button', btnAttrs, [String(item.label || item.id)]);
      tabChildren.push(btn);
      tabButtons.push({ id: item.id, btn: btn, panelId: panelId });
    });
    var tablist = u.el(
      'div',
      { class: 'tablist', role: 'tablist' },
      tabChildren,
    );

    // ── panels
    var panelChildren = [];
    items.forEach(function (item) {
      var panelId = rootId + '-panel-' + item.id;
      var tabId = rootId + '-tab-' + item.id;
      var panelAttrs = {
        role: 'tabpanel',
        id: panelId,
        'aria-labelledby': tabId,
        class: 'tabpanel',
        tabindex: '0',
        hidden: item.id !== activeId,
      };
      var content = item.content;
      var panelChildrenArr = [];
      if (content == null) {
        // 空
      } else if (content && typeof content === 'object' && 'nodeType' in content) {
        panelChildrenArr.push(content);
      } else {
        panelChildrenArr.push(u.el('div', { class: 'tabpanel-body' }, [String(content)]));
      }
      var panel = u.el('div', panelAttrs, panelChildrenArr);
      panelChildren.push(panel);
    });
    var panelsWrap = u.el('div', { class: 'tabpanels' }, panelChildren);

    // ── 根
    var rootClasses = ['tabs'];
    if (options.className) rootClasses.push(String(options.className));
    var root = u.el('div', { class: rootClasses.join(' '), id: rootId }, [tablist, panelsWrap]);

    // ── 切换
    function select(newId, focus) {
      var found = null;
      var oldId = activeId;
      tabButtons.forEach(function (t) {
        if (t.id === newId) found = t;
        t.btn.setAttribute('aria-selected', t.id === newId ? 'true' : 'false');
        t.btn.setAttribute('tabindex', t.id === newId ? '0' : '-1');
      });
      // 切 panel hidden
      var allPanels = panelsWrap.children;
      for (var i = 0; i < allPanels.length; i++) {
        var p = allPanels[i];
        p.hidden = p.id !== found.panelId;
      }
      activeId = newId;
      if (focus && found) {
        found.btn.focus();
      }
      if (newId !== oldId && onChange) {
        try {
          onChange(newId, oldId);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Tabs] onChange 抛错:', err);
          }
        }
      }
    }

    // ── keyboard
    function onKeydown(ev) {
      var key = ev.key;
      var enabledIdx = [];
      tabButtons.forEach(function (t, idx) {
        if (!t.btn.disabled) enabledIdx.push(idx);
      });
      var currentIdx = enabledIdx.indexOf(
        tabButtons.findIndex(function (t) { return t.id === activeId; })
      );
      if (currentIdx < 0) currentIdx = 0;

      if (key === 'ArrowRight') {
        ev.preventDefault();
        var next = enabledIdx[(currentIdx + 1) % enabledIdx.length];
        select(tabButtons[next].id, true);
      } else if (key === 'ArrowLeft') {
        ev.preventDefault();
        var prev = enabledIdx[(currentIdx - 1 + enabledIdx.length) % enabledIdx.length];
        select(tabButtons[prev].id, true);
      } else if (key === 'Home') {
        ev.preventDefault();
        select(tabButtons[enabledIdx[0]].id, true);
      } else if (key === 'End') {
        ev.preventDefault();
        select(tabButtons[enabledIdx[enabledIdx.length - 1]].id, true);
      }
    }
    tablist.addEventListener('keydown', onKeydown);

    // ── click
    tabButtons.forEach(function (t) {
      t.btn.addEventListener('click', function () {
        if (t.btn.disabled) return;
        select(t.id, false);
      });
    });

    function destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, select: select, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Tabs = Tabs;
})(typeof globalThis !== 'undefined' ? globalThis : this);
