/**
 * slash.js — Slash 命令系统 + 命令面板（F18 / WU-07a）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 4.4.5
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-07a
 *
 * 职责:
 *   - 注册 18 slash 命令（/theme 复用 WU-04d themeFeature）
 *   - 命令面板 UI（Cmd+K 触发 / input 过滤 / 键盘导航 / ARIA combobox）
 *   - 提供 registerCommand / unregisterCommand 给其他 feature 动态注册
 *
 * 命令 handler 策略:
 *   - 大多数命令派发 CustomEvent('my-agent:xxx', {detail, bubbles:true})
 *   - Modal 命令打开对应 modal（MyAgent.modals.*）
 *   - Toast 命令（list 类）用 MyAgent.components.Toast
 *   - /theme 调 MyAgent.themeModule.applyTheme()
 *
 * 加载方式: <script defer src="js/features/slash.js"> + IIFE
 * 挂载点:   window.MyAgent.slash
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  var PALETTE_ID = 'slash-command-palette';
  var INPUT_ID = 'slash-command-input';
  var LIST_ID = 'slash-command-list';

  // 18 命令静态表（/theme 除外 — 由 WU-04d themeFeature 动态注册）
  var COMMAND_TABLE = [
    // ── Agent 域（3） ──
    { name: 'agent-launch',    args: '<name>',  category: 'Agent',  description: '启动指定 Agent' },
    { name: 'agent-create',    args: '',         category: 'Agent',  description: '创建新 Agent' },
    { name: 'agent-list',      args: '',         category: 'Agent',  description: '列出所有 Agent' },

    // ── Skill 域（2） ──
    { name: 'skill-use',       args: '<name>',  category: 'Skill',  description: '使用指定 Skill' },
    { name: 'skill-list',      args: '',         category: 'Skill',  description: '列出所有 Skill' },

    // ── Session 域（6） ──
    { name: 'session-new',     args: '',         category: 'Session', description: '新建会话' },
    { name: 'session-list',    args: '',         category: 'Session', description: '列出所有会话' },
    { name: 'session-rename',  args: '<id>',    category: 'Session', description: '重命名会话' },
    { name: 'session-delete',  args: '<id>',    category: 'Session', description: '删除会话' },
    { name: 'session-export',  args: '<id>',    category: 'Session', description: '导出会话' },
    { name: 'session-compact', args: '<id>',    category: 'Session', description: '压缩会话上下文' },

    // ── Provider 域（4） ──
    { name: 'provider-add',    args: '',         category: 'Provider', description: '添加模型提供商' },
    { name: 'provider-edit',   args: '<id>',    category: 'Provider', description: '编辑提供商' },
    { name: 'provider-list',   args: '',         category: 'Provider', description: '列出所有提供商' },
    { name: 'provider-remove', args: '<id>',    category: 'Provider', description: '删除提供商' },

    // ── 系统（3） ──
    { name: 'theme',           args: '<name>',  category: '系统',    description: '切换主题（dark/light/system）' },
    { name: 'lang',            args: '<code>',  category: '系统',    description: '切换语言（zh/en）' },
    { name: 'settings',        args: '',         category: '系统',    description: '打开设置面板' },
  ];

  // ------------------------------------------------------------------
  // 内部状态
  // ------------------------------------------------------------------

  var registry = {};        // name -> { handler, opts }
  var paletteRoot = null;
  var paletteVisible = false;
  var paletteSelectedIdx = -1;
  var paletteFiltered = []; // 当前过滤后的命令列表

  // ------------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------------

  function noop() {}

  function getUtils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function getComponents() {
    return (global.MyAgent && global.MyAgent.components) || null;
  }

  function getThemeModule() {
    return (global.MyAgent && global.MyAgent.themeModule) || null;
  }

  function dispatchDoc(type, detail) {
    if (!global.document || typeof global.CustomEvent !== 'function' || typeof global.document.dispatchEvent !== 'function') return false;
    try {
      global.document.dispatchEvent(new global.CustomEvent(type, {
        detail: detail || {},
        bubbles: true,
        cancelable: true,
      }));
      return true;
    } catch (_e) {
      return false;
    }
  }

  function showToast(msg, status) {
    var C = getComponents();
    if (C && typeof C.Toast === 'function') {
      try {
        var t = new C.Toast();
        if (typeof t.show === 'function') {
          t.show({ message: String(msg), status: status || 'info' });
          return;
        }
      } catch (_e) { /* ignore */ }
    }
  }

  function openModal(name, data) {
    var modals = global.MyAgent && global.MyAgent.modals;
    if (!modals || typeof modals[name] !== 'function') {
      showToast('功能开发中: ' + name, 'info');
      return null;
    }
    try {
      var m = modals[name](data);
      if (m && typeof m.open === 'function') m.open();
      return m;
    } catch (err) {
      showToast('打开弹窗失败: ' + String(err), 'error');
      return null;
    }
  }

  /** 解析 "/cmd arg1 arg2" → { name, args: [] } */
  function parseInput(raw) {
    if (!raw || typeof raw !== 'string') return null;
    var trimmed = raw.trim();
    if (!trimmed || trimmed.charAt(0) !== '/') return null;
    var parts = trimmed.split(/\s+/);
    var name = parts[0].slice(1); // 去掉 '/'
    var args = parts.slice(1);
    return { name: name, args: args };
  }

  // ------------------------------------------------------------------
  // 18 命令 handler 工厂
  // ------------------------------------------------------------------

  function buildHandler(cmdName) {
    switch (cmdName) {
      // Agent 域
      case 'agent-launch':
        return function (args) {
          if (!args || !args[0]) { showToast('/agent-launch <name> — 请指定 Agent 名称', 'warn'); return; }
          dispatchDoc('my-agent:agent-launch', { name: args[0] });
        };
      case 'agent-create':
        return function () { openModal('agentCreate'); };
      case 'agent-list':
        return function () { showToast('列出 Agent（UI 后续补全）', 'info'); };

      // Skill 域
      case 'skill-use':
        return function (args) {
          if (!args || !args[0]) { showToast('/skill-use <name> — 请指定 Skill 名称', 'warn'); return; }
          dispatchDoc('my-agent:skill-use', { name: args[0] });
        };
      case 'skill-list':
        return function () { showToast('列出 Skill（UI 后续补全）', 'info'); };

      // Session 域
      case 'session-new':
        return function () { openModal('sessionNew'); };
      case 'session-list':
        return function () { showToast('列出会话（UI 后续补全）', 'info'); };
      case 'session-rename':
        return function (args) {
          if (!args || !args[0]) { showToast('/session-rename <id> — 请指定会话 ID', 'warn'); return; }
          openModal('sessionRename', { sessionId: args[0] });
        };
      case 'session-delete':
        return function (args) {
          if (!args || !args[0]) { showToast('/session-delete <id> — 请指定会话 ID', 'warn'); return; }
          var modals = global.MyAgent && global.MyAgent.modals;
          if (modals && typeof modals.confirm === 'function') {
            try {
              var m = modals.confirm({
                message: '确认删除会话 ' + args[0] + '？此操作不可撤销。',
                onConfirm: function () { dispatchDoc('my-agent:session-delete', { sessionId: args[0] }); },
              });
              if (m && typeof m.open === 'function') m.open();
            } catch (_e) { dispatchDoc('my-agent:session-delete', { sessionId: args[0] }); }
          } else {
            dispatchDoc('my-agent:session-delete', { sessionId: args[0] });
          }
        };
      case 'session-export':
        return function () { openModal('sessionExport'); };
      case 'session-compact':
        return function (args) {
          var sid = (args && args[0]) ? args[0] : '';
          dispatchDoc('my-agent:compact-request', { sessionId: sid });
        };

      // Provider 域
      case 'provider-add':
        return function () { openModal('providerAdd'); };
      case 'provider-edit':
        return function (args) {
          if (!args || !args[0]) { showToast('/provider-edit <id> — 请指定 Provider ID', 'warn'); return; }
          openModal('providerEdit', { id: args[0] });
        };
      case 'provider-list':
        return function () { showToast('列出 Provider（UI 后续补全）', 'info'); };
      case 'provider-remove':
        return function (args) {
          if (!args || !args[0]) { showToast('/provider-remove <id> — 请指定 Provider ID', 'warn'); return; }
          var modals = global.MyAgent && global.MyAgent.modals;
          if (modals && typeof modals.confirm === 'function') {
            try {
              var m2 = modals.confirm({
                message: '确认删除 Provider ' + args[0] + '？',
                onConfirm: function () { dispatchDoc('my-agent:provider-remove', { id: args[0] }); },
              });
              if (m2 && typeof m2.open === 'function') m2.open();
            } catch (_e2) { dispatchDoc('my-agent:provider-remove', { id: args[0] }); }
          } else {
            dispatchDoc('my-agent:provider-remove', { id: args[0] });
          }
        };

      // 系统
      case 'theme':
        return function (args) {
          var themeName = (args && args[0]) ? args[0].toLowerCase() : '';
          var validThemes = { dark: 1, light: 1, system: 1, auto: 1 };
          if (!themeName) {
            // 循环到下一态
            var tm = getThemeModule();
            if (tm && typeof tm.nextInCycle === 'function') {
              try { tm.nextInCycle(); return; } catch (_e) { /* fall through */ }
            }
            showToast('主题循环功能暂时不可用', 'warn');
            return;
          }
          if (!validThemes[themeName]) {
            showToast('未知主题: ' + themeName + '。可用: dark | light | system', 'warn');
            return;
          }
          var tm2 = getThemeModule();
          if (tm2 && typeof tm2.applyTheme === 'function') {
            try { tm2.applyTheme(themeName === 'auto' ? 'system' : themeName); } catch (_e) { /* fall through */ }
          } else {
            showToast('主题切换功能暂时不可用', 'warn');
          }
        };
      case 'lang':
        return function (args) {
          var code = (args && args[0]) ? args[0] : 'zh';
          dispatchDoc('my-agent:lang-change', { code: code });
        };
      case 'settings':
        return function () {
          dispatchDoc('my-agent:panel-change', { panel: 'settings' });
        };

      default:
        return function () {
          showToast('未知命令: /' + cmdName, 'warn');
        };
    }
  }

  // ------------------------------------------------------------------
  // 命令注册表（公共 API）
  // ------------------------------------------------------------------

  function registerCommand(name, handler, opts) {
    if (!name || typeof handler !== 'function') return false;
    registry[name] = { handler: handler, opts: opts || {} };
    return true;
  }

  function unregisterCommand(name) {
    if (!name || !registry[name]) return false;
    delete registry[name];
    return true;
  }

  function runCommand(rawInput) {
    var parsed = parseInput(rawInput);
    if (!parsed) return false;
    var entry = registry[parsed.name];
    if (!entry) {
      showToast('未知命令: /' + parsed.name, 'warn');
      return false;
    }
    try {
      entry.handler(parsed.args);
    } catch (err) {
      showToast('命令执行失败: ' + String(err), 'error');
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 命令面板 UI
  // ------------------------------------------------------------------

  function getPaletteRoot() {
    if (paletteRoot && paletteRoot.parentNode) return paletteRoot;
    paletteRoot = null;
    return null;
  }

  function buildPaletteDom() {
    var u = getUtils();
    if (!u) return null;

    var input = u.el('input', {
      type: 'text',
      id: INPUT_ID,
      class: 'slash-command-input',
      placeholder: '输入命令...',
      autofocus: true,
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-autocomplete': 'list',
      'aria-controls': LIST_ID,
      'aria-activedescendant': '',
    });

    var list = u.el('ul', {
      id: LIST_ID,
      class: 'slash-command-list',
      role: 'listbox',
    });

    var panel = u.el('div', { class: 'slash-command-panel' }, [input, list]);

    var overlay = u.el('div', { class: 'slash-command-overlay' }, [panel]);

    var root = u.el('div', {
      id: PALETTE_ID,
      class: 'slash-command-root',
      hidden: true,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '命令面板',
    }, [overlay]);

    return { root: root, input: input, list: list, overlay: overlay };
  }

  function renderFilteredList(listEl, filtered, selectedIdx) {
    var u = getUtils();
    if (!u || !listEl) return;

    // 清空
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }

    for (var i = 0; i < filtered.length; i++) {
      var cmd = filtered[i];
      var isSelected = i === selectedIdx;
      var itemAttrs = {
        role: 'option',
        'aria-selected': isSelected ? 'true' : 'false',
        'data-index': String(i),
        class: 'slash-command-item' + (isSelected ? ' slash-command-item--selected' : ''),
      };
      if (isSelected) itemAttrs.id = 'slash-option-' + i;

      var nameSpan = u.el('span', { class: 'slash-command-name' }, ['/' + cmd.name + ' ' + (cmd.args || '')]);
      var descSpan = u.el('span', { class: 'slash-command-desc' }, [cmd.description]);
      var catSpan = u.el('span', { class: 'slash-command-cat' }, [cmd.category]);

      var item = u.el('li', itemAttrs, [nameSpan, catSpan, descSpan]);
      if (isSelected && itemAttrs.id) {
        var inputEl = listEl.parentNode && listEl.parentNode.querySelector('#' + INPUT_ID);
        if (inputEl) {
          inputEl.setAttribute('aria-activedescendant', itemAttrs.id);
        }
      }
      listEl.appendChild(item);
    }
  }

  function openCommandPalette() {
    if (paletteVisible) return;

    var existing = getPaletteRoot();
    if (!existing) {
      var built = buildPaletteDom();
      if (!built) return;
      paletteRoot = built.root;
      global.document.body.appendChild(paletteRoot);

      // 绑定事件
      built.overlay.addEventListener('click', function (ev) {
        if (ev.target === built.overlay) closeCommandPalette();
      });

      built.input.addEventListener('input', function () {
        var q = (built.input.value || '').toLowerCase();
        paletteFiltered = COMMAND_TABLE.filter(function (c) {
          return q === '' || c.name.indexOf(q) >= 0 || c.description.toLowerCase().indexOf(q) >= 0;
        });
        paletteSelectedIdx = paletteFiltered.length > 0 ? 0 : -1;
        renderFilteredList(built.list, paletteFiltered, paletteSelectedIdx);
      });

      built.input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeCommandPalette();
          return;
        }
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (paletteFiltered.length > 0) {
            paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, paletteFiltered.length - 1);
            renderFilteredList(built.list, paletteFiltered, paletteSelectedIdx);
          }
          return;
        }
        if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          if (paletteFiltered.length > 0) {
            paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0);
            renderFilteredList(built.list, paletteFiltered, paletteSelectedIdx);
          }
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (paletteSelectedIdx >= 0 && paletteSelectedIdx < paletteFiltered.length) {
            var cmd = paletteFiltered[paletteSelectedIdx];
            closeCommandPalette();
            runCommand('/' + cmd.name);
          }
          return;
        }
      });

      built.list.addEventListener('click', function (ev) {
        var target = ev.target;
        while (target && target !== built.list) {
          if (target.getAttribute && target.getAttribute('role') === 'option') {
            var idx = parseInt(target.getAttribute('data-index') || '0', 10);
            if (idx >= 0 && idx < paletteFiltered.length) {
              var cmd2 = paletteFiltered[idx];
              closeCommandPalette();
              runCommand('/' + cmd2.name);
            }
            return;
          }
          target = target.parentNode;
        }
      });
    }

    paletteRoot.hidden = false;
    paletteVisible = true;
    paletteFiltered = COMMAND_TABLE.slice();
    paletteSelectedIdx = 0;
    var inputEl = paletteRoot.querySelector('#' + INPUT_ID);
    if (inputEl) {
      inputEl.value = '';
      renderFilteredList(paletteRoot.querySelector('#' + LIST_ID), paletteFiltered, paletteSelectedIdx);
      setTimeout(function () { inputEl.focus(); }, 50);
    }
  }

  function closeCommandPalette() {
    paletteVisible = false;
    paletteFiltered = [];
    paletteSelectedIdx = -1;
    if (paletteRoot) {
      paletteRoot.hidden = true;
    }
  }

  // ------------------------------------------------------------------
  // install / uninstall
  // ------------------------------------------------------------------

  function installSlashCommandPalette() {
    // 注册全部 18 命令
    for (var i = 0; i < COMMAND_TABLE.length; i++) {
      var cmd = COMMAND_TABLE[i];
      registerCommand(cmd.name, buildHandler(cmd.name), {
        description: cmd.description,
        category: cmd.category,
        args: cmd.args,
      });
    }

    // 如果 keymap 已安装且 slashFeature 未安装，补注册 Cmd+K
    // (appKeymap 启动时会调 openCommandPalette — 无需二次注册)
    return true;
  }

  function uninstallSlashCommandPalette() {
    // 清空注册表
    Object.keys(registry).forEach(function (k) { delete registry[k]; });
    // 摘除面板 DOM
    if (paletteRoot && paletteRoot.parentNode) {
      paletteRoot.parentNode.removeChild(paletteRoot);
    }
    paletteRoot = null;
    paletteVisible = false;
  }

  // ------------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.slash = {
    installSlashCommandPalette: installSlashCommandPalette,
    uninstallSlashCommandPalette: uninstallSlashCommandPalette,
    registerCommand: registerCommand,
    unregisterCommand: unregisterCommand,
    runCommand: runCommand,
    openCommandPalette: openCommandPalette,
    closeCommandPalette: closeCommandPalette,
    // 测试/调试
    _internal: {
      COMMAND_TABLE: COMMAND_TABLE,
      registry: registry,
      parseInput: parseInput,
      buildHandler: buildHandler,
      paletteVisible: function () { return paletteVisible; },
      paletteFiltered: function () { return paletteFiltered; },
      paletteSelectedIdx: function () { return paletteSelectedIdx; },
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
