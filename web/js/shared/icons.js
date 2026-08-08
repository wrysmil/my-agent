/**
 * icons.js — Lucide inline SVG 图标库（spec § 4.4.6 / plan § 6.2 F4）
 *
 * 设计约束：
 * - 零依赖：不走 npm、不走构建工具，图标路径直接 inline（见 spec § 4.4.6）。
 * - 不用 emoji（spec § 2.2 反模式）。
 * - 全部 24×24 viewBox，stroke-width: 2，stroke: currentColor —— 颜色由 CSS 继承。
 * - 经典 <script defer> 加载（非 ES module），挂载到全局，与 index.html 顺序一致。
 *
 * 无障碍（harness-kit/references/accessibility-checklist.md）：
 * - 图标一律 aria-hidden="true"，视为装饰性元素；屏幕阅读器不朗读。
 * - **icon-only button 必须自己提供 aria-label**，例如：
 *     `<button class="btn-icon" aria-label="删除会话">${iconHtml('trash-2', 16)}</button>`
 *   否则该按钮对屏幕阅读器无可访问名称。
 *
 * 图标路径来源：Lucide Icons <https://lucide.dev/icons/>，ISC License。
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
 * of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
 * Contributors 2022.
 */

(function (global) {
  'use strict';

  /**
   * 图标名 → SVG 内部图形元素（不含外层 <svg>）。
   *
   * 命名沿用 spec § 4.4.6 / plan § 6.2 F4 指定的名字。其中若干名字是 Lucide
   * 的历史名，上游后来做过重命名，这里保留 spec 的名字并注明现名，便于日后对照升级：
   * - stop           → 上游 `square`（用作「■ 停止」按钮）
   * - history        → 上游已移除该名（路径取自 lucide v0.400.0 `history`）
   * - loader-2       → 上游 `loader-circle`
   * - alert-triangle → 上游 `triangle-alert`
   * - check-circle-2 → 上游 `circle-check`
   * - x-circle       → 上游 `circle-x`
   */
  const ICON_PATHS = {
    'send':
      '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    'stop':
      '<rect width="18" height="18" x="3" y="3" rx="2"/>',
    'plus':
      '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'trash-2':
      '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    'settings':
      '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    'message-square':
      '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    'history':
      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    'users':
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    'sparkles':
      '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
    'zap':
      '<path d="M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z"/>',
    'search':
      '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    'x':
      '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'check':
      '<path d="M20 6 9 17l-5-5"/>',
    'chevron-right':
      '<path d="m9 18 6-6-6-6"/>',
    'chevron-down':
      '<path d="m6 9 6 6 6-6"/>',
    'loader-2':
      '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    'alert-triangle':
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'info':
      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'check-circle-2':
      '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'x-circle':
      '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  };

  const DEFAULT_SIZE = 24;

  /**
   * 把 size 收敛为安全的正整数像素值。
   * size 会被插进 HTML 属性，做数值校验即可杜绝属性注入。
   * @param {unknown} size
   * @returns {number}
   */
  function normalizeSize(size) {
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIZE;
    return Math.round(n);
  }

  /**
   * 返回指定图标的 inline SVG 字符串。
   *
   * @param {string} name 图标名，见 ICON_NAMES
   * @param {number} [size=24] 像素尺寸，写入 width/height（viewBox 恒为 24）
   * @returns {string} SVG 字符串；未知 name 返回 ""（并 console.warn）
   */
  function iconHtml(name, size) {
    const shapes = Object.prototype.hasOwnProperty.call(ICON_PATHS, name)
      ? ICON_PATHS[name]
      : undefined;

    if (shapes === undefined) {
      // 缺图标不该炸掉整个视图渲染 —— 降级成空字符串 + 开发期告警。
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[icons] unknown icon name: ' + String(name));
      }
      return '';
    }

    const px = normalizeSize(size === undefined ? DEFAULT_SIZE : size);

    return (
      '<svg xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + px + '" height="' + px + '"' +
      ' viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      shapes +
      '</svg>'
    );
  }

  /**
   * 图标是否存在。渲染前想做兜底判断时用。
   * @param {string} name
   * @returns {boolean}
   */
  function hasIcon(name) {
    return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
  }

  /** @type {string[]} 全部可用图标名 */
  const ICON_NAMES = Object.keys(ICON_PATHS);

  global.iconHtml = iconHtml;
  global.hasIcon = hasIcon;
  global.ICON_NAMES = ICON_NAMES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
