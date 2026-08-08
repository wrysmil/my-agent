/**
 * features/agents.js — 子 Agent 管理视图（F12 / WU-05e）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.4
 *           + § 4.4.6 (IIFE 模式) + § 4.3 (零运行时依赖)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-05e
 *
 * 职责（spec § 5.4 Agent UI）:
 *   - 渲染 builtin + user agents 列表
 *   - 点击 agent → modal 显示详情（id / systemPrompt preview / tools / scope / source）
 *   - 「启动对话」按钮 → 派发 CustomEvent('my-agent:agent-launch', { detail: { agentId, agentName } })
 *     由 F15 app.js 接管（切到 chat panel + 预填 system prompt / 工具白名单）
 *   - 「Agents」 + 「Skills」 两个 Tab（用 WU-04c Tabs 组件；本 WU 仅实现 Agents tab
 *     内容，Skills tab 留给 WU-05f 占位空文案）
 *   - 状态缓存 agentState.agents（state/state.js WU-04b 内建 store）
 *   - 错误处理：Toast（toast 组件 WU-04c）
 *   - a11y：Tabs role="tablist" + Agent 列表 <ul role="listbox"> + 选项 role="option"
 *
 * API 契约（与 src/web/server/routes/agents.ts 对齐）:
 *   GET /api/agents
 *     → 200 { ok:true, data:{ agents: AgentListItem[] } }
 *       AgentListItem: { id, name, description, source, scope, enabled, tools }
 *   GET /api/agents/:id
 *     → 200 { ok:true, data:{ agent: AgentDetail } }
 *       AgentDetail = AgentListItem + { description_zh, description_en, systemPrompt }
 *     → 404 { ok:false, error:{ code:'AGENT_NOT_FOUND', message } }
 *
 * 与其他模块的协作:
 *   - 依赖 utils.js / api.js / i18n.js / icons.js（shared，WU-04a）
 *   - 依赖 state/state.js（agentState 内置 store；WU-04b）
 *   - 依赖 components/{tabs,modal,button,toast,badge}.js（WU-04c）
 *   - 不依赖 chat.js / menu.js / providers.js / skills.js / slash.js（其他 WU）
 *
 * 加载方式: <script defer> + IIFE（与 spec § 4.4.6 / 仿写Agent前端框架指南一致）。
 * 测试:    test/web/features-agents.test.ts（≥ 10 用例）
 */

(function (global) {
  'use strict';

  // ────────────────────────────────────────────────────────────────────
  // 常量
  // ────────────────────────────────────────────────────────────────────

  /** 「启动对话」按钮派发的 CustomEvent 名（spec § 5.4 + F15 app.js 约定） */
  var LAUNCH_EVENT = 'my-agent:agent-launch';

  /** 详情 modal 最大 systemPrompt 预览字符数（防 XSS + 防 layout 撑爆） */
  var SYSTEM_PROMPT_PREVIEW_MAX = 600;

  /** 列表空文案（i18n 优先；缺则 fallback 中文字面量） */
  var EMPTY_TEXT = {
    zh: '暂无 Agent',
    en: 'No agents available',
  };

  /** scope → 文案映射（spec § 5.4 Agent UI） */
  var SCOPE_LABELS = {
    builtin: { zh: '内置', en: 'Built-in' },
    user: { zh: '用户', en: 'User' },
    both: { zh: '内置+用户', en: 'Built-in+User' },
  };

  /** source → 文案映射 */
  var SOURCE_LABELS = {
    builtin: { zh: '内置', en: 'Built-in' },
    user: { zh: '用户自定义', en: 'User-defined' },
  };

  // ────────────────────────────────────────────────────────────────────
  // 内部 helpers — 解析依赖（与 spec § 4.4.6「全局对象模块通信」一致）
  // ────────────────────────────────────────────────────────────────────

  function utils() {
    return (global.MyAgent && global.MyAgent.utils) || null;
  }

  function api() {
    return (global.MyAgent && global.MyAgent.api) || null;
  }

  function i18n() {
    return global.MyAgent && global.MyAgent.i18n;
  }

  function stateStore() {
    return (global.MyAgent && global.MyAgent.state) || null;
  }

  function components() {
    return (global.MyAgent && global.MyAgent.components) || {};
  }

  function getLang() {
    var dict = i18n();
    if (dict && typeof dict.getLang === 'function') {
      try {
        return dict.getLang();
      } catch (_e) {
        /* ignore */
      }
    }
    return 'zh';
  }

  function tr(key, fallback) {
    var dict = i18n();
    if (dict && typeof dict.t === 'function') {
      try {
        var v = dict.t(key);
        if (v && v !== key) return v;
      } catch (_e) {
        /* ignore */
      }
    }
    return fallback;
  }

  /**
   * scope/source → 当前语言的展示文案。未知值 → 原字符串。
   * @param {Record<string, {zh:string,en:string}>} map
   * @param {string} key
   */
  function pickLabel(map, key) {
    var entry = map[key];
    if (!entry) return String(key || '');
    var lang = getLang();
    return entry[lang] || entry.zh || entry.en || String(key || '');
  }

  /**
   * 从 ApiClientError 提取人类可读消息。
   * @param {unknown} err
   * @returns {string}
   */
  function errMessage(err) {
    if (err && typeof err === 'object') {
      var e = /** @type {any} */ (err);
      if (typeof e.message === 'string' && e.message.length > 0) return e.message;
      if (typeof e.code === 'string') return e.code;
    }
    return tr('error.unknown', '未知错误');
  }

  /**
   * 截断 systemPrompt 预览（按 char 截断，保留末尾省略号）。
   * @param {string} s
   * @param {number} max
   */
  function truncate(s, max) {
    if (typeof s !== 'string') return '';
    if (s.length <= max) return s;
    return s.slice(0, max) + '…';
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:Toast 单例缓存（避免每次 install 重建）
  // ────────────────────────────────────────────────────────────────────

  var toastSingleton = null;
  function getToast() {
    if (toastSingleton) return toastSingleton;
    var C = components();
    if (!C || typeof C.Toast !== 'function') return null;
    try {
      toastSingleton = C.Toast({});
    } catch (_e) {
      return null;
    }
    return toastSingleton;
  }

  function showToast(message, status) {
    var t = getToast();
    if (!t || typeof t.show !== 'function') return;
    try {
      t.show({ message: String(message || ''), status: status || 'error' });
    } catch (_e) {
      /* ignore */
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:fetch list / detail（apiFetch 已封装 {ok,data}/{ok,error} 协议）
  // ────────────────────────────────────────────────────────────────────

  /**
   * GET /api/agents → 列表。
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<Array<any>>}
   */
  function fetchAgentsList(opts) {
    var a = api();
    if (!a || typeof a.apiFetch !== 'function') {
      return Promise.reject(new Error('window.MyAgent.api.apiFetch 不可用'));
    }
    var init = {};
    if (opts && opts.signal) init.signal = opts.signal;
    return a.apiFetch('/api/agents', init).then(function (data) {
      // 兼容后端两种返回：{ agents: [...] } 或 直接 [...]
      if (data && Array.isArray(data.agents)) return data.agents;
      if (Array.isArray(data)) return data;
      return [];
    });
  }

  /**
   * GET /api/agents/:id → 详情。
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<any>}
   */
  function fetchAgentDetail(id, opts) {
    var a = api();
    if (!a || typeof a.apiFetch !== 'function') {
      return Promise.reject(new Error('window.MyAgent.api.apiFetch 不可用'));
    }
    var init = {};
    if (opts && opts.signal) init.signal = opts.signal;
    var safeId = encodeURIComponent(String(id || ''));
    return a.apiFetch('/api/agents/' + safeId, init).then(function (data) {
      // 兼容 { agent: {...} } 或 直接 {...}
      if (data && typeof data === 'object' && data.agent) return data.agent;
      return data;
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:缓存写回 agentState（W-04b 内建 store）
  // ────────────────────────────────────────────────────────────────────

  function cacheAgents(list) {
    var s = stateStore();
    if (!s) return;
    var store = null;
    try {
      store = typeof s.getStore === 'function' ? s.getStore('agentState') : null;
    } catch (_e) {
      return;
    }
    if (!store || typeof store.set !== 'function') return;
    try {
      var prev = store.get();
      var next = Object.assign({}, prev, { agents: Array.isArray(list) ? list : [] });
      store.set(next);
    } catch (_e) {
      // schema 校验失败等情况 → 静默（不影响 UI 渲染）
    }
  }

  function getCachedAgents() {
    var s = stateStore();
    if (!s || typeof s.getStore !== 'function') return [];
    var store = s.getStore('agentState');
    if (!store) return [];
    var v = store.get();
    if (v && Array.isArray(v.agents)) return v.agents.slice();
    return [];
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:render helpers（构造 list 项 / detail 内容）
  // ────────────────────────────────────────────────────────────────────

  /**
   * 渲染 scope 角标（builtin / user / both）。直接 inline <span>，
   * 文本由 utils.el 走 textContent 防 XSS。
   * @param {string} scope
   */
  function buildScopeBadge(scope) {
    var u = utils();
    if (!u || typeof u.el !== 'function') return null;
    var label = pickLabel(SCOPE_LABELS, scope);
    var variant =
      scope === 'builtin'
        ? 'primary'
        : scope === 'user'
        ? 'success'
        : scope === 'both'
        ? 'warning'
        : 'primary';
    return u.el('span', {
      class: 'badge-scope badge badge-' + variant,
      'data-scope': String(scope || ''),
      'aria-label': label,
    }, [label]);
  }

  /**
   * 渲染单条 agent 列表项（<li role="option">）。
   * @param {object} agent
   * @returns {HTMLElement}
   */
  function buildAgentRow(agent) {
    var u = utils();
    if (!u || typeof u.el !== 'function') return null;
    var id = String((agent && agent.id) || '');
    var name = String((agent && agent.name) || id);
    var description =
      (agent && (agent.description_zh || agent.description)) ||
      (agent && agent.description_en) ||
      '';
    var scope = String((agent && agent.scope) || 'builtin');

    var scopeBadge = buildScopeBadge(scope);

    var nameNode = u.el('div', { class: 'agent-row-name' }, [name]);
    var descNode = u.el('div', { class: 'agent-row-desc' }, [String(description)]);
    var metaNode = u.el('div', { class: 'agent-row-meta' }, [
      u.el('span', { class: 'agent-row-id' }, [id]),
    ]);

    var headNode = u.el('div', { class: 'agent-row-head' }, [
      nameNode,
      scopeBadge,
    ]);

    return u.el(
      'li',
      {
        class: 'agent-row',
        role: 'option',
        'aria-selected': 'false',
        tabindex: '0',
        'data-agent-id': id,
        dataset: { agentId: id, scope: scope },
      },
      [headNode, descNode, metaNode],
    );
  }

  /**
   * 渲染 detail modal 内容（id / name / description_zh / systemPrompt preview /
   * tools 列表 / scope / source + 「启动对话」按钮）。
   * @param {object} detail AgentDetail
   * @returns {HTMLElement}
   */
  function buildDetailContent(detail, handlers) {
    var u = utils();
    if (!u || typeof u.el !== 'function') return null;
    handlers = handlers || {};

    var id = String((detail && detail.id) || '');
    var name = String((detail && detail.name) || id);
    var descriptionZh = String((detail && detail.description_zh) || '');
    var descriptionEn = String((detail && detail.description_en) || '');
    var systemPrompt = String((detail && detail.systemPrompt) || '');
    var tools = Array.isArray(detail && detail.tools) ? detail.tools : [];
    var scope = String((detail && detail.scope) || 'builtin');
    var source = String((detail && detail.source) || 'builtin');

    // 顶部：name + scope badge
    var header = u.el('div', { class: 'agent-detail-header' }, [
      u.el('h3', { class: 'agent-detail-name' }, [name]),
      buildScopeBadge(scope),
    ]);

    // id 段
    var idRow = u.el('div', { class: 'agent-detail-row' }, [
      u.el('span', { class: 'agent-detail-label' }, [
        tr('agent.field.id', 'ID'),
      ]),
      u.el('code', { class: 'agent-detail-value' }, [id]),
    ]);

    // source 段
    var sourceLabel = pickLabel(SOURCE_LABELS, source);
    var sourceRow = u.el('div', { class: 'agent-detail-row' }, [
      u.el('span', { class: 'agent-detail-label' }, [
        tr('agent.field.source', '来源'),
      ]),
      u.el('span', { class: 'agent-detail-value' }, [sourceLabel]),
    ]);

    // description_zh 段
    var descRows = [];
    if (descriptionZh) {
      descRows.push(
        u.el('div', { class: 'agent-detail-row agent-detail-row-block' }, [
          u.el('div', { class: 'agent-detail-label' }, [
            tr('agent.field.descriptionZh', '中文说明'),
          ]),
          u.el('p', { class: 'agent-detail-description' }, [descriptionZh]),
        ]),
      );
    }
    if (descriptionEn) {
      descRows.push(
        u.el('div', { class: 'agent-detail-row agent-detail-row-block' }, [
          u.el('div', { class: 'agent-detail-label' }, [
            tr('agent.field.descriptionEn', 'English Description'),
          ]),
          u.el('p', { class: 'agent-detail-description' }, [descriptionEn]),
        ]),
      );
    }

    // tools 段
    var toolsBlock;
    if (tools.length > 0) {
      var toolsItems = tools.map(function (toolName) {
        return u.el('li', { class: 'agent-tool-chip', dataset: { tool: String(toolName) } }, [
          String(toolName),
        ]);
      });
      toolsBlock = u.el('div', { class: 'agent-detail-row agent-detail-row-block' }, [
        u.el('div', { class: 'agent-detail-label' }, [
          tr('agent.field.tools', '可用工具 / Skills'),
        ]),
        u.el('ul', { class: 'agent-tool-list' }, toolsItems),
      ]);
    } else {
      toolsBlock = u.el('div', { class: 'agent-detail-row agent-detail-row-block' }, [
        u.el('div', { class: 'agent-detail-label' }, [
          tr('agent.field.tools', '可用工具 / Skills'),
        ]),
        u.el('p', { class: 'agent-detail-empty-tools' }, [
          tr('agent.empty.tools', '无'),
        ]),
      ]);
    }

    // systemPrompt 段
    var promptPreview = truncate(systemPrompt, SYSTEM_PROMPT_PREVIEW_MAX);
    var promptBlock = u.el('div', { class: 'agent-detail-row agent-detail-row-block' }, [
      u.el('div', { class: 'agent-detail-label' }, [
        tr('agent.field.systemPrompt', 'System Prompt（预览）'),
      ]),
      promptPreview
        ? u.el('pre', { class: 'agent-detail-prompt' }, [promptPreview])
        : u.el('p', { class: 'agent-detail-empty-prompt' }, [
            tr('agent.empty.systemPrompt', '无'),
          ]),
    ]);

    // 「启动对话」按钮（用 components/Button）
    var C = components();
    var launchBtn = null;
    if (C && typeof C.Button === 'function') {
      try {
        var btnInst = C.Button({
          label: tr('agent.launch', '启动对话'),
          variant: 'primary',
          type: 'button',
          icon: 'message-square',
          iconPosition: 'left',
          onClick: function () {
            if (typeof handlers.onLaunch === 'function') {
              try {
                handlers.onLaunch({ agentId: id, agentName: name });
              } catch (_e) {
                /* ignore */
              }
            }
          },
        });
        launchBtn = btnInst && btnInst.el ? btnInst.el : null;
        // 给启动按钮挂 data-agent-launch 便于测试与 e2e 选择器
        if (launchBtn && typeof launchBtn.setAttribute === 'function') {
          try {
            launchBtn.setAttribute('data-agent-launch', id);
          } catch (_e) {
            /* ignore */
          }
        }
      } catch (_e) {
        launchBtn = null;
      }
    }
    if (!launchBtn) {
      // 兜底：纯 <button>，仍可触发 onLaunch
      launchBtn = u.el(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary agent-launch-btn',
          'data-agent-launch': id,
        },
        [tr('agent.launch', '启动对话')],
      );
      if (typeof handlers.onLaunch === 'function') {
        launchBtn.addEventListener('click', function () {
          try {
            handlers.onLaunch({ agentId: id, agentName: name });
          } catch (_e) {
            /* ignore */
          }
        });
      }
    }

    var footer = u.el('div', { class: 'agent-detail-footer' }, [launchBtn]);

    return u.el('div', { class: 'agent-detail', dataset: { agentId: id } }, [
      header,
      idRow,
      sourceRow,
    ].concat(descRows).concat([toolsBlock, promptBlock, footer]));
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:installAgentsView 主体
  // ────────────────────────────────────────────────────────────────────

  /**
   * 渲染 Agents 管理视图到指定容器。
   *
   * 选项 options：
   *   {
   *     container: HTMLElement,           // 必填：渲染目标容器
   *     onLaunch?:  function({agentId,agentName}),  // 启动对话回调（默认派发 CustomEvent）
   *   }
   *
   * @param {{container: HTMLElement, onLaunch?: Function}} options
   * @returns {{ el: HTMLElement, refresh: Function, destroy: Function }}
   */
  function installAgentsView(options) {
    options = options || {};
    var container = options.container;
    if (!container || !container.appendChild) {
      throw new Error('[agentsFeature] options.container 必填且为 HTMLElement');
    }

    var u = utils();
    var C = components();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[agentsFeature] window.MyAgent.utils.el 不可用');
    }
    if (!C || typeof C.Tabs !== 'function') {
      throw new Error('[agentsFeature] window.MyAgent.components.Tabs 不可用');
    }
    if (!C || typeof C.Modal !== 'function') {
      throw new Error('[agentsFeature] window.MyAgent.components.Modal 不可用');
    }

    var lang = getLang();
    var emptyText = EMPTY_TEXT[lang] || EMPTY_TEXT.zh;
    var onLaunch = typeof options.onLaunch === 'function' ? options.onLaunch : null;

    // ── 状态：当前激活 tab、当前选中 agent、abortController ──
    var activeTab = 'agents';
    var selectedAgent = null;
    var loadAbortController = null;

    // ── 容器根
    var root = u.el('div', { class: 'agents-feature', role: 'region', 'aria-label': tr('agent.title', '子 Agent') });

    // ── Agent 列表容器（<ul role="listbox">）
    var agentListEl = u.el('ul', {
      class: 'agent-list',
      role: 'listbox',
      'aria-label': tr('agent.listLabel', 'Agent 列表'),
    });

    // ── 加载中 / 空 / 错误占位
    function buildEmptyState(text) {
      return u.el('li', { class: 'agent-list-empty', role: 'presentation' }, [text || emptyText]);
    }

    function buildErrorState(text) {
      return u.el('li', { class: 'agent-list-error', role: 'presentation' }, [text || tr('error.unknown', '未知错误')]);
    }

    // ── Skills tab 占位内容（WU-05f 留白）
    function buildSkillsPlaceholder() {
      return u.el('div', { class: 'agents-skills-placeholder' }, [
        u.el('p', { class: 'agents-skills-placeholder-text' }, [
          tr('skill.title', '技能') + '：' + tr('skill.empty', '暂无可用技能'),
        ]),
      ]);
    }

    // ── Tab 切换回调
    function handleTabChange(newId /* , oldId */) {
      activeTab = newId;
      if (newId === 'agents') {
        // 切回 agents tab 时若缓存为空则拉一次
        if (getCachedAgents().length === 0 && !loadAbortController) {
          loadAgents();
        }
      }
    }

    // ── 构造 Tabs
    var tabsInst = C.Tabs({
      id: 'agents-skills-tabs',
      items: [
        {
          id: 'agents',
          label: tr('agent.title', '子 Agent'),
          content: agentListEl,
        },
        {
          id: 'skills',
          label: tr('skill.title', '技能'),
          content: buildSkillsPlaceholder(),
        },
      ],
      activeId: 'agents',
      onChange: handleTabChange,
    });

    root.appendChild(tabsInst.el);

    // ── 列表行 click + keyboard（Enter/Space）打开详情
    function attachAgentRowEvents(row, agent) {
      function openDetail() {
        openDetailModal(agent);
      }
      row.addEventListener('click', openDetail);
      row.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openDetail();
        }
      });
    }

    // ── 渲染列表
    function renderAgents(list) {
      // 清空旧内容
      while (agentListEl.firstChild) agentListEl.removeChild(agentListEl.firstChild);

      if (!Array.isArray(list) || list.length === 0) {
        agentListEl.appendChild(buildEmptyState(emptyText));
        return;
      }

      list.forEach(function (agent) {
        if (!agent || !agent.id) return;
        var row = buildAgentRow(agent);
        if (row) {
          attachAgentRowEvents(row, agent);
          agentListEl.appendChild(row);
        }
      });
    }

    function renderLoading() {
      while (agentListEl.firstChild) agentListEl.removeChild(agentListEl.firstChild);
      agentListEl.appendChild(
        u.el('li', { class: 'agent-list-loading', role: 'presentation' }, [
          tr('common.loading', '加载中…'),
        ]),
      );
    }

    function renderError(text) {
      while (agentListEl.firstChild) agentListEl.removeChild(agentListEl.firstChild);
      agentListEl.appendChild(buildErrorState(text));
    }

    // ── 加载列表
    function loadAgents(opts) {
      opts = opts || {};
      var silent = !!opts.silent; // silent=true：后台刷新，不显示 loading，避免闪烁
      if (loadAbortController) {
        try {
          loadAbortController.abort();
        } catch (_e) {
          /* ignore */
        }
      }
      loadAbortController =
        typeof global.AbortController === 'function'
          ? new global.AbortController()
          : null;

      if (!silent) {
        renderLoading();
      }

      var fetchOpts = {};
      if (loadAbortController) fetchOpts.signal = loadAbortController.signal;

      fetchAgentsList(fetchOpts)
        .then(function (list) {
          loadAbortController = null;
          cacheAgents(list);
          renderAgents(list);
        })
        .catch(function (err) {
          loadAbortController = null;
          // AbortError 不显示错误
          if (err && err.code === 'ABORTED') return;
          // silent 失败也不刷错误（保留旧 UI）
          if (silent) {
            showToast(errMessage(err), 'error');
            return;
          }
          renderError(errMessage(err));
          showToast(errMessage(err), 'error');
        });
    }

    // ── 详情 Modal
    var currentModal = null;
    function openDetailModal(agent) {
      selectedAgent = agent || null;

      function doLaunch(payload) {
        // 1) 优先调 options.onLaunch
        if (onLaunch) {
          try {
            onLaunch(payload);
          } catch (_e) {
            /* ignore */
          }
        }
        // 2) 同时派发 CustomEvent（与 F15 app.js 约定），即便 onLaunch 也派发
        //    —— 调用方可以二选一监听；本 WU 默认派发。
        try {
          if (typeof global.CustomEvent === 'function') {
            global.document.dispatchEvent(
              new global.CustomEvent(LAUNCH_EVENT, {
                detail: {
                  agentId: String(payload.agentId || ''),
                  agentName: String(payload.agentName || ''),
                },
                bubbles: true,
                cancelable: false,
              }),
            );
          }
        } catch (_e) {
          /* ignore */
        }
        // 3) 关闭 modal
        if (currentModal) {
          try {
            currentModal.close();
          } catch (_e) {
            /* ignore */
          }
        }
      }

      // 先用 list 项的概要信息渲染 modal（快速），再异步拉详情填充 systemPrompt
      var initialDetail = Object.assign({}, agent, {
        description_zh: agent.description_zh || agent.description || '',
        description_en: agent.description_en || '',
        systemPrompt: agent.systemPrompt || '',
        tools: Array.isArray(agent.tools) ? agent.tools : [],
        source: agent.source || 'builtin',
        scope: agent.scope || 'builtin',
      });

      var detailContent = buildDetailContent(initialDetail, {
        onLaunch: doLaunch,
      });

      if (currentModal) {
        try {
          currentModal.destroy();
        } catch (_e) {
          /* ignore */
        }
        currentModal = null;
      }

      currentModal = C.Modal({
        title: String(agent.name || agent.id || ''),
        content: detailContent,
        closeOnOverlay: true,
        closeOnEsc: true,
        className: 'agent-detail-modal',
        onClose: function () {
          currentModal = null;
          // 取消正在进行的 detail fetch
          if (detailAbortController) {
            try {
              detailAbortController.abort();
            } catch (_e) {
              /* ignore */
            }
            detailAbortController = null;
          }
        },
      });

      currentModal.open();

      // 异步拉完整 detail（含 systemPrompt / 完整 description）
      var detailAbortController =
        typeof global.AbortController === 'function'
          ? new global.AbortController()
          : null;

      fetchAgentDetail(agent.id, detailAbortController ? { signal: detailAbortController.signal } : {})
        .then(function (fullDetail) {
          if (!currentModal) return; // modal 已关
          // 替换 modal 内容
          var newContent = buildDetailContent(fullDetail, {
            onLaunch: doLaunch,
          });
          // 通过 close + 新 modal 重建（避免触碰 modal 内部 API）
          try {
            currentModal.close();
          } catch (_e) {
            /* ignore */
          }
          currentModal = null;
          currentModal = C.Modal({
            title: String((fullDetail && fullDetail.name) || agent.name || agent.id),
            content: newContent,
            closeOnOverlay: true,
            closeOnEsc: true,
            className: 'agent-detail-modal',
            onClose: function () {
              currentModal = null;
              if (detailAbortController) {
                try {
                  detailAbortController.abort();
                } catch (_e) {
                  /* ignore */
                }
                detailAbortController = null;
              }
            },
          });
          currentModal.open();
        })
        .catch(function (err) {
          if (err && err.code === 'ABORTED') return;
          // 概要渲染已足够，detail 失败不强制报错；toast 提示
          showToast(errMessage(err), 'error');
        });
    }

    // ── 初次渲染：先展示缓存 → 异步拉取最新（即便有缓存也后台刷新）
    var cached = getCachedAgents();
    if (cached.length > 0) {
      renderAgents(cached);
      // 后台刷新（silent：不显示 loading，避免闪烁）
      loadAgents({ silent: true });
    } else {
      loadAgents();
    }

    // 挂到容器
    container.appendChild(root);

    function refresh() {
      loadAgents();
    }

    function destroy() {
      // 取消正在进行的请求
      if (loadAbortController) {
        try {
          loadAbortController.abort();
        } catch (_e) {
          /* ignore */
        }
        loadAbortController = null;
      }
      // 关闭 modal
      if (currentModal) {
        try {
          currentModal.destroy();
        } catch (_e) {
          /* ignore */
        }
        currentModal = null;
      }
      // 销毁 tabs
      try {
        tabsInst.destroy();
      } catch (_e) {
        /* ignore */
      }
      // 摘除根
      if (root.parentNode) root.parentNode.removeChild(root);
      selectedAgent = null;
    }

    // 暴露 uninstall 别名（与 spec § 5.4 一致；spec 4.4.6 的 feature 接口约定）
    function uninstall() {
      destroy();
    }

    // uninstall === destroy 引用相等，便于测试与「同名函数可互换」的约定
    return {
      el: root,
      refresh: refresh,
      destroy: destroy,
      uninstall: destroy,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // 导出
  // ────────────────────────────────────────────────────────────────────

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.agentsFeature = {
    installAgentsView: installAgentsView,
    // 暴露纯函数 / 常量给测试与调试
    LAUNCH_EVENT: LAUNCH_EVENT,
    SCOPE_LABELS: SCOPE_LABELS,
    SOURCE_LABELS: SOURCE_LABELS,
    EMPTY_TEXT: EMPTY_TEXT,
    SYSTEM_PROMPT_PREVIEW_MAX: SYSTEM_PROMPT_PREVIEW_MAX,
    // 内部 helper（测试可单测）
    _buildAgentRow: buildAgentRow,
    _buildDetailContent: buildDetailContent,
    _buildScopeBadge: buildScopeBadge,
    _truncate: truncate,
    _pickLabel: pickLabel,
    _cacheAgents: cacheAgents,
    _getCachedAgents: getCachedAgents,
    _fetchAgentsList: fetchAgentsList,
    _fetchAgentDetail: fetchAgentDetail,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
