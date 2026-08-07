/**
 * card.js — Card 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Card。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 通用容器：<article> 根（语义化）
 *   - header / body / footer 三个 slot（都可选）
 *   - 可点击：as="button" 时整卡片键盘可达
 *
 * 暴露的实例 API：
 *   - card.el          —— 根 <article> 节点
 *   - card.destroy()   —— 摘除节点
 *
 * 构造选项 options：
 *   {
 *     title?:    string,
 *     subtitle?: string,
 *     children?: Node | Node[] | string,
 *     footer?:   Node | string,
 *     as?:       'article' | 'button' | 'div',   // 默认 'article'
 *     interactive?: boolean,                      // as=button 时 keyboard
 *     onClick?:  function,
 *     className?:string,
 *     id?:       string,
 *   }
 */
(function (global) {
  'use strict';

  var VALID_AS = ['article', 'button', 'div'];

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function Card(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Card] window.MyAgent.utils.el 不可用');
    }

    var as = VALID_AS.indexOf(options.as) >= 0 ? options.as : 'article';
    var interactive = options.interactive || as === 'button';

    var rootAttrs = {
      class: 'card' + (options.className ? ' ' + String(options.className) : '') +
             (interactive ? ' card-interactive' : ''),
    };
    if (options.id) rootAttrs.id = String(options.id);
    if (as === 'button') {
      rootAttrs.type = 'button';
    }
    if (interactive) {
      rootAttrs.tabindex = '0';
    }

    var root = u.el(as, rootAttrs);

    // header
    if (options.title || options.subtitle) {
      var headerChildren = [];
      if (options.title) {
        headerChildren.push(u.el('h3', { class: 'card-title' }, [String(options.title)]));
      }
      if (options.subtitle) {
        headerChildren.push(u.el('p', { class: 'card-subtitle' }, [String(options.subtitle)]));
      }
      var header = u.el('div', { class: 'card-header' }, headerChildren);
      root.appendChild(header);
    }

    // body
    if (options.children != null) {
      var bodyChildren = [];
      if (Array.isArray(options.children)) {
        bodyChildren = options.children;
      } else if (options.children && typeof options.children === 'object' && 'nodeType' in options.children) {
        bodyChildren = [options.children];
      } else {
        bodyChildren = [String(options.children)];
      }
      var body = u.el('div', { class: 'card-body' }, bodyChildren);
      root.appendChild(body);
    }

    // footer
    if (options.footer != null) {
      var footerChildren = [];
      if (options.footer && typeof options.footer === 'object' && 'nodeType' in options.footer) {
        footerChildren = [options.footer];
      } else {
        footerChildren = [String(options.footer)];
      }
      var footerNode = u.el('div', { class: 'card-footer' }, footerChildren);
      root.appendChild(footerNode);
    }

    if (typeof options.onClick === 'function') {
      var guarded = function (ev) {
        try {
          options.onClick(ev);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Card] onClick 抛错:', err);
          }
        }
      };
      root.addEventListener('click', guarded);
    }

    function destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Card = Card;
})(typeof globalThis !== 'undefined' ? globalThis : this);
