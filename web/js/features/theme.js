/**
 * features/theme.js — /theme Slash 命令循环（F18 / WU-04d）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 4.4.6
 *           + § 5.4.1 (slash 命令 /theme)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-04d
 *
 * 职责（与 shared/theme.js 切分）:
 *   - 注册 /theme 命令到全局 slash 派发器 (window.MyAgent.slash.register)
 *   - 解析: `dark | light | system` (大小写不敏感) | 无参 (循环到下一态)
 *   - 循环顺序: dark → light → system → dark
 *   - 持久化: localStorage['my-agent.theme'] = theme
 *   - 通知: dispatch CustomEvent('my-agent:theme-change',
 *                                { detail: { theme, systemTheme } })
 *   - 输出: appendOutput({ role: 'system', content: '当前主题: ...' })
 *   - 重置: clearOutput() （可选 /theme reset 触发,留 UI 备用）
 *
 * 与 WU-03a shared/theme.js 的协作:
 *   - 本文件复用 window.MyAgent.theme (setTheme/getTheme/getSystemTheme)。
 *     该 API 由 shared/theme.js 在 app.js 启动时挂载(F15 落地,本 WU 不实现)。
 *   - 当前阶段若 window.MyAgent.theme 不存在,降级:
 *       - getCurrentTheme 退到 localStorage
 *       - getSystemTheme 退到 'light'
 *       - 持久化与事件照常派发
 *
 * 不实现(留给后续 WU):
 *   - 其余 9 个 F18 slash 命令(compact/clear/export/import/help/sessions/
 *     skill/agent/model) → 留 WU-07a
 *   - index.html 加 <script defer src="./js/features/theme.js"> → 留 WU-07a
 *
 * 加载方式: <script defer> + IIFE,与 spec § 4.4.6 / 仿写Agent前端框架指南一致。
 * 测试:    test/web/features-theme.test.ts (≥ 8 用例)
 */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'my-agent.theme';
  var CHANGE_EVENT = 'my-agent:theme-change';
  var COMMAND_NAME = '/theme';

  // 三态循环顺序(spec § 5.4.1 /theme 命令行为)
  var CYCLE_ORDER = ['dark', 'light', 'system'];

  // -------------------------------------------------------------------------
  // 内部:noop(appendOutput/clearOutput 未传时的降级,防止测试或极端调用炸掉)
  // -------------------------------------------------------------------------
  function noop() {}

  // -------------------------------------------------------------------------
  // 内部:normalizeArg(rawInput)
  //   去掉前导 /theme(大小写不敏感)与多余空白,返回剩余参数字符串(已 toLowerCase)。
  //   接受 "/theme"、"/theme  dark "、"/Theme Dark"、"/  THEME   LIGHT  "、
  //   "theme System"、无前导斜杠等任意合法输入。
  //
  //   匹配规则(两种):
  //     1) withArg: ^\s*\/*\s*theme\s+(\S.*?)\s*$/i  →  捕获组 1 为参数
  //     2) noArg:   ^\s*\/*\s*theme\s*$/i           →  无参,返回 ''
  //   都允许 / 与 theme 之间含空白(常见误输入)。
  // -------------------------------------------------------------------------
  function normalizeArg(rawInput) {
    var s = typeof rawInput === 'string' ? rawInput : '';
    var withArg = s.match(/^\s*\/*\s*theme\s+(\S.*?)\s*$/i);
    if (withArg && typeof withArg[1] === 'string') {
      return withArg[1].toLowerCase().trim();
    }
    var noArg = s.match(/^\s*\/*\s*theme\s*$/i);
    if (noArg) {
      return '';
    }
    // 不是 theme 命令(或完全无效),返回 trimmed lowercase 给上层判定
    return s.trim().toLowerCase();
  }

  // -------------------------------------------------------------------------
  // 内部:nextInCycle(current)
  //   current ∈ CYCLE_ORDER → 下一态;未知值 → CYCLE_ORDER[0](dark)
  // -------------------------------------------------------------------------
  function nextInCycle(current) {
    var idx = -1;
    for (var i = 0; i < CYCLE_ORDER.length; i++) {
      if (CYCLE_ORDER[i] === current) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return CYCLE_ORDER[0];
    }
    return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
  }

  // -------------------------------------------------------------------------
  // 内部:getThemeApi()
  //   读取 window.MyAgent.theme(若存在);用于 setTheme/getTheme/getSystemTheme。
  //   返回 { api, hasApi } —— hasApi=false 时调用方需走降级路径。
  // -------------------------------------------------------------------------
  function getThemeApi() {
    var api = global.MyAgent && global.MyAgent.theme;
    if (
      api &&
      typeof api.setTheme === 'function' &&
      typeof api.getTheme === 'function' &&
      typeof api.getSystemTheme === 'function'
    ) {
      return { api: api, hasApi: true };
    }
    return { api: null, hasApi: false };
  }

  // -------------------------------------------------------------------------
  // 内部:getCurrentTheme()
  //   优先读 window.MyAgent.theme.getTheme()(返回 dataset.theme);
  //   缺失 / 非法值 → 退到 localStorage;再缺失 → 'system'(与 spec § 4.4.1 默认一致)。
  // -------------------------------------------------------------------------
  function getCurrentTheme() {
    var t = getThemeApi();
    if (t.hasApi) {
      try {
        var fromApi = t.api.getTheme();
        if (
          fromApi === 'dark' ||
          fromApi === 'light' ||
          fromApi === 'system'
        ) {
          return fromApi;
        }
      } catch (_e) {
        // 忽略,走降级
      }
    }
    try {
      var stored = global.localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') {
        return stored;
      }
    } catch (_e) {
      // localStorage 可能被禁用,继续降级
    }
    return 'system';
  }

  // -------------------------------------------------------------------------
  // 内部:getSystemThemeResolved()
  //   优先读 window.MyAgent.theme.getSystemTheme()(返回 dataset.systemTheme);
  //   缺失 / 非法值 → 退到 'light'。
  // -------------------------------------------------------------------------
  function getSystemThemeResolved() {
    var t = getThemeApi();
    if (t.hasApi) {
      try {
        var fromApi = t.api.getSystemTheme();
        if (fromApi === 'dark' || fromApi === 'light') {
          return fromApi;
        }
      } catch (_e) {
        // 忽略,走降级
      }
    }
    return 'light';
  }

  // -------------------------------------------------------------------------
  // 内部:applyTheme(theme)
  //   1. 调 window.MyAgent.theme.setTheme(theme)(改 dataset.theme + dataset.systemTheme)
  //   2. 写 localStorage
  //   3. 派发 CustomEvent('my-agent:theme-change', { detail: { theme, systemTheme } })
  // -------------------------------------------------------------------------
  function applyTheme(theme) {
    var t = getThemeApi();
    if (t.hasApi) {
      try {
        t.api.setTheme(theme);
      } catch (_e) {
        // setTheme 抛错不应阻塞持久化与事件派发
      }
    }
    try {
      global.localStorage.setItem(STORAGE_KEY, theme);
    } catch (_e) {
      // 静默忽略(隐私模式 / SecurityError)
    }
    var systemTheme = getSystemThemeResolved();
    var detail = { theme: theme, systemTheme: systemTheme };
    var evt;
    try {
      evt = new global.CustomEvent(CHANGE_EVENT, {
        detail: detail,
        bubbles: true,
        cancelable: false,
      });
    } catch (_e) {
      // 极端环境无 CustomEvent 构造函数,跳过事件派发(spec § 4.4.1 仍能工作)
      return;
    }
    global.document.dispatchEvent(evt);
  }

  // -------------------------------------------------------------------------
  // 内部:buildStatusMessage(theme, systemTheme)
  //   返回 "当前主题: dark (跟随系统: light)" 形式(spec § 5.4.1 + WU-04d #4)
  // -------------------------------------------------------------------------
  function buildStatusMessage(theme, systemTheme) {
    return '当前主题: ' + theme + ' (跟随系统: ' + systemTheme + ')';
  }

  // -------------------------------------------------------------------------
  // installThemeCommand({ appendOutput, clearOutput })
  //   - 注册 /theme 命令到 window.MyAgent.slash(若存在)
  //   - 返回 handler 闭包(handler(rawInput) → void),便于测试直调
  //
  //   rawInput 接受形式:
  //     - '/theme'              循环到下一态
  //     - '/theme dark'         直接设 dark
  //     - '/Theme Dark'         大小写不敏感 → dark
  //     - '/theme reset'        清空 chat transcript(可选,留 UI 备用)
  //     - '/theme bogus'        错误提示(appendOutput 一行说明)
  // -------------------------------------------------------------------------
  function installThemeCommand(options) {
    options = options || {};
    var appendOutput =
      typeof options.appendOutput === 'function' ? options.appendOutput : noop;
    var clearOutput =
      typeof options.clearOutput === 'function' ? options.clearOutput : noop;

    function handler(rawInput) {
      var arg = normalizeArg(rawInput);

      // /theme reset → 清空 transcript(spec § 5.4.1 留 UI 备用,本 WU 支持)
      if (arg === 'reset') {
        try {
          clearOutput();
        } catch (_e) {
          // 清空失败不应炸命令
        }
        appendOutput({
          role: 'system',
          content: '已清空主题相关输出。',
        });
        return;
      }

      var newTheme;
      if (arg === '') {
        // 无参:循环到下一态
        newTheme = nextInCycle(getCurrentTheme());
      } else if (
        arg === 'dark' ||
        arg === 'light' ||
        arg === 'system'
      ) {
        newTheme = arg;
      } else {
        appendOutput({
          role: 'system',
          content:
            '未知主题值: ' +
            String(rawInput || '') +
            '。可用值: dark | light | system(或直接 /theme 循环)',
        });
        return;
      }

      applyTheme(newTheme);
      appendOutput({
        role: 'system',
        content: buildStatusMessage(newTheme, getSystemThemeResolved()),
      });
    }

    // 注册到全局 slash 派发器(由 features/slash.js 在 defer 顺序中提供)。
    // 若 slash 派发器尚未挂载,installThemeCommand 应在 app.js 启动后再调一次
    // (本 WU 仅暴露 handler,具体调用时机由 F15 app.js 决定)。
    var slash = global.MyAgent && global.MyAgent.slash;
    if (slash && typeof slash.register === 'function') {
      try {
        slash.register(COMMAND_NAME, handler);
      } catch (_e) {
        // 注册失败不应阻塞返回 handler(测试可直接调)
      }
    }

    return handler;
  }

  // -------------------------------------------------------------------------
  // 导出(spec § 4.2:全局变量模块通信)
  // -------------------------------------------------------------------------
  global.MyAgent = global.MyAgent || {};
  global.MyAgent.themeFeature = {
    installThemeCommand: installThemeCommand,
    // 暴露纯函数给测试 / 调试,避免依赖真实 DOM
    nextInCycle: nextInCycle,
    normalizeArg: normalizeArg,
    getCurrentTheme: getCurrentTheme,
    getSystemThemeResolved: getSystemThemeResolved,
    buildStatusMessage: buildStatusMessage,
    // 常量
    STORAGE_KEY: STORAGE_KEY,
    CHANGE_EVENT: CHANGE_EVENT,
    COMMAND_NAME: COMMAND_NAME,
    CYCLE_ORDER: CYCLE_ORDER,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
