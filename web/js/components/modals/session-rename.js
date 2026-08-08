/**
 * session-rename.js — 重命名会话弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var sessionId = options.sessionId || '';
    var newTitleInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: '新标题', name: 'newTitle' });
    var label = u.el('label', {}, ['新标题']);
    var content = u.el('div', { class: 'modal-form' }, [label, newTitleInput]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['重命名']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '重命名会话', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      var newTitle = newTitleInput.value.trim();
      if (!newTitle || !sessionId) return;
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:session-rename', {
          detail: { sessionId: sessionId, title: newTitle },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.sessionRename = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
