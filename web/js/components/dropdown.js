/**
 * dropdown.js — Dropdown 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Dropdown。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 点击 trigger 展开；再次点击 / 点击外部 / ESC 关闭
 *   - 键盘：↑ / ↓ 在 menuitem 之间循环；Enter / Space 激活；Home / End
 *   - role="menu" / role="menuitem" / aria-expanded
 *
 * 暴露的实例 API：
 *   - dd.el          —— 根节点（trigger + menu 一起）
 *   - dd.open()      —— 展开
 *   - dd.close()     —— 关闭
 *   - dd.toggle()    —— 切换
 *   - dd.destroy()   —— 关闭 + 摘除节点 + 解除 listener
 *
 * 构造选项 options：
 *   {
 *     trigger:  { label?: string, icon?: string, ariaLabel?: string } | HTMLElement,
 *     items:    Array<{ id?: string, label: string, onClick?: function, disabled?: boolean, divider?: boolean }>,
 *     placement?:'bottom-start' | 'bottom-end' | 'top-start' | 'top-end',  // 默认 'bottom-start'
 *     onOpen?:  function,
 *     onClose?: function,
 *     className?:string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_PLACEMENT = ['bottom-start', 'bottom-end', 'top-start', 'top-end'];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'dd') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function Dropdown(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Dropdown] window.MyAgent.utils.el 不可用');
    }

    var placement = VALID_PLACEMENT.indexOf(options.placement) >= 0 ? options.placement : 'bottom-start';
    var onOpen = typeof options.onOpen === 'function' ? options.onOpen : null;
    var onClose = typeof options.onClose === 'function' ? options.onClose : null;
    var items = Array.isArray(options.items) ? options.items : [];

    var rootId = genId('dd');
    var menuId = rootId + '-menu';
    var isOpen = false;
    var activeIdx = -1;

    // ── trigger
    var triggerEl;
    if (options.trigger && typeof options.trigger === 'object' && 'nodeType' in options.trigger) {
      triggerEl = options.trigger;
    } else {
      var trigConf = options.trigger || {};
      var trigAttrs = {
        type: 'button',
        class: 'dropdown-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-controls': menuId,
      };
      if (trigConf.ariaLabel) trigAttrs['aria-label'] = String(trigConf.ariaLabel);
      var trigChildren = [];
      if (trigConf.icon) {
        var iconLib = global.MyAgent && global.MyAgent.icons;
        if (iconLib && typeof iconLib.iconHtml === 'function') {
          var icoWrap = document.createElement('span');
          icoWrap.className = 'dropdown-trigger-icon';
          icoWrap.setAttribute('aria-hidden', 'true');
          icoWrap.innerHTML = iconLib.iconHtml(String(trigConf.icon), 16); // eslint-disable-line no-unsanitized
          trigChildren.push(icoWrap);
        }
      }
      if (trigConf.label) trigChildren.push(String(trigConf.label));
      // chevron-down
      var iconLib2 = global.MyAgent && global.MyAgent.icons;
      if (iconLib2 && typeof iconLib2.iconHtml === 'function') {
        var chevWrap = document.createElement('span');
        chevWrap.className = 'dropdown-trigger-chevron';
        chevWrap.setAttribute('aria-hidden', 'true');
        chevWrap.innerHTML = iconLib2.iconHtml('chevron-down', 14); // eslint-disable-line no-unsanitized
        trigChildren.push(chevWrap);
      }
      triggerEl = u.el('button', trigAttrs, trigChildren);
    }
    // 确保 trigger 有正确的 aria 属性
    triggerEl.setAttribute('aria-haspopup', 'menu');
    triggerEl.setAttribute('aria-expanded', 'false');
    triggerEl.setAttribute('aria-controls', menuId);

    // ── menu
    var menuItemEls = []; // { el, item, idx, enabled }
    var menuChildren = [];
    items.forEach(function (item, idx) {
      if (item.divider) {
        menuChildren.push(u.el('div', { class: 'dropdown-divider', role: 'separator' }));
        return;
      }
      var itemId = rootId + '-item-' + (item.id || idx);
      var itemAttrs = {
        role: 'menuitem',
        id: itemId,
        class: 'dropdown-item',
        tabindex: '-1',
      };
      if (item.disabled) {
        itemAttrs['aria-disabled'] = 'true';
        itemAttrs.disabled = true;
      }
      var itemEl = u.el('div', itemAttrs, [String(item.label || '')]);
      if (!item.disabled && typeof item.onClick === 'function') {
        itemEl.addEventListener('click', function (ev) {
          try {
            item.onClick(ev);
          } catch (err) {
            if (global.console && typeof global.console.error === 'function') {
              global.console.error('[Dropdown] onClick 抛错:', err);
            }
          }
          close();
        });
      }
      menuItemEls.push({ el: itemEl, item: item, idx: idx, enabled: !item.disabled });
      menuChildren.push(itemEl);
    });
    var menu = u.el(
      'div',
      {
        class: 'dropdown-menu',
        id: menuId,
        role: 'menu',
        'aria-label': 'Menu',
        'data-placement': placement,
        hidden: true,
      },
      menuChildren,
    );

    // ── root
    var rootClasses = ['dropdown', 'dropdown-' + placement];
    if (options.className) rootClasses.push(String(options.className));
    var root = u.el('div', { class: rootClasses.join(' '), id: rootId }, [triggerEl, menu]);

    // ── open / close
    function open() {
      if (isOpen) return;
      isOpen = true;
      menu.hidden = false;
      triggerEl.setAttribute('aria-expanded', 'true');
      activeIdx = menuItemEls.findIndex(function (m) { return m.enabled; });
      if (onOpen) {
        try { onOpen(); } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Dropdown] onOpen 抛错:', err);
          }
        }
      }
      // 全局监听 click outside / ESC
      setTimeout(function () {
        global.document.addEventListener('click', onDocClick, true);
        global.document.addEventListener('keydown', onKey, true);
      }, 0);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      menu.hidden = true;
      triggerEl.setAttribute('aria-expanded', 'false');
      activeIdx = -1;
      // 清除 active 样式
      menuItemEls.forEach(function (m) {
        m.el.classList && m.el.classList.remove('dropdown-item-active');
        m.el.setAttribute('tabindex', '-1');
      });
      global.document.removeEventListener('click', onDocClick, true);
      global.document.removeEventListener('keydown', onKey, true);
      if (onClose) {
        try { onClose(); } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Dropdown] onClose 抛错:', err);
          }
        }
      }
    }

    function toggle() {
      if (isOpen) close();
      else open();
    }

    function onDocClick(ev) {
      if (!root.contains(ev.target)) {
        close();
      }
    }

    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        triggerEl.focus && triggerEl.focus();
        return;
      }
      if (!isOpen) return;
      var enabled = menuItemEls.filter(function (m) { return m.enabled; });
      if (enabled.length === 0) return;
      var currentPos = enabled.findIndex(function (m) { return m.idx === activeIdx; });
      if (currentPos < 0) currentPos = 0;
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        var nxt = enabled[(currentPos + 1) % enabled.length];
        activeIdx = nxt.idx;
        focusItem(nxt);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        var prv = enabled[(currentPos - 1 + enabled.length) % enabled.length];
        activeIdx = prv.idx;
        focusItem(prv);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        activeIdx = enabled[0].idx;
        focusItem(enabled[0]);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        activeIdx = enabled[enabled.length - 1].idx;
        focusItem(enabled[enabled.length - 1]);
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        if (activeIdx >= 0) {
          ev.preventDefault();
          var cur = menuItemEls[activeIdx];
          if (cur && cur.enabled) {
            cur.el.click();
          }
        }
      }
    }

    function focusItem(m) {
      menuItemEls.forEach(function (x) {
        x.el.classList && x.el.classList.remove('dropdown-item-active');
      });
      m.el.classList && m.el.classList.add('dropdown-item-active');
      m.el.focus();
    }

    triggerEl.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggle();
    });

    // trigger keydown (ArrowDown / Enter / Space 打开)
    triggerEl.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (!isOpen) open();
        var first = menuItemEls.find(function (m) { return m.enabled; });
        if (first) {
          activeIdx = first.idx;
          focusItem(first);
        }
      }
    });

    function destroy() {
      close();
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, open: open, close: close, toggle: toggle, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Dropdown = Dropdown;
})(typeof globalThis !== 'undefined' ? globalThis : this);
