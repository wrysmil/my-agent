// electron/renderer/js/pages/sessions.js
const SessionsPage = {
  sessions: [],
  selected: new Set(),
  page: 1,
  pageSize: 20,
  total: 0,

  async init() {
    this.bindEvents();
    await this.load();
  },

  bindEvents() {
    document.getElementById("sessions-search").addEventListener(
      "input",
      () => this.debounceSearch()
    );
    document.getElementById("sessions-filter-project").addEventListener(
      "change",
      () => this.load()
    );
    document.getElementById("sessions-filter-time").addEventListener(
      "change",
      () => this.load()
    );
    document.getElementById("select-all").addEventListener(
      "change",
      (e) => this.toggleSelectAll(e.target.checked)
    );
    document.getElementById("btn-batch-delete").addEventListener(
      "click",
      () => this.batchDelete()
    );
    document.getElementById("btn-batch-export").addEventListener(
      "click",
      () => this.batchExport()
    );
  },

  debounceSearch() {
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.load(), 300);
  },

  async load() {
    const search = document.getElementById("sessions-search").value.trim();
    const projectFilter = document.getElementById("sessions-filter-project").value;
    const timeFilter = document.getElementById("sessions-filter-time").value;
    try {
      const { sessions, total } = await api.sessions.list({
        search: search || undefined,
        offset: (this.page - 1) * this.pageSize,
        limit: this.pageSize,
      });
      let filtered = sessions;
      if (timeFilter) {
        filtered = this.filterByTime(sessions, timeFilter);
      }
      this.sessions = filtered;
      this.total = timeFilter ? filtered.length : total;
      this.render();
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  },

  filterByTime(sessions, filter) {
    const now = Date.now();
    const ranges = {
      today: now - 86400_000,
      week: now - 7 * 86400_000,
      month: now - 30 * 86400_000,
    };
    const since = ranges[filter];
    if (!since) return sessions;
    return sessions.filter(s => s.updatedAt >= since);
  },

  render() {
    this.renderTable();
    this.renderPagination();
    this.updateBatchBar();
  },

  renderTable() {
    const tbody = document.getElementById("sessions-tbody");
    if (this.sessions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:60px;color:#999;">
            没有匹配的会话
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = this.sessions
      .map(
        (s) => `
      <tr class="${this.selected.has(s.id) ? "selected" : ""}">
        <td class="col-checkbox">
          <input type="checkbox" data-id="${s.id}"
            ${this.selected.has(s.id) ? "checked" : ""}>
        </td>
        <td>
          <div class="session-name">${this.esc(s.name || "新对话")}</div>
        </td>
        <td>📁 —</td>
        <td>${this.esc(s.model)}</td>
        <td class="col-count">${s.messageCount}</td>
        <td class="col-tokens">${this.formatTokens(s.inputTokens + s.outputTokens)}</td>
        <td>${this.formatTime(s.updatedAt)}</td>
        <td class="col-actions">
          <button class="btn btn-icon btn-ghost row-menu" data-id="${s.id}">⋯</button>
        </td>
      </tr>`
      )
      .join("");

    tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) this.selected.add(id);
        else this.selected.delete(id);
        this.updateBatchBar();
        this.updateRowHighlight();
      });
    });

    tbody.querySelectorAll(".row-menu").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.showRowMenu(btn.dataset.id, btn);
      });
    });
  },

  renderPagination() {
    const totalPages = Math.ceil(this.total / this.pageSize);
    const el = document.getElementById("pagination-info");
    const btns = document.getElementById("pagination-btns");

    const start = (this.page - 1) * this.pageSize + 1;
    const end = Math.min(this.page * this.pageSize, this.total);
    el.textContent = `显示 ${this.total > 0 ? start : 0} - ${end} / ${this.total}`;

    let html = `<button ${this.page <= 1 ? "disabled" : ""}>‹</button>`;
    for (let i = 1; i <= totalPages && i <= 5; i++) {
      html += `<button class="${i === this.page ? "active" : ""}">${i}</button>`;
    }
    html += `<button ${this.page >= totalPages ? "disabled" : ""}>›</button>`;
    btns.innerHTML = html;

    btns.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        if (b.textContent === "‹") this.goToPage(this.page - 1);
        else if (b.textContent === "›") this.goToPage(this.page + 1);
        else this.goToPage(Number.parseInt(b.textContent));
      });
    });
  },

  goToPage(p) {
    this.page = p;
    this.load();
  },

  toggleSelectAll(checked) {
    if (checked) {
      this.sessions.forEach((s) => this.selected.add(s.id));
    } else {
      this.selected.clear();
    }
    this.render();
  },

  updateBatchBar() {
    const bar = document.getElementById("sessions-batch-bar");
    const count = document.getElementById("batch-count");
    if (this.selected.size > 0) {
      bar.classList.add("visible");
      count.textContent = `已选 ${this.selected.size} 个会话`;
    } else {
      bar.classList.remove("visible");
    }
  },

  updateRowHighlight() {
    const rows = document.querySelectorAll("#sessions-tbody tr");
    rows.forEach((row) => {
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) {
        row.classList.toggle("selected", this.selected.has(cb.dataset.id));
      }
    });
  },

  async batchDelete() {
    if (this.selected.size === 0) return;
    if (!confirm(`确定删除 ${this.selected.size} 个会话？此操作不可撤销。`)) return;

    for (const id of this.selected) {
      try {
        await api.sessions.delete(id);
      } catch (err) {
        console.error(`Failed to delete ${id}:`, err);
      }
    }
    this.selected.clear();
    await this.load();
  },

  batchExport() {
    const ids = [...this.selected].join(",");
    alert(`导出功能暂未实现。已选: ${ids}`);
  },

  showRowMenu(id, anchor) {
    const action = confirm(
      "选择操作:\n确定=删除, 取消=重命名"
    );
    if (action) {
      this.deleteSingle(id);
    } else {
      const name = prompt("新名称:");
      if (name) {
        api.sessions.rename(id, name).then(() => this.load());
      }
    }
  },

  async deleteSingle(id) {
    if (!confirm("确定删除此会话？")) return;
    await api.sessions.delete(id);
    await this.load();
  },

  formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  },

  formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;

    if (diff < 60_000) return "刚刚";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
    if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
