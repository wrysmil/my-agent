/**
 * tooltip.js — Tooltip 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Tooltip。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - hover / focus 时显示
 *   - 4 方向：top / bottom / left / right
 *   - role="tooltip"
 *   - target 设 aria-describedby 指向 tooltip
 *
 * 暴露的实例 API：
 *   - tip.el          —— tooltip 根节点（默认挂在 document.body）
 *   - tip.show()      —— 强制显示
 *   - tip.hide()      —— 强制隐藏
 *   - tip.destroy()   —— 隐藏 + 摘除节点 + 解除 listener
 *
 * 构造选项 options：
 *   {
 *     target:     HTMLElement,         // 必填
 *     content:    string,
 *     placement?: 'top' | 'bottom' | 'left' | 'right',  // 默认 'top'
 *     delay?:     number,              // 显示延迟 ms；默认 100
 *   }
 */
(function (global) {
  'use strict';

  var VALID_PLACEMENT = ['top', 'bottom', 'left', 'right'];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'tip') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function Tooltip(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Tooltip] window.MyAgent.utils.el 不可用');
    }
    if (!options.target || typeof options.target !== 'object' || !('nodeType' in options.target)) {
      throw new Error('[Tooltip] options.target 必填（HTMLElement）');
    }

    var placement = VALID_PLACEMENT.indexOf(options.placement) >= 0 ? options.placement : 'top';
    var delay = typeof options.delay === 'number' && options.delay >= 0 ? options.delay : 100;
    var content = options.content != null ? String(options.content) : '';

    var id = genId('tip');
    var tip = u.el(
      'div',
      {
        id: id,
        class: 'tooltip tooltip-' + placement,
        role: 'tooltip',
        'data-placement': placement,
        hidden: true,
      },
      [content],
    );

    // 挂到 body（避免被父容器 overflow 裁掉）
    global.document.body.appendChild(tip);

    // 让 target 通过 aria-describedby 关联
    options.target.setAttribute('aria-describedby', id);

    var showTimer = null;
    var visible = false;

    function position() {
      // 取 target 的位置
      var rect = options.target.getBoundingClientRect();
      var tipRect = tip.getBoundingClientRect();
      var scrollX = global.pageXOffset || global.document.documentElement.scrollLeft || 0;
      var scrollY = global.pageYOffset || global.document.documentElement.scrollTop || 0;
      var top = 0;
      var left = 0;
      if (placement === 'top') {
        top = rect.top + scrollY - tipRect.height - 8;
        left = rect.left + scrollX + (rect.width - tipRect.width) / 2;
      } else if (placement === 'bottom') {
        top = rect.bottom + scrollY + 8;
        left = rect.left + scrollX + (rect.width - tipRect.width) / 2;
      } else if (placement === 'left') {
        top = rect.top + scrollY + (rect.height - tipRect.height) / 2;
        left = rect.left + scrollX - tipRect.width - 8;
      } else if (placement === 'right') {
        top = rect.top + scrollY + (rect.height - tipRect.height) / 2;
        left = rect.right + scrollX + 8;
      }
      tip.style.position = 'absolute';
      tip.style.top = Math.max(0, top) + 'px';
      tip.style.left = Math.max(0, left) + 'px';
    }

    function show() {
      if (visible) return;
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      showTimer = setTimeout(function () {
        showTimer = null;
        position();
        tip.hidden = false;
        visible = true;
      }, delay);
    }

    function hide() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      tip.hidden = true;
      visible = false;
    }

    options.target.addEventListener('mouseenter', show);
    options.target.addEventListener('mouseleave', hide);
    options.target.addEventListener('focus', show);
    options.target.addEventListener('blur', hide);

    function destroy() {
      hide();
      options.target.removeEventListener('mouseenter', show);
      options.target.removeEventListener('mouseleave', hide);
      options.target.removeEventListener('focus', show);
      options.target.removeEventListener('blur', hide);
      if (tip.parentNode) tip.parentNode.removeChild(tip);
    }

    return { el: tip, show: show, hide: hide, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Tooltip = Tooltip;
})(typeof globalThis !== 'undefined' ? globalThis : this);
