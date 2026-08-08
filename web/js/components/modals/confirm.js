/**
 * confirm.js — 确认对话框（F18 modals / WU-07a）
 *
 * 挂在 window.MyAgent.modals.confirm。
 * 用法: MyAgent.modals.confirm({ message, onConfirm, onCancel, title })
 */
(function (global) {
  'use strict';

  function buildConfirmModal(options) {
    options = options || {};
    var u = (global.MyAgent && global.MyAgent.utils) || {};
    var Modal = (global.MyAgent && global.MyAgent.components && global.MyAgent.components.Modal);
    if (!u.el || !Modal) return null;

    var message = options.message || '确认执行此操作？';
    var title = options.title || '确认';
    var onConfirm = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    var onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;

    var content = u.el('div', { class: 'confirm-body' }, [
      u.el('p', { class: 'confirm-message' }, [String(message)]),
    ]);

    var cancelBtn = u.el('button', {
      type: 'button',
      class: 'btn btn-secondary',
    }, ['取消']);

    var okBtn = u.el('button', {
      type: 'button',
      class: 'btn btn-primary btn-danger',
    }, ['确认']);

    var footer = u.el('div', { class: 'confirm-footer' }, [cancelBtn, okBtn]);

    var modal = new Modal({
      title: title,
      content: content,
      footer: footer,
      closeOnOverlay: true,
      closeOnEsc: true,
      onClose: function () {
        modal.destroy();
      },
    });

    cancelBtn.addEventListener('click', function () {
      if (onCancel) { try { onCancel(); } catch (_e) { /* ignore */ } }
      modal.close();
    });

    okBtn.addEventListener('click', function () {
      if (onConfirm) { try { onConfirm(); } catch (_e) { /* ignore */ } }
      modal.close();
    });

    return modal;
  }

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.modals = global.MyAgent.modals || {};
  global.MyAgent.modals.confirm = buildConfirmModal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
