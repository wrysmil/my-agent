/**
 * spinner.js — Spinner 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Spinner。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 旋转 loader 图标（用 icons.js 的 loader-2）
 *   - role="status" + aria-label（默认 "Loading"）
 *   - size 可调（px）
 *
 * 暴露的实例 API：
 *   - sp.el        —— 根节点
 *   - sp.destroy() —— 摘除节点
 *
 * 构造选项 options：
 *   {
 *     size?:     number,    // px；默认 24
 *     label?:    string,    // 屏幕阅读器朗读的加载提示；默认 'Loading'
 *     className?:string,
 *   }
 */
(function (global) {
  'use strict';

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function Spinner(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Spinner] window.MyAgent.utils.el 不可用');
    }

    var size = typeof options.size === 'number' && options.size > 0 ? Math.round(options.size) : 24;
    var label = options.label ? String(options.label) : 'Loading';
    var iconLib = global.MyAgent && global.MyAgent.icons;
    var svgHtml = iconLib && typeof iconLib.iconHtml === 'function'
      ? iconLib.iconHtml('loader-2', size)
      : '';

    var wrapClasses = ['spinner'];
    if (options.className) wrapClasses.push(String(options.className));
    var wrap = u.el('span', {
      class: wrapClasses.join(' '),
      role: 'status',
      'aria-label': label,
    });
    if (svgHtml) {
      var icon = document.createElement('span');
      icon.className = 'spinner-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = svgHtml; // eslint-disable-line no-unsanitized
      wrap.appendChild(icon);
    }
    // 给屏幕阅读器一个可视的 fallback 文字
    var srText = u.el('span', { class: 'visually-hidden' }, [label]);
    wrap.appendChild(srText);

    function destroy() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    return { el: wrap, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Spinner = Spinner;
})(typeof globalThis !== 'undefined' ? globalThis : this);
