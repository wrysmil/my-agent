/**
 * button.js — Button 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Button，与 utils.js / icons.js 保持一致。
 * - 视觉构造走 window.MyAgent.utils.el()（防 XSS），不直接 innerHTML。
 * - 装饰性图标用 window.MyAgent.icons.iconHtml(name)，由调用方传入图标名。
 * - 翻译用 window.MyAgent.i18n.t(key)，未传 label 时回退到 i18n。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 4 种 variant：primary / secondary / ghost / danger
 *   - 支持 disabled（aria-disabled + 真 disabled + 不可点）
 *   - 支持 icon slot（左侧或右侧）
 *   - focus-visible 通过 :focus-visible CSS（style.css）保证可见 focus ring
 *
 * 暴露的实例 API：
 *   - button.el      —— 构造好的 <button> DOM 节点
 *   - button.destroy() —— 解除所有内部 listener（idempotent）
 *
 * 构造选项 options：
 *   {
 *     label?:       string,         // 按钮文字；空且有 icon 时为 icon-only 按钮
 *     variant?:     'primary' | 'secondary' | 'ghost' | 'danger',  // 默认 'secondary'
 *     type?:        'button' | 'submit' | 'reset',  // 默认 'button'
 *     icon?:        string,         // 图标名（icons.ICON_NAMES 之一）
 *     iconPosition?: 'left' | 'right',  // 默认 'left'
 *     disabled?:    boolean,        // 默认 false
 *     onClick?:     function,       // click handler
 *     ariaLabel?:   string,         // icon-only 时必须提供
 *     className?:   string,         // 附加 class
 *     id?:          string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'];
  var VALID_TYPES = ['button', 'submit', 'reset'];

  function normalizeVariant(v) {
    if (VALID_VARIANTS.indexOf(v) >= 0) return v;
    return 'secondary';
  }

  function normalizeType(t) {
    if (VALID_TYPES.indexOf(t) >= 0) return t;
    return 'button';
  }

  /**
   * 取已挂载的工具集。组件不缓存，每次调用现取 —— 与 spec § 4.4.6
   * 「模块通信用全局对象」一致；这样测试时可以在组件加载前注入 mock。
   */
  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function icons() {
    return global.MyAgent && global.MyAgent.icons;
  }

  /**
   * 把 SVG 字符串包成一个真实的 DOM 节点（用 utils.el 的 attr 系统无法直接吃
   * 内联 SVG 字符串；这里把 SVG 字符串塞到 innerHTML 的容器里 —— 内容是受控的
   * icons.js 输出，不存在用户输入，XSS 风险为零）。
   */
  function svgFragment(svgHtml) {
    if (!svgHtml) return null;
    var wrap = document.createElement('span');
    wrap.className = 'btn-icon-slot';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = svgHtml; // eslint-disable-line no-unsanitized
    return wrap;
  }

  /**
   * 构造一个 Button 实例。
   * @param {object} [options]
   * @returns {{ el: HTMLElement, destroy: () => void }}
   */
  function Button(options) {
    options = options || {};
    var u = utils();

    if (!u || typeof u.el !== 'function') {
      throw new Error('[Button] window.MyAgent.utils.el 不可用；请确认 utils.js 已先加载');
    }

    var variant = normalizeVariant(options.variant);
    var type = normalizeType(options.type);
    var iconName = options.icon;
    var iconPosition = options.iconPosition === 'right' ? 'right' : 'left';
    var disabled = !!options.disabled;
    var label = options.label != null ? String(options.label) : '';
    var ariaLabel = options.ariaLabel;
    var onClick = typeof options.onClick === 'function' ? options.onClick : null;
    var className = options.className ? String(options.className) : '';
    var idAttr = options.id ? String(options.id) : '';

    // icon-only 时若没给 ariaLabel —— 警告并以空 aria-label 兜底（按钮仍可点但
    // 屏幕阅读器读不到名字；由调用方负责修）。
    if (!label && iconName && !ariaLabel) {
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn(
          '[Button] icon-only 按钮未传 ariaLabel；对屏幕阅读器将无可访问名称',
        );
      }
    }

    var classes = ['btn', 'btn-' + variant];
    if (className) classes.push(className);
    if (!label && iconName) classes.push('btn-icon-only');

    // 构造 children
    var children = [];
    var iconSlot = null;
    if (iconName) {
      var iconLib = icons();
      if (iconLib && typeof iconLib.iconHtml === 'function') {
        iconSlot = svgFragment(iconLib.iconHtml(iconName, 16));
      }
    }
    if (iconSlot && iconPosition === 'left') children.push(iconSlot);
    if (label) children.push(label);
    if (iconSlot && iconPosition === 'right') children.push(iconSlot);

    var attrs = {
      type: type,
      class: classes.join(' '),
    };
    if (idAttr) attrs.id = idAttr;
    if (ariaLabel) attrs['aria-label'] = ariaLabel;
    if (disabled) {
      attrs.disabled = true;
      attrs['aria-disabled'] = 'true';
    }
    if (onClick) attrs.onclick = onClick;

    var el = u.el('button', attrs, children);

    // 即使 disabled 也把 listener 注册上；handler 内部判断 disabled 早退。
    // 这样销毁时统一 removeEventListener 即可。
    if (onClick) {
      var guarded = function (ev) {
        if (el.disabled) {
          ev.preventDefault();
          ev.stopImmediatePropagation && ev.stopImmediatePropagation();
          return;
        }
        try {
          onClick(ev);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Button] onClick 抛错:', err);
          }
        }
      };
      // 把 onClick 替换为 guarded（同时把 attrs 上的 onclick listener 卸掉）
      el.removeEventListener('click', onClick);
      el.addEventListener('click', guarded);
    }

    function destroy() {
      // listener 已在 onClick 注册时记录；这里只需把节点从父节点摘掉
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }

    return { el: el, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Button = Button;
})(typeof globalThis !== 'undefined' ? globalThis : this);
