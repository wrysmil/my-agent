/**
 * app.js — 应用启动入口
 *
 * 迁移自 dist/electron/renderer/js/app.js。
 * 改用全局 state.js 的 setView() 管理视图切换 + initI18n() 启动国际化。
 */
var App = {
  currentPage: 'chat',
  PAGES: ['chat', 'sessions', 'skills', 'settings'],

  async init() {
    // ── Stage 1: 初始化 i18n ──
    try { await initI18n(); } catch (_) { /* 回退到内联默认表 */ }

    // ── Stage 2: 渲染图标 ──
    this._fillIcons();

    // ── 注册导航事件 ──
    var self = this;
    var icons = document.querySelectorAll('.sidebar-icon');
    for (var i = 0; i < icons.length; i++) {
      (function (icon) {
        icon.addEventListener('click', function () {
          self.navigate(icon.dataset.nav);
        });
      })(icons[i]);
    }

    var logo = document.getElementById('sidebar-logo');
    if (logo) logo.addEventListener('click', function () { self.navigate('chat'); });

    var manageLink = document.querySelector('#session-panel [data-nav="sessions"]');
    if (manageLink) manageLink.addEventListener('click', function () { self.navigate('sessions'); });

    var btnNew = document.getElementById('btn-new-session');
    if (btnNew) btnNew.addEventListener('click', function () {
      if (typeof ChatPage !== 'undefined' && ChatPage.newSession) ChatPage.newSession();
    });

    var btnNew2 = document.getElementById('btn-new-session-2');
    if (btnNew2) btnNew2.addEventListener('click', function () {
      self.navigate('chat');
      if (typeof ChatPage !== 'undefined' && ChatPage.newSession) ChatPage.newSession();
    });

    window.addEventListener('popstate', function () { self.syncFromHash(); });
    window.addEventListener('hashchange', function () { self.syncFromHash(); });

    // ── Stage 3: 恢复上次视图 ──
    if (typeof _restoreLastView === 'function') {
      _restoreLastView();
    } else {
      this.applyPage(this.pageFromHash() || 'chat');
    }
  },

  _fillIcons: function () {
    if (typeof uiIconHtml !== 'function') return;
    var els = document.querySelectorAll('[data-icon]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var name = el.dataset.icon;
      var size = el.dataset.iconSize || '16';
      if (name) {
        el.innerHTML = uiIconHtml(name);
        var svg = el.querySelector('svg');
        if (svg) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
      }
    }
  },

  pageFromHash: function () {
    var hash = location.hash.replace(/^#/, '');
    return this.PAGES.indexOf(hash) >= 0 ? hash : null;
  },

  syncFromHash: function () {
    var page = this.pageFromHash();
    if (page && page !== this.currentPage) this.navigate(page, true);
  },

  navigate: function (page, fromHash) {
    if (!fromHash && location.hash !== '#' + page) location.hash = page;
    this.applyPage(page);
  },

  applyPage: function (page) {
    this.currentPage = page;

    if (typeof setView === 'function') {
      setView(page);
    } else {
      // 回退 DOM 操作
      var panels = document.querySelectorAll('.page');
      for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
      var pageEl = document.getElementById('page-' + page);
      if (pageEl) pageEl.classList.add('active');

      var icons = document.querySelectorAll('.sidebar-icon');
      for (var j = 0; j < icons.length; j++) icons[j].classList.remove('active');
      var btn = document.querySelector('.sidebar-icon[data-nav="' + page + '"]');
      if (btn) btn.classList.add('active');

      var sp = document.getElementById('session-panel');
      if (sp) sp.classList.toggle('collapsed', page !== 'chat');
    }

    // 初始化页面模块
    if (page === 'chat' && typeof ChatPage !== 'undefined' && ChatPage.init) ChatPage.init();
    if (page === 'sessions' && typeof SessionsPage !== 'undefined' && SessionsPage.init) SessionsPage.init();
    if (page === 'settings' && typeof SettingsPage !== 'undefined' && SettingsPage.init) SettingsPage.init();
    if (page === 'skills' && typeof SkillsPage !== 'undefined' && SkillsPage.init) SkillsPage.init();
  },
};

document.addEventListener('DOMContentLoaded', function () { App.init(); });
