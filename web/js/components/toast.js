/**
 * toast.js — Toast 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Toast。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 * - 单例挂载点：默认找 #toast-root；缺省则挂到 document.body 末尾并 cache。
 *   调用方也可在 options.root 指定挂载点。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - top-right 4 种 status：info / success / warn / error
 *   - role="status"（info / success / warn）；error 用 role="alert"
 *   - 自动消失：duration ms 后淡出移除（duration=0 表示不自动消失）
 *   - 同时显示多条：每条独立 timeout；click 立即关闭
 *
 * 暴露的实例 API：
 *   - toast.el          —— 根节点（容器）
 *   - toast.show(opts)  —— 推入新 toast，传入 { message, status?, duration? }，返回 toastItem
 *   - toast.destroy()   —— 清空所有 toast + 摘除根节点
 *
 * 构造选项 options（构造时）：
 *   {
 *     root?:  HTMLElement,  // 自定义挂载点
 *     className?: string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_STATUS = ['info', 'success', 'warn', 'error'];

  var DEFAULT_DURATION = 4000;
  var ROOT_ID = 'toast-root';

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function i18n() {
    return global.MyAgent && global.MyAgent.i18n;
  }

  function getOrCreateRoot(customRoot) {
    if (customRoot) return customRoot;
    var existing = global.document.getElementById(ROOT_ID);
    if (existing) return existing;
    var root = global.document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'toast-root';
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'false');
    global.document.body.appendChild(root);
    return root;
  }

  function iconForStatus(status, size) {
    var iconLib = global.MyAgent && global.MyAgent.icons;
    if (!iconLib) return null;
    var name =
      status === 'success'
        ? 'check-circle-2'
        : status === 'error'
        ? 'x-circle'
        : status === 'warn'
        ? 'alert-triangle'
        : 'info';
    if (typeof iconLib.iconHtml !== 'function') return null;
    return iconLib.iconHtml(name, size || 16);
  }

  function svgFragment(svgHtml) {
    if (!svgHtml) return null;
    var wrap = document.createElement('span');
    wrap.className = 'toast-icon';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = svgHtml; // eslint-disable-line no-unsanitized
    return wrap;
  }

  function Toast(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Toast] window.MyAgent.utils.el 不可用');
    }

    var mount = getOrCreateRoot(options.root);
    var activeTimers = new Set();
    var items = new Set();

    var rootClasses = ['toast-stack'];
    if (options.className) rootClasses.push(String(options.className));
    var root = u.el('div', { class: rootClasses.join(' '), role: 'region', 'aria-label': 'Notifications' });
    mount.appendChild(root);

    /**
     * 推入一条 toast。
     * @param {object} opts { message, status?, duration? }
     * @returns {{ el: HTMLElement, close: () => void }}
     */
    function show(opts) {
      opts = opts || {};
      var status = VALID_STATUS.indexOf(opts.status) >= 0 ? opts.status : 'info';
      var duration = typeof opts.duration === 'number' ? opts.duration : DEFAULT_DURATION;
      var message = opts.message != null ? String(opts.message) : '';

      var role = status === 'error' ? 'alert' : 'status';
      var iconSlot = svgFragment(iconForStatus(status, 16));

      var children = [];
      if (iconSlot) children.push(iconSlot);
      children.push(
        u.el('div', { class: 'toast-message' }, [message]),
      );

      var closeBtn = u.el(
        'button',
        { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss' },
        ['×'],
      );
      children.push(closeBtn);

      var item = u.el(
        'div',
        {
          class: ('toast toast-' + status),
          role: role,
          'aria-live': status === 'error' ? 'assertive' : 'polite',
        },
        children,
      );

      function removeItem() {
        if (item.parentNode) item.parentNode.removeChild(item);
        items.delete(item);
      }

      function close() {
        if (timer) {
          clearTimeout(timer);
          activeTimers.delete(timer);
        }
        removeItem();
      }

      closeBtn.addEventListener('click', close);
      item.addEventListener('click', function (ev) {
        // 点 toast 本体也可关闭（除非点到了内部按钮 / 链接）
        if (ev.target === closeBtn) return;
        if (ev.target && ev.target.closest && ev.target.closest('button, a')) return;
        close();
      });

      var timer = null;
      if (duration > 0) {
        timer = setTimeout(function () {
          activeTimers.delete(timer);
          removeItem();
        }, duration);
        activeTimers.add(timer);
      }

      root.appendChild(item);
      items.add(item);
      return { el: item, close: close };
    }

    function destroy() {
      // 清空所有 timer
      activeTimers.forEach(function (t) {
        clearTimeout(t);
      });
      activeTimers.clear();
      items.clear();
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, show: show, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Toast = Toast;
})(typeof globalThis !== 'undefined' ? globalThis : this);
