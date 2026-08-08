/**
 * features/settings.js — 设置面板 (F14 / WU-05g)
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.6 + § 4.4.6
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-05g
 *
 * 本文件职责:
 *   - 渲染设置面板(垂直列表 form):
 *       1) 主题      — 3 选 1 radio(dark / light / system)+ 实时切换 + localStorage['my-agent.theme']
 *       2) 语言      — 2 选 1 radio(zh / en)         + localStorage['my-agent.lang']
 *       3) 默认模型  — select 下拉,列 active provider 的模型(含「使用 Provider 默认」)
 *       4) 清空数据  — 危险按钮 + confirm modal → localStorage.clear() + location.reload()
 *   - 状态:settingsState(store)+ providerState.activeProviderId
 *   - 主题切换:调 MyAgent.theme.setTheme(theme)(若存在) + 写 localStorage +
 *               派发 CustomEvent('my-agent:theme-change',{detail:{theme}})
 *               (冒号名,与 F18 features/theme.js 对齐 — F0 shared/theme.js 仍用破折号名,
 *                GROUP-7 closeout 统一)
 *   - 语言切换:调 MyAgent.i18n.setLang(lang) + 写 localStorage +
 *               派发 CustomEvent('my-agent:lang-change',{detail:{lang}})
 *   - 持久化:settingsState 自动 persist('my-agent.settings' 键)
 *
 * 与其他模块的协作:
 *   - utils.js 提供 el()/escapeHtml/on()
 *   - shared/i18n.js 提供 setLang() / getLang() / t()
 *   - shared/theme.js 后续挂载 MyAgent.theme = {setTheme, getTheme, getSystemTheme}(F15 落地)
 *   - state/state.js 提供 settingsState / providerState
 *   - components/modal.js 提供确认弹窗(若可用)
 *
 * 不实现:
 *   - 其他设置面板(provider / agent / skill)— 留 WU-05a~f
 *   - 远程同步 / 备份导出 — 不在 spec § 5.6 范围
 *
 * 加载方式:<script defer>+ IIFE,与 spec § 4.4.6 一致。
 * 测试:test/web/features-settings.test.ts(≥ 10 用例,node:vm 加载 + mock utils/i18n/theme/state/modal)
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  var THEME_STORAGE_KEY = 'my-agent.theme';
  var LANG_STORAGE_KEY = 'my-agent.lang';
  var THEME_CHANGE_EVENT = 'my-agent:theme-change'; // 与 F18 features/theme.js 对齐(冒号)
  var LANG_CHANGE_EVENT = 'my-agent:lang-change';

  var VALID_THEMES = ['dark', 'light', 'system'];
  var VALID_LANGS = ['zh', 'en'];
  var DEFAULT_THEME = 'system';
  var DEFAULT_LANG = 'zh';

  var PLACEHOLDER_MODEL_VALUE = '__default__'; // sentinel: 使用 Provider 默认

  // ------------------------------------------------------------------
  // 模块级状态:同一时刻只能有一个 install(面板是单例)
  // ------------------------------------------------------------------

  /** @type {null | { root: HTMLElement, offs: Array<() => void> }} */
  var currentInstall = null;

  // ------------------------------------------------------------------
  // 内部 helper
  // ------------------------------------------------------------------

  function utils() { return global.MyAgent && global.MyAgent.utils; }
  function i18n() { return global.MyAgent && global.MyAgent.i18n; }
  function themeApi() { return global.MyAgent && global.MyAgent.theme; }
  function state() { return global.MyAgent && global.MyAgent.state; }
  function components() { return global.MyAgent && global.MyAgent.components; }

  function normalizeTheme(v) {
    return VALID_THEMES.indexOf(v) >= 0 ? v : null;
  }
  function normalizeLang(v) {
    return VALID_LANGS.indexOf(v) >= 0 ? v : null;
  }

  function safeStorageGet(key) {
    try { return global.localStorage.getItem(key); } catch (_e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { global.localStorage.setItem(key, value); return true; } catch (_e) { return false; }
  }

  function dispatchDoc(eventName, detail) {
    try {
      if (typeof global.CustomEvent !== 'function' || !global.document) return;
      var evt = new global.CustomEvent(eventName, { detail: detail, bubbles: true, cancelable: false });
      global.document.dispatchEvent(evt);
    } catch (_e) {
      /* ignore */
    }
  }

  function capitalize(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ------------------------------------------------------------------
  // 读取当前值(从 settingsState 优先,localStorage 兜底)
  // ------------------------------------------------------------------

  function readCurrentTheme() {
    var s = state();
    if (s && s.settingsState) {
      var stored = s.settingsState.get();
      if (stored && normalizeTheme(stored.theme)) return stored.theme;
    }
    var fromLs = normalizeTheme(safeStorageGet(THEME_STORAGE_KEY));
    if (fromLs) return fromLs;
    return DEFAULT_THEME;
  }

  function readCurrentLang() {
    var i = i18n();
    if (i && typeof i.getLang === 'function') {
      var cur = i.getLang();
      if (normalizeLang(cur)) return cur;
    }
    var s = state();
    if (s && s.settingsState) {
      var stored = s.settingsState.get();
      if (stored && normalizeLang(stored.lang)) return stored.lang;
    }
    var fromLs = normalizeLang(safeStorageGet(LANG_STORAGE_KEY));
    if (fromLs) return fromLs;
    return DEFAULT_LANG;
  }

  function readCurrentModel() {
    var s = state();
    if (s && s.settingsState) {
      var stored = s.settingsState.get();
      if (stored && typeof stored.model === 'string' && stored.model) return stored.model;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 取 active provider 的模型列表(给 select 填充)
  // ------------------------------------------------------------------

  /**
   * 返回 active provider 的模型数组(字符串数组);
   * 无 active provider / 无 models / 无 defaultModel → 返回 []。
   * @returns {string[]}
   */
  function getActiveProviderModels() {
    var s = state();
    if (!s || !s.providerState) return [];
    var prov = s.providerState.get();
    if (!prov || !prov.activeProviderId) return [];
    var providers = Array.isArray(prov.providers) ? prov.providers : [];
    var active = null;
    for (var i = 0; i < providers.length; i++) {
      if (providers[i] && providers[i].id === prov.activeProviderId) {
        active = providers[i];
        break;
      }
    }
    if (!active) return [];
    if (Array.isArray(active.models) && active.models.length > 0) {
      return active.models.slice();
    }
    if (typeof active.defaultModel === 'string' && active.defaultModel) {
      return [active.defaultModel];
    }
    return [];
  }

  // ------------------------------------------------------------------
  // 应用主题/语言:setTheme + persist + dispatch event + 更新 settingsState
  // ------------------------------------------------------------------

  /**
   * 应用主题到全局 + 持久化 + 派发事件 + 更新 settingsState。
   * @param {string} themeValue
   */
  function applyTheme(themeValue) {
    var normalized = normalizeTheme(themeValue);
    if (!normalized) return;

    // 1) 调 MyAgent.theme.setTheme(theme)(若存在;F0 / F15 之后挂载)
    var api = themeApi();
    if (api && typeof api.setTheme === 'function') {
      try { api.setTheme(normalized); } catch (_e) { /* ignore */ }
    }

    // 2) 写 localStorage
    safeStorageSet(THEME_STORAGE_KEY, normalized);

    // 3) 派发 CustomEvent('my-agent:theme-change')
    dispatchDoc(THEME_CHANGE_EVENT, { theme: normalized });

    // 4) 更新 settingsState(store 自动 persist 到 'my-agent.settings')
    var s = state();
    if (s && s.settingsState) {
      try {
        s.settingsState.update(function (old) {
          return Object.assign({}, old, { theme: normalized });
        });
      } catch (_e) { /* ignore */ }
    }
  }

  /**
   * 应用语言到全局 + 持久化 + 派发事件 + 更新 settingsState。
   * @param {string} langValue
   */
  function applyLang(langValue) {
    var normalized = normalizeLang(langValue);
    if (!normalized) return;

    // 1) 调 MyAgent.i18n.setLang(lang)
    var i = i18n();
    if (i && typeof i.setLang === 'function') {
      try { i.setLang(normalized); } catch (_e) { /* ignore */ }
    }

    // 2) 写 localStorage
    safeStorageSet(LANG_STORAGE_KEY, normalized);

    // 3) 派发 CustomEvent('my-agent:lang-change')
    dispatchDoc(LANG_CHANGE_EVENT, { lang: normalized });

    // 4) 更新 settingsState
    var s = state();
    if (s && s.settingsState) {
      try {
        s.settingsState.update(function (old) {
          return Object.assign({}, old, { lang: normalized });
        });
      } catch (_e) { /* ignore */ }
    }
  }

  /**
   * 应用默认模型:更新 settingsState(不写独立 localStorage)。
   * @param {string|null} modelValue
   */
  function applyModel(modelValue) {
    var s = state();
    if (!s || !s.settingsState) return;
    var normalized = (typeof modelValue === 'string' && modelValue && modelValue !== PLACEHOLDER_MODEL_VALUE)
      ? modelValue
      : null;
    try {
      s.settingsState.update(function (old) {
        return Object.assign({}, old, { model: normalized });
      });
    } catch (_e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // 构建 UI(3 个 fieldset + 危险按钮)
  // ------------------------------------------------------------------

  /**
   * 构建主题 fieldset。
   * @returns {{ fieldset: HTMLElement, radios: HTMLInputElement[] }}
   */
  function buildThemeFieldset(u, t) {
    var current = readCurrentTheme();
    var radios = [];
    var rows = [];

    VALID_THEMES.forEach(function (themeVal) {
      var id = 'settings-theme-' + themeVal;
      var radioAttrs = {
        type: 'radio',
        id: id,
        name: 'settings-theme',
        value: themeVal,
        class: 'settings-radio-input',
      };
      var radio = u.el('input', radioAttrs);
      if (themeVal === current) radio.checked = true;

      var label = u.el(
        'label',
        { for: id, class: 'settings-radio-label' },
        [t('settings.theme' + capitalize(themeVal))],
      );

      radios.push(radio);
      rows.push(u.el('div', { class: 'settings-radio-row' }, [radio, label]));
    });

    var legend = u.el('legend', { class: 'settings-legend' }, [t('settings.theme')]);
    var fs = u.el(
      'fieldset',
      { class: 'settings-fieldset', id: 'settings-fieldset-theme' },
      [legend].concat(rows),
    );
    return { fieldset: fs, radios: radios };
  }

  /**
   * 构建语言 fieldset。
   * @returns {{ fieldset: HTMLElement, radios: HTMLInputElement[] }}
   */
  function buildLangFieldset(u, t) {
    var current = readCurrentLang();
    var radios = [];
    var rows = [];

    VALID_LANGS.forEach(function (langVal) {
      var id = 'settings-lang-' + langVal;
      var radio = u.el('input', {
        type: 'radio',
        id: id,
        name: 'settings-lang',
        value: langVal,
        class: 'settings-radio-input',
      });
      if (langVal === current) radio.checked = true;

      var label = u.el(
        'label',
        { for: id, class: 'settings-radio-label' },
        [t('settings.language' + capitalize(langVal))],
      );

      radios.push(radio);
      rows.push(u.el('div', { class: 'settings-radio-row' }, [radio, label]));
    });

    var legend = u.el('legend', { class: 'settings-legend' }, [t('settings.language')]);
    var fs = u.el(
      'fieldset',
      { class: 'settings-fieldset', id: 'settings-fieldset-lang' },
      [legend].concat(rows),
    );
    return { fieldset: fs, radios: radios };
  }

  /**
   * 构建默认模型 fieldset(select)。
   * @returns {{ fieldset: HTMLElement, select: HTMLSelectElement }}
   */
  function buildModelFieldset(u, t) {
    var models = getActiveProviderModels();
    var currentModel = readCurrentModel();

    var selectAttrs = {
      id: 'settings-model-select',
      name: 'settings-model',
      class: 'settings-select',
    };
    var select = u.el('select', selectAttrs);

    // placeholder:使用 Provider 默认
    var placeholder = u.el(
      'option',
      { value: PLACEHOLDER_MODEL_VALUE },
      [t('settings.modelDefault') || '使用 Provider 默认'],
    );
    select.appendChild(placeholder);

    models.forEach(function (m) {
      var optAttrs = { value: m };
      var opt = u.el('option', optAttrs, [m]);
      if (m === currentModel) optAttrs.selected = true;
      select.appendChild(opt);
    });

    // currentModel 不在 models 时(可能 provider 被改 / 已删)→ 仍回显一个等价的 option
    if (currentModel && models.indexOf(currentModel) < 0) {
      var curOpt = u.el('option', { value: currentModel, selected: true }, [currentModel + ' (旧)']);
      select.appendChild(curOpt);
    }

    // 初始 selected(若 currentModel 为 null → placeholder selected)
    if (!currentModel) {
      placeholder.setAttribute('selected', 'selected');
    }

    var legend = u.el('legend', { class: 'settings-legend' }, [t('settings.model') || '默认模型']);
    var fs = u.el(
      'fieldset',
      { class: 'settings-fieldset', id: 'settings-fieldset-model' },
      [legend, select],
    );
    return { fieldset: fs, select: select };
  }

  /**
   * 构建「清空数据」危险按钮 + 确认 modal 触发。
   * @returns {{ wrapper: HTMLElement, button: HTMLElement, openConfirm: () => void }}
   */
  function buildClearDataSection(u, t) {
    var section = u.el(
      'fieldset',
      { class: 'settings-fieldset settings-fieldset-danger', id: 'settings-fieldset-danger' },
      [
        u.el('legend', { class: 'settings-legend' }, [t('settings.dangerZone') || '危险操作']),
        u.el(
          'p',
          { class: 'settings-danger-hint' },
          [t('settings.clearDataHint') || '清空所有本地数据(包括主题 / 语言 / 模型选择)。此操作不可撤销。'],
        ),
      ],
    );

    var button = u.el(
      'button',
      {
        type: 'button',
        class: 'settings-btn-danger',
        id: 'settings-btn-clear-data',
        'aria-label': t('settings.clearData') || '清空数据',
      },
      [t('settings.clearData') || '清空数据'],
    );
    section.appendChild(button);

    function openConfirm() {
      // 优先使用 components.Modal(若已挂载);否则用原生 confirm()
      var c = components();
      var Modal = c && c.Modal;
      if (typeof Modal === 'function') {
        var modal = Modal({
          title: t('settings.clearDataConfirmTitle') || '确认清空数据?',
          content: t('settings.clearDataConfirmBody') || '此操作将清空所有本地数据并刷新页面。是否继续?',
          footer: null,
          onClose: function () {},
        });
        // 手动加确认/取消 footer
        var footerWrap = u.el('div', { class: 'modal-footer-actions' }, [
          u.el(
            'button',
            {
              type: 'button',
              class: 'btn btn-secondary',
              'data-modal-cancel': 'true',
              onclick: function () { modal.close(); },
            },
            [t('common.cancel') || '取消'],
          ),
          u.el(
            'button',
            {
              type: 'button',
              class: 'btn btn-danger',
              'data-modal-confirm': 'true',
              onclick: function () {
                modal.close();
                performClearData();
              },
            },
            [t('common.confirm') || '确认'],
          ),
        ]);
        // 把 footer 追加到 modal-dialog
        var dialog = modal.el.querySelector && modal.el.querySelector('.modal-dialog');
        if (dialog) {
          dialog.appendChild(u.el('div', { class: 'modal-footer' }, [footerWrap]));
        }
        modal.open();
      } else {
        // 降级:window.confirm
        var ok = false;
        try {
          ok = global.confirm(
            t('settings.clearDataConfirmBody') || '此操作将清空所有本地数据并刷新页面。是否继续?',
          );
        } catch (_e) { ok = false; }
        if (ok) performClearData();
      }
    }

    return { wrapper: section, button: button, openConfirm: openConfirm };
  }

  // ------------------------------------------------------------------
  // performClearData — 真正的清空逻辑
  // ------------------------------------------------------------------

  function performClearData() {
    try { global.localStorage.clear(); } catch (_e) { /* ignore */ }
    try {
      if (typeof global.location !== 'undefined' && typeof global.location.reload === 'function') {
        global.location.reload();
      }
    } catch (_e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // 公开 API:installSettingsView({ container })
  // ------------------------------------------------------------------

  /**
   * 安装设置面板到 container。返回 { root }。
   * 同一时刻只允许一个实例;再次调用会替换旧的(自动调 uninstall)。
   *
   * @param {{ container: HTMLElement }} opts
   * @returns {{ root: HTMLElement }}
   */
  function installSettingsView(opts) {
    opts = opts || {};
    var container = opts.container;
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('[settingsFeature] installSettingsView: container (HTMLElement) is required');
    }
    var u = utils();
    if (!u || typeof u.el !== 'function') {
      throw new Error('[settingsFeature] window.MyAgent.utils.el 不可用;请确认 utils.js 已先加载');
    }

    // 先卸载旧实例(若有)
    if (currentInstall) {
      try { uninstall(); } catch (_e) { /* ignore */ }
    }

    var t = (i18n() && typeof i18n().t === 'function')
      ? i18n().t
      : function (k) { return k; };

    // ── 1) 主题 fieldset
    var themeGroup = buildThemeFieldset(u, t);
    // ── 2) 语言 fieldset
    var langGroup = buildLangFieldset(u, t);
    // ── 3) 默认模型 fieldset
    var modelGroup = buildModelFieldset(u, t);
    // ── 4) 清空数据 section
    var dangerGroup = buildClearDataSection(u, t);

    // ── form 根(form 语义 + a11y)
    var formAttrs = {
      class: 'settings-form',
      id: 'settings-form',
      'aria-label': t('settings.title') || '设置',
    };
    var form = u.el('form', formAttrs, [
      themeGroup.fieldset,
      langGroup.fieldset,
      modelGroup.fieldset,
      dangerGroup.wrapper,
    ]);

    // 防止 form 默认 submit(我们没用 submit,只是语义)
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
    });

    // ── 事件绑定
    var offs = [];

    // 主题:radio change → applyTheme
    themeGroup.radios.forEach(function (radio) {
      function handler() {
        if (radio.checked) applyTheme(radio.value);
      }
      radio.addEventListener('change', handler);
      offs.push(function () { radio.removeEventListener('change', handler); });
    });

    // 语言:radio change → applyLang
    langGroup.radios.forEach(function (radio) {
      function handler() {
        if (radio.checked) applyLang(radio.value);
      }
      radio.addEventListener('change', handler);
      offs.push(function () { radio.removeEventListener('change', handler); });
    });

    // 模型:select change → applyModel
    function onModelChange() {
      var val = modelGroup.select.value;
      applyModel(val);
    }
    modelGroup.select.addEventListener('change', onModelChange);
    offs.push(function () { modelGroup.select.removeEventListener('change', onModelChange); });

    // 清空数据
    function onClearClick() { dangerGroup.openConfirm(); }
    dangerGroup.button.addEventListener('click', onClearClick);
    offs.push(function () { dangerGroup.button.removeEventListener('click', onClearClick); });

    // ── 挂到 container
    container.appendChild(form);
    offs.push(function () {
      if (form.parentNode) form.parentNode.removeChild(form);
    });

    currentInstall = { root: form, offs: offs };
    return { root: form };
  }

  // ------------------------------------------------------------------
  // 公开 API:uninstall()
  // ------------------------------------------------------------------

  function uninstall() {
    if (!currentInstall) return false;
    var inst = currentInstall;
    currentInstall = null;
    var offs = inst.offs || [];
    for (var i = 0; i < offs.length; i++) {
      try { offs[i](); } catch (_e) { /* ignore */ }
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.settingsFeature = {
    installSettingsView: installSettingsView,
    uninstall: uninstall,
    // 暴露纯函数给测试 / 调试
    applyTheme: applyTheme,
    applyLang: applyLang,
    applyModel: applyModel,
    getActiveProviderModels: getActiveProviderModels,
    readCurrentTheme: readCurrentTheme,
    readCurrentLang: readCurrentLang,
    readCurrentModel: readCurrentModel,
    performClearData: performClearData,
    // 常量
    THEME_STORAGE_KEY: THEME_STORAGE_KEY,
    LANG_STORAGE_KEY: LANG_STORAGE_KEY,
    THEME_CHANGE_EVENT: THEME_CHANGE_EVENT,
    LANG_CHANGE_EVENT: LANG_CHANGE_EVENT,
    VALID_THEMES: VALID_THEMES.slice(),
    VALID_LANGS: VALID_LANGS.slice(),
    PLACEHOLDER_MODEL_VALUE: PLACEHOLDER_MODEL_VALUE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
