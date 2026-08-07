/**
 * i18n.js — 国际化模块
 *
 * 异步加载翻译表（通过 IPC），提供 t() 翻译函数 + DOM 自动填充。
 * 当前阶段仅中文（zh-CN），英文为远期可选。
 * 挂载到 window: initI18n / t / getLang / setLang / applyDomI18n
 */
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;

  // ============================================================
  // 状态
  // ============================================================
  var _currentLang = 'zh';
  var _tables = {};       // { zh: { key: "value", ... } }
  var _ready = false;
  var _initPromise = null;

  // 支持的语言
  var _LOCALES = [
    { code: 'zh', label: '简体中文', htmlLang: 'zh-CN' },
  ];

  // ============================================================
  // 内联默认翻译表（IPC 不可用时的回退）
  // ============================================================
  var DEFAULT_TABLE = {
    // 侧边栏
    'sidebar.new_chat': '新对话',
    'sidebar.conversations': '对话',
    'sidebar.agents': 'Agents',
    'sidebar.skills': 'Skills',
    'sidebar.settings': '设置',
    'sidebar.manage': '管理',
    // 对话
    'chat.title': '新对话',
    'chat.placeholder': '输入消息... Enter 发送，Shift+Enter 换行',
    'chat.send': '发送',
    'chat.stop': '停止',
    'chat.empty': '开始一段新对话',
    'chat.empty_hint': 'Enter 发送，Shift+Enter 换行',
    'chat.attachment': '附件',
    'chat.slash_cmd': 'Slash 命令',
    'chat.disclaimer': 'My Agent 可能产生错误，请核实重要信息',
    'chat.tools_enabled': '工具已启用',
    // 会话管理
    'sessions.title': '会话管理',
    'sessions.stats': '共 {count} 个会话',
    'sessions.search': '搜索会话标题或内容...',
    'sessions.filter_project': '全部项目',
    'sessions.filter_time': '全部时间',
    'sessions.batch_selected': '已选 {count} 个会话',
    'sessions.export_all': '导出全部',
    'sessions.new': '新建',
    'sessions.archive': '归档',
    'sessions.export': '导出',
    'sessions.delete': '删除',
    'sessions.no_sessions': '暂无对话',
    'sessions.col_session': '会话',
    'sessions.col_project': '项目',
    'sessions.col_model': '模型',
    'sessions.col_messages': '消息',
    'sessions.col_tokens': 'Token',
    'sessions.col_updated': '更新时间',
    'sessions.col_actions': '操作',
    'sessions.pagination': '显示 {start} - {end} / {total}',
    // Skills
    'skills.title': 'Skills 管理',
    'skills.stats': '已启用 {enabled} / {total}',
    'skills.install': '从市场安装',
    'skills.open_dir': '打开目录',
    'skills.new': '新建 Skill',
    'skills.filter_all': '全部',
    'skills.enabled_only': '仅显示已启用',
    // 设置
    'settings.title': '设置',
    'settings.models': '模型',
    'settings.tools': '工具',
    'settings.paths': '路径与权限',
    'settings.context': '上下文',
    'settings.appearance': '外观',
    'settings.developer': '开发者',
    // 对话框
    'dialog.ok': '确定',
    'dialog.cancel': '取消',
    'dialog.confirm': '确认',
    'dialog.delete_confirm': '确定要删除吗？此操作不可撤销。',
    'dialog.delete_title': '确认删除',
    'dialog.reset_title': '恢复默认',
    'dialog.reset_confirm': '确定要恢复默认设置吗？',
    'sessions.delete_batch_confirm': '确定删除 {{count}} 个会话？此操作不可撤销。',
    'sessions.archive_batch_confirm': '确定归档选中的 {{count}} 个会话？',
    'sessions.delete_single_confirm': '确定删除此会话？此操作不可撤销。',
    'sessions.rename': '新名称',
    'sessions.context_rename': '重命名',
    'sessions.context_delete': '删除',
    'sessions.context_export': '导出',
    'sessions.export_fail': '导出失败：没有可导出的会话数据。',
    'settings.delete_provider_confirm': '确定删除此 Provider？',
    'settings.reset_confirm': '恢复默认设置？此操作不可撤销。',
    // 通用
    'common.loading': '加载中...',
    'common.error': '加载失贩',
    'common.retry': '重试',
    // 阶段5 新增（与 zh.json 同步）
    'chat.streaming_cancel': '已停止生成并清空待发送队列',
    'bash.permission.title': 'Bash 权限确认',
    'bash.permission.message': 'Agent 请求执行命令:\n\n{{command}}\n\n是否允许？',
    'bash.permission.allow_once': '允许本次',
    'bash.permission.deny': '拒绝',
    'delete_file.confirm.title': '确认删除文件',
    'delete_file.confirm.message': 'Agent 请求删除文件:\n\n{{path}}\n\n是否确认？',
    'chat.poll_detected': '检测到进行中的助手响应，正在同步...',
    'chat.queue_count': '队列中还有 {{count}} 条消息等待发送',
    'chat.tool_executing': '执行中...',
  };

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化 i18n 模块（异步，通过 IPC 获取翻译表）。
   * 应在 app.js 启动时最先调用。
   */
  function initI18n() {
    if (_initPromise) return _initPromise;

    _initPromise = _doInit().then(function () {
      _ready = true;
      applyDomI18n();
      _setDocumentLang(_currentLang);
    });

    return _initPromise;
  }

  function _doInit() {
    // 尝试通过 IPC 获取翻译表
    if (typeof window.myAgent !== 'undefined' && window.myAgent.invoke) {
      return window.myAgent.invoke('config:getLocales')
        .then(function (result) {
          if (result && result.tables) {
            _tables = result.tables;
          }
          if (result && result.lang) {
            _currentLang = result.lang;
          }
        })
        .catch(function () {
          // IPC 不可用 → 使用内联默认表
          _tables = { zh: DEFAULT_TABLE };
        });
    }

    // 无 IPC → 使用内联默认表
    _tables = { zh: DEFAULT_TABLE };
    return Promise.resolve();
  }

  // ============================================================
  // 翻译函数
  // ============================================================

  /**
   * 获取翻译文本。
   * @param {string} key - 翻译键
   * @param {object} [vars] - 插值变量，如 { count: 5 }
   * @returns {string} 翻译后文本；key 不存在时返回 key 本身
   */
  function t(key, vars) {
    // 查当前语言表
    var table = _tables[_currentLang];
    var raw = (table && table[key] !== undefined) ? table[key] : undefined;

    // 回退到 key 本身
    if (raw === undefined) raw = key;

    return _interpolate(raw, vars);
  }

  /**
   * 变量插值：将 "共 {{count}} 个" + { count: 5 } → "共 5 个"
   */
  function _interpolate(template, vars) {
    if (!vars || typeof vars !== 'object') return String(template);
    return String(template).replace(/\{\{(\w+)\}\}/g, function (_, name) {
      return vars[name] !== undefined ? vars[name] : '{{' + name + '}}';
    });
  }

  // ============================================================
  // DOM 自动填充
  // ============================================================

  /**
   * 扫描 root 下所有 [data-i18n] / [data-i18n-title] / [data-i18n-placeholder] 元素并填充文本。
   * @param {Element} [root] - 根元素，默认 document
   */
  function applyDomI18n(root) {
    root = root || document;

    // [data-i18n] → textContent
    var els = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = t(els[i].dataset.i18n);
    }

    // [data-i18n-title] → title 属性
    els = root.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < els.length; j++) {
      els[j].title = t(els[j].dataset.i18nTitle);
    }

    // [data-i18n-placeholder] → placeholder 属性
    els = root.querySelectorAll('[data-i18n-placeholder]');
    for (var k = 0; k < els.length; k++) {
      els[k].placeholder = t(els[k].dataset.i18nPlaceholder);
    }
  }

  // ============================================================
  // 语言切换
  // ============================================================

  function getLang() {
    return _currentLang;
  }

  function setLang(lang) {
    if (lang === _currentLang) return;
    _currentLang = lang;

    // 持久化到主进程（best-effort）
    if (typeof window.myAgent !== 'undefined' && window.myAgent.invoke) {
      window.myAgent.invoke('config:setLanguage', { language: lang }).catch(function () {});
    }

    applyDomI18n();
    _setDocumentLang(lang);

    // 通知所有动态模块重渲染
    try {
      window.dispatchEvent(new Event('i18n-change'));
    } catch (_) { /* ignore */ }
  }

  function _setDocumentLang(lang) {
    var locale = null;
    for (var i = 0; i < _LOCALES.length; i++) {
      if (_LOCALES[i].code === lang) { locale = _LOCALES[i]; break; }
    }
    if (locale) {
      document.documentElement.lang = locale.htmlLang;
    }
  }

  // ============================================================
  // 对外 API
  // ============================================================
  root.initI18n = initI18n;
  root.t = t;
  root.getLang = getLang;
  root.setLang = setLang;
  root.applyDomI18n = applyDomI18n;
})();
