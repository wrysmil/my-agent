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

    this.currentPage = page;
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
