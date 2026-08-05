// electron/renderer/js/pages/settings.js
const SettingsPage = {
  currentTab: "models",
  config: null,
  _initialized: false,

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
      this.renderModelsTab();
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  },

  async loadProviders() {
    try {
      const providers = await api.providers.list();
      this.renderProviderCards(providers);
    } catch (err) {
      console.error("Failed to load providers:", err);
    }
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
      const iconStyle = cfg.color.startsWith("linear-gradient")
        ? `background:${cfg.color};`
        : `background:${cfg.color};`;
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

    document.getElementById("btn-save-provider").addEventListener("click", async () => {
      await api.providers.save({
        id: editId ?? undefined,
        provider: document.getElementById("pf-provider").value,
        name: document.getElementById("pf-name").value,
        apiKey: document.getElementById("pf-api-key").value,
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

  renderModelsTab() {
    const content = document.getElementById("settings-content");
    content.innerHTML = `
      <div class="settings-section">
        <h3>默认模型</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主对话模型</div>
              <div class="settings-field-desc">用于所有新建会话</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-main-model">
                <option>🧠 deepseek-chat</option>
                <option>🤖 claude-sonnet-4</option>
                <option>⚡ gpt-4o</option>
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
                <option>🧠 deepseek-chat</option>
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
              <input type="range" id="setting-temperature" min="0" max="1" step="0.1" value="0.7">
              <span class="value-display" id="temp-value">0.7</span>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Max tokens</div>
              <div class="settings-field-desc">单次回复上限</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="4096" id="setting-max-tokens" style="width:100px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">请求超时</div>
              <div class="settings-field-desc">超过此时长自动放弃</div>
            </div>
            <div class="settings-field-control">
              <select class="select" id="setting-timeout">
                <option>60 秒</option>
                <option selected>120 秒</option>
                <option>300 秒</option>
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

  renderToolsTab() {
    const tools = [
      { name: "read_file", desc: "读取文件内容，支持行范围", enabled: true },
      { name: "write_file", desc: "写入/创建文件", enabled: true },
      { name: "bash", desc: "执行 Shell 命令", enabled: true },
      { name: "grep_files", desc: "正则搜索文件内容", enabled: true },
      { name: "list_dir", desc: "列出目录结构", enabled: true },
      { name: "glob_files", desc: "通配符匹配文件名", enabled: true },
      { name: "fetch_url", desc: "HTTP GET 请求", enabled: false },
      { name: "run_skill", desc: "调用已安装的 Skill", enabled: true },
    ];

    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>内置工具启用状态</h3>
        <div class="settings-field-group">
          ${tools
            .map(
              (t, i) => `
            <div class="settings-field">
              <div>
                <div class="settings-field-label">🔧 ${t.name}</div>
                <div class="settings-field-desc">${t.desc}</div>
              </div>
              <div class="settings-field-control">
                <input type="checkbox" ${t.enabled ? "checked" : ""}
                  id="tool-${i}" style="accent-color:var(--color-primary);">
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

  renderPathsTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>路径与权限</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">工作目录白名单</div>
              <div class="settings-field-desc">Agent 只能访问以下目录</div>
            </div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <textarea class="input" rows="4" style="width:100%;font-family:monospace;font-size:12px;"
            placeholder="每行一个目录路径">D:/studyspace/project/my-agent
        D:/studyspace/源码学习/Orkas</textarea>
        </div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" id="btn-save-settings">保存设置</button>
      </div>
    `;
    this.bindEvents();
  },

  renderContextTab() {
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
              <select class="select">
                <option>70%</option>
                <option selected>82%</option>
                <option>90%</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">保留最近</div>
              <div class="settings-field-desc">压缩后最少保留的完整轮次</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="2" style="width:80px;">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">压缩预算</div>
              <div class="settings-field-desc">单次会话最多压缩次数</div>
            </div>
            <div class="settings-field-control">
              <input type="number" class="input" value="5" style="width:80px;">
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

  renderAppearanceTab() {
    document.getElementById("settings-content").innerHTML = `
      <div class="settings-section">
        <h3>外观</h3>
        <div class="settings-field-group">
          <div class="settings-field">
            <div>
              <div class="settings-field-label">主题</div>
            </div>
            <div class="settings-field-control">
              <select class="select">
                <option selected>亮色</option>
                <option>暗色</option>
                <option>跟随系统</option>
              </select>
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">字体大小</div>
            </div>
            <div class="settings-field-control">
              <select class="select">
                <option>小</option>
                <option selected>中</option>
                <option>大</option>
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
  },

  renderDeveloperTab() {
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
              <input type="checkbox" style="accent-color:var(--color-primary);">
            </div>
          </div>
          <div class="settings-field">
            <div>
              <div class="settings-field-label">Trace 模式</div>
              <div class="settings-field-desc">记录完整 LLM 请求/响应</div>
            </div>
            <div class="settings-field-control">
              <input type="checkbox" style="accent-color:var(--color-primary);">
            </div>
          </div>
        </div>
      </div>
      <div class="settings-section">
        <h3>版本</h3>
        <p style="color:#666;font-size:13px;" id="version-info">加载中...</p>
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

  async save() {
    try {
      await api.config.update({
        temperature: Number.parseFloat(
          document.getElementById("setting-temperature")?.value ?? "0.7"
        ),
        maxTokens: Number.parseInt(
          document.getElementById("setting-max-tokens")?.value ?? "4096"
        ),
      });
      this.showToast("设置已保存");
    } catch (err) {
      this.showToast("保存失败: " + err.message);
    }
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
