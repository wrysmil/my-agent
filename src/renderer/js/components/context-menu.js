/**
 * context-menu.js — 右键上下文菜单
 *
 * 挂载到 window:
 *   showContextMenu(items, x, y) → Promise<string|null>
 *
 * items: [{ id, label, icon?, danger?, separator? }]
 *   separator: true → 渲染分隔线；其余字段忽略
 *   danger: true  → 危险项样式（红色，class .danger）
 *   icon         → icons.js 中的图标名（uiIconHtml）
 *
 * 关闭时机: 点击菜单外部 / Escape / 滚轮 → resolve(null)
 * 点击菜单项: resolve(item.id) 并移除菜单
 * 定位: position:fixed，右/下边界防溢出
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  var _menu = null;  // 当前菜单元素
  var _onDoc = null; // document 事件处理（mousedown/keydown/wheel）

  /**
   * 移除菜单并解绑 document 事件。不 resolve（由调用方 resolve）。
   */
  function _removeMenu() {
    if (_onDoc) {
      document.removeEventListener('mousedown', _onDoc);
      document.removeEventListener('keydown', _onDoc, true);
      document.removeEventListener('wheel', _onDoc, true);
      _onDoc = null;
    }
    if (_menu && _menu.parentNode) {
      _menu.parentNode.removeChild(_menu);
    }
    _menu = null;
  }

  /**
   * 显示上下文菜单。
   * @param {Array} items - 菜单项
   * @param {number} x - 视口 x 坐标
   * @param {number} y - 视口 y 坐标
   * @returns {Promise<string|null>} 选中项 id；取消/外部关闭 → null
   */
  function showContextMenu(items, x, y) {
    _removeMenu(); // 若已有菜单，先静默关闭旧的
    return new Promise(function (resolve) {
      var menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.left = '0px';
      menu.style.top = '0px';

      var hasItem = false;
      var list = items || [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];

        // 分隔线
        if (it && it.separator) {
          var sep = document.createElement('div');
          sep.className = 'context-menu-divider';
          menu.appendChild(sep);
          continue;
        }

        if (!it || !it.id) continue;
        var el = document.createElement('div');
        el.className = 'context-menu-item' + (it.danger ? ' danger' : '');

        // 图标（可选）
        var iconHtml = '';
        if (it.icon && typeof root.uiIconHtml === 'function') {
          iconHtml = root.uiIconHtml(it.icon);
        }
        el.innerHTML = iconHtml;

        var label = document.createElement('span');
        label.textContent = it.label || '';
        el.appendChild(label);

        (function (id) {
          el.addEventListener('click', function (e) {
            e.stopPropagation();
            _removeMenu();
            resolve(id);
          });
        })(it.id);

        menu.appendChild(el);
        hasItem = true;
      }

      // 空菜单 → 直接取消
      if (!hasItem) {
        resolve(null);
        return;
      }

      document.body.appendChild(menu);
      _menu = menu;

      // 边界检测防溢出（右/下；位置固定相对视口）
      var rect = menu.getBoundingClientRect();
      var left = (typeof x === 'number') ? x : 0;
      var top = (typeof y === 'number') ? y : 0;
      if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4;
      if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';

      // 关闭：点击外部 / Escape / 滚轮
      function onDoc(e) {
        if (e.type === 'keydown' && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          _removeMenu();
          resolve(null);
          return;
        }
        if (e.type === 'mousedown') {
          // 点击菜单项交给菜单项的 click 处理；仅外部点击关闭
          if (menu.contains(e.target)) return;
          _removeMenu();
          resolve(null);
          return;
        }
        if (e.type === 'wheel') {
          _removeMenu();
          resolve(null);
        }
      }

      _onDoc = onDoc;
      document.addEventListener('mousedown', onDoc);
      document.addEventListener('keydown', onDoc, true);
      document.addEventListener('wheel', onDoc, true);
    });
  }

  root.showContextMenu = showContextMenu;
})();
