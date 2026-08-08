/**
 * provider-add.js — 添加 Provider 弹窗（F18 modals / WU-07a）
 */
(function (global) {
  'use strict';

  function buildModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    function field(label, el) {
      return u.el('div', { class: 'modal-field' }, [u.el('label', {}, [label]), el]);
    }

    var idInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'deepseek', name: 'id' });
    var nameInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'DeepSeek', name: 'name' });
    var typeInput = u.el('input', { type: 'text', class: 'modal-input', value: 'deepseek', readonly: true, name: 'type' });
    var apiKeyInput = u.el('input', { type: 'password', class: 'modal-input', placeholder: 'sk-...', name: 'apiKey' });
    var baseUrlInput = u.el('input', { type: 'url', class: 'modal-input', placeholder: 'https://api.deepseek.com/v1', name: 'baseUrl' });
    var modelInput = u.el('input', { type: 'text', class: 'modal-input', placeholder: 'deepseek-chat', name: 'defaultModel' });
    var enabledInput = u.el('input', { type: 'checkbox', checked: true, name: 'enabled' });

    var content = u.el('div', { class: 'modal-form' }, [
      field('ID', idInput), field('名称', nameInput), field('类型', typeInput),
      field('API Key', apiKeyInput), field('Base URL', baseUrlInput),
      field('默认模型', modelInput),
      u.el('div', { class: 'modal-field' }, [u.el('label', {}, [enabledInput, ' 启用'])]),
    ]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['添加']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '添加 Provider', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      var id = idInput.value.trim();
      if (!id) return;
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:provider-add', {
          detail: { id: id, name: nameInput.value.trim(), type: 'deepseek', apiKey: apiKeyInput.value,
            baseUrl: baseUrlInput.value.trim(), defaultModel: modelInput.value.trim(), enabled: enabledInput.checked },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.providerAdd = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
