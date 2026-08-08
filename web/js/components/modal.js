/**
 * modal.js — Modal 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Modal。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 居中弹窗 + 遮罩（overlay）
 *   - role="dialog" + aria-modal="true" + aria-labelledby 指向 title
 *   - ESC 关闭（可关）+ overlay 点击关闭（可关）
 *   - focus trap：打开时记录 activeElement，关闭时恢复
 *   - 打开时焦点移到第一个可聚焦元素
 *
 * 暴露的实例 API：
 *   - modal.el          —— 根节点（包含 overlay + dialog）
 *   - modal.open()      —— 显示
 *   - modal.close()     —— 隐藏（不销毁节点）
 *   - modal.destroy()   —— 关闭 + 摘除节点 + 解除全部 listener
 *
 * 构造选项 options：
 *   {
 *     title?:       string,
 *     content?:     Node | string,   // 字符串走 textContent（防 XSS）
 *     footer?:      Node,
 *     onClose?:     function,
 *     closeOnOverlay?: boolean,      // 默认 true
 *     closeOnEsc?:  boolean,         // 默认 true
 *     className?:   string,
 *     id?:          string,
 *   }
 */
(function (global) {
  'use strict';

  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'modal') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function Modal(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Modal] window.MyAgent.utils.el 不可用');
    }

    var id = options.id ? String(options.id) : genId('modal');
    var titleId = id + '-title';
    var closeOnOverlay = options.closeOnOverlay !== false;
    var closeOnEsc = options.closeOnEsc !== false;
    var onClose = typeof options.onClose === 'function' ? options.onClose : null;
    var prevActive = null;

    // ── content 节点
    var contentNode;
    if (options.content == null) {
      contentNode = null;
    } else if (options.content && typeof options.content === 'object' && 'nodeType' in options.content) {
      contentNode = options.content;
    } else {
      contentNode = u.el('div', { class: 'modal-body' }, [String(options.content)]);
    }

    // ── 内部 close（公共 close + destroy 共用）
    function doClose(triggerOnClose) {
      if (root.parentNode) root.parentNode.removeChild(root);
      if (keyHandler) {
        global.document.removeEventListener('keydown', keyHandler);
        keyHandler = null;
      }
      if (prevActive && typeof prevActive.focus === 'function') {
        try {
          prevActive.focus();
        } catch (_e) {
          /* ignore */
        }
      }
      prevActive = null;
      if (triggerOnClose && onClose) {
        try {
          onClose();
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Modal] onClose 抛错:', err);
          }
        }
      }
    }

    // ── header
    var headerChildren = [];
    if (options.title) {
      headerChildren.push(
        u.el('h2', { id: titleId, class: 'modal-title' }, [String(options.title)]),
      );
    }
    var closeBtn = u.el(
      'button',
      {
        type: 'button',
        class: 'modal-close',
        'aria-label': 'Close',
      },
      ['×'],
    );

    var header = u.el('div', { class: 'modal-header' }, headerChildren.concat([closeBtn]));

    // ── dialog children
    var dialogChildren = [header];
    if (contentNode) dialogChildren.push(contentNode);
    if (options.footer) {
      var footerNode = options.footer;
      if (footerNode && typeof footerNode === 'object' && 'nodeType' in footerNode) {
        dialogChildren.push(u.el('div', { class: 'modal-footer' }, [footerNode]));
      }
    }

    // ── dialog
    var dialogAttrs = {
      role: 'dialog',
      'aria-modal': 'true',
      class: 'modal-dialog',
      tabindex: '-1',
    };
    if (options.title) dialogAttrs['aria-labelledby'] = titleId;
    var dialog = u.el('div', dialogAttrs, dialogChildren);

    // ── overlay
    var overlay = u.el(
      'div',
      {
        class: 'modal-overlay',
        'data-modal-overlay': id,
      },
      [dialog],
    );

    // 根节点
    var rootClasses = ['modal-root'];
    if (options.className) rootClasses.push(String(options.className));
    var root = u.el(
      'div',
      {
        class: rootClasses.join(' '),
        'data-modal-root': id,
        hidden: true,
      },
      [overlay],
    );

    // ── close button
    closeBtn.addEventListener('click', function () {
      doClose(true);
    });

    // ── overlay click
    if (closeOnOverlay) {
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay) {
          doClose(true);
        }
      });
    }

    // ── keydown (ESC + focus trap)
    var keyHandler = null;
    function onKeydown(ev) {
      if (ev.key === 'Escape' && closeOnEsc) {
        ev.preventDefault();
        doClose(true);
        return;
      }
      if (ev.key === 'Tab') {
        // focus trap
        var focusables = dialog.querySelectorAll(FOCUSABLE);
        if (!focusables.length) {
          ev.preventDefault();
          dialog.focus();
          return;
        }
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        var active = global.document.activeElement;
        if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    }

    // ── open
    function open() {
      if (root.parentNode) return; // 已挂载
      prevActive = global.document.activeElement || null;
      global.document.body.appendChild(root);
      root.hidden = false;
      global.document.addEventListener('keydown', keyHandler);
      // 焦点移到第一个可聚焦元素，否则 dialog 自身
      var focusables = dialog.querySelectorAll(FOCUSABLE);
      if (focusables.length) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }
    }

    // ── close（公共）
    function close() {
      doClose(true);
    }

    // ── destroy
    function destroy() {
      doClose(false);
    }

    return { el: root, open: open, close: close, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Modal = Modal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
