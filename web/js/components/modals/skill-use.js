/**
 * skill-use.js — Skill 使用弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var nameInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'Skill 名称', name: 'name' });
    var label = u.el('label', {}, ['Skill 名称']);
    var content = u.el('div', { class: 'modal-form' }, [label, nameInput]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['使用']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '使用 Skill', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      if (!name) return;
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:skill-use', { detail: { name: name }, bubbles: true, cancelable: true }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.skillUse = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
