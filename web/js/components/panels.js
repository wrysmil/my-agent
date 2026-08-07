/**
 * panels.js — 5 个右侧 panel DOM 骨架（spec § 5.2 / F7 / WU-05a）
 *
 * 设计约束：
 * - 零依赖；纯 ES2023 + DOM API。
 * - IIFE 模式挂载 window.MyAgent.components.{HomePanel, ChatPanel, SessionsPanel, ProvidersPanel, AgentsPanel}。
 * - 走 window.MyAgent.utils.el() 构造（防 XSS）。
 * - 每个 panel 提供：{ el, destroy(), update(props) }
 * - a11y：role="main" + aria-labelledby 指向内部 h2 heading
 * - 本文件**只做 DOM 骨架**：HomePanel 9 个菜单按钮为 placeholder，等 F8 (WU-05b) 接入
 *   真实数据；Chat / Sessions / Providers / Agents 的 list 区域也只构造容器 + 空状态，
 *   真实数据由 F9-F12 (WU-05c/d/e) 注入。
 *
 * 暴露的 5 个 panel 构造器：
 *   - HomePanel({ onMenuAction })            —— Bento Grid 9 个菜单按钮（placeholder）
 *   - ChatPanel({ sessionId, onSend })       —— chat transcript + input + send 占位
 *   - SessionsPanel({ sessions, onSelect, onDelete }) —— session 列表
 *   - ProvidersPanel({ providers, activeProviderId, onEdit }) —— provider 列表
 *   - AgentsPanel({ agents, skills, onLaunch })  —— agent 列表 + skill 列表
 */
(function (global) {
  'use strict';

  // ----------------------------------------------------------------------
  // 共享 helpers
  // ----------------------------------------------------------------------

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function genId(prefix) {
    return (
      (prefix || 'panel') +
      '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-4)
    );
  }

  /**
   * 构造一个标准 panel 容器。
   * 通用结构：
   *   <section role="main" aria-labelledby="<titleId>" class="panel">
   *     <h2 id="<titleId>" class="panel-title">{title}</h2>
   *     <div class="panel-body">{children}</div>
   *   </section>
   *
   * @param {object} args
   * @returns {{ root: HTMLElement, heading: HTMLElement, body: HTMLElement, rootId: string }}
   */
  function buildPanelShell(args) {
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[panels] window.MyAgent.utils.el 不可用；请确认 utils.js 已先加载');
    }
    var panelId = args.id ? String(args.id) : genId(args.prefix || 'panel');
    var titleId = panelId + '-title';
    var bodyId = panelId + '-body';
    var title = String(args.title || '');
    var extraClass = args.className ? String(args.className) : '';

    var classes = ['panel'];
    if (extraClass) classes.push(extraClass);
    if (args.dataPanel) classes.push('panel-' + String(args.dataPanel));

    var heading = u.el(
      'h2',
      { class: 'panel-title', id: titleId },
      [title]
    );
    var body = u.el(
      'div',
      { class: 'panel-body', id: bodyId, role: 'region', 'aria-label': title + ' 内容' },
      []
    );
    var root = u.el(
      'section',
      {
        class: classes.join(' '),
        id: panelId,
        role: 'main',
        'aria-labelledby': titleId,
        'data-panel': args.dataPanel || '',
        tabindex: '-1',
      },
      [heading, body]
    );
    return { root: root, heading: heading, body: body, rootId: panelId };
  }

  /**
   * 安全派发 CustomEvent —— 同一文件多处复用，集中放在 helper。
   */
  function emit(target, eventName, detail) {
    var evt;
    try {
      evt = new global.CustomEvent(eventName, {
        bubbles: true,
        cancelable: true,
        detail: detail || {},
      });
    } catch (_e) {
      evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(eventName, true, true, detail || {});
    }
    target.dispatchEvent(evt);
  }

  /**
   * 构造空状态占位节点（Skeleton 风格，避免引入依赖）。
   * @param {string} text
   * @returns {HTMLElement}
   */
  function emptyState(text) {
    var u = utils();
    return u.el('div', {
      class: 'panel-empty',
      role: 'status',
    }, [String(text || '暂无数据')]);
  }

  // ----------------------------------------------------------------------
  // HomePanel — 主菜单（9 个 placeholder 按钮；F8 WU-05b 接入）
  // ----------------------------------------------------------------------

  /**
   * HomePanel({ onMenuAction }):
   *   - 构造 9 个 placeholder 按钮（占满 3×3 Bento Grid 槽位；当前 spec 是 6 按钮，
   *     多 3 个为扩展位）。
   *   - 每按钮：data-menu-id / aria-label
   *   - 点击按钮 → 派发 'my-agent:menu-action'（detail: { menuId, label }）
   *     + 调用 onMenuAction(menuId, label)
   *   - .update({ items }) —— 替换 placeholder 列表（items 可选；不传则保留占位）
   *
   * @param {object} [options]
   * @returns {{ el, destroy, update }}
   */
  function HomePanel(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[HomePanel] utils.el 不可用');
    }
    var onMenuAction = typeof options.onMenuAction === 'function' ? options.onMenuAction : null;
    var shell = buildPanelShell({
      prefix: 'panel-home',
      dataPanel: 'home',
      title: '主菜单',
      className: 'panel-home',
    });

    var defaultItems = [
      { id: 'start-chat',     label: '开始对话' },
      { id: 'history',        label: '加载历史对话' },
      { id: 'providers',      label: '设置提供商' },
      { id: 'view-provider',  label: '查看当前提供商' },
      { id: 'agents',         label: '子 Agent 管理' },
      { id: 'skills',         label: '技能' },
      { id: 'settings',       label: '设置' },
      { id: 'help',           label: '帮助' },
      { id: 'quit',           label: '退出' },
    ];

    var grid = u.el('div', {
      class: 'bento-grid panel-bento-grid',
      role: 'grid',
      'aria-label': '主菜单网格',
    }, []);
    shell.body.appendChild(grid);

    var currentButtons = [];

    function renderItems(items) {
      // 清旧
      while (grid.firstChild) grid.removeChild(grid.firstChild);
      currentButtons = [];
      items.forEach(function (it, idx) {
        var id = it && it.id != null ? String(it.id) : 'item-' + idx;
        var label = it && it.label != null ? String(it.label) : id;
        var btn = u.el('button', {
          type: 'button',
          class: 'panel-menu-btn bento-card',
          role: 'gridcell',
          tabindex: '0',
          'data-menu-id': id,
          'aria-label': label,
        }, [String(idx + 1), label]);
        btn.addEventListener('click', function () {
          try { if (onMenuAction) onMenuAction(id, label); } catch (_e) { /* 静默 */ }
          emit(shell.root, 'my-agent:menu-action', { menuId: id, label: label });
        });
        btn.addEventListener('keydown', function (ev) {
          var k = ev.key;
          if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
            ev.preventDefault();
            btn.click();
          }
        });
        grid.appendChild(btn);
        currentButtons.push({ id: id, btn: btn });
      });
    }

    // 初次构造：渲染默认 9 项 placeholder
    renderItems(defaultItems);

    function update(props) {
      props = props || {};
      if (Array.isArray(props.items)) {
        renderItems(props.items);
      }
    }

    function destroy() {
      // 节点从父节点摘除（DOM API 自动清理事件监听；这里显式 removeChild 保证一致性）
      if (shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
    }

    return { el: shell.root, update: update, destroy: destroy, heading: shell.heading, body: shell.body };
  }

  // ----------------------------------------------------------------------
  // ChatPanel — 对话面板（transcript + input + send 占位）
  // ----------------------------------------------------------------------

  /**
   * ChatPanel({ sessionId, onSend }):
   *   - transcript 区域：role="log" + aria-live="polite"
   *   - input：textarea（受控留位 —— 真实绑定由 chat.js F11 WU-05c 接入）
   *   - send button：aria-label="发送消息"
   *   - 空状态：未提供 sessionId 时显示「请选择或新建一个会话」
   *
   * @param {object} [options]
   * @returns {{ el, destroy, update }}
   */
  function ChatPanel(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[ChatPanel] utils.el 不可用');
    }
    var onSend = typeof options.onSend === 'function' ? options.onSend : null;
    var sessionId = options.sessionId != null ? String(options.sessionId) : null;

    var shell = buildPanelShell({
      prefix: 'panel-chat',
      dataPanel: 'chat',
      title: '对话',
      className: 'panel-chat',
    });

    // 工具栏：session label
    var sessionLabelText = sessionId ? 'Session: ' + sessionId : 'Session: —';
    var sessionLabel = u.el('span', {
      class: 'chat-session-label',
      id: shell.rootId + '-session-label',
    }, [sessionLabelText]);
    var toolbar = u.el('div', { class: 'chat-toolbar', role: 'toolbar', 'aria-label': '对话工具栏' }, [sessionLabel]);
    shell.body.appendChild(toolbar);

    // transcript
    var transcript = u.el('div', {
      class: 'chat-transcript',
      id: shell.rootId + '-transcript',
      role: 'log',
      'aria-live': 'polite',
      'aria-relevant': 'additions',
      'aria-label': '对话消息流',
    }, []);
    if (!sessionId) {
      transcript.appendChild(emptyState('请选择或新建一个会话'));
    }
    shell.body.appendChild(transcript);

    // composer
    var inputId = shell.rootId + '-input';
    var composer = u.el('form', {
      class: 'chat-composer',
      id: shell.rootId + '-composer',
      'aria-label': '消息输入',
    }, []);
    var label = u.el('label', { class: 'visually-hidden', for: inputId }, ['输入消息']);
    var textarea = u.el('textarea', {
      id: inputId,
      class: 'chat-input',
      rows: '3',
      placeholder: '输入消息（Cmd/Ctrl+Enter 发送）',
    }, []);
    var sendBtn = u.el('button', {
      type: 'submit',
      class: 'chat-send-btn',
      'aria-label': '发送消息',
      tabindex: '0',
    }, ['发送']);
    composer.appendChild(label);
    composer.appendChild(textarea);
    composer.appendChild(sendBtn);
    shell.body.appendChild(composer);

    // 行为
    function doSend(ev) {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      var text = textarea.value;
      try { if (onSend) onSend(text, sessionId); } catch (err) {
        if (global.console && typeof global.console.error === 'function') {
          global.console.error('[ChatPanel] onSend 抛错:', err);
        }
      }
      emit(shell.root, 'my-agent:chat-send', { text: text, sessionId: sessionId });
    }
    composer.addEventListener('submit', doSend);

    textarea.addEventListener('keydown', function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
        ev.preventDefault();
        doSend();
      }
    });

    sendBtn.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        ev.preventDefault();
        doSend();
      }
    });

    function update(props) {
      props = props || {};
      if ('sessionId' in props) {
        sessionId = props.sessionId != null ? String(props.sessionId) : null;
        sessionLabel.textContent = sessionId ? 'Session: ' + sessionId : 'Session: —';
        // 清空 transcript
        while (transcript.firstChild) transcript.removeChild(transcript.firstChild);
        if (!sessionId) transcript.appendChild(emptyState('请选择或新建一个会话'));
      }
      if (typeof props.disabled === 'boolean') {
        textarea.disabled = props.disabled;
        sendBtn.disabled = props.disabled;
        sendBtn.setAttribute('aria-disabled', props.disabled ? 'true' : 'false');
      }
    }

    function destroy() {
      if (shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
    }

    return { el: shell.root, update: update, destroy: destroy, heading: shell.heading, body: shell.body };
  }

  // ----------------------------------------------------------------------
  // SessionsPanel — 历史会话列表
  // ----------------------------------------------------------------------

  /**
   * SessionsPanel({ sessions, onSelect, onDelete }):
   *   - session list：role="list"
   *   - 每条：button-like li，data-session-id；hover 显示删除按钮（占位）
   *
   * @param {object} [options]
   * @returns {{ el, destroy, update }}
   */
  function SessionsPanel(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[SessionsPanel] utils.el 不可用');
    }
    var onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
    var onDelete = typeof options.onDelete === 'function' ? options.onDelete : null;
    var initialSessions = Array.isArray(options.sessions) ? options.sessions : [];

    var shell = buildPanelShell({
      prefix: 'panel-sessions',
      dataPanel: 'sessions',
      title: '历史会话',
      className: 'panel-sessions',
    });

    var list = u.el('ul', {
      class: 'panel-sessions-list',
      id: shell.rootId + '-list',
      role: 'list',
      'aria-label': '历史会话列表',
    }, []);
    shell.body.appendChild(list);

    var currentSessions = [];

    function renderList(sessions) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!Array.isArray(sessions) || sessions.length === 0) {
        list.appendChild(emptyState('暂无历史会话'));
        currentSessions = [];
        return;
      }
      sessions.forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        var sid = s.id != null ? String(s.id) : '';
        if (!sid) return;
        var name = s.name != null ? String(s.name) : sid;
        var li = u.el('li', {
          class: 'panel-sessions-item',
          role: 'listitem',
          tabindex: '0',
          'data-session-id': sid,
          'aria-label': '会话：' + name,
        }, [name]);
        // delete button（占位 —— 真实功能由 WU-05d 接入）
        var delBtn = u.el('button', {
          type: 'button',
          class: 'panel-sessions-delete',
          'aria-label': '删除会话 ' + name,
          tabindex: '0',
        }, ['删除']);
        li.appendChild(delBtn);

        li.addEventListener('click', function (ev) {
          // 点击在删除按钮上：忽略（由 delete 自身处理）
          if (ev.target === delBtn) return;
          try { if (onSelect) onSelect(sid); } catch (_e) { /* 静默 */ }
          emit(shell.root, 'my-agent:session-select', { sessionId: sid });
        });
        li.addEventListener('keydown', function (ev) {
          var k = ev.key;
          if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
            ev.preventDefault();
            try { if (onSelect) onSelect(sid); } catch (_e) { /* 静默 */ }
            emit(shell.root, 'my-agent:session-select', { sessionId: sid });
          }
        });
        delBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          try { if (onDelete) onDelete(sid); } catch (_e) { /* 静默 */ }
          emit(shell.root, 'my-agent:session-delete', { sessionId: sid });
        });

        list.appendChild(li);
      });
      currentSessions = sessions.slice();
    }

    renderList(initialSessions);

    function update(props) {
      props = props || {};
      if (Array.isArray(props.sessions)) {
        renderList(props.sessions);
      }
    }

    function destroy() {
      if (shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
    }

    return { el: shell.root, update: update, destroy: destroy, heading: shell.heading, body: shell.body, list: list };
  }

  // ----------------------------------------------------------------------
  // ProvidersPanel — 提供商列表
  // ----------------------------------------------------------------------

  /**
   * ProvidersPanel({ providers, activeProviderId, onEdit }):
   *   - 列表：role="list"
   *   - 当前 active 的 provider 用 aria-current="true"
   *   - 每条编辑按钮 → onEdit(providerId)
   *
   * @param {object} [options]
   * @returns {{ el, destroy, update }}
   */
  function ProvidersPanel(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[ProvidersPanel] utils.el 不可用');
    }
    var onEdit = typeof options.onEdit === 'function' ? options.onEdit : null;
    var initialProviders = Array.isArray(options.providers) ? options.providers : [];
    var activeProviderId = options.activeProviderId != null ? String(options.activeProviderId) : null;

    var shell = buildPanelShell({
      prefix: 'panel-providers',
      dataPanel: 'providers',
      title: '提供商设置',
      className: 'panel-providers',
    });

    var list = u.el('ul', {
      class: 'panel-providers-list',
      id: shell.rootId + '-list',
      role: 'list',
      'aria-label': '提供商列表',
    }, []);
    shell.body.appendChild(list);

    function renderList(providers, activeId) {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (!Array.isArray(providers) || providers.length === 0) {
        list.appendChild(emptyState('暂无提供商配置'));
        return;
      }
      providers.forEach(function (p) {
        if (!p || typeof p !== 'object') return;
        var pid = p.id != null ? String(p.id) : '';
        if (!pid) return;
        var name = p.name != null ? String(p.name) : pid;
        var enabled = !!p.enabled;
        var isActive = pid === activeId;

        var li = u.el('li', {
          class: 'panel-providers-item',
          role: 'listitem',
          tabindex: '0',
          'data-provider-id': pid,
          'aria-current': isActive ? 'true' : 'false',
          'aria-label': name + (isActive ? '（当前激活）' : '') + (enabled ? '' : '（已禁用）'),
        }, [name + (isActive ? '  ★' : '') + (enabled ? '' : '  [禁用]')]);

        var editBtn = u.el('button', {
          type: 'button',
          class: 'panel-providers-edit',
          'aria-label': '编辑提供商 ' + name,
          tabindex: '0',
        }, ['编辑']);
        li.appendChild(editBtn);

        editBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          try { if (onEdit) onEdit(pid); } catch (_e) { /* 静默 */ }
          emit(shell.root, 'my-agent:provider-edit', { providerId: pid });
        });
        li.addEventListener('click', function () {
          try { if (onEdit) onEdit(pid); } catch (_e) { /* 静默 */ }
          emit(shell.root, 'my-agent:provider-edit', { providerId: pid });
        });
        li.addEventListener('keydown', function (ev) {
          var k = ev.key;
          if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
            ev.preventDefault();
            try { if (onEdit) onEdit(pid); } catch (_e) { /* 静默 */ }
            emit(shell.root, 'my-agent:provider-edit', { providerId: pid });
          }
        });

        list.appendChild(li);
      });
    }

    renderList(initialProviders, activeProviderId);

    function update(props) {
      props = props || {};
      if (Array.isArray(props.providers)) {
        activeProviderId = 'activeProviderId' in props && props.activeProviderId != null
          ? String(props.activeProviderId)
          : activeProviderId;
        renderList(props.providers, activeProviderId);
      } else if ('activeProviderId' in props) {
        activeProviderId = props.activeProviderId != null ? String(props.activeProviderId) : null;
        renderList(initialProviders, activeProviderId);
      }
    }

    function destroy() {
      if (shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
    }

    return { el: shell.root, update: update, destroy: destroy, heading: shell.heading, body: shell.body, list: list };
  }

  // ----------------------------------------------------------------------
  // AgentsPanel — 子 Agent + Skill 列表
  // ----------------------------------------------------------------------

  /**
   * AgentsPanel({ agents, skills, onLaunch }):
   *   - 两块列表：agents / skills
   *   - 每条 launch 按钮 → onLaunch(agentId)
   *
   * @param {object} [options]
   * @returns {{ el, destroy, update }}
   */
  function AgentsPanel(options) {
    options = options || {};
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[AgentsPanel] utils.el 不可用');
    }
    var onLaunch = typeof options.onLaunch === 'function' ? options.onLaunch : null;
    var initialAgents = Array.isArray(options.agents) ? options.agents : [];
    var initialSkills = Array.isArray(options.skills) ? options.skills : [];

    var shell = buildPanelShell({
      prefix: 'panel-agents',
      dataPanel: 'agents',
      title: '子 Agent 管理',
      className: 'panel-agents',
    });

    // ── agents 子区
    var agentsHeadingId = shell.rootId + '-agents-heading';
    var agentsHeading = u.el('h3', { class: 'panel-subtitle', id: agentsHeadingId }, ['子 Agent']);
    var agentsList = u.el('ul', {
      class: 'panel-agents-list',
      id: shell.rootId + '-agents-list',
      role: 'list',
      'aria-labelledby': agentsHeadingId,
    }, []);
    var agentsBlock = u.el('div', { class: 'panel-agents-block' }, [agentsHeading, agentsList]);
    shell.body.appendChild(agentsBlock);

    // ── skills 子区
    var skillsHeadingId = shell.rootId + '-skills-heading';
    var skillsHeading = u.el('h3', { class: 'panel-subtitle', id: skillsHeadingId }, ['技能']);
    var skillsList = u.el('ul', {
      class: 'panel-agents-skills-list',
      id: shell.rootId + '-skills-list',
      role: 'list',
      'aria-labelledby': skillsHeadingId,
    }, []);
    var skillsBlock = u.el('div', { class: 'panel-agents-skills-block' }, [skillsHeading, skillsList]);
    shell.body.appendChild(skillsBlock);

    function renderList(target, items, kind) {
      while (target.firstChild) target.removeChild(target.firstChild);
      if (!Array.isArray(items) || items.length === 0) {
        target.appendChild(emptyState('暂无' + (kind === 'agent' ? '子 Agent' : '技能')));
        return;
      }
      items.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        var id = it.id != null ? String(it.id) : '';
        if (!id) return;
        var name = it.name != null ? String(it.name) : id;
        var desc = it.description_zh != null ? String(it.description_zh)
          : (it.description != null ? String(it.description) : '');
        var source = it.source != null ? String(it.source) : '';

        var li = u.el('li', {
          class: 'panel-agents-item',
          role: 'listitem',
          tabindex: '0',
          'data-agent-id': id,
          'aria-label': (kind === 'agent' ? '子 Agent：' : '技能：') + name,
        }, [name + (source ? '  [' + source + ']' : ''), desc ? '  — ' + desc : '']);

        if (kind === 'agent') {
          var launchBtn = u.el('button', {
            type: 'button',
            class: 'panel-agents-launch',
            'aria-label': '启动子 Agent ' + name,
            tabindex: '0',
          }, ['启动']);
          li.appendChild(launchBtn);
          launchBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            try { if (onLaunch) onLaunch(id); } catch (_e) { /* 静默 */ }
            emit(shell.root, 'my-agent:agent-launch', { agentId: id });
          });
        }

        target.appendChild(li);
      });
    }

    renderList(agentsList, initialAgents, 'agent');
    renderList(skillsList, initialSkills, 'skill');

    function update(props) {
      props = props || {};
      if (Array.isArray(props.agents)) renderList(agentsList, props.agents, 'agent');
      if (Array.isArray(props.skills)) renderList(skillsList, props.skills, 'skill');
    }

    function destroy() {
      if (shell.root.parentNode) shell.root.parentNode.removeChild(shell.root);
    }

    return { el: shell.root, update: update, destroy: destroy, heading: shell.heading, body: shell.body };
  }

  // ----------------------------------------------------------------------
  // 导出
  // ----------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.components = global.MyAgent.components || {};
  global.MyAgent.components.HomePanel = HomePanel;
  global.MyAgent.components.ChatPanel = ChatPanel;
  global.MyAgent.components.SessionsPanel = SessionsPanel;
  global.MyAgent.components.ProvidersPanel = ProvidersPanel;
  global.MyAgent.components.AgentsPanel = AgentsPanel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
