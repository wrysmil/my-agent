// electron/renderer/js/pages/skills.js
const SkillsPage = {
  skills: [],
  filterCategory: "all",
  showEnabledOnly: false,
  _initialized: false,

  async init() {
    if (this._initialized) {
      await this.load();
      return;
    }
    this._initialized = true;
    this.bindEvents();
    await this.load();
  },

  bindEvents() {
    document.querySelectorAll(".skills-chip-bar .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        this.filterCategory = chip.dataset.category;
        this.render();
      });
    });

    const toggle = document.getElementById("show-enabled-only");
    if (toggle) {
      toggle.addEventListener("change", () => {
        this.showEnabledOnly = toggle.checked;
        this.render();
      });
    }
  },

  async load() {
    try {
      this.skills = await api.skills.list();
      if (this.skills.length === 0) {
        this.skills = this.getMockSkills();
      }
      this.render();
    } catch (err) {
      console.error("Failed to load skills:", err);
      this.skills = this.getMockSkills();
      this.render();
    }
  },

  render() {
    document.querySelectorAll(".skills-chip-bar .chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.category === this.filterCategory);
    });

    const enabledCount = this.skills.filter((s) => s.enabled !== false).length;
    document.getElementById("skills-stats").textContent =
      `已启用 ${enabledCount} / ${this.skills.length}`;

    let filtered = this.skills;
    if (this.filterCategory !== "all") {
      filtered = filtered.filter((s) => s.category === this.filterCategory);
    }
    if (this.showEnabledOnly) {
      filtered = filtered.filter((s) => s.enabled !== false);
    }

    const enabled = filtered.filter((s) => s.enabled !== false);
    const disabled = filtered.filter((s) => s.enabled === false);

    const container = document.getElementById("skills-grid");
    let html = "";

    if (enabled.length > 0) {
      html += `<div class="skills-group-label">已启用 (${enabled.length})</div>`;
      html += `<div class="skills-grid">${enabled.map((s) => this.renderCard(s)).join("")}</div>`;
    }

    if (disabled.length > 0) {
      html += `<div class="skills-group-label" style="margin-top:20px;">未启用 (${disabled.length})</div>`;
      html += `<div class="skills-grid">${disabled.map((s) => this.renderCard(s)).join("")}</div>`;
    }

    if (filtered.length === 0) {
      html = `<div class="empty-state"><div class="empty-state-icon">🧩</div><div>没有匹配的 Skill</div></div>`;
    }

    container.innerHTML = html;

    container.querySelectorAll(".toggle-switch input").forEach((cb) => {
      cb.addEventListener("change", async (e) => {
        const id = e.target.dataset.id;
        const enabled = e.target.checked;
        await api.skills.setEnabled(id, enabled);
        const skill = this.skills.find((s) => s.id === id);
        if (skill) skill.enabled = enabled;
        this.render();
      });
    });
  },

  renderCard(s) {
    const colors = {
      "code-review": "#dbeafe",
      "commit-message": "#dcfce7",
      summarize: "#fef3c7",
      "git-workflow": "#fee2e2",
      "sql-helper": "#ede9fe",
      "deep-research": "#dbeafe",
      "web-search": "#f3f4f6",
      "image-gen": "#f3f4f6",
      "pdf-reader": "#f3f4f6",
    };
    const iconBg = colors[s.id] || "#f3f4f6";

    const CATEGORY_EMOJI = {
      "开发": "💻", "写作": "📝", "数据": "📊", "研究": "🔍", "创意": "🎨",
    };
    const displayCategory = s.category
      ? `${CATEGORY_EMOJI[s.category] || ""} ${s.category}`
      : "未分类";

    return `
      <div class="skill-card ${s.enabled === false ? "disabled" : ""}">
        <div class="skill-card-header">
          <div class="skill-card-icon-row">
            <div class="skill-card-icon" style="background:${iconBg};">
              ${s.icon || "📦"}
            </div>
            <div>
              <div class="skill-card-name">${this.esc(s.name)}</div>
              <div class="skill-card-category">${displayCategory}</div>
            </div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" data-id="${s.id}" ${s.enabled !== false ? "checked" : ""}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="skill-card-desc">${this.esc(s.description || "")}</div>
        <div class="skill-card-footer">
          <span class="skill-card-source">📦 ${s.version || "v1.0.0"} · ${s.source || "内置"}</span>
          <span class="skill-card-config">配置</span>
        </div>
      </div>`;
  },

  getMockSkills() {
    return [
      {
        id: "code-review",
        name: "code-review",
        category: "开发",
        icon: "🔍",
        description: "自动审查 PR / commit，识别 bug、安全问题与风格问题。",
        enabled: true,
        version: "v1.2.0",
        source: "内置",
      },
      {
        id: "commit-message",
        name: "commit-message",
        category: "开发",
        icon: "📝",
        description: "基于 staged diff 生成 Conventional Commits 规范的提交信息。",
        enabled: true,
        version: "v0.9.0",
        source: "内置",
      },
      {
        id: "summarize",
        name: "summarize",
        category: "写作",
        icon: "📋",
        description: "摘要长文档/对话/网页内容，支持中文输出与多级压缩。",
        enabled: true,
        version: "v1.0.1",
        source: "自定义",
      },
      {
        id: "git-workflow",
        name: "git-workflow",
        category: "开发",
        icon: "🌿",
        description: "规范化 Git 工作流：branch 命名 / PR 模板 / rebase 冲突解决。",
        enabled: true,
        version: "v2.0.0",
        source: "市场",
      },
      {
        id: "sql-helper",
        name: "sql-helper",
        category: "数据",
        icon: "📊",
        description: "自然语言转 SQL、查询优化建议、EXPLAIN 解读。",
        enabled: true,
        version: "v1.1.0",
        source: "市场",
      },
      {
        id: "deep-research",
        name: "deep-research",
        category: "研究",
        icon: "🔬",
        description: "多轮检索 + 交叉验证，生成带引用源的研究报告。",
        enabled: true,
        version: "v0.5.0",
        source: "自定义",
      },
      {
        id: "web-search",
        name: "web-search",
        category: "研究",
        icon: "🌐",
        description: "联网搜索（需配置 search API Key）。",
        enabled: false,
        version: "v1.0.0",
        source: "市场",
      },
      {
        id: "image-gen",
        name: "image-gen",
        category: "创意",
        icon: "🎨",
        description: "文字生成配图（需 DALL-E / Stable Diffusion key）。",
        enabled: false,
        version: "v0.8.0",
        source: "市场",
      },
      {
        id: "pdf-reader",
        name: "pdf-reader",
        category: "数据",
        icon: "📑",
        description: "读取 PDF 文本、表格、图片，结构化输出。",
        enabled: false,
        version: "v1.0.2",
        source: "市场",
      },
    ];
  },

  esc(s) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(s).replace(/[&<>"']/g, (c) => map[c]);
  },
};
