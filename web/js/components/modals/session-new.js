/**
 * session-new.js — 新建会话弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var titleInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: '会话标题（可选）', name: 'title' });
    var titleLabel = u.el('label', {}, ['标题']);
    var modelInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: '模型（可选）', name: 'model' });
    var modelLabel = u.el('label', {}, ['模型']);
    var content = u.el('div', { class: 'modal-form' }, [titleLabel, titleInput, modelLabel, modelInput]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['创建']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '新建会话', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:session-new', {
          detail: { title: titleInput.value.trim(), model: modelInput.value.trim() },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.sessionNew = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
