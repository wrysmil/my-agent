/**
 * dialogs.js — 对话框系统（uiChoice / uiConfirm / uiAlert）
 *
 * 挂载到 window:
 *   uiChoice({ title, message, choices, cancelLabel, highlight }) → Promise<string|null>
 *   uiConfirm({ title, message, confirmLabel, cancelLabel, danger }) → Promise<boolean>
 *   uiAlert({ title, message }) → Promise<void>
 *
 * 键盘: Enter = 高亮按钮，Escape = 取消/关闭。
 * 消息文本经 escapeHtml() 转义后写入 body.innerHTML，防 XSS。
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  var _overlay = null;       // 当前 overlay 元素
  var _pending = null;       // { resolve, escapeValue } — 待 settle 的对话框
  var _onKeydown = null;     // document keydown（capture）
  var _onOverlayDown = null; // overlay mousedown

  // ============================================================
  // 工具
  // ============================================================

  function _t(key) {
    if (typeof root.t === 'function') return root.t(key);
    return key;
  }

  function _esc(str) {
    if (typeof root.escapeHtml === 'function') return root.escapeHtml(str);
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================================
  // 清理
  // ============================================================

  /**
   * 若上一个对话框尚未 settle，以“取消”语义结束它（防 Promise 悬挂）。
   */
  function _settlePending() {
    if (_pending) {
      var p = _pending;
      _pending = null;
      p.resolve(p.escapeValue);
    }
  }

  /**
   * 关闭并清理对话框：移除 overlay + 移除键盘/遮罩事件监听。
   * 注意：本函数只负责 DOM/事件清理，不主动 resolve（由调用方 resolve）。
   */
  function _closeDialog() {
    if (_onKeydown) {
      document.removeEventListener('keydown', _onKeydown, true);
      _onKeydown = null;
    }
    if (_onOverlayDown && _overlay) {
      _overlay.removeEventListener('mousedown', _onOverlayDown);
      _onOverlayDown = null;
    }
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
    _pending = null;
  }

  // ============================================================
  // 通用打开逻辑
  // ============================================================

  /**
   * 打开对话框。
   * @param {object} config
   *   title         - 标题文本（textContent 设置，天然防 XSS）
   *   message       - 消息文本（经 escapeHtml 转义）
   *   buttons       - [{ label, cls, value }] 按钮数组（按渲染顺序）
   *   highlightValue- Enter 触发的高亮按钮 value（null 表示无高亮）
   *   escapeValue   - Escape / 点击遮罩关闭时 resolve 的值
   *   resolve       - Promise resolve 回调
   */
  function _openDialog(config) {
    _settlePending();
    _closeDialog();

    var overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    var dialog = document.createElement('div');
    dialog.className = 'dialog';

    var header = document.createElement('div');
    header.className = 'dialog-header';
    header.textContent = config.title || '';

    var body = document.createElement('div');
    body.className = 'dialog-body';
    body.innerHTML = _esc(config.message || '');

    var footer = document.createElement('div');
    footer.className = 'dialog-footer';

    var highlightEl = null;
    var buttons = config.buttons || [];
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn ' + btn.cls;
        el.textContent = btn.label;
        if (btn.value === config.highlightValue) highlightEl = el;
        el.addEventListener('click', function () {
          _closeDialog();
          config.resolve(btn.value);
        });
        footer.appendChild(el);
      })(buttons[i]);
    }

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    _overlay = overlay;
    _pending = { resolve: config.resolve, escapeValue: config.escapeValue };

    // 键盘：Enter = 高亮按钮，Escape = 取消
    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _closeDialog();
        config.resolve(config.escapeValue);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        _closeDialog();
        config.resolve(config.highlightValue);
      }
    }
    document.addEventListener('keydown', onKeydown, true);
    _onKeydown = onKeydown;

    // 点击遮罩（对话框外区域）→ 取消
    function onOverlayDown(e) {
      if (e.target === overlay) {
        _closeDialog();
        config.resolve(config.escapeValue);
      }
    }
    overlay.addEventListener('mousedown', onOverlayDown);
    _onOverlayDown = onOverlayDown;

    // 高亮按钮获得焦点（配合 Enter 语义）
    if (highlightEl && highlightEl.focus) {
      highlightEl.focus();
    }
  }

  // ============================================================
  // 对外 API
  // ============================================================

  /**
   * 选择对话框。
   * @param {object} opts
   *   choices   - [{ label, value }] 或字符串数组；选择结果 resolve 该项 value
   *   highlight - 高亮按钮（btn-primary），按 value 或下标匹配
   *   cancelLabel - 取消按钮文案，默认 t('dialog.cancel')
   * @returns {Promise<string|null>} 选择项 value；取消/Escape → null
   */
  root.uiChoice = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var choices = opts.choices || [];
      var buttons = [];
      var highlightValue = null;

      for (var i = 0; i < choices.length; i++) {
        var c = choices[i];
        if (c === null || c === undefined) continue;
        var val = (c.value !== undefined) ? c.value : c;
        var label = (c.label !== undefined) ? c.label : String(c);
        var isHl = false;
        if (opts.highlight !== undefined && opts.highlight !== null) {
          isHl = (Number(opts.highlight) === i) || (String(opts.highlight) === String(val));
        }
        if (isHl) highlightValue = val;
        buttons.push({ label: label, cls: isHl ? 'btn-primary' : 'btn-ghost', value: val });
      }

      // 未指定 highlight → 默认第一个选择项为高亮
      if (highlightValue === null && buttons.length) {
        highlightValue = buttons[0].value;
      }

      buttons.push({
        label: opts.cancelLabel || _t('dialog.cancel'),
        cls: 'btn-ghost',
        value: null,
      });

      _openDialog({
        title: opts.title || '',
        message: opts.message || '',
        buttons: buttons,
        highlightValue: highlightValue,
        escapeValue: null,
        resolve: resolve,
      });
    });
  };

  /**
   * 确认对话框。
   * @param {object} opts
   *   danger - true 时确认按钮变为红色 btn-danger
   * @returns {Promise<boolean>} 确认 → true，取消/Escape → false
   */
  root.uiConfirm = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var confirmCls = opts.danger ? 'btn-danger' : 'btn-primary';
      _openDialog({
        title: opts.title || '',
        message: opts.message || '',
        buttons: [
          { label: opts.cancelLabel || _t('dialog.cancel'), cls: 'btn-ghost', value: false },
          { label: opts.confirmLabel || _t('dialog.confirm'), cls: confirmCls, value: true },
        ],
        highlightValue: true,
        escapeValue: false,
        resolve: resolve,
      });
    });
  };

  /**
   * 提示对话框。
   * @returns {Promise<void>} 确定 / Escape 均 resolve
   */
  root.uiAlert = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      _openDialog({
        title: opts.title || '',
        message: opts.message || '',
        buttons: [
          { label: opts.okLabel || _t('dialog.ok'), cls: 'btn-primary', value: undefined },
        ],
        highlightValue: undefined,
        escapeValue: undefined,
        resolve: resolve,
      });
    });
  };
})();
