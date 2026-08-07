/**
 * textarea.js — Textarea 基础组件（spec § 4.4.5 F6 / WU-04c）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.Textarea。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 *
 * 职责（spec § 4.4.5 + accessibility-checklist § Essential Checks）：
 *   - 多行输入，rows 控制默认行数
 *   - auto-grow：随内容增长直到 maxRows（默认 12）
 *   - char count：showCount=true 时显示「已输入 N / maxLength」
 *   - error 状态：aria-invalid="true" + aria-describedby 指向错误文案
 *
 * 暴露的实例 API：
 *   - textarea.el          —— 根 <div class="field">
 *   - textarea.inputEl     —— 真正的 <textarea> 节点
 *   - textarea.destroy()   —— 摘除节点 + 解除 listener
 *
 * 构造选项 options：
 *   {
 *     name?:       string,
 *     value?:      string,
 *     placeholder?:string,
 *     label?:      string,
 *     rows?:       number,    // 默认 3
 *     maxRows?:    number,    // auto-grow 上限，默认 12
 *     maxLength?:  number,
 *     showCount?:  boolean,   // 默认 false
 *     autoGrow?:   boolean,   // 默认 false
 *     error?:      string,
 *     helpText?:   string,
 *     required?:   boolean,
 *     disabled?:   boolean,
 *     readOnly?:   boolean,
 *     id?:         string,
 *     onInput?:    function,
 *     onChange?:   function,
 *   }
 */
(function (global) {
  'use strict';

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'textarea') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  function autoResize(ta, maxRows) {
    ta.style.height = 'auto';
    var max = (maxRows || 12) * 1.5 * 14; // 估算：1.5 line-height × 14px（保守上界）
    var next = Math.min(ta.scrollHeight, max);
    ta.style.height = next + 'px';
  }

  function Textarea(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[Textarea] window.MyAgent.utils.el 不可用');
    }

    var id = options.id ? String(options.id) : genId('textarea');
    var rows = typeof options.rows === 'number' && options.rows > 0 ? options.rows : 3;
    var maxRows = typeof options.maxRows === 'number' && options.maxRows > 0 ? options.maxRows : 12;
    var hasError = !!options.error;
    var errorId = id + '-error';
    var helpId = id + '-help';
    var countId = id + '-count';

    var children = [];

    if (options.label) {
      children.push(
        u.el('label', { for: id, class: 'field-label' }, [String(options.label)]),
      );
    }

    var taAttrs = {
      id: id,
      class: 'field-textarea' + (hasError ? ' field-textarea-error' : ''),
      rows: rows,
    };
    if (options.name) taAttrs.name = String(options.name);
    if (options.placeholder) taAttrs.placeholder = String(options.placeholder);
    if (options.value != null) taAttrs.value = String(options.value);
    if (options.required) taAttrs.required = true;
    if (options.disabled) {
      taAttrs.disabled = true;
      taAttrs['aria-disabled'] = 'true';
    }
    if (options.readOnly) taAttrs.readOnly = true;
    if (typeof options.maxLength === 'number') taAttrs.maxLength = options.maxLength;

    // aria-describedby：error 优先，否则 helpText / char count
    var describedBy = [];
    if (hasError) describedBy.push(errorId);
    else if (options.helpText) describedBy.push(helpId);
    if (options.showCount) describedBy.push(countId);
    if (describedBy.length) taAttrs['aria-describedby'] = describedBy.join(' ');
    if (hasError) taAttrs['aria-invalid'] = 'true';

    var inputEl = u.el('textarea', taAttrs);

    if (options.autoGrow) {
      // 初始化 + 监听
      autoResize(inputEl, maxRows);
      inputEl.addEventListener('input', function () {
        autoResize(inputEl, maxRows);
      });
    }

    if (options.showCount) {
      var max = typeof options.maxLength === 'number' ? options.maxLength : null;
      var initial = (options.value || '').length;
      var countNode = u.el(
        'div',
        { id: countId, class: 'field-count', 'aria-live': 'polite' },
        max != null ? [String(initial) + ' / ' + String(max)] : [String(initial)],
      );
      // inputEl 后面追加 count
      inputEl.addEventListener('input', function () {
        var len = inputEl.value.length;
        countNode.textContent = max != null ? len + ' / ' + max : String(len);
      });
      children.push(inputEl, countNode);
    } else {
      children.push(inputEl);
    }

    if (hasError) {
      children.push(
        u.el(
          'div',
          { id: errorId, class: 'field-error', role: 'alert' },
          [String(options.error)],
        ),
      );
    } else if (options.helpText) {
      children.push(
        u.el('div', { id: helpId, class: 'field-help' }, [String(options.helpText)]),
      );
    }

    if (typeof options.onInput === 'function') {
      inputEl.addEventListener('input', function (ev) {
        try {
          options.onInput(inputEl.value, ev);
        } catch (err) {
          if (global.console && typeof global.console.error === 'function') {
            global.console.error('[Textarea] onInput 抛错:', err);
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
            global.console.error('[Textarea] onChange 抛错:', err);
          }
        }
      });
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
  global.MyAgent.components.Textarea = Textarea;
})(typeof globalThis !== 'undefined' ? globalThis : this);
