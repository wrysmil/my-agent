/**
 * i18n.js — 中英双语字典 + t() 函数（F3 / WU-04a）
 *
 * 设计约束：
 * - 零依赖；纯对象字典 + 字符串替换。
 * - 仅支持 zh / en 两种语言；缺语言 → fallback zh。
 * - 持久化键：localStorage['my-agent.lang']
 * - 启动时从 localStorage 读值；无值 / 非法 → 默认 zh。
 * - 占位符：{name} / {count} 等大括号键名 → 用 args[k] 替换
 *
 * 字典设计原则：
 * - 至少 30 个键值（按钮标题、菜单、错误提示、占位符、标签）
 * - 同一组 key 在 zh / en 都有对应翻译；缺翻译时 t() 回退到 zh，再回退到 key 本身
 * - 不引第三方词库；不引 ICU MessageFormat
 *
 * 与其他模块的协作：
 *   - 不依赖 utils.js / api.js / theme.js / icons.js
 *   - 被 UI 组件（按钮、菜单、表单提示）调用 t('common.send') 等
 */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'my-agent.lang';
  var DEFAULT_LANG = 'zh';
  var FALLBACK_LANG = 'zh';
  var SUPPORTED_LANGS = ['zh', 'en'];

  // ------------------------------------------------------------------
  // 字典 — 中文 / English
  //   命名分组：common.* 通用 / menu.* 主菜单 / chat.* 对话 /
  //            session.* 会话 / provider.* 提供商 / agent.* 子Agent /
  //            skill.* 技能 / settings.* 设置 / error.* 错误
  // ------------------------------------------------------------------

  var DICT = {
    zh: {
      // ── common.* 通用 ──
      'common.confirm': '确认',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.delete': '删除',
      'common.edit': '编辑',
      'common.create': '新建',
      'common.close': '关闭',
      'common.refresh': '刷新',
      'common.loading': '加载中…',
      'common.empty': '暂无数据',
      'common.search': '搜索',
      'common.yes': '是',
      'common.no': '否',
      'common.copy': '复制',
      'common.copied': '已复制',

      // ── menu.* 主菜单 ──
      'menu.title': '主菜单',
      'menu.hint': '使用方向键或数字键 1-6 选择，或鼠标点击卡片。',
      'menu.chat': '对话',
      'menu.sessions': '历史会话',
      'menu.providers': '提供商',
      'menu.agents': '子 Agent',
      'menu.skills': '技能',
      'menu.settings': '设置',

      // ── chat.* 对话 ──
      'chat.placeholder': '输入消息（Cmd/Ctrl+Enter 发送，Cmd/Ctrl+. 停止）',
      'chat.send': '发送',
      'chat.stop': '停止',
      'chat.newChat': '新建对话',
      'chat.sessionLabel': '会话',

      // ── session.* ──
      'session.new': '+ 新会话',
      'session.empty': '暂无会话',
      'session.deleteConfirm': '确定删除此会话？此操作不可撤销。',

      // ── provider.* ──
      'provider.title': '提供商设置',
      'provider.add': '新增提供商',
      'provider.empty': '尚未配置任何提供商',
      'provider.activate': '设为当前',
      'provider.active': '当前',

      // ── agent.* ──
      'agent.title': '子 Agent',
      'agent.builtin': '内置',
      'agent.user': '用户',

      // ── skill.* ──
      'skill.title': '技能',
      'skill.empty': '暂无可用技能',

      // ── settings.* ──
      'settings.title': '设置',
      'settings.theme': '主题',
      'settings.themeDark': '深色',
      'settings.themeLight': '浅色',
      'settings.themeSystem': '跟随系统',
      'settings.language': '语言',
      'settings.languageZh': '中文',
      'settings.languageEn': 'English',
      'settings.port': '端口',

      // ── error.* 错误提示 ──
      'error.network': '网络错误，请检查连接后重试',
      'error.timeout': '请求超时',
      'error.unauthorized': '未授权，请重新登录',
      'error.notFound': '未找到资源',
      'error.server': '服务器错误',
      'error.unknown': '未知错误',

      // ── 占位符示例（用户消息插入） ──
      'placeholder.userMessage': '用户 {name} 发送了 {count} 条消息',
    },

    en: {
      // ── common.* ──
      'common.confirm': 'Confirm',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.create': 'New',
      'common.close': 'Close',
      'common.refresh': 'Refresh',
      'common.loading': 'Loading…',
      'common.empty': 'No data',
      'common.search': 'Search',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.copy': 'Copy',
      'common.copied': 'Copied',

      // ── menu.* ──
      'menu.title': 'Main Menu',
      'menu.hint': 'Use arrow keys or number keys 1-6 to select, or click a card.',
      'menu.chat': 'Chat',
      'menu.sessions': 'Sessions',
      'menu.providers': 'Providers',
      'menu.agents': 'Agents',
      'menu.skills': 'Skills',
      'menu.settings': 'Settings',

      // ── chat.* ──
      'chat.placeholder': 'Type a message (Cmd/Ctrl+Enter to send, Cmd/Ctrl+. to stop)',
      'chat.send': 'Send',
      'chat.stop': 'Stop',
      'chat.newChat': 'New chat',
      'chat.sessionLabel': 'Session',

      // ── session.* ──
      'session.new': '+ New session',
      'session.empty': 'No sessions yet',
      'session.deleteConfirm': 'Delete this session? This cannot be undone.',

      // ── provider.* ──
      'provider.title': 'Providers',
      'provider.add': 'Add provider',
      'provider.empty': 'No providers configured',
      'provider.activate': 'Set active',
      'provider.active': 'Active',

      // ── agent.* ──
      'agent.title': 'Agents',
      'agent.builtin': 'Built-in',
      'agent.user': 'User',

      // ── skill.* ──
      'skill.title': 'Skills',
      'skill.empty': 'No skills available',

      // ── settings.* ──
      'settings.title': 'Settings',
      'settings.theme': 'Theme',
      'settings.themeDark': 'Dark',
      'settings.themeLight': 'Light',
      'settings.themeSystem': 'System',
      'settings.language': 'Language',
      'settings.languageZh': '中文',
      'settings.languageEn': 'English',
      'settings.port': 'Port',

      // ── error.* ──
      'error.network': 'Network error, please check your connection',
      'error.timeout': 'Request timeout',
      'error.unauthorized': 'Unauthorized, please sign in again',
      'error.notFound': 'Resource not found',
      'error.server': 'Server error',
      'error.unknown': 'Unknown error',

      // ── 占位符 ──
      'placeholder.userMessage': 'User {name} sent {count} messages',
    },
  };

  // ------------------------------------------------------------------
  // currentLang —— 当前语言（启动时同步从 localStorage 读）
  // ------------------------------------------------------------------

  /**
   * 从 localStorage 读值并校验；非法值回退到 DEFAULT_LANG。
   * @returns {'zh' | 'en'}
   */
  function readStoredLang() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw === 'zh' || raw === 'en') return raw;
    } catch (_e) {
      // localStorage 不可用（隐私模式 / SecurityError）
    }
    return DEFAULT_LANG;
  }

  var currentLang = readStoredLang();

  // ------------------------------------------------------------------
  // setLang(lang) / getLang()
  // ------------------------------------------------------------------

  /**
   * 切换语言并持久化（同时触发 my-agent-lang-change 自定义事件）。
   *
   * 非法 lang 走白名单兜底（不回 throw）；持久化失败（隐私模式）静默忽略。
   *
   * @param {string} lang
   * @returns {string} 规范化后的 lang
   */
  function setLang(lang) {
    var normalized = SUPPORTED_LANGS.indexOf(lang) >= 0 ? lang : DEFAULT_LANG;
    currentLang = normalized;
    try {
      global.localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_e) {
      /* ignore */
    }
    // 通知 UI 层（CustomEvent）
    try {
      if (typeof global.CustomEvent === 'function' && global.document) {
        global.document.dispatchEvent(
          new global.CustomEvent('my-agent-lang-change', { detail: { lang: normalized } }),
        );
      }
    } catch (_e) {
      /* ignore */
    }
    return normalized;
  }

  /**
   * 取当前语言。
   * @returns {string}
   */
  function getLang() {
    return currentLang;
  }

  // ------------------------------------------------------------------
  // t(key, ...args) — 取翻译
  // ------------------------------------------------------------------

  /**
   * 占位符正则：{key}，key 是 [A-Za-z0-9_]+。
   */
  var PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;

  /**
   * 取 key 对应的翻译。
   *
   * 查找顺序：
   *   1) DICT[currentLang][key]
   *   2) DICT[FALLBACK_LANG][key]（一般就是 zh）
   *   3) key 本身（最后兜底，保证 UI 不会显示 undefined）
   *
   * 占位符替换：
   *   - t('placeholder.userMessage', { name: 'Alice', count: 3 })
   *     → "用户 Alice 发送了 3 条消息"
   *   - args 可为对象或位置参数：
   *     t('greeting', 'Alice')  → 替换 {0}
   *     t('greeting', 'Alice', 'Bob') → 替换 {0} {1}
   *   - 占位符 key 在 args 找不到 → 保留原 {key} 不替换
   *
   * @param {string} key
   * @param {...any} args
   * @returns {string}
   */
  function t(key) {
    if (typeof key !== 'string') return '';

    var dict = DICT[currentLang] || DICT[FALLBACK_LANG] || {};
    var template;
    if (Object.prototype.hasOwnProperty.call(dict, key)) {
      template = dict[key];
    } else {
      // fallback 到 FALLBACK_LANG
      var fb = DICT[FALLBACK_LANG] || {};
      if (Object.prototype.hasOwnProperty.call(fb, key)) {
        template = fb[key];
      } else {
        // 最后兜底：返回 key 本身
        return key;
      }
    }

    if (typeof template !== 'string') return key;

    // 收集 args
    var named = null; // { key: value }
    var positional = null; // [v0, v1, ...]
    for (var i = 1; i < arguments.length; i++) {
      var a = arguments[i];
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        named = a;
      } else if (positional === null) {
        positional = [a];
      } else {
        positional.push(a);
      }
    }

    if (!named && !positional) return template;

    return template.replace(PLACEHOLDER_RE, function (_match, name) {
      if (named && Object.prototype.hasOwnProperty.call(named, name)) {
        return String(named[name]);
      }
      // 位置参数：{0} {1} ...
      if (/^\d+$/.test(name) && positional) {
        var idx = parseInt(name, 10);
        if (idx >= 0 && idx < positional.length) return String(positional[idx]);
      }
      // 缺值 → 保留原占位符
      return '{' + name + '}';
    });
  }

  // ------------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.i18n = {
    I18N: DICT,
    setLang: setLang,
    getLang: getLang,
    t: t,
    SUPPORTED_LANGS: SUPPORTED_LANGS.slice(),
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_LANG: DEFAULT_LANG,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);