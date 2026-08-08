/**
 * badge.js — Badge 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Badge。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - count 角标；> max 时显示 max+（如 99+）
 *   - aria-label = "未读 N 条" / "Unread N items"（屏幕阅读器读为完整数量）
 *
 * 暴露的实例 API：
 *   - badge.el          —— 根节点
 *   - badge.setCount(n) —— 动态更新 count
 *   - badge.destroy()   —— 摘除节点
 *
 * 构造选项 options：
 *   {
 *     count:    number,
 *     max?:     number,     // 默认 99
 *     variant?: 'primary' | 'danger' | 'success' | 'warning',  // 默认 'danger'
 *     label?:   string,     // 完整 a11y 文案模板；占位符 {count} 替换为「实际数字」；如 '未读 {count} 条'
 *     className?:string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_VARIANT = ['primary', 'danger', 'success', 'warning'];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function i18n() {
    return global.MyAgent && global.MyAgent.i18n;
  }

  function formatCount(n, max) {
    if (n > max) return max + '+';
    return String(n);
  }

  function Badge(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Badge] window.MyAgent.utils.el 不可用');
    }

    var count = typeof options.count === 'number' ? options.count : 0;
    var max = typeof options.max === 'number' && options.max > 0 ? options.max : 99;
    var variant = VALID_VARIANT.indexOf(options.variant) >= 0 ? options.variant : 'danger';

    // a11y label：i18n 优先；options.label 兜底；最末「Unread {count}」
    var a11yLabel;
    if (options.label) {
      a11yLabel = String(options.label).replace('{count}', String(count));
    } else {
      var dict = i18n();
      if (dict && typeof dict.t === 'function') {
        // zh / en 都有 'common.unread'？没有，简化：固定字符串 + i18n.lang
        var lang = typeof dict.getLang === 'function' ? dict.getLang() : 'zh';
        a11yLabel = lang === 'en' ? 'Unread ' + count : '未读 ' + count + ' 条';
      } else {
        a11yLabel = 'Unread ' + count;
      }
    }

    var classes = ['badge', 'badge-' + variant];
    if (count <= 0) classes.push('badge-hidden');
    if (options.className) classes.push(String(options.className));

    var root = u.el('span', {
      class: classes.join(' '),
      role: 'status',
      'aria-label': a11yLabel,
    }, [formatCount(count, max)]);

    function setCount(n) {
      count = typeof n === 'number' ? n : 0;
      var newLabel = options.label
        ? String(options.label).replace('{count}', String(count))
        : (function () {
            var dict = i18n();
            var lang = dict && typeof dict.getLang === 'function' ? dict.getLang() : 'zh';
            return lang === 'en' ? 'Unread ' + count : '未读 ' + count + ' 条';
          })();
      root.setAttribute('aria-label', newLabel);
      root.textContent = formatCount(count, max);
      if (count <= 0) {
        root.classList.add('badge-hidden');
      } else {
        root.classList.remove('badge-hidden');
      }
    }

    function destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, setCount: setCount, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Badge = Badge;
})(typeof globalThis !== 'undefined' ? globalThis : this);
