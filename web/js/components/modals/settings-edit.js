/**
 * settings-edit.js — 设置弹窗（F18 modals / WU-07a）
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

    var langSelect = u.el('select', { class: 'modal-input', name: 'language' }, [
      u.el('option', { value: 'zh' }, ['中文']),
      u.el('option', { value: 'en' }, ['English']),
    ]);
    var themeSelect = u.el('select', { class: 'modal-input', name: 'themeMode' }, [
      u.el('option', { value: 'system' }, ['跟随系统']),
      u.el('option', { value: 'dark' }, ['深色']),
      u.el('option', { value: 'light' }, ['浅色']),
    ]);
    var autoCompactInput = u.el('input', { type: 'checkbox', checked: false, name: 'autoCompact' });

    var content = u.el('div', { class: 'modal-form' }, [
      field('语言', langSelect),
      field('主题', themeSelect),
      u.el('div', { class: 'modal-field' }, [u.el('label', {}, [autoCompactInput, ' 自动压缩上下文'])]),
    ]);

    var cancelBtn = u.el('button', { type: 'button', class: 'btn btn-secondary' }, ['取消']);
    var okBtn = u.el('button', { type: 'button', class: 'btn btn-primary' }, ['保存']);
    var footer = u.el('div', { class: 'modal-footer-btns' }, [cancelBtn, okBtn]);

    var modal = new Modal({ title: '设置', content: content, footer: footer, onClose: function () { modal.destroy(); } });
    cancelBtn.addEventListener('click', function () { modal.close(); });
    okBtn.addEventListener('click', function () {
      if (global.document && typeof global.CustomEvent === 'function') {
        global.document.dispatchEvent(new global.CustomEvent('my-agent:settings-save', {
          detail: { language: langSelect.value, themeMode: themeSelect.value, autoCompact: autoCompactInput.checked },
          bubbles: true, cancelable: true,
        }));
      }
      modal.close();
    });
    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.settingsEdit = buildModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
