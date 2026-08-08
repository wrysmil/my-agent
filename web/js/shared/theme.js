/* ============================================================================
 * my-agent Web 前端 — Theme System (F0)
 * ----------------------------------------------------------------------------
 * 源规范:  .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 4.4.1 + § 5.4.1 注 2
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6.2 F0
 *
 * 本文件职责（与 F18 web/js/features/theme.js 切分）:
 *   - 启动时: 从 localStorage['my-agent.theme'] 读值,初始化 <html data-theme="...">
 *   - system 模式下: 监听 prefers-color-scheme 变化(Safari < 14 polyfill)
 *   - 自定义事件 'my-agent-theme-change' 监听器:
 *       接收 F18 /theme 命令循环触发的新主题,重设 CSS 变量
 *
 * 不实现:
 *   - /theme 三态循环 (dark → light → system → dark) → 留给 F18 web/js/features/theme.js
 *
 * v3.3 修复 (来自 v3.2 Reviewer Critical):
 *   Safari < 14 polyfill — MediaQueryList.addListener() 仅接受 1 个 callback 参数。
 *   v3.2 误写 mql.addListener(mql, cb),把 mql 当 callback 注册,导致
 *   OS 切换时 TypeError: mql is not a function。
 *   本版本: mql.addListener((e) => apply(e.matches))
 * ========================================================================== */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'my-agent.theme';
  var THEME_CHANGE_EVENT = 'my-agent-theme-change';

  // -------------------------------------------------------------------------
  // applyTheme(theme)
  //   theme ∈ {"dark", "light", "system"}
  //   - "system": 监听 prefers-color-scheme 变化(动态设 data-system-theme)
  //   - 其他:     data-theme 直接 = theme,移除 data-system-theme
  // -------------------------------------------------------------------------
  function applyTheme(theme) {
    if (theme !== 'dark' && theme !== 'light' && theme !== 'system') {
      // 防御:未知值退化到 "system"(与 spec § 4.4.1 默认一致)
      theme = 'system';
    }

    var root = document.documentElement;

    if (theme === 'system') {
      var mql = window.matchMedia('(prefers-color-scheme: dark)');
      var applySystem = function (matches) {
        root.setAttribute('data-system-theme', matches ? 'dark' : 'light');
      };

      // 1. 立即设一次(首屏不闪烁)
      applySystem(mql.matches);
      root.setAttribute('data-theme', 'system');

      // 2. 监听 OS 主题切换
      //    - 现代浏览器 / Safari 14+ → addEventListener('change', cb)
      //    - Safari < 14             → addListener(cb) (已废弃但 Safari 13 支持)
      //    - 都不支持 → 取一次快照后不再监听(最差降级,用户需手动 /theme)
      //
      // v3.3 关键修复:addListener 仅接受 1 个 callback 参数(不是 mql + cb)
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', function (e) {
          applySystem(e.matches);
        });
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(function (e) {
          applySystem(e.matches);
        });
      }
    } else {
      root.setAttribute('data-theme', theme);
      root.removeAttribute('data-system-theme');
    }
  }

  // -------------------------------------------------------------------------
  // getStoredTheme()
  //   从 localStorage 读取;缺失 / 非法 → 返回 "system"(与 spec § 4.4.1 默认一致)
  // -------------------------------------------------------------------------
  function getStoredTheme() {
    try {
      var stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        return stored;
      }
    } catch (_err) {
      // localStorage 可能被禁用(隐私模式 / SecurityError);退化 system
    }
    return 'system';
  }

  // -------------------------------------------------------------------------
  // setStoredTheme(theme)
  //   持久化到 localStorage(供 F18 /theme 命令循环调用)
  // -------------------------------------------------------------------------
  function setStoredTheme(theme) {
    try {
      global.localStorage.setItem(STORAGE_KEY, theme);
    } catch (_err) {
      // 静默忽略(隐私模式 / SecurityError)
    }
  }

  // -------------------------------------------------------------------------
  // init()
  //   app.js 启动流水线第一步调用(F0 → theme → providers → views)
  //   - 读 localStorage → applyTheme
  //   - 监听 'my-agent-theme-change' 事件(F18 /theme 命令触发后重设 CSS)
  // -------------------------------------------------------------------------
  function init() {
    var stored = getStoredTheme();
    applyTheme(stored);

    // F18 /theme 命令循环触发的事件:
    //   detail = { theme: "dark" | "light" | "system" }
    // 本监听器仅做"重设 CSS 变量"(持久化由 F18 完成),职责不重叠
    global.document.addEventListener(THEME_CHANGE_EVENT, function (e) {
      var newTheme = e && e.detail && e.detail.theme;
      if (newTheme) {
        applyTheme(newTheme);
      }
    });
  }

  // -------------------------------------------------------------------------
  // 导出(全局变量模块通信,与 spec § 4.2 + 仿写Agent前端框架指南一致)
  // -------------------------------------------------------------------------
  global.themeModule = {
    applyTheme: applyTheme,
    getStoredTheme: getStoredTheme,
    setStoredTheme: setStoredTheme,
    init: init,
    STORAGE_KEY: STORAGE_KEY,
    THEME_CHANGE_EVENT: THEME_CHANGE_EVENT
  };
})(window);