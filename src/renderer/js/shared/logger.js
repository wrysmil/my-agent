/**
 * logger.js — 渲染进程日志
 *
 * 分级日志工厂。当前阶段走 console 输出；阶段2 接入 IPC 转发到主进程。
 * 挂载到 window: createLogger
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  /**
   * 日志级别（数值越大越严重）。
   */
  var LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  /**
   * 创建指定模块的 logger 实例。
   */
  function createLogger(module) {
    return {
      debug: function () {
        if (LOG_LEVELS.debug >= _currentLevel()) {
          var args = ['[DEBUG] [' + module + ']'];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          console.debug.apply(console, args);
        }
      },
      info: function () {
        if (LOG_LEVELS.info >= _currentLevel()) {
          var args = ['[INFO] [' + module + ']'];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          console.info.apply(console, args);
        }
      },
      warn: function () {
        if (LOG_LEVELS.warn >= _currentLevel()) {
          var args = ['[WARN] [' + module + ']'];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          console.warn.apply(console, args);
        }
      },
      error: function () {
        if (LOG_LEVELS.error >= _currentLevel()) {
          var args = ['[ERROR] [' + module + ']'];
          for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
          console.error.apply(console, args);
        }
      },
    };
  }

  function _currentLevel() {
    // 默认 info 级别；可通过 localStorage 覆盖
    try {
      var stored = localStorage.getItem('myagent:logLevel');
      if (stored && LOG_LEVELS[stored] !== undefined) return LOG_LEVELS[stored];
    } catch (_) { /* ignore */ }
    return LOG_LEVELS.info;
  }

  root.createLogger = createLogger;
})();
