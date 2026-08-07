/**
 * utils.js — 前端 DOM / event / escape / format 共享小工具（F3 / WU-04a）
 *
 * 设计约束：
 * - 零依赖：纯 ES2023 + DOM API；与 icons.js / theme.js 同样挂在 window.MyAgent.utils。
 * - 不引 emoji / 不引模板字符串以外的字符串插值（防御注入）。
 * - 全部函数为「纯函数 + 极小副作用」—— 不监听、不挂全局、不写 localStorage。
 *
 * 职责：
 *   $ / $$      — querySelector 糖（语义与 jQuery 兼容）
 *   el          — 元素构造器（h() 的最小版；attrs 支持 class / dataset / aria-* / event）
 *   escapeHtml  — 把字符串转成 textContent 可直接吃的形态（不替代 DOMPurify）
 *   on          — addEventListener + 返回 off() 自动 remove
 *   debounce    — trailing=true（leading=false）；标准 lodash 行为
 *   formatTime  — 三档时间格式：同秒 / 今天 / 跨天
 *   assert      — 断言；失败 console.error + throw
 *
 * 与其他模块的协作：
 *   - 不依赖 theme.js / icons.js / api.js / i18n.js
 *   - 是 api.js / i18n.js 的前置依赖（脚本加载顺序见 web/index.html）
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // $ / $$ — querySelector 糖
  // ------------------------------------------------------------------

  /**
   * 等价 `root.querySelector(sel)`；root 缺省 = document。
   * 返回首个匹配元素；无匹配返回 null。
   *
   * @param {string} sel
   * @param {ParentNode} [root=document]
   * @returns {Element | null}
   */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  /**
   * 等价 `[...root.querySelectorAll(sel)]`；root 缺省 = document。
   * 返回 Array（不是 NodeList），便于 .map / .filter）。
   *
   * @param {string} sel
   * @param {ParentNode} [root=document]
   * @returns {Element[]}
   */
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  // ------------------------------------------------------------------
  // el(tag, attrs, children) — 元素构造器
  // ------------------------------------------------------------------

  /**
   * 已知「无副作用」的 DOM 属性名（直接赋值即可，不走 setAttribute）。
   * 其余属性 / aria-* / dataset.* 走 setAttribute，规避 IE-style 命名兼容问题。
   */
  var NATIVE_PROPS = {
    id: true, title: true, lang: true, dir: true, tabIndex: true, hidden: true,
    type: true, name: true, value: true, href: true, src: true, alt: true,
    placeholder: true, disabled: true, checked: true, selected: true, readOnly: true,
    required: true, maxLength: true, minLength: true, min: true, max: true, step: true,
    rows: true, cols: true, role: true, style: true, autofocus: true,
  };

  /**
   * 元素构造器（h() 的最小版）。
   *
   * 用法：
   *   el('button', { class: 'btn', onclick: () => 1, 'aria-label': 'send' }, ['发送'])
   *
   * attrs 支持：
   *   - 字符串键（如 class / id / href）→ 直接赋值（白名单）或 setAttribute
   *   - 以 'on' 开头的函数（如 onclick / onmouseenter）→ addEventListener
   *   - 'data-*' / 'aria-*' / 其它 → setAttribute
   *   - dataset 简写（如 dataset: { foo: 'bar' }）→ element.dataset.foo = 'bar'
   *
   * children 支持：
   *   - string / number → textContent（不走 innerHTML，避免注入）
   *   - Node           → appendChild
   *   - null / undefined / false → 跳过
   *   - Array          → 扁平化后逐项 append
   *
   * @param {string} tag 标签名（小写约定，不强制）
   * @param {Object<string, any>} [attrs={}]
   * @param {Array<Node|string|number|null|undefined|false>} [children=[]]
   * @returns {HTMLElement}
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === undefined || value === null || value === false) return;

        // on* 事件
        if (key.length > 2 && key.slice(0, 2) === 'on' && typeof value === 'function') {
          var eventName = key.slice(2).toLowerCase();
          node.addEventListener(eventName, value);
          return;
        }

        // dataset 简写
        if (key === 'dataset' && value && typeof value === 'object') {
          Object.keys(value).forEach(function (dk) {
            node.dataset[dk] = String(value[dk]);
          });
          return;
        }

        // 字符串键：白名单直接赋值；其它走 setAttribute
        if (NATIVE_PROPS[key]) {
          node[key] = value;
        } else {
          node.setAttribute(key, String(value));
        }
      });
    }

    if (children) {
      appendChildren(node, children);
    }
    return node;
  }

  /**
   * 把 children 数组扁平化追加到 node。
   * 内部 helper，独立可测。
   *
   * @param {Node} node
   * @param {Array} children
   */
  function appendChildren(node, children) {
    // children 接受单值（非数组）的情况：向上兼容
    var arr = Array.isArray(children) ? children : [children];
    arr.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) {
        appendChildren(node, c);
        return;
      }
      // duck-type Node 检查（避免依赖全局 Node 常量；测试环境无 DOM）
      if (
        c &&
        typeof c === 'object' &&
        typeof c.nodeType === 'number' &&
        typeof c.parentNode !== 'undefined'
      ) {
        node.appendChild(c);
        return;
      }
      // string / number → textContent（绝不 innerHTML）
      node.appendChild(document.createTextNode(String(c)));
    });
  }

  // ------------------------------------------------------------------
  // escapeHtml — 用于 textContent 路径的字符串转义
  // ------------------------------------------------------------------

  /**
   * 把字符串中的 HTML 特殊字符转义为实体（& < > " '）。
   *
   * 注意：本函数**不**替代 DOMPurify。当业务需要把不可信字符串拼到 innerHTML 时
   * 仍要走 DOMPurify（见 spec § 4.4.6）。escapeHtml 只用于「即便误用也不会爆 XSS」
   * 的兜底层 —— 例如把用户输入写进 title 属性、写进 data-*、写进 aria-label。
   *
   * null / undefined / number / boolean → 返回其字符串形式（不会抛错）。
   *
   * @param {unknown} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    var s = String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------------
  // on(el, event, handler, opts) — addEventListener + 返回 off
  // ------------------------------------------------------------------

  /**
   * 注册事件并返回 off 函数（idempotent 解除）。
   *
   * 用法：
   *   var off = on(button, 'click', function () { ... });
   *   // ... 某时候
   *   off();   // 解除绑定
   *   off();   // 再次调用安全无副作用
   *
   * @param {EventTarget} el
   * @param {string} event
   * @param {EventListener} handler
   * @param {AddEventListenerOptions | boolean} [opts]
   * @returns {() => void} off —— 调用一次即解除，幂等
   */
  function on(el, event, handler, opts) {
    el.addEventListener(event, handler, opts);
    var removed = false;
    return function off() {
      if (removed) return;
      removed = true;
      el.removeEventListener(event, handler, opts);
    };
  }

  // ------------------------------------------------------------------
  // debounce(fn, ms) — leading=false, trailing=true
  // ------------------------------------------------------------------

  /**
   * 去抖：连续调用在 ms 静默后才真正触发；leading=false, trailing=true。
   *
   * 与 lodash _.debounce(fn, ms) 默认行为一致。
   *
   * @template {(...args: any[]) => void} F
   * @param {F} fn
   * @param {number} ms
   * @returns {F & { cancel(): void, flush(): void }}
   */
  function debounce(fn, ms) {
    var timer = null;
    var lastArgs = null;
    var lastThis = null;

    function debounced() {
      var args = arguments;
      var ctx = this;
      lastArgs = args;
      lastThis = ctx;

      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(function invoke() {
        timer = null;
        // trailing 触发
        fn.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }, ms);
    }

    debounced.cancel = function cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastArgs = null;
      lastThis = null;
    };

    debounced.flush = function flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        var args = lastArgs;
        var ctx = lastThis;
        lastArgs = null;
        lastThis = null;
        fn.apply(ctx, args);
      }
    };

    return debounced;
  }

  // ------------------------------------------------------------------
  // formatTime(ms) — 三档时间格式
  // ------------------------------------------------------------------

  /**
   * 三档时间格式：
   *   - 距今 ≤ 60 秒              → 「HH:mm:ss」（带秒；流式输出场景）
   *   - 今天（≥ 60 秒 且同日）    → 「今天 HH:mm」
   *   - 跨天（昨天或更早）        → 「YYYY-MM-DD HH:mm」
   *
   * 注：
   *   - 「今天」按本地时区判定（同年同月同日）。
   *   - 入参 ms 为 epoch 毫秒；非法 / NaN 返回空字符串。
   *   - 三档分界 60s 是经验值；spec 仅规定三档存在，未限定切分点。
   *
   * @param {number} ms
   * @returns {string}
   */
  function formatTime(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';

    var HH = pad2(d.getHours());
    var MM = pad2(d.getMinutes());
    var SS = pad2(d.getSeconds());

    var now = Date.now();
    var sameDay = isSameLocalDay(d, new Date(now));

    // 第一档：≤ 60 秒 —— HH:mm:ss
    if (sameDay && Math.abs(now - ms) <= 60_000) {
      return HH + ':' + MM + ':' + SS;
    }

    // 第二档：今天 —— 今天 HH:mm
    if (sameDay) {
      return '今天 ' + HH + ':' + MM;
    }

    // 第三档：跨天 —— YYYY-MM-DD HH:mm
    var YYYY = d.getFullYear();
    var MO = pad2(d.getMonth() + 1);
    var DD = pad2(d.getDate());
    return YYYY + '-' + MO + '-' + DD + ' ' + HH + ':' + MM;
  }

  /**
   * 本地时区下两个 Date 是否同一天。
   * @param {Date} a
   * @param {Date} b
   * @returns {boolean}
   */
  function isSameLocalDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /**
   * 把 0-9 补零到 2 位。
   * @param {number} n
   * @returns {string}
   */
  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // ------------------------------------------------------------------
  // assert(condition, msg)
  // ------------------------------------------------------------------

  /**
   * 断言；失败 console.error(msg) + throw new Error(msg)。
   * condition 为 truthy → 静默通过；为 falsy → 抛错。
   *
   * 设计意图：用于「违反前提直接退出」的内部 invariant；与业务校验（走 ErrorState）
   * 区分。
   *
   * @param {unknown} condition
   * @param {string} [msg='Assertion failed']
   * @returns {void}
   */
  function assert(condition, msg) {
    if (condition) return;
    var text = msg || 'Assertion failed';
    if (global.console && typeof global.console.error === 'function') {
      global.console.error('[utils] assert failed: ' + text);
    }
    throw new Error(text);
  }

  // ------------------------------------------------------------------
  // 导出（与 icons.js 同模式：global 对象挂载 + 命名空间）
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.utils = {
    $: $,
    $$: $$,
    el: el,
    escapeHtml: escapeHtml,
    on: on,
    debounce: debounce,
    formatTime: formatTime,
    assert: assert,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);