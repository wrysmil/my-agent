/**
 * skeleton.js — Skeleton 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Skeleton。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 占位符骨架（pulse 动画由 style.css 提供 .skeleton-pulse 关键帧）
 *   - 3 种 variant：text（默认）/ rect / circle
 *   - aria-busy="true" + aria-live="polite"（屏幕阅读器读为「正在加载」）
 *
 * 暴露的实例 API：
 *   - skel.el        —— 根节点
 *   - skel.destroy() —— 摘除节点
 *
 * 构造选项 options：
 *   {
 *     variant?:  'text' | 'rect' | 'circle',  // 默认 'text'
 *     width?:    string | number,            // CSS 长度
 *     height?:   string | number,
 *     lines?:    number,                     // text 模式渲染几行；默认 1
 *     className?:string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_VARIANT = ['text', 'rect', 'circle'];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function toCssSize(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v + 'px';
    return String(v);
  }

  function Skeleton(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Skeleton] window.MyAgent.utils.el 不可用');
    }

    var variant = VALID_VARIANT.indexOf(options.variant) >= 0 ? options.variant : 'text';
    var lines = typeof options.lines === 'number' && options.lines > 0 ? Math.floor(options.lines) : 1;
    var width = toCssSize(options.width);
    var height = toCssSize(options.height);

    var style = '';
    if (width) style += 'width:' + width + ';';
    if (height) style += 'height:' + height + ';';

    if (variant === 'text' && lines <= 1) {
      // 单行：普通块；宽度若未指定则 100%
      var single = u.el('span', {
        class: 'skeleton skeleton-text' + (options.className ? ' ' + options.className : ''),
        'aria-busy': 'true',
        'aria-live': 'polite',
      });
      if (style) single.setAttribute('style', style);
      function destroy() {
        if (single.parentNode) single.parentNode.removeChild(single);
      }
      return { el: single, destroy: destroy };
    }

    if (variant === 'text') {
      // 多行：最后一行 60% 宽
      var childrenArr = [];
      for (var i = 0; i < lines; i++) {
        var lastStyle = i === lines - 1 ? 'width:60%;' : '';
        var child = u.el('span', {
          class: 'skeleton skeleton-text',
          'aria-busy': 'true',
          'aria-live': 'polite',
        });
        if (lastStyle) child.setAttribute('style', lastStyle);
        childrenArr.push(child);
      }
      var wrap = u.el(
        'div',
        {
          class: 'skeleton-group' + (options.className ? ' ' + options.className : ''),
          'aria-busy': 'true',
          'aria-live': 'polite',
        },
        childrenArr,
      );
      function destroy() {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
      return { el: wrap, destroy: destroy };
    }

    // rect / circle
    var el2 = u.el('span', {
      class: 'skeleton skeleton-' + variant + (options.className ? ' ' + options.className : ''),
      'aria-busy': 'true',
      'aria-live': 'polite',
    });
    if (style) el2.setAttribute('style', style);
    function destroy() {
      if (el2.parentNode) el2.parentNode.removeChild(el2);
    }
    return { el: el2, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Skeleton = Skeleton;
})(typeof globalThis !== 'undefined' ? globalThis : this);
