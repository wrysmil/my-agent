/**
 * agent-create.js — 创建 Agent 弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var nameInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'Agent 名称', name: 'name' });
    var nameLabel = u.el('label', {}, ['名称']);
    var fileInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'Agent 文件路径', name: 'file' });
    var fileLabel = u.el('label', {}, ['文件路径']);
    var promptInput = u.el('textarea', { class: 'modal-input', placeholder: 'System Prompt', name: 'systemPrompt', rows: '3' });
    var promptLabel = u.el('label', {}, ['System Prompt']);

    var content = u.el('div', { class: 'modal-form' }, [nameLabel, nameInput, fileLabel, fileInput, promptLabel, promptInput]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['创建']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '创建 Agent', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      if (!name) return;
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:agent-create', {
          detail: { name: name, file: fileInput.value.trim(), systemPrompt: promptInput.value.trim() },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.agentCreate = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
