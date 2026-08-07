/**
 * empty-state.js — EmptyState 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.EmptyState（kebab-case → PascalCase）。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 空态展示：icon + title + description + 可选 action
 *   - 容器 role="status"，避免干扰阅读器
 *
 * 暴露的实例 API：
 *   - es.el          —— 根节点
 *   - es.destroy()   —— 摘除节点
 *
 * 构造选项 options：
 *   {
 *     icon?:     string,         // 图标名；不传则无图标
 *     title?:    string,
 *     description?: string,
 *     action?:   { label: string, onClick?: function, href?: string, variant?: string },
 *     className?:string,
 *   }
 */
(function (global) {
  'use strict';

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function EmptyState(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[EmptyState] window.MyAgent.utils.el 不可用');
    }

    var rootClasses = ['empty-state'];
    if (options.className) rootClasses.push(String(options.className));

    var root = u.el(
      'div',
      {
        class: rootClasses.join(' '),
        role: 'status',
        'aria-live': 'polite',
      },
    );

    // icon（用 icons.js）
    if (options.icon) {
      var iconLib = global.MyAgent && global.MyAgent.icons;
      if (iconLib && typeof iconLib.iconHtml === 'function') {
        var iconWrap = document.createElement('div');
        iconWrap.className = 'empty-state-icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        iconWrap.innerHTML = iconLib.iconHtml(String(options.icon), 48); // eslint-disable-line no-unsanitized
        root.appendChild(iconWrap);
      }
    }

    if (options.title) {
      root.appendChild(
        u.el('h3', { class: 'empty-state-title' }, [String(options.title)]),
      );
    }

    if (options.description) {
      root.appendChild(
        u.el('p', { class: 'empty-state-description' }, [String(options.description)]),
      );
    }

    if (options.action && options.action.label) {
      var actionAttrs = {
        type: 'button',
        class: 'btn btn-primary empty-state-action',
      };
      var actionEl;
      if (options.action.href) {
        // 不创建 <a>，统一 button（避免在空态里导航走开）
        actionAttrs['data-href'] = String(options.action.href);
      }
      if (options.action.variant) {
        actionAttrs['data-variant'] = String(options.action.variant);
      }
      actionEl = u.el('button', actionAttrs, [String(options.action.label)]);
      if (typeof options.action.onClick === 'function') {
        actionEl.addEventListener('click', function (ev) {
          try {
            options.action.onClick(ev);
          } catch (err) {
            if (global.console && typeof global.console.error === 'function') {
              global.console.error('[EmptyState] action.onClick 抛错:', err);
            }
          }
        });
      }
      root.appendChild(actionEl);
    }

    function destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.EmptyState = EmptyState;
})(typeof globalThis !== 'undefined' ? globalThis : this);
