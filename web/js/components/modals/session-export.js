/**
 * session-export.js — 导出会话弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var formatSelect = u.el('select', { class: 'modal-input', name: 'format' }, [
      u.el('option', { value: 'json' }, ['JSON']),
      u.el('option', { value: 'markdown' }, ['Markdown']),
    ]);
    var formatLabel = u.el('label', {}, ['导出格式']);
    var pathInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: '导出路径（可选）', name: 'path' });
    var pathLabel = u.el('label', {}, ['路径']);
    var content = u.el('div', { class: 'modal-form' }, [formatLabel, formatSelect, pathLabel, pathInput]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['导出']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '导出会话', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:session-export', {
          detail: { format: formatSelect.value, path: pathInput.value.trim() },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.sessionExport = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
