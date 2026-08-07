/**
 * chat-input-form.js — 动态表单渲染（聊天内嵌表单）
 *
 * 挂载到 window:
 *   renderChatForm(container, payload, onSubmit) → { destroy }
 *
 * payload: {
 *   formId, title,
 *   fields: [{ name, type, label, required?, options?, placeholder? }]
 * }
 *   type: text | number | textarea | select | checkbox | radio
 *   options（select/radio）: [{ label, value }] 或字符串数组
 *
 * 草稿: 模块级 _formDrafts（Map），key = `sessionId::formId`。
 *   - 渲染时若有草稿则回填；提交时保存草稿
 *   - 阶段3 仅提供框架与草稿机制，阶段5 由 chat 模块接入
 *
 * 返回 { destroy } 用于卸载表单。
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  var _formDrafts = new Map();

  // ============================================================
  // 工具
  // ============================================================

  function _getSessionId() {
    if (typeof currentSessionId !== 'undefined' && currentSessionId) {
      return currentSessionId;
    }
    return '';
  }

  function _draftKey(formId) {
    return _getSessionId() + '::' + (formId || '');
  }

  function _el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function _optionValue(o, index) {
    if (o && typeof o === 'object' && o.value !== undefined) return o.value;
    if (typeof o === 'string') return o;
    return String(o !== undefined ? o : index);
  }

  function _optionLabel(o, value) {
    if (o && typeof o === 'object' && o.label !== undefined) return o.label;
    return String(o !== undefined ? o : value);
  }

  // ============================================================
  // 字段渲染
  // ============================================================

  /**
   * 构建单个字段包装节点，返回 { wrap, controls }。
   * controls: 参与取值的控件列表（NodeList 或单个元素）。
   */
  function _buildField(field) {
    var wrap = _el('div', 'chat-form-field');
    var controls = null;

    // checkbox：单行 label 内嵌复选框
    if (field.type === 'checkbox') {
      var checkLabel = _el('label', 'chat-form-checkbox');
      var checkInput = _el('input');
      checkInput.type = 'checkbox';
      checkInput.name = field.name || '';
      if (field.required) checkInput.required = true;
      checkLabel.appendChild(checkInput);
      checkLabel.appendChild(_el('span', null, field.label || ''));
      wrap.appendChild(checkLabel);
      controls = checkLabel.querySelectorAll('input');
      return { wrap: wrap, controls: controls };
    }

    // radio：组标签 + 多个单选行
    if (field.type === 'radio') {
      wrap.appendChild(_el('label', 'chat-form-label', field.label || ''));
      var radios = field.options || [];
      var groupName = 'field_' + (field.name || '') + '_' + Math.random().toString(36).slice(2, 7);
      for (var j = 0; j < radios.length; j++) {
        var rv = _optionValue(radios[j], j);
        var rl = _optionLabel(radios[j], rv);
        var row = _el('label', 'chat-form-radio');
        var radio = _el('input');
        radio.type = 'radio';
        radio.name = groupName;
        radio.value = rv;
        if (field.required && j === 0) radio.required = true;
        row.appendChild(radio);
        row.appendChild(_el('span', null, rl));
        wrap.appendChild(row);
      }
      controls = wrap.querySelectorAll('input');
      return { wrap: wrap, controls: controls };
    }

    // 其余类型：label + 单值控件
    var fieldLabel = _el('label', 'chat-form-label', field.label || '');
    if (field.required) fieldLabel.textContent = (field.label || '') + ' *';
    wrap.appendChild(fieldLabel);

    var input;
    if (field.type === 'textarea') {
      input = _el('textarea', 'chat-form-textarea');
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.required) input.required = true;
    } else if (field.type === 'select') {
      input = _el('select', 'chat-form-select');
      var opts = field.options || [];
      for (var i = 0; i < opts.length; i++) {
        var ov = _optionValue(opts[i], i);
        var ol = _optionLabel(opts[i], ov);
        var option = _el('option', null, ol);
        option.value = ov;
        input.appendChild(option);
      }
      if (field.required) input.required = true;
    } else {
      // text / number
      input = _el('input', 'chat-form-input');
      input.type = (field.type === 'number') ? 'number' : 'text';
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.required) input.required = true;
    }
    input.name = field.name || '';
    wrap.appendChild(input);
    return { wrap: wrap, controls: input };
  }

  /**
   * 从控件收集表单数据。
   * controlsMap: name → 单值元素 | NodeList（checkbox/radio 组）
   */
  function _collectValues(controlsMap) {
    var data = {};
    var names = Object.keys(controlsMap);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var control = controlsMap[name];
      if (!control) continue;

      if (control.tagName) {
        // 单值控件
        data[name] = (control.type === 'checkbox') ? control.checked : control.value;
        continue;
      }

      // checkbox / radio 组（NodeList）
      var isCheckbox = false;
      var checkedValue = null;
      for (var j = 0; j < control.length; j++) {
        var node = control[j];
        if (node.type === 'checkbox') {
          isCheckbox = true;
          data[name] = node.checked;
          break;
        }
        if (node.type === 'radio' && node.checked) {
          checkedValue = node.value;
        }
      }
      if (!isCheckbox) data[name] = (checkedValue !== null) ? checkedValue : '';
    }
    return data;
  }

  /**
   * 用草稿回填控件。
   */
  function _applyDraft(controlsMap, draft) {
    if (!draft) return;
    var names = Object.keys(controlsMap);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (draft[name] === undefined) continue;
      var control = controlsMap[name];
      if (!control) continue;

      if (control.tagName) {
        if (control.type === 'checkbox') {
          control.checked = !!draft[name];
        } else {
          control.value = draft[name];
        }
        continue;
      }

      for (var j = 0; j < control.length; j++) {
        var node = control[j];
        if (node.type === 'checkbox') {
          node.checked = !!draft[name];
        } else if (node.type === 'radio' && String(node.value) === String(draft[name])) {
          node.checked = true;
        }
      }
    }
  }

  // ============================================================
  // 对外 API
  // ============================================================

  /**
   * 在 container 内渲染动态表单。
   * @param {Element} container - 承载表单的 DOM 容器
   * @param {object} payload - { formId, title, fields[], submitLabel? }
   * @param {Function} onSubmit - (formData) => void，提交时回调
   * @returns {{ destroy: Function }}
   */
  function renderChatForm(container, payload, onSubmit) {
    payload = payload || {};
    if (!container) return { destroy: function () {} };

    var key = _draftKey(payload.formId);
    var form = _el('form', 'chat-form');
    var controlsMap = {};

    form.appendChild(_el('div', 'chat-form-title', payload.title || ''));

    var fields = payload.fields || [];
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field || !field.name) continue;
      var built = _buildField(field);
      form.appendChild(built.wrap);
      controlsMap[field.name] = built.controls;
    }

    var submitBtn = _el('button', 'btn btn-primary chat-form-submit', payload.submitLabel || '提交');
    submitBtn.type = 'submit';
    form.appendChild(submitBtn);

    // 草稿回填
    _applyDraft(controlsMap, _formDrafts.get(key));

    function onFormSubmit(e) {
      e.preventDefault();
      var data = _collectValues(controlsMap);
      _formDrafts.set(key, data);
      if (typeof onSubmit === 'function') onSubmit(data);
    }
    form.addEventListener('submit', onFormSubmit);

    container.appendChild(form);

    return {
      destroy: function () {
        form.removeEventListener('submit', onFormSubmit);
        if (form.parentNode) form.parentNode.removeChild(form);
      },
    };
  }

  root.renderChatForm = renderChatForm;
})();
