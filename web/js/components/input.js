/**
 * input.js — Input 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Input。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - text / password / number / email / tel / url 等 type
 *   - 关联 <label for=...>（自动生成 id）
 *   - error 状态：aria-invalid="true" + aria-describedby 指向错误文案节点
 *   - disabled / readonly / required
 *
 * 暴露的实例 API：
 *   - input.el          —— 包含 label + input + 错误提示的 <div class="field"> 根节点
 *   - input.inputEl     —— 真正的 <input> 节点（便于直接 focus / 取值）
 *   - input.destroy()   —— 解除 listener + 摘除节点
 *
 * 构造选项 options：
 *   {
 *     type?:       'text' | 'password' | 'number' | 'email' | 'tel' | 'url' | 'search',  // 默认 'text'
 *     name?:       string,
 *     value?:      string,
 *     placeholder?:string,
 *     label?:      string,
 *     error?:      string,        // 设置后渲染错误提示并标记 aria-invalid
 *     helpText?:   string,        // 描述文本（与 error 互斥，error 优先）
 *     required?:   boolean,
 *     disabled?:   boolean,
 *     readOnly?:   boolean,
 *     maxLength?:  number,
 *     minLength?:  number,
 *     min?:        number,
 *     max?:        number,
 *     pattern?:    string,
 *     autocomplete?:string,
 *     id?:         string,        // 不传则自动生成 input-{随机}
 *     className?:  string,
 *     onInput?:    function,      // (value, ev)
 *     onChange?:   function,      // (value, ev)
 *   }
 */
(function (global) {
  'use strict';

  var VALID_TYPES = [
    'text', 'password', 'number', 'email', 'tel', 'url', 'search',
  ];

  function normalizeType(t) {
    if (VALID_TYPES.indexOf(t) >= 0) return t;
    return 'text';
  }

  function genId(prefix) {
    return (
      (prefix || 'input') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  /**
   * 构造一个 Input 实例。
   * @param {object} [options]
   */
  function Input(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Input] window.MyAgent.utils.el 不可用');
    }

    var type = normalizeType(options.type);
    var id = options.id ? String(options.id) : genId('input');
    var hasError = !!options.error;
    var helpText = options.helpText ? String(options.helpText) : '';
    var errorId = id + '-error';
    var helpId = id + '-help';
    var describedByParts = [];

    // children: label + input + (help | error)
    var children = [];

    if (options.label) {
      var labelAttrs = { for: id, class: 'field-label' };
      children.push(u.el('label', labelAttrs, [String(options.label)]));
    }

    var inputAttrs = {
      id: id,
      type: type,
      class: 'field-input' + (hasError ? ' field-input-error' : ''),
    };
    if (options.name) inputAttrs.name = String(options.name);
    if (options.placeholder) inputAttrs.placeholder = String(options.placeholder);
    if (options.value != null) inputAttrs.value = String(options.value);
    if (options.required) inputAttrs.required = true;
    if (options.disabled) {
      inputAttrs.disabled = true;
      inputAttrs['aria-disabled'] = 'true';
    }
    if (options.readOnly) inputAttrs.readOnly = true;
    if (typeof options.maxLength === 'number') inputAttrs.maxLength = options.maxLength;
    if (typeof options.minLength === 'number') inputAttrs.minLength = options.minLength;
    if (typeof options.min === 'number') inputAttrs.min = options.min;
    if (typeof options.max === 'number') inputAttrs.max = options.max;
    if (options.pattern) inputAttrs.pattern = String(options.pattern);
    if (options.autocomplete) inputAttrs.autocomplete = String(options.autocomplete);
    if (hasError) {
      inputAttrs['aria-invalid'] = 'true';
      inputAttrs['aria-describedby'] = errorId;
      describedByParts.push(errorId);
    } else if (helpText) {
      inputAttrs['aria-describedby'] = helpId;
      describedByParts.push(helpId);
    }

    var inputEl = u.el('input', inputAttrs);

    if (typeof options.onInput === 'function') {
      inputEl.addEventListener('input', function (ev) {
        try {
          options.onInput(inputEl.value, ev);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Input] onInput 抛错:', err);
          }
        }
      });
    }
    if (typeof options.onChange === 'function') {
      inputEl.addEventListener('change', function (ev) {
        try {
          options.onChange(inputEl.value, ev);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Input] onChange 抛错:', err);
          }
        }
      });
    }

    children.push(inputEl);

    // error 文案节点
    if (hasError) {
      children.push(
        u.el(
          'div',
          { id: errorId, class: 'field-error', role: 'alert' },
          [String(options.error)],
        ),
      );
    } else if (helpText) {
      children.push(
        u.el('div', { id: helpId, class: 'field-help' }, [helpText]),
      );
    }

    var rootClasses = ['field'];
    if (options.className) rootClasses.push(String(options.className));
    if (hasError) rootClasses.push('field-has-error');

    var root = u.el('div', { class: rootClasses.join(' ') }, children);

    function destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    return { el: root, inputEl: inputEl, destroy: destroy };
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.Input = Input;
})(typeof globalThis !== 'undefined' ? globalThis : this);
