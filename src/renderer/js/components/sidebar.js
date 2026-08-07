/**
 * sidebar.js — 侧边栏宽度拖拽（会话面板 resize）
 *
 * 挂载到 window:
 *   initSidebarResize({ sidebarSelector, handleSelector, minWidth, maxWidth, defaultWidth, storageKey })
 *
 * 行为:
 *   - mousedown → mousemove → mouseup 拖拽，更新元素级 --sidebar-width CSS 变量
 *   - 拖拽中 body 光标 col-resize + user-select: none（防选中文本）
 *   - 双击 handle 恢复默认宽度
 *   - 宽度持久化到 localStorage（storageKey）
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  function _clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function _readStorage(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw !== null && raw !== '') {
        var v = parseInt(raw, 10);
        if (!isNaN(v)) return v;
      }
    } catch (_) { /* ignore */ }
    return fallback;
  }

  function _writeStorage(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) { /* ignore */ }
  }

  /**
   * 初始化侧边栏拖拽。
   * @param {object} opts
   *   sidebarSelector - 侧边栏元素选择器（默认 #session-panel）
   *   handleSelector  - 拖拽手柄选择器（默认 #session-panel-resize-handle）
   *   minWidth        - 最小宽度（默认 180）
   *   maxWidth        - 最大宽度（默认 480）
   *   defaultWidth    - 默认/双击恢复宽度（默认 260）
   *   storageKey      - localStorage 存储键（默认 myagent:sidebar-width）
   */
  function initSidebarResize(opts) {
    opts = opts || {};
    var sidebar = document.querySelector(opts.sidebarSelector || '#session-panel');
    var handle = document.querySelector(opts.handleSelector || '#session-panel-resize-handle');
    if (!sidebar || !handle) return;

    var minWidth = opts.minWidth || 180;
    var maxWidth = opts.maxWidth || 480;
    var defaultWidth = opts.defaultWidth || 260;
    var storageKey = opts.storageKey || 'myagent:sidebar-width';
    var currentWidth = defaultWidth;

    function applyWidth(w) {
      currentWidth = _clamp(w, minWidth, maxWidth);
      sidebar.style.setProperty('--sidebar-width', currentWidth + 'px');
    }

    // 初始宽度：本地存储优先，否则默认
    applyWidth(_readStorage(storageKey, defaultWidth));

    // 拖拽逻辑
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startX = e.clientX;
      var startW = currentWidth;
      var prevCursor = document.body.style.cursor;
      var prevSelect = document.body.style.userSelect;

      // 拖拽中禁止选中文本 + col-resize 光标
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        applyWidth(startW + (ev.clientX - startX));
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        _writeStorage(storageKey, currentWidth);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 双击恢复默认宽度
    handle.addEventListener('dblclick', function (e) {
      e.preventDefault();
      applyWidth(defaultWidth);
      _writeStorage(storageKey, defaultWidth);
    });
  }

  root.initSidebarResize = initSidebarResize;
})();
