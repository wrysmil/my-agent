/**
 * features/skills.js — Skill 管理视图（F13 / WU-05f）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.5
 *           + § 4.4.6 (IIFE 模式) + § 4.3 (零运行时依赖)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-05f
 * 契约:     contract § 1 路由总览（Skill 域 2 条）
 *
 * 职责（spec § 5.5 Skill UI）:
 *   - 渲染 builtin / user / marketplace skills 列表（**独立 panel**，不依赖 agents tab）
 *   - 每项展示 name + description + scope 角标
 *   - 点击 skill → modal 显示详情（id / scope / source / body 预览 ≤ 600 字 / 「使用」按钮）
 *   - 「使用」按钮 → 派发 CustomEvent('my-agent:skill-use', { detail: { skillId, skillName } })
 *     由 F15 app.js 接管（切到 chat panel + 注入 skill 正文）
 *   - 状态缓存 agentState.skills（state/state.js WU-04b 内建 store，与 F12 agents.js 共享）
 *   - 错误处理：Toast（toast 组件 WU-04c）
 *   - a11y：<ul role="listbox"> + <li role="option">
 *
 * API 契约（与 src/web/server/routes/skills.ts 对齐）:
 *   GET /api/skills
 *     → 200 { ok:true, data:{ skills: SkillListItem[] } }
 *       SkillListItem: { id, name, description, source, scope }
 *   GET /api/skills/:id
 *     → 200 { ok:true, data:{ skill: SkillDetail } }
 *       SkillDetail = SkillListItem + { description_zh, description_en, body }
 *     → 404 { ok:false, error:{ code:'SKILL_NOT_FOUND', message } }
 *
 * 与其他模块的协作:
 *   - 依赖 utils.js / api.js / i18n.js（shared，WU-04a）
 *   - 依赖 state/state.js（agentState 内置 store；WU-04b）
 *   - 依赖 components/{modal,button,toast}.js（WU-04c）
 *   - 不依赖 agents.js / chat.js / menu.js / providers.js（其他 WU）
 *
 * 加载方式: <script defer> + IIFE（与 spec § 4.4.6 一致）。
 * 测试:    test/web/features-skills.test.ts（≥ 10 用例）
 */

(function (global) {
  'use strict';

  // ────────────────────────────────────────────────────────────────────
  // 常量
  // ────────────────────────────────────────────────────────────────────

  /** 「使用」按钮派发的 CustomEvent 名（spec § 5.5 + F15 app.js 约定） */
  var USE_EVENT = 'my-agent:skill-use';

  /** 详情 modal 最大 body 预览字符数（Done criteria #2：≤ 600 字） */
  var BODY_PREVIEW_MAX = 600;

  /** 列表空文案（i18n 优先；缺则 fallback 中文字面量） */
  var EMPTY_TEXT = {
    zh: '暂无可用技能',
    en: 'No skills available',
  };

  /** scope → 文案映射（skills 路由 scope === source，取值 builtin/user/marketplace） */
  var SCOPE_LABELS = {
    builtin: { zh: '内置', en: 'Built-in' },
    user: { zh: '用户', en: 'User' },
    marketplace: { zh: '市场', en: 'Marketplace' },
  };

  /** source → 文案映射 */
  var SOURCE_LABELS = {
    builtin: { zh: '内置', en: 'Built-in' },
    user: { zh: '用户自定义', en: 'User-defined' },
    marketplace: { zh: '技能市场', en: 'Marketplace' },
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
   * 截断 body 预览（按 char 截断，保留末尾省略号）。
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
   * GET /api/skills → 列表。
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<Array<any>>}
   */
  function fetchSkillsList(opts) {
    var a = api();
    if (!a || typeof a.apiFetch !== 'function') {
      return Promise.reject(new Error('window.MyAgent.api.apiFetch 不可用'));
    }
    var init = {};
    if (opts && opts.signal) init.signal = opts.signal;
    return a.apiFetch('/api/skills', init).then(function (data) {
      // 兼容后端两种返回：{ skills: [...] } 或 直接 [...]
      if (data && Array.isArray(data.skills)) return data.skills;
      if (Array.isArray(data)) return data;
      return [];
    });
  }

  /**
   * GET /api/skills/:id → 详情。
   * @param {string} id
   * @param {{ signal?: AbortSignal }} [opts]
   * @returns {Promise<any>}
   */
  function fetchSkillDetail(id, opts) {
    var a = api();
    if (!a || typeof a.apiFetch !== 'function') {
      return Promise.reject(new Error('window.MyAgent.api.apiFetch 不可用'));
    }
    var init = {};
    if (opts && opts.signal) init.signal = opts.signal;
    var safeId = encodeURIComponent(String(id || ''));
    return a.apiFetch('/api/skills/' + safeId, init).then(function (data) {
      // 兼容 { skill: {...} } 或 直接 {...}
      if (data && typeof data === 'object' && data.skill) return data.skill;
      return data;
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:缓存写回 agentState.skills（WU-04b 内建 store，与 agents.js 共享）
  // ────────────────────────────────────────────────────────────────────

  function cacheSkills(list) {
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
      var next = Object.assign({}, prev, { skills: Array.isArray(list) ? list : [] });
      store.set(next);
    } catch (_e) {
      // schema 校验失败等情况 → 静默（不影响 UI 渲染）
    }
  }

  function getCachedSkills() {
    var s = stateStore();
    if (!s || typeof s.getStore !== 'function') return [];
    var store = s.getStore('agentState');
    if (!store) return [];
    var v = store.get();
    if (v && Array.isArray(v.skills)) return v.skills.slice();
    return [];
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:render helpers（构造 list 项 / detail 内容）
  // ────────────────────────────────────────────────────────────────────

  /**
   * 渲染 scope 角标（builtin / user / marketplace）。文本由 utils.el 走
   * textContent 防 XSS。
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
        : scope === 'marketplace'
        ? 'warning'
        : 'primary';
    return u.el(
      'span',
      {
        class: 'badge-scope badge badge-' + variant,
        'data-scope': String(scope || ''),
        'aria-label': label,
      },
      [label],
    );
  }

  /**
   * 渲染单条 skill 列表项（<li role="option">）。
   * @param {object} skill
   * @returns {HTMLElement|null}
   */
  function buildSkillRow(skill) {
    var u = utils();
    if (!u || typeof u.el !== 'function') return null;
    var id = String((skill && skill.id) || '');
    var name = String((skill && skill.name) || id);
    var description =
      (skill && (skill.description_zh || skill.description)) ||
      (skill && skill.description_en) ||
      '';
    var scope = String((skill && skill.scope) || 'builtin');

    var scopeBadge = buildScopeBadge(scope);

    var nameNode = u.el('div', { class: 'skill-row-name' }, [name]);
    var descNode = u.el('div', { class: 'skill-row-desc' }, [String(description)]);
    var metaNode = u.el('div', { class: 'skill-row-meta' }, [
      u.el('span', { class: 'skill-row-id' }, [id]),
    ]);

    var headNode = u.el('div', { class: 'skill-row-head' }, [nameNode, scopeBadge]);

    return u.el(
      'li',
      {
        class: 'skill-row',
        role: 'option',
        'aria-selected': 'false',
        tabindex: '0',
        'data-skill-id': id,
        dataset: { skillId: id, scope: scope },
      },
      [headNode, descNode, metaNode],
    );
  }

  /**
   * 渲染 detail modal 内容（id / scope / source / description / body 预览 +
   * 「使用」按钮）。
   * @param {object} detail SkillDetail
   * @param {{ onUse?: Function }} [handlers]
   * @returns {HTMLElement|null}
   */
  function buildDetailContent(detail, handlers) {
    var u = utils();
    if (!u || typeof u.el !== 'function') return null;
    handlers = handlers || {};

    var id = String((detail && detail.id) || '');
    var name = String((detail && detail.name) || id);
    var descriptionZh = String((detail && detail.description_zh) || '');
    var descriptionEn = String((detail && detail.description_en) || '');
    var body = String((detail && detail.body) || '');
    var scope = String((detail && detail.scope) || 'builtin');
    var source = String((detail && detail.source) || 'builtin');

    // 顶部：name + scope badge
    var header = u.el('div', { class: 'skill-detail-header' }, [
      u.el('h3', { class: 'skill-detail-name' }, [name]),
      buildScopeBadge(scope),
    ]);

    // id 段
    var idRow = u.el('div', { class: 'skill-detail-row' }, [
      u.el('span', { class: 'skill-detail-label' }, [tr('skill.field.id', 'ID')]),
      u.el('code', { class: 'skill-detail-value' }, [id]),
    ]);

    // scope 段
    var scopeRow = u.el('div', { class: 'skill-detail-row' }, [
      u.el('span', { class: 'skill-detail-label' }, [tr('skill.field.scope', '范围')]),
      u.el('span', { class: 'skill-detail-value' }, [pickLabel(SCOPE_LABELS, scope)]),
    ]);

    // source 段
    var sourceRow = u.el('div', { class: 'skill-detail-row' }, [
      u.el('span', { class: 'skill-detail-label' }, [tr('skill.field.source', '来源')]),
      u.el('span', { class: 'skill-detail-value' }, [pickLabel(SOURCE_LABELS, source)]),
    ]);

    // description 段
    var descRows = [];
    if (descriptionZh) {
      descRows.push(
        u.el('div', { class: 'skill-detail-row skill-detail-row-block' }, [
          u.el('div', { class: 'skill-detail-label' }, [
            tr('skill.field.descriptionZh', '中文说明'),
          ]),
          u.el('p', { class: 'skill-detail-description' }, [descriptionZh]),
        ]),
      );
    }
    if (descriptionEn) {
      descRows.push(
        u.el('div', { class: 'skill-detail-row skill-detail-row-block' }, [
          u.el('div', { class: 'skill-detail-label' }, [
            tr('skill.field.descriptionEn', 'English Description'),
          ]),
          u.el('p', { class: 'skill-detail-description' }, [descriptionEn]),
        ]),
      );
    }

    // body 预览段（≤ BODY_PREVIEW_MAX 字）
    var bodyPreview = truncate(body, BODY_PREVIEW_MAX);
    var bodyBlock = u.el('div', { class: 'skill-detail-row skill-detail-row-block' }, [
      u.el('div', { class: 'skill-detail-label' }, [
        tr('skill.field.body', 'SKILL.md（预览）'),
      ]),
      bodyPreview
        ? u.el('pre', { class: 'skill-detail-body' }, [bodyPreview])
        : u.el('p', { class: 'skill-detail-empty-body' }, [tr('skill.empty.body', '无')]),
    ]);

    // 「使用」按钮（用 components/Button）
    var C = components();
    var useBtn = null;
    if (C && typeof C.Button === 'function') {
      try {
        var btnInst = C.Button({
          label: tr('skill.use', '使用'),
          variant: 'primary',
          type: 'button',
          icon: 'zap',
          iconPosition: 'left',
          onClick: function () {
            if (typeof handlers.onUse === 'function') {
              try {
                handlers.onUse({ skillId: id, skillName: name });
              } catch (_e) {
                /* ignore */
              }
            }
          },
        });
        useBtn = btnInst && btnInst.el ? btnInst.el : null;
        // 挂 data-skill-use 便于测试与 e2e 选择器
        if (useBtn && typeof useBtn.setAttribute === 'function') {
          try {
            useBtn.setAttribute('data-skill-use', id);
          } catch (_e) {
            /* ignore */
          }
        }
      } catch (_e) {
        useBtn = null;
      }
    }
    if (!useBtn) {
      // 兜底：纯 <button>，仍可触发 onUse
      useBtn = u.el(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary skill-use-btn',
          'data-skill-use': id,
        },
        [tr('skill.use', '使用')],
      );
      if (typeof handlers.onUse === 'function') {
        useBtn.addEventListener('click', function () {
          try {
            handlers.onUse({ skillId: id, skillName: name });
          } catch (_e) {
            /* ignore */
          }
        });
      }
    }

    var footer = u.el('div', { class: 'skill-detail-footer' }, [useBtn]);

    return u.el(
      'div',
      { class: 'skill-detail', dataset: { skillId: id } },
      [header, idRow, scopeRow, sourceRow]
        .concat(descRows)
        .concat([bodyBlock, footer]),
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // 内部:installSkillsView 主体
  // ────────────────────────────────────────────────────────────────────

  /** 最近一次 installSkillsView 的实例（供模块级 uninstall() 用） */
  var activeInstance = null;

  /**
   * 渲染 Skills 管理视图到指定容器（独立 panel，spec § 5.5）。
   *
   * 选项 options：
   *   {
   *     container: HTMLElement,                  // 必填：渲染目标容器
   *     onUse?:    function({skillId,skillName}), // 「使用」回调（同时派发 CustomEvent）
   *   }
   *
   * @param {{container: HTMLElement, onUse?: Function}} options
   * @returns {{ el: HTMLElement, refresh: Function, destroy: Function, uninstall: Function }}
   */
  function installSkillsView(options) {
    options = options || {};
    var container = options.container;
    if (!container || !container.appendChild) {
      throw new Error('[skillsFeature] options.container 必填且为 HTMLElement');
    }

    var u = utils();
    var C = components();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[skillsFeature] window.MyAgent.utils.el 不可用');
    }
    if (!C || typeof C.Modal !== 'function') {
      throw new Error('[skillsFeature] window.MyAgent.components.Modal 不可用');
    }

    var lang = getLang();
    var emptyText = EMPTY_TEXT[lang] || EMPTY_TEXT.zh;
    var onUse = typeof options.onUse === 'function' ? options.onUse : null;

    // ── 状态：当前选中 skill、abortController ──
    var selectedSkill = null;
    var loadAbortController = null;

    // ── 容器根（独立 region，不套 Tabs）
    var root = u.el('div', {
      class: 'skills-feature',
      role: 'region',
      'aria-label': tr('skill.title', '技能'),
    });

    var heading = u.el('h2', { class: 'skills-heading' }, [tr('skill.title', '技能')]);
    root.appendChild(heading);

    // ── Skill 列表容器（<ul role="listbox">）
    var skillListEl = u.el('ul', {
      class: 'skill-list',
      role: 'listbox',
      'aria-label': tr('skill.listLabel', '技能列表'),
    });
    root.appendChild(skillListEl);

    // ── 加载中 / 空 / 错误占位
    function clearList() {
      while (skillListEl.firstChild) skillListEl.removeChild(skillListEl.firstChild);
    }

    function renderLoading() {
      clearList();
      skillListEl.appendChild(
        u.el('li', { class: 'skill-list-loading', role: 'presentation' }, [
          tr('common.loading', '加载中…'),
        ]),
      );
    }

    function renderError(text) {
      clearList();
      skillListEl.appendChild(
        u.el('li', { class: 'skill-list-error', role: 'presentation' }, [
          text || tr('error.unknown', '未知错误'),
        ]),
      );
    }

    // ── 列表行 click + keyboard（Enter/Space）打开详情
    function attachSkillRowEvents(row, skill) {
      function openDetail() {
        openDetailModal(skill);
      }
      row.addEventListener('click', openDetail);
      row.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          if (typeof ev.preventDefault === 'function') ev.preventDefault();
          openDetail();
        }
      });
    }

    // ── 渲染列表
    function renderSkills(list) {
      clearList();

      if (!Array.isArray(list) || list.length === 0) {
        skillListEl.appendChild(
          u.el('li', { class: 'skill-list-empty', role: 'presentation' }, [emptyText]),
        );
        return;
      }

      list.forEach(function (skill) {
        if (!skill || !skill.id) return;
        var row = buildSkillRow(skill);
        if (row) {
          attachSkillRowEvents(row, skill);
          skillListEl.appendChild(row);
        }
      });
    }

    // ── 加载列表
    function loadSkills(opts) {
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
        typeof global.AbortController === 'function' ? new global.AbortController() : null;

      if (!silent) {
        renderLoading();
      }

      var fetchOpts = {};
      if (loadAbortController) fetchOpts.signal = loadAbortController.signal;

      fetchSkillsList(fetchOpts)
        .then(function (list) {
          loadAbortController = null;
          cacheSkills(list);
          renderSkills(list);
        })
        .catch(function (err) {
          loadAbortController = null;
          // AbortError 不显示错误
          if (err && err.code === 'ABORTED') return;
          // silent 失败不刷错误占位（保留旧 UI），仅 toast
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
    var detailAbortController = null;

    function abortDetail() {
      if (detailAbortController) {
        try {
          detailAbortController.abort();
        } catch (_e) {
          /* ignore */
        }
        detailAbortController = null;
      }
    }

    /** 「使用」：调 onUse + 派发 CustomEvent + 关 modal */
    function doUse(payload) {
      // 1) 优先调 options.onUse
      if (onUse) {
        try {
          onUse(payload);
        } catch (_e) {
          /* ignore */
        }
      }
      // 2) 同时派发 CustomEvent（与 F15 app.js 约定）—— 调用方可二选一监听
      try {
        if (typeof global.CustomEvent === 'function' && global.document) {
          global.document.dispatchEvent(
            new global.CustomEvent(USE_EVENT, {
              detail: {
                skillId: String(payload.skillId || ''),
                skillName: String(payload.skillName || ''),
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

    function makeModal(detail, fallbackTitle) {
      return C.Modal({
        title: String((detail && detail.name) || fallbackTitle || ''),
        content: buildDetailContent(detail, { onUse: doUse }),
        closeOnOverlay: true,
        closeOnEsc: true,
        className: 'skill-detail-modal',
        onClose: function () {
          currentModal = null;
          abortDetail();
        },
      });
    }

    function openDetailModal(skill) {
      selectedSkill = skill || null;

      // 先用 list 项的概要信息渲染 modal（快速），再异步拉详情填充 body
      var initialDetail = Object.assign({}, skill, {
        description_zh: skill.description_zh || skill.description || '',
        description_en: skill.description_en || '',
        body: skill.body || '',
        source: skill.source || 'builtin',
        scope: skill.scope || 'builtin',
      });

      if (currentModal) {
        try {
          currentModal.destroy();
        } catch (_e) {
          /* ignore */
        }
        currentModal = null;
      }

      currentModal = makeModal(initialDetail, skill.id);
      currentModal.open();

      // 异步拉完整 detail（含 body / 完整 description）
      detailAbortController =
        typeof global.AbortController === 'function' ? new global.AbortController() : null;

      fetchSkillDetail(
        skill.id,
        detailAbortController ? { signal: detailAbortController.signal } : {},
      )
        .then(function (fullDetail) {
          if (!currentModal) return; // modal 已关
          // 通过 close + 新 modal 重建（避免触碰 modal 内部 API）
          try {
            currentModal.close();
          } catch (_e) {
            /* ignore */
          }
          currentModal = null;
          currentModal = makeModal(fullDetail, skill.name || skill.id);
          currentModal.open();
        })
        .catch(function (err) {
          if (err && err.code === 'ABORTED') return;
          // 概要渲染已足够，detail 失败不强制报错；toast 提示
          showToast(errMessage(err), 'error');
        });
    }

    // ── 初次渲染：先展示缓存 → 异步拉取最新（即便有缓存也后台刷新）
    var cached = getCachedSkills();
    if (cached.length > 0) {
      renderSkills(cached);
      loadSkills({ silent: true });
    } else {
      loadSkills();
    }

    // 挂到容器
    container.appendChild(root);

    function refresh() {
      loadSkills();
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
      abortDetail();
      // 关闭 modal
      if (currentModal) {
        try {
          currentModal.destroy();
        } catch (_e) {
          /* ignore */
        }
        currentModal = null;
      }
      // 摘除根
      if (root.parentNode) root.parentNode.removeChild(root);
      selectedSkill = null;
      if (activeInstance === instance) activeInstance = null;
    }

    var instance = {
      el: root,
      refresh: refresh,
      destroy: destroy,
      uninstall: destroy,
    };
    activeInstance = instance;
    return instance;
  }

  /**
   * 模块级 uninstall()：销毁最近一次 installSkillsView 创建的视图。
   * 无活动实例时为 no-op（幂等）。
   */
  function uninstall() {
    if (!activeInstance) return;
    var inst = activeInstance;
    activeInstance = null;
    try {
      inst.destroy();
    } catch (_e) {
      /* ignore */
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 导出
  // ────────────────────────────────────────────────────────────────────

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.skillsFeature = {
    installSkillsView: installSkillsView,
    uninstall: uninstall,
    // 暴露常量给测试与调试
    USE_EVENT: USE_EVENT,
    SCOPE_LABELS: SCOPE_LABELS,
    SOURCE_LABELS: SOURCE_LABELS,
    EMPTY_TEXT: EMPTY_TEXT,
    BODY_PREVIEW_MAX: BODY_PREVIEW_MAX,
    // 内部 helper（测试可单测）
    _buildSkillRow: buildSkillRow,
    _buildDetailContent: buildDetailContent,
    _buildScopeBadge: buildScopeBadge,
    _truncate: truncate,
    _pickLabel: pickLabel,
    _cacheSkills: cacheSkills,
    _getCachedSkills: getCachedSkills,
    _fetchSkillsList: fetchSkillsList,
    _fetchSkillDetail: fetchSkillDetail,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
