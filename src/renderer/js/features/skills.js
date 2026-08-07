// electron/renderer/js/pages/skills.js

// 分类 → 图标 映射（用于分类 chip 与卡片图标）
const CATEGORY_EMOJI = {
  "开发": "💻", "写作": "📝", "数据": "📊", "研究": "🔍", "创意": "🎨",
};

// Skill source 枚举 → 中文标签（SkillSpec.source: system | user | marketplace）
const SOURCE_LABEL = {
  system: "内置",
  user: "用户",
  marketplace: "市场",
};

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
    const toggle = document.getElementById("show-enabled-only");
    if (toggle) {
      toggle.addEventListener("change", () => {
        this.showEnabledOnly = toggle.checked;
        this.render();
      });
    }
  },

  /** 展示加载中 / 加载失败占位（不触发 render，避免闪现空态）。 */
  showStatus(text) {
    const grid = document.getElementById("skills-grid");
    if (grid) {
      grid.innerHTML =
        `<div class="empty-state"><div class="empty-state-icon">🧩</div><div>${this.esc(text)}</div></div>`;
    }
  },

  async load() {
    this.showStatus("加载中...");
    try {
      this.skills = await api.skills.list();
    } catch (err) {
      console.error("加载 Skills 失败:", err);
      this.skills = [];
      this.showStatus("加载失败");
      return;
    }
    this.render();
  },

  /** 从真实数据的 category 字段动态收集可用分类，重建分类 chips。 */
  renderChips() {
    const bar = document.querySelector(".skills-chip-bar");
    if (!bar) return;

    const toggle = document.getElementById("show-enabled-only");
    const toggleLabel = toggle ? toggle.closest("label") : null;

    // 收集可用分类（保持首次出现顺序、去重、忽略空值）
    const categories = [];
    this.skills.forEach((s) => {
      if (s.category && !categories.includes(s.category)) categories.push(s.category);
    });

    // 数据刷新后所选分类已不存在时回退到"全部"，避免死筛选状态
    if (this.filterCategory !== "all" && !categories.includes(this.filterCategory)) {
      this.filterCategory = "all";
    }

    // 移除旧的 chips（保留"分类："标签与"仅显示已启用"开关）
    bar.querySelectorAll(".chip").forEach((chip) => chip.remove());

    const mkChip = (category, text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (category === this.filterCategory ? " active" : "");
      chip.dataset.category = category;
      chip.textContent = text;
      chip.addEventListener("click", () => {
        this.filterCategory = category;
        this.render();
      });
      return chip;
    };

    bar.insertBefore(mkChip("all", "全部"), toggleLabel);
    categories.forEach((cat) => {
      const emoji = CATEGORY_EMOJI[cat] ? `${CATEGORY_EMOJI[cat]} ` : "";
      bar.insertBefore(mkChip(cat, `${emoji}${cat}`), toggleLabel);
    });
  },

  render() {
    this.renderChips();

    const enabledCount = this.skills.filter((s) => s.enabled !== false).length;
    const statsEl = document.getElementById("skills-stats");
    if (statsEl) {
      statsEl.textContent = `已启用 ${enabledCount} / ${this.skills.length}`;
    }

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

    // 卡片点击查看详情（可选：console 占位，后续可扩展为详情面板）
    container.querySelectorAll(".skill-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".toggle-switch")) return;
        const skill = this.skills.find((s) => s.id === card.dataset.id);
        if (skill) console.log("[skills] 查看详情:", skill.name, skill);
      });
    });
  },

  renderCard(s) {
    const iconBg = "#e5e7eb";
    const displayCategory = s.category
      ? `${CATEGORY_EMOJI[s.category] || ""} ${s.category}`
      : "未分类";
    const description = s.description_zh || s.description_en || "";
    const sourceLabel = SOURCE_LABEL[s.source] || s.source || "内置";
    const version = s.version
      ? (String(s.version).startsWith("v") ? String(s.version) : `v${s.version}`)
      : "v1.0.0";

    return `
      <div class="skill-card ${s.enabled === false ? "disabled" : ""}" data-id="${s.id}">
        <div class="skill-card-header">
          <div class="skill-card-icon-row">
            <div class="skill-card-icon" style="background:${iconBg};">
              ${s.icon || CATEGORY_EMOJI[s.category] || "📦"}
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
        <div class="skill-card-desc">${this.esc(description)}</div>
        <div class="skill-card-footer">
          <span class="skill-card-source">📦 ${version} · ${sourceLabel}</span>
          <span class="skill-card-config">配置</span>
        </div>
      </div>`;
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
