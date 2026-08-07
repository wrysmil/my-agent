// electron/renderer/js/pages/settings.js
const SettingsPage = {
  currentTab: "models",
  config: null,
  _initialized: false,

  // 内置工具清单（对应 src/tools/builtin.ts 的 BUILTIN_TOOLS，保持同步）
  builtinTools: [
    { name: "read_file", desc: "读取文件内容，支持行号/字符范围" },
    { name: "write_file", desc: "写入/创建文件，父目录自动创建" },
    { name: "edit_file", desc: "对现有文件做精确字符串替换" },
    { name: "list_files", desc: "列出目录中的文件和子目录" },
    { name: "search_files", desc: "按文件名/glob 模式搜索文件" },
    { name: "grep_files", desc: "在文件内容中搜索文本/正则" },
    { name: "bash", desc: "执行 shell 命令（有副作用）" },
    { name: "web_fetch", desc: "抓取网页内容并提取文本" },
  ],

  async init() {
    if (this._initialized) {
      await this.loadConfig();
      this.switchTab(this.currentTab);
      return;
    }
    this._initialized = true;
    this.bindSubnav();
    this.bindEvents();
    await this.loadConfig();
    // 应用已保存主题（若可回读）；缺失时默认亮色
    this.applyTheme(this.config?.theme || "light");
    this.switchTab(this.currentTab);
  },

  bindSubnav() {
    document.querySelectorAll(".settings-subnav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const tab = item.dataset.tab;
        this.switchTab(tab);
      });
    });
  },

  bindEvents() {
    const tempSlider = document.getElementById("setting-temperature");
    const tempValue = document.getElementById("temp-value");
    if (tempSlider && tempValue) {
      tempSlider.addEventListener("input", () => {
        tempValue.textContent = tempSlider.value;
      });
    }

    const saveBtn = document.getElementById("btn-save-settings");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => this.save());
    }

    const resetBtn = document.getElementById("btn-reset-settings");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetDefaults());
    }
  },

  async loadConfig() {
    try {
      this.config = await api.config.get();
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  },

  // ============================================================
  // Provider 数据源（模型 tab）
  // ============================================================

  async loadProviders() {
    try {
      const providers = await api.providers.list();
      this.renderProviderCards(providers);
      this.populateModelSelects(providers);
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
  },

  /** 从 Provider 的 models 字段去重合并生成模型下拉选项。 */
  populateModelSelects(providers) {
    const modelSet = new Set();
    (providers || []).forEach((p) => {
      (p.models || []).forEach((m) => modelSet.add(m));
    });
    const models = [...modelSet];

    const optionsHtml = models.length
      ? models.map((m) => `<option value="${this.esc(m)}">${this.esc(m)}</option>`).join("")
      : `<option value="">暂无模型，请先在下方的 Provider 配置中添加</option>`;

    ["setting-main-model", "setting-plan-model"].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = optionsHtml;
      if (models.includes(current)) {
        sel.value = current;
      } else if (models.length) {
        sel.value = models[0];
      }
    });
  },

  renderProviderCards(providers) {
    const container = document.getElementById("provider-cards");
    if (!container) return;

    if (providers.length === 0) {
      container.innerHTML = `
        <div style="padding:24px;text-align:center;color:#999;">
          暂无配置的 Provider。<br><br>
          <button class="btn btn-sm btn-primary" id="btn-add-first-provider">＋ 添加第一个 Provider</button>
        </div>`;
      document.getElementById("btn-add-first-provider")?.addEventListener(
        "click", () => this.showProviderForm()
      );
      return;
    }

    const PROVIDER_CONFIG = {
      anthropic:  { icon: "A", color: "#d97706", label: "Anthropic" },
      openai:     { icon: "O", color: "#10a37f", label: "OpenAI" },
      deepseek:   { icon: "DS", color: "linear-gradient(135deg,#6c5ce7,#a29bfe)", label: "DeepSeek" },
      moonshot:   { icon: "M", color: "#6366f1", label: "Moonshot" },
      doubao:     { icon: "D", color: "#22c55e", label: "Doubao" },
    };

    container.innerHTML = providers.map((p) => {
      const cfg = PROVIDER_CONFIG[p.provider] ?? { icon: "?", color: "#999", label: p.provider };
      const iconStyle = `background:${cfg.color};`;
      const connected = p.isEnabled;
      return `
      <div class="provider-card ${connected ? "" : "disconnected"}">
        <div class="provider-card-header">
          <div class="provider-card-icon" style="${iconStyle}">${cfg.icon}</div>
          <div class="provider-card-info">
            <div class="provider-card-name">
              ${this.esc(p.name || cfg.label)}
              <span class="badge ${connected ? "badge-connected" : "badge-disconnected"}">
                ${connected ? "● 已启用" : "● 已禁用"}
              </span>
            </div>
            <div class="provider-card-models">${(p.models ?? []).join(" · ") || "无模型"}</div>
          </div>
          <button class="btn btn-sm btn-secondary edit-provider" data-id="${p.id}">编辑</button>
          <button class="btn btn-icon btn-ghost delete-provider" data-id="${p.id}">⋯</button>
        </div>
      </div>`;
    }).join("");

    container.querySelectorAll(".edit-provider").forEach(btn =>
      btn.addEventListener("click", () => this.showProviderForm(btn.dataset.id))
    );
    container.querySelectorAll(".delete-provider").forEach(btn =>
      btn.addEventListener("click", () => this.deleteProvider(btn.dataset.id))
    );
  },

  /** API Key 基础校验：非空 + 常见前缀检查。返回警告列表（不阻止保存）。 */
  validateApiKey(key, required = false) {
    const warnings = [];
    const trimmed = (key || "").trim();
    if (!trimmed && required) {
      warnings.push("API Key 不能为空");
    } else if (trimmed) {
      if (!/^(sk-|ak-|fk-|pk-|sk-ant-|key-)/i.test(trimmed)) {
        warnings.push("API Key 通常以 sk-/ak-/fk- 等前缀开头，请确认格式是否正确");
      }
    }
    return warnings;
  },

  async showProviderForm(editId) {
    let existingEntry = null;
    if (editId) {
      const list = await api.providers.list();
      existingEntry = list.find(x => x.id === editId) ?? null;
    }

    const PROVIDER_TYPES = [
      { id: "anthropic", label: "Anthropic", hint: "api.anthropic.com" },
      { id: "openai", label: "OpenAI", hint: "api.openai.com" },
      { id: "deepseek", label: "DeepSeek", hint: "api.deepseek.com" },
      { id: "moonshot", label: "Moonshot (月之暗面)", hint: "api.moonshot.cn" },
      { id: "doubao", label: "Doubao (豆包)", hint: "ark.cn-beijing.volces.com" },
    ];

    const formHtml = `
      <div class="modal-overlay" id="provider-form-modal">
        <div class="modal-content" style="max-width:480px;">
          <div class="modal-header">
            <h3>${editId ? "编辑" : "添加"} Provider</h3>
            <button class="btn btn-icon btn-ghost modal-close">✕</button>
          </div>
          <div class="modal-body">
            <div class="settings-field">
              <label class="settings-field-label">厂商</label>
              <select class="select" id="pf-provider" style="width:100%;">${PROVIDER_TYPES.map(
                t => `<option value="${t.id}">${t.label}</option>`
              ).join("")}</select>
            </div>
            <div class="settings-field">
              <label class="settings-field-label">显示名称</label>
              <input class="input" id="pf-name" placeholder="如：我的 DeepSeek" style="width:100%;">
            </div>
            <div class="settings-field">
              <label class="settings-field-label">API Key</label>
              <input class="input" type="password" id="pf-api-key" placeholder="sk-..." style="width:100%;">
              <div class="settings-field-desc">密钥将加密存储到本地数据库</div>
              <div class="settings-field-desc" id="pf-api-key-hint"
                style="color:var(--color-warning);display:none;margin-top:6px;"></div>
            </div>
            <div class="settings-field">
              <label class="settings-field-label">Base URL（可选）</label>
              <input class="input" id="pf-base-url" placeholder="默认 API 地址" style="width:100%;">
            </div>
            <div class="settings-field">
              <label class="settings-field-label">模型列表（逗号分隔）</label>
              <input class="input" id="pf-models" placeholder="deepseek-chat, deepseek-reasoner" style="width:100%;">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary modal-close">取消</button>
            <button class="btn btn-primary" id="btn-save-provider">保存</button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML("beforeend", formHtml);

    if (existingEntry) {
      document.getElementById("pf-provider").value = existingEntry.provider;
      document.getElementById("pf-name").value = existingEntry.name;
      document.getElementById("pf-base-url").value = existingEntry.baseUrl;
      document.getElementById("pf-models").value = (existingEntry.models ?? []).join(", ");
      document.getElementById("pf-api-key").placeholder = "留空则不修改已有密钥";
    }

    const isNew = !editId;
    const showKeyWarnings = () => {
      const warnings = this.validateApiKey(
        document.getElementById("pf-api-key").value,
        isNew,
      );
      const hint = document.getElementById("pf-api-key-hint");
      if (hint) {
        hint.textContent = warnings.join("；");
        hint.style.display = warnings.length ? "" : "none";
      }
    };

    document.getElementById("pf-api-key").addEventListener("blur", showKeyWarnings);

    document.getElementById("btn-save-provider").addEventListener("click", async () => {
      const apiKey = document.getElementById("pf-api-key").value;
      const warnings = this.validateApiKey(apiKey, isNew);
      // warn 但不阻止保存
      if (warnings.length) {
        this.showToast("⚠️ " + warnings.join("；") + "（已保存）");
      }

      await api.providers.save({
        id: editId ?? undefined,
        provider: document.getElementById("pf-provider").value,
        name: document.getElementById("pf-name").value,
        apiKey,
        baseUrl: document.getElementById("pf-base-url").value,
        models: document.getElementById("pf-models").value
          .split(",").map(s => s.trim()).filter(Boolean),
      });
      document.getElementById("provider-form-modal").remove();
      this.loadProviders();
    });

    document.querySelectorAll("#provider-form-modal .modal-close").forEach(b =>
      b.addEventListener("click", () =>
        document.getElementById("provider-form-modal").remove())
    );
  },

  async deleteProvider(id) {
    if (!confirm("确定删除此 Provider？")) return;
    await api.providers.delete(id);
    this.loadProviders();
  },

  // ============================================================
  // 标签页分发
  // ============================================================

  switchTab(tab) {
    this.currentTab = tab;

    document.querySelectorAll(".settings-subnav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.tab === tab);
    });

    const content = document.getElementById("settings-content");
    switch (tab) {
      case "models":
        this.renderModelsTab();
        break;
      case "tools":
        this.renderToolsTab();
        break;
      case "paths":
        this.renderPathsTab();
        break;
      case "context":
        this.renderContextTab();
        break;
      case "appearance":
        this.renderAppearanceTab();
        break;
      case "developer":
        this.renderDeveloperTab();
        break;
      default:
        content.innerHTML = `<div class="empty-state">即将实现</div>`;
    }
  },

  // ============================================================
  // 模型 tab
  // ============================================================

  renderModelsTab() {
    const cfg = this.config ?? {};
    const agent = cfg.agent ?? {};
    const mainModel = agent.defaultModel || "deepseek-chat";
    const planModel = cfg.planModel || "deepseek-chat";
    const temperature = cfg.temperature ?? 0.7;
    const maxTokens = cfg.maxTokens ?? 4096;
    const timeoutSeconds = [60, 120, 300].includes(cfg.requestTimeout)
      ? cfg.requestTimeout : 120;

    const content = document.getElementById("settings-content");
    content.innerHTML = `
      <div class="settings-section">
        <h3>默认模型</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主对话模型</div>
              <div class="settings-field-desc">用于所有新建会话（来自已配置 Provider）</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-main-model">
                <option value="${this.esc(mainModel)}">${this.esc(mainModel)}</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">规划/反思模型</div>
              <div class="settings-field-desc">用于 plan_set / 错误反思（可选用更便宜的）</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-plan-model">
                <option value="${this.esc(planModel)}">${this.esc(planModel)}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <h3 style="margin:0;">Provider 配置</h3>
          <button class="btn btn-sm btn-primary" id="btn-add-provider">＋ 添加</button>
        </div>

        <div id="provider-cards">
          <div style="padding:16px;text-align:center;color:#999;">加载中...</div>
        </div>
      </div>

      <div class="settings-section">
        <h3>生成参数</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Temperature</div>
              <div class="settings-field-desc">越高越发散</div>
            </div>
            <div class="settings-field-control">
              <input type="range" id="setting-temperature" min="0" max="1" step="0.1" value="${temperature}">
              <span class="value-display" id="temp-value">${temperature}</span>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Max tokens</div>
              <div class="settings-field-desc">单次回复上限</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="${maxTokens}" id="setting-max-tokens"
                min="1" style="width:100px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">请求超时</div>
              <div class="settings-field-desc">超过此时长自动放弃</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-timeout">
                ${[60, 120, 300].map((sec) =>
                  `<option value="${sec}" ${timeoutSeconds === sec ? "selected" : ""}>${sec} 秒</option>`
                ).join("")}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-actions">
        <button class="btn btn-secondary" id="btn-reset-settings">恢复默认</button>
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;

    this.bindEvents();
    this.loadProviders();

    document.getElementById("btn-add-provider")?.addEventListener(
      "click", () => this.showProviderForm()
    );
  },

  // ============================================================
  // 工具 tab
  // ============================================================

  renderToolsTab() {
    const cfg = this.config ?? {};
    const enabledSet = Array.isArray(cfg.enabledTools)
      ? new Set(cfg.enabledTools)
      : null; // null → 全部默认启用

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>内置工具启用状态</h3>
        <p style="color:var(--color-text-muted);font-size:12px;margin:-6px 0 14px;">
          列表与 src/tools/builtin.ts 的 BUILTIN_TOOLS 一致
        </p>
        <div class="settings-field-group">
          ${this.builtinTools
            .map(
              (t) => `
            <div class="settings-field">
              <div>
                <div class="settings-field-label">🔧 ${this.esc(t.name)}</div>
                <div class="settings-field-desc">${this.esc(t.desc)}</div>
              </div>
              <div class="settings-field-control">
                <input type="checkbox" id="tool-${this.esc(t.name)}"
                  ${enabledSet === null || enabledSet.has(t.name) ? "checked" : ""}
                  style="accent-color:var(--color-primary);">
              </div>
            </div>`
            )
            .join("")}
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  // ============================================================
  // 路径 tab
  // ============================================================

  renderPathsTab() {
    const cfg = this.config ?? {};
    const dirs = Array.isArray(cfg.workingDirs) ? cfg.workingDirs : [];
    const defaultValue = dirs.length
      ? dirs.join("\n")
      : `D:/studyspace/project/my-agent\nD:/studyspace/源码学习/Orkas`;

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>路径与权限</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">工作目录白名单</div>
              <div class="settings-field-desc">Agent 只能访问以下目录（每行一个）</div>
            </div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <textarea class="input" id="setting-working-dirs" rows="4"
            style="width:100%;font-family:monospace;font-size:12px;">${this.esc(defaultValue)}</textarea>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  // ============================================================
  // 上下文 tab
  // ============================================================

  renderContextTab() {
    const cfg = this.config ?? {};
    const thresholds = [70, 82, 90];
    const threshold = thresholds.includes(cfg.contextCompressThreshold)
      ? cfg.contextCompressThreshold : 82;
    const keep = cfg.contextKeepRounds ?? 2;
    const budget = cfg.contextBudget ?? 5;

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>上下文压缩</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">压缩触发阈值</div>
              <div class="settings-field-desc">上下文窗口使用率超过此值触发压缩</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-context-threshold">
                ${thresholds.map((v) =>
                  `<option value="${v}" ${threshold === v ? "selected" : ""}>${v}%</option>`
                ).join("")}
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">保留最近</div>
              <div class="settings-field-desc">压缩后最少保留的完整轮次</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" id="setting-context-keep"
                value="${keep}" min="1" style="width:80px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">压缩预算</div>
              <div class="settings-field-desc">单次会话最多压缩次数</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" id="setting-context-budget"
                value="${budget}" min="0" style="width:80px;">
            </div>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  // ============================================================
  // 外观 tab
  // ============================================================

  renderAppearanceTab() {
    const cfg = this.config ?? {};
    const theme = cfg.theme || "light";
    const fontSize = cfg.fontSize || "medium";

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>外观</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主题</div>
              <div class="settings-field-desc">切换后立即生效</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-theme">
                <option value="light" ${theme === "light" ? "selected" : ""}>亮色</option>
                <option value="dark" ${theme === "dark" ? "selected" : ""}>暗色</option>
                <option value="system" ${theme === "system" ? "selected" : ""}>跟随系统</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">字体大小</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-font-size">
                <option value="small" ${fontSize === "small" ? "selected" : ""}>小</option>
                <option value="medium" ${fontSize === "medium" ? "selected" : ""}>中</option>
                <option value="large" ${fontSize === "large" ? "selected" : ""}>大</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();

    const themeSelect = document.getElementById("setting-theme");
    if (themeSelect) {
      themeSelect.addEventListener("change", () => {
        this.applyTheme(themeSelect.value);
        this.save();
      });
    }
  },

  /** 主题即时生效：通过 document.documentElement.dataset.theme 驱动 CSS。 */
  applyTheme(theme) {
    document.documentElement.dataset.theme = theme || "light";
  },

  // ============================================================
  // 开发者 tab
  // ============================================================

  renderDeveloperTab() {
    const cfg = this.config ?? {};

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>开发者</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Mock LLM</div>
              <div class="settings-field-desc">离线调试模式，不调用真实 API</div>
            </div>
            <div class="settings-field-control">
              <input type="checkbox" id="setting-mock-llm" ${cfg.mockLLM ? "checked" : ""}
                style="accent-color:var(--color-primary);">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Trace 模式</div>
              <div class="settings-field-desc">记录完整 LLM 请求/响应</div>
            </div>
            <div class="settings-field-control">
              <input type="checkbox" id="setting-trace-mode" ${cfg.traceMode ? "checked" : ""}
                style="accent-color:var(--color-primary);">
            </div>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3>版本</h3>
        <p style="color:#666;font-size:13px;" id="version-info">加载中...</p>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
    this.loadVersionInfo();
  },

  async loadVersionInfo() {
    try {
      const info = await api.app.getVersion();
      document.getElementById("version-info").textContent =
        `my-agent v${info.version} · Electron ${info.electron} · Node ${info.node}`;
    } catch {
      document.getElementById("version-info").textContent = "my-agent v0.3.0";
    }
  },

  resetDefaults() {
    if (!confirm("恢复默认设置？")) return;
    this.switchTab(this.currentTab);
  },

  // ============================================================
  // 保存
  // ============================================================

  async save() {
    const patch = this.collectCurrentTabPatch();
    if (!patch) {
      this.showToast("当前标签页没有可保存的字段");
      return;
    }
    try {
      await api.config.update(patch);
      // 同步本地缓存，便于同页回读
      this.config = { ...(this.config ?? {}), ...patch };
      this.showToast("设置已保存");
    } catch (err) {
      this.showToast("保存失败: " + err.message);
    }
  },

  /** 收集当前 tab 的所有 input/select/checkbox 值。 */
  collectCurrentTabPatch() {
    switch (this.currentTab) {
      case "models": return this.collectModelsPatch();
      case "tools": return this.collectToolsPatch();
      case "paths": return this.collectPathsPatch();
      case "context": return this.collectContextPatch();
      case "appearance": return this.collectAppearancePatch();
      case "developer": return this.collectDeveloperPatch();
      default: return null;
    }
  },

  collectModelsPatch() {
    return {
      // agent 保持 schema 完整，只覆盖 defaultModel，避免清掉其他 agent 配置
      agent: { ...(this.config?.agent ?? {}), defaultModel: this.readVal("setting-main-model", "deepseek-chat") },
      planModel: this.readVal("setting-plan-model", "deepseek-chat"),
      temperature: this.toNum(this.readVal("setting-temperature"), 0.7),
      maxTokens: this.toNum(this.readVal("setting-max-tokens"), 4096),
      requestTimeout: this.toNum(this.readVal("setting-timeout"), 120),
    };
  },

  collectToolsPatch() {
    const enabled = [];
    for (const t of this.builtinTools) {
      const el = document.getElementById("tool-" + t.name);
      if (el && el.checked) enabled.push(t.name);
    }
    return { enabledTools: enabled };
  },

  collectPathsPatch() {
    const raw = this.readVal("setting-working-dirs", "");
    const dirs = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return { workingDirs: dirs };
  },

  collectContextPatch() {
    return {
      contextCompressThreshold: this.toNum(this.readVal("setting-context-threshold"), 82),
      contextKeepRounds: this.toNum(this.readVal("setting-context-keep"), 2),
      contextBudget: this.toNum(this.readVal("setting-context-budget"), 5),
    };
  },

  collectAppearancePatch() {
    return {
      theme: this.readVal("setting-theme", "light"),
      fontSize: this.readVal("setting-font-size", "medium"),
    };
  },

  collectDeveloperPatch() {
    return {
      mockLLM: this.readChecked("setting-mock-llm", false),
      traceMode: this.readChecked("setting-trace-mode", false),
    };
  },

  // ============================================================
  // 工具方法
  // ============================================================

  readVal(id, fallback = "") {
    return document.getElementById(id)?.value ?? fallback;
  },

  readChecked(id, fallback = false) {
    const el = document.getElementById(id);
    return el ? el.checked : fallback;
  },

  toNum(v, fallback) {
    if (v === "" || v == null) return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
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

  showToast(msg) {
    let toast = document.querySelector(".toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2000);
  },
};
