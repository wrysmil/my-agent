// electron/renderer/js/app.js
const App = {
  currentPage: "chat",
  PAGES: ["chat", "sessions", "skills", "settings"],

  init() {
    // 注入暗色主题样式表（位于静态样式之后，保证变量覆盖生效）
    this.injectDarkThemeCss();

    // 侧栏导航
    document.querySelectorAll(".sidebar-icon").forEach((icon) => {
      icon.addEventListener("click", () => {
        const page = icon.dataset.nav;
        this.navigate(page);
      });
    });

    // Logo 点击回对话页
    document.getElementById("sidebar-logo").addEventListener("click", () => {
      this.navigate("chat");
    });

    // 会话面板内的"管理"链接
    const sessionManageLink = document.querySelector("#session-panel [data-nav='sessions']");
    if (sessionManageLink) {
      sessionManageLink.addEventListener("click", () => {
        this.navigate("sessions");
      });
    }

    // 新建会话按钮
    document.getElementById("btn-new-session")?.addEventListener("click", () => {
      if (typeof ChatPage !== "undefined") {
        ChatPage.newSession();
      }
    });

    // 会话管理页的"新建"按钮
    document.getElementById("btn-new-session-2")?.addEventListener("click", () => {
      this.navigate("chat");
      if (typeof ChatPage !== "undefined") {
        ChatPage.newSession();
      }
    });

    // 前进/后退：hash 变化同步路由（hashchange 为主，popstate 兜底，去重）
    window.addEventListener("popstate", () => this.syncFromHash());
    window.addEventListener("hashchange", () => this.syncFromHash());

    // 初始路由：读取 location.hash 确定当前页
    this.applyPage(this.pageFromHash() || "chat");
  },

  /** 暗色主题样式表通过 <link> 动态注入，无需改动 index.html。 */
  injectDarkThemeCss() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/theme-dark.css";
    document.head.appendChild(link);
  },

  /** 从 location.hash 解析合法页面，非法/空则返回 null。 */
  pageFromHash() {
    const hash = location.hash.replace(/^#/, "");
    return this.PAGES.includes(hash) ? hash : null;
  },

  /** 历史前进/后退导致 hash 变化时同步到对应页面。 */
  syncFromHash() {
    const page = this.pageFromHash();
    if (page && page !== this.currentPage) {
      this.navigate(page, true);
    }
  },

  navigate(page, fromHash = false) {
    // 导航时同步地址栏 hash（产生历史记录）；hash 触发回流时不重复写入
    if (!fromHash && location.hash !== `#${page}`) {
      location.hash = page;
    }
    this.applyPage(page);
  },

  applyPage(page) {
    // 更新侧栏（active 状态与 hash 同步）
    document.querySelectorAll(".sidebar-icon").forEach((icon) => {
      icon.classList.toggle("active", icon.dataset.nav === page);
    });

    // 更新页面
    document.querySelectorAll(".page").forEach((p) => {
      p.classList.toggle("active", p.id === `page-${page}`);
    });

    // 会话面板仅在对话页显示
    const sessionPanel = document.getElementById("session-panel");
    if (sessionPanel) {
      sessionPanel.classList.toggle("collapsed", page !== "chat");
    }

    this.currentPage = page;

    // 初始化页面
    if (page === "chat" && typeof ChatPage !== "undefined") {
      ChatPage.init();
    }
    if (page === "sessions" && typeof SessionsPage !== "undefined") {
      SessionsPage.init();
    }
    if (page === "settings" && typeof SettingsPage !== "undefined") {
      SettingsPage.init();
    }
    if (page === "skills" && typeof SkillsPage !== "undefined") {
      SkillsPage.init();
    }
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
