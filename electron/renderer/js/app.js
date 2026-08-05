// electron/renderer/js/app.js
const App = {
  currentPage: "chat",

  init() {
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

    // 初始路由
    this.navigate(this.currentPage);
  },

  navigate(page) {
    // 更新侧栏
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
