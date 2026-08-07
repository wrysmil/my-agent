# 仿写 Agent 前端框架 — 从零构建指南

基于 Orkas `src/renderer/` 架构，从原生 HTML/CSS/JS 逐步构建一个完整的 Agent 前端 UI 系统。

> **与后端指南的关系：** 后端指南 ([仿写Agent框架指南.md](./仿写Agent框架指南.md)) 聚焦 `core-agent` 运行时的 Provider/Session/Runner/Tools。本指南聚焦 **Renderer 进程**的 UI 架构：如何用经典 script 标签构建 Agent/Skill/聊天管理界面，以及如何通过 IPC 与 Main 进程通信。

## 学习策略

**逐个模块边学边做，不要全看完再动手。**

- Renderer 代码量约 20000+ 行（11 个核心模块），一次读完会迷失在细节中
- 依赖关系天然决定顺序：底层写完就能在浏览器里看到效果
- 动手写暴露理解漏洞：看源码觉得懂了，一写就卡住
- 即时正反馈：每个模块都有可见的 UI 产出

**每个模块的节奏：**

1. 读 Orkas 源码（30-60 分钟）
2. 关掉源码，凭理解自己写（1-2 小时）
3. 在浏览器中打开，对比交互效果

## 项目骨架

```bash
mkdir my-agent-ui && cd my-agent-ui
# 无需 npm install！前端只用经典 HTML/CSS/JS
```

```
my-agent-ui/
├── index.html              # 入口（加载所有 script 标签）
├── style.css               # 全局样式
├── js/
│   ├── vendor/             # 第三方库（手动放入）
│   │   └── dompurify/      # XSS 防护
│   ├── shared/
│   │   ├── i18n.js         # 国际化（同步启动 + 异步回退）
│   │   ├── icons.js        # SVG 图标系统
│   │   ├── utils.js        # escapeHtml / pickDesc / safeHref
│   │   └── logger.js       # 渲染进程日志（经 IPC 转发主进程）
│   ├── ipc/
│   │   ├── preload.js      # contextBridge 白名单 API
│   │   └── ipc-shim.js     # HTTP→IPC 路由垫片
│   ├── state/
│   │   └── state.js        # 全局状态 + 视图切换
│   ├── components/
│   │   ├── dialogs.js      # 对话框/确认/选择器
│   │   ├── sidebar.js      # 侧边栏导航 + 拖拽调整大小
│   │   ├── context-menu.js # 右键菜单
│   │   └── chat-input-form.js # 动态表单渲染
│   ├── features/
│   │   ├── agents.js       # Agent 列表/详情/编辑
│   │   ├── skills.js       # Skill 列表/详情/文件树
│   │   ├── chat.js         # 聊天消息渲染 + 流式 + 轮询
│   │   ├── chat-use.js     # Skill/Connector 内联芯片
│   │   ├── marketplace.js  # 市场浏览/安装
│   │   ├── local-agents.js # 外部 CLI Agent 集成
│   │   ├── settings.js     # 设置面板
│   │   └── projects.js     # 项目管理
│   └── app.js              # 启动入口（boot sequence）
└── locales/
    ├── zh.json
    ├── en.json
    └── ja.json
```

## 完整依赖图

```
                    ┌──────────────────────┐
                    │      app.js          │  ← 三阶段启动流水线
                    │   (boot sequence)    │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
   ┌──────┴──────┐   ┌────────┴────────┐   ┌───────┴───────┐
   │  features/  │   │  components/    │   │    ipc/       │
   │  agents.js  │   │  dialogs.js     │   │  preload.js   │
   │  skills.js  │   │  sidebar.js     │   │  ipc-shim.js  │
   │  chat.js    │   │  chat-form.js   │   └───────┬───────┘
   │  marketplace│   └────────┬────────┘           │
   └──────┬──────┘            │                    │
          │                   │                    │
          └───────────────────┼────────────────────┘
                              │
                      ┌───────┴───────┐
                      │    state/     │  ← 全局状态 + 视图切换
                      │   state.js    │
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │   shared/     │  ← i18n / icons / utils / logger（零依赖）
                      └───────┬───────┘
                              │
                      ┌───────┴───────┐
                      │   vendor/     │  ← DOMPurify（XSS 防护）
                      └───────────────┘
```

**关键约束（来自 CLAUDE.md §Renderer）：**

- 只用经典 scripts。每个 `.js` 文件通过 `<script>` 标签装入 `index.html`。
- 不用 TypeScript/JSX/bundler；模块间通过**全局变量**（顶层 `let`/`const`/`function`）通信。
- Renderer 只能通过 `window.orkas.{invoke, stream}` 访问 Main 进程。
- 第三方 JS 放在 `vendor/`，不走 npm。
- Markdown 渲染使用 `renderMarkdown`。
- 图标集中在 `icons.js`，不要硬编码 SVG 路径或使用 emoji。

---

# 📐 仿写路线图：从小到大

---

## 第一阶段：基础积木（零依赖 UI 模块）

这些模块不依赖 IPC 或任何业务逻辑，可以独立仿写并在浏览器中直接测试。

**第一阶段模块总览：**

```
js/shared/
├── i18n.js    ← 同步启动 + 异步回退 + DOM 绑定 + 语言切换
├── icons.js   ← SVG 图标系统 + 文件类型图标 + 扩展名分类
├── utils.js   ← escapeHtml / pickDesc / safeHref / normalizeDisplayText
└── logger.js  ← 分级日志（经 IPC 转发主进程，降级为 console）

js/state/
└── state.js   ← currentView / currentCid / conversations 全局状态
```

| #   | 模块           | 产出文件            | 你需要定义的 |
| --- | -------------- | ------------------- | ------------ |
| 1.1 | HTML 骨架      | `index.html`        | 应用容器（侧边栏 + 主内容区多面板）、`<script>` 标签加载顺序、`data-i18n` 属性绑定 |
| 1.2 | 图标系统       | `js/shared/icons.js` | `UI_ICONS` 字典（50+ SVG 图标）、`uiIconHtml(name)`、`fileIconHtml(filename)`、扩展名分类 Set |
| 1.3 | 国际化 i18n    | `js/shared/i18n.js` | `t(key, vars)` 翻译函数、`getLang()`/`setLang(lang)`、同步启动 `__orkasI18nBoot` 预加载、`applyDomI18n()` DOM 扫描、`i18n-change` 事件 |
| 1.4 | 工具函数       | `js/shared/utils.js` | `escapeHtml()`、`pickLocalizedField()`、`pickDesc()`、`normalizeDisplayText()`、`_SAFE_URI_RE` |
| 1.5 | 全局状态管理   | `js/state/state.js` | `currentView`、`currentCid`、`conversations[]`、`setView(view, cid)`、`pendingConvs` Map、`messageQueues` Map |

### 1.1 HTML 骨架与样式体系

**对应源码：** `src/renderer/index.html`（~1200 行）、`src/renderer/style.css`

**仿写要点：**

- 两栏布局：侧边栏 (`aside.sidebar`) + 主内容区 (`main.main-content`)
- 主内容区包含多个面板 (`section.panel`)，通过 `classList.toggle('active')` 切换
- 侧边栏包含：Logo、搜索按钮、导航按钮（Commander/Agents/Skills/Connectors/Library/Apps）、项目列表、会话列表、设置按钮、拖拽调整大小手柄
- 所有文本使用 `data-i18n` 属性标记，由 `applyDomI18n()` 在启动时填充

**HTML 骨架结构：**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>My Agent</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div class="app-container">
    <aside class="sidebar">
      <div class="sidebar-logo">...</div>
      <div class="sidebar-actions">
        <button data-i18n="sidebar.new_chat">Commander</button>
        <button data-i18n="sidebar.agents">Agents</button>
        <button data-i18n="sidebar.skills">Skills</button>
        ...
      </div>
      <div class="sidebar-conversation-nav">
        <div class="projects-list" id="projects-list"></div>
        <div class="conversation-list" id="conversation-list"></div>
      </div>
      <div class="sidebar-resize-handle"></div>
    </aside>
    <main class="main-content">
      <section class="panel active" id="panel-new-chat">...</section>
      <section class="panel" id="panel-conversation">...</section>
      <section class="panel" id="panel-agents">...</section>
      <section class="panel" id="panel-skills">...</section>
      <section class="panel" id="panel-settings">...</section>
      ...
    </main>
  </div>
  <!-- vendor -->
  <script src="./js/vendor/dompurify/purify.min.js"></script>
  <!-- shared（按依赖顺序） -->
  <script src="./js/shared/logger.js"></script>
  <script src="./js/shared/icons.js"></script>
  <script src="./js/shared/utils.js"></script>
  <script src="./js/shared/i18n.js"></script>
  <!-- state -->
  <script src="./js/state/state.js"></script>
  <!-- components -->
  <script src="./js/components/dialogs.js"></script>
  <script src="./js/components/sidebar.js"></script>
  ...
  <!-- features（按依赖顺序） -->
  <script src="./js/features/chat-use.js"></script>
  <script src="./js/features/chat.js"></script>
  <script src="./js/features/agents.js"></script>
  <script src="./js/features/skills.js"></script>
  ...
  <!-- app 入口（最后加载，依赖以上全部） -->
  <script src="./js/app.js"></script>
</body>
</html>
```

**关键设计决策：**

- **`<script>` 标签顺序即依赖顺序。** 没有模块系统，后加载的文件可以访问先加载文件定义的全局变量。
- **面板切换用 CSS `display`。** `section.panel { display: none; }` / `section.panel.active { display: flex; }` — 简单高效，隐藏面板不占用布局计算。
- **`data-i18n` 属性在 DOM 解析后、首次绘制前填充。** 通过 preload 的 `sendSync` 同步获取翻译表，避免语言闪烁。

### 1.2 图标系统

**对应源码：** `src/renderer/modules/icons.js`（~300 行）

**仿写要点：**

- 所有图标集中在一个 `UI_ICONS` 字典中，SVG path 数据为值
- 通过 `uiIconHtml(name, className)` 函数按需渲染内联 SVG
- 文件类型图标通过扩展名分类自动选择（`fileIconHtml(filename)`）
- 不要在任何其他模块中硬编码 SVG 路径或使用 emoji 作为图标

**核心结构：**

```js
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  // 文件扩展名分类
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico']);
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv']);
  const CODE_EXTS = new Set([
    'py', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'sh', 'bash',
    'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'sql', ...
  ]);
  const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'xml', ...]);
  const SPREADSHEET_EXTS = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'tsv']);
  const PRESENTATION_EXTS = new Set(['pptx', 'pptm', 'ppt']);
  const ARCHIVE_EXTS = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar']);

  // 统一图标渲染
  function wrapUiIcon(name, inner, className) {
    const cls = `${className || 'ui-icon'} is-${name}`;
    return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16"
      fill="none" stroke="currentColor" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  // UI 图标字典（50+ 图标，按字母序排列）
  const UI_ICONS = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
    'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7..."></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6..."></path>',
    sparkles: '<path d="M12 3l1.4 3.6L17 8l-3.6 1.4..."></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15..."></path>',
    terminal: '<path d="m8 8 4 4-4 4"></path><path d="M14 16h4"></path>...',
    x: '<path d="M18 6 6 18M6 6l12 12"></path>',
    trash: '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path>...',
    // ... 50+ 图标
  };

  // 文件图标选择逻辑
  function _fileKindIconClass(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (SPREADSHEET_EXTS.has(ext)) return 'spreadsheet';
    if (PRESENTATION_EXTS.has(ext)) return 'presentation';
    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    if (CODE_EXTS.has(ext)) return 'code';
    if (DATA_EXTS.has(ext)) return 'data';
    if (TEXT_EXTS.has(ext)) return 'text';
    return 'file';
  }

  // 对外暴露（挂到 window 上供其他模块使用）
  root.uiIconHtml = function(name, className) {
    const inner = UI_ICONS[name];
    if (!inner) return '';
    return wrapUiIcon(name, inner, className);
  };

  root.fileIconHtml = function(filename) {
    const kind = _fileKindIconClass(filename);
    return `<svg class="chat-file-kind-icon is-${kind}" ...>${FILE_KIND_ICONS[kind]}</svg>`;
  };
})();
```

### 1.3 国际化 i18n

**对应源码：** `src/renderer/modules/i18n.js`（~200 行）

**仿写要点：**

- **同步优先路径：** preload.js 在 DOM 脚本运行前通过 `ipcRenderer.sendSync('orkas:bootI18n')` 获取翻译表和语言偏好，挂到 `window.__orkasI18nBoot`。i18n 模块通过 IIFE 在加载时同步读取并立即调用 `applyDomI18n()`，确保首次绘制前 DOM 已翻译。
- **异步回退路径：** 如果 preload 不可用，`initI18n()` 走异步 IPC 获取翻译表。
- **`t(key, vars?)` 函数：** 查翻译表 → 变量插值 → 回退到 key 本身。
- **`i18n-change` 事件：** 语言切换时 `setLang()` 触发 `window.dispatchEvent(new Event('i18n-change'))`，各模块监听后重新渲染动态内容。
- **`applyDomI18n(root?)`：** 遍历 DOM，填充 `[data-i18n]`（textContent）、`[data-i18n-title]`（title 属性）、`[data-i18n-placeholder]`（placeholder 属性）。

**核心结构：**

```js
let _currentLang = 'en';
let _tables = {};      // { en: { key: "value", ... }, zh: { ... } }
let _ready = false;

const _LOCALES = [
  { code: 'zh', label: '简体中文', htmlLang: 'zh-CN', fallback: 'en' },
  { code: 'en', label: 'English',   htmlLang: 'en',    fallback: null },
  { code: 'ja', label: '日本語',     htmlLang: 'ja',    fallback: 'en' },
];

// ── 同步启动 IIFE ──
(function _bootSyncI18n() {
  const boot = window.__orkasI18nBoot;
  if (!boot || !boot.tables) return; // preload 不可用 → 走异步
  if (isSupportedLang(boot.lang)) _currentLang = boot.lang;
  _tables = boot.tables || {};
  _ready = true;
  applyDomI18n();                     // 立刻填充所有 [data-i18n] 元素
  _setDocumentLang(_currentLang);
})();

// ── 异步初始化（回退路径） ──
async function initI18n() {
  if (_ready) return;
  const [lang, tables] = await Promise.all([
    window.orkas.getLanguage(),
    window.orkas.getLocales(),
  ]);
  if (isSupportedLang(lang)) _currentLang = lang;
  _tables = tables || {};
  _ready = true;
  applyDomI18n();
  _setDocumentLang(_currentLang);
}

// ── 翻译函数 ──
function t(key, vars) {
  // 1. 沿 fallback 链查翻译表
  for (const lang of fallbackChain(_currentLang)) {
    const v = _lookup(key, lang);
    if (v !== undefined) return _interpolate(v, vars);
  }
  // 2. 回退到 key 本身
  return _interpolate(key, vars);
}

// ── DOM 扫描 ──
function applyDomI18n(root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

// ── 语言切换 ──
async function setLang(lang) {
  if (!isSupportedLang(lang) || lang === _currentLang) return;
  _currentLang = lang;
  await window.orkas.setLanguage(lang); // 持久化到主进程
  applyDomI18n();
  _setDocumentLang(lang);
  window.dispatchEvent(new Event('i18n-change')); // 通知所有动态模块重渲染
}
```

**为什么 `sendSync` 可以接受：** `sendSync` 会阻塞渲染进程约 1-2ms（一次本地 IPC 往返），换来零语言闪烁的首次绘制。如果 preload 崩溃，异步路径仍可用——此时用户可能看到英文占位符闪现一次。

### 1.4 工具函数

**对应源码：** `src/renderer/modules/utils.js`（~250 行）

**仿写要点：**

- `escapeHtml(str)` — XSS 防护的第一道防线。所有用户/模型生成的文本在插入 DOM 前必须转义。
- `pickLocalizedField(obj, base, lang)` — 按语言链选择双语字段（`description_zh` / `description_en`）。
- `pickDesc(spec, lang)` — 为 agent/skill 选择当前语言的描述。
- `_SAFE_URI_RE` — URL 白名单正则。只允许 `https?`、`mailto`、`tel` 以及应用特权 scheme（`chat-media`、`chat-app`、`kb-file`）。
- `normalizeDisplayText(value)` — 清理多余空格、反转义引号。

**核心函数：**

```js
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pickLocalizedField(obj, base, lang, fallbackLang = 'en') {
  if (!obj || !base) return '';
  const cur = (lang || '').split(/[-_]/)[0] || 'en';
  const candidates = [`${base}_${cur}`, `${base}_${fallbackLang}`, `${base}_en`, `${base}_zh`, base];
  const seen = new Set();
  for (const key of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    const v = obj[key];
    if (v !== null && v !== undefined && String(v).trim()) return normalizeDisplayText(v);
  }
  return '';
}

// 安全 URI 白名单：https? / mailto / tel / 应用特权 scheme / 相对路径
const _SAFE_URI_RE = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|chat-media|chat-app|kb-file|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
```

### 1.5 全局状态管理

**对应源码：** `src/renderer/modules/state.js`（~400 行）

**仿写要点：**

- 不使用 Redux/Vuex/任何框架。所有状态是**模块级顶层变量**，各模块通过全局作用域直接读写。
- `currentView` — 当前激活的面板（`'new-chat'` / `'conversation'` / `'agents'` / `'skills'` / `'settings'` / ...）
- `currentCid` — 当前会话 ID，null 表示新聊天
- `conversations[]` — 会话列表（侧边栏数据源）
- `pendingConvs` Map — 每个 cid 的挂起状态（loading 元素、abort controller）
- `messageQueues` Map — 每个 cid 的排队消息（FIFO 顺序发送）
- `setView(view, cid, opts)` — 视图切换的核心函数

**核心结构：**

```js
let currentUserId = '';
let currentView = 'new-chat';   // 'new-chat' | 'conversation' | 'agents' | 'skills' | ...
let currentCid = null;
let conversations = [];

// 每个会话的挂起状态
const pendingConvs = new Map(); // cid → { loadingEl, controller, aborted }
const groupBusyConvs = new Map(); // cid → true (群聊运行时)

// 每个会话的排队消息
const messageQueues = new Map(); // cid → [{ id, content, skill }, ...]

// ── 视图切换 ──
function setView(view, cid, opts = {}) {
  const prev = currentView;
  currentView = view;
  currentCid = cid || null;

  // 1. 切换面板可见性
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panelId = _viewToPanelId(view);
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');

  // 2. 高亮侧边栏按钮
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`${view}-btn`);
  if (btn) btn.classList.add('active');

  // 3. 持久化最后视图（localStorage）
  _saveLastView(view, cid);

  // 4. 按需加载功能模块
  if (view === 'agents') _loadViewFeature('agents', view, renderAgentsList);
  if (view === 'skills') _loadViewFeature('skills', view, renderSkillsList);
  // ...
}
```

**设计要点：**

- **消息队列，非并发发送。** `messageQueues` 按 cid 隔离，同一会话的消息 FIFO 顺序发送——下一条在上一条的流完成后才发出。
- **`pendingConvs` 追踪加载/中止。** 每个 cid 保存 `{ loadingEl, controller, aborted }` — 支持"停止生成"按钮和 UI 加载态。
- **视图切换触发按需加载。** 不是所有功能都在启动时加载，通过 `loadRendererFeature` 懒加载。

---

## 第二阶段：通信层（IPC）

Renderer 不能直接访问 Node.js API。所有与 Main 进程的通信通过 `contextBridge` 暴露的白名单 API `window.orkas`。

### 2.1 contextBridge 白名单 API（preload.js）

**对应源码：** `src/main/preload.js`（~200 行）

**仿写要点：**

- 在 `contextBridge.exposeInMainWorld('orkas', api)` 中只暴露最小、显式白名单 API。
- `invoke(channel, payload)` → 请求/响应模式，内部调用 `ipcRenderer.invoke`。
- `stream(channel, payload, onEvent)` → SSE 风格流，返回 `{ promise, cancel }`。
- `onPushEvent(channel, handler)` → 主进程发起的广播订阅（如 `bash:`、`bridge:` 权限请求）。
- **同步 i18n 启动**：`ipcRenderer.sendSync('orkas:bootI18n')` 在 DOM 脚本运行前获取翻译表。

**核心 API 表面：**

```js
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// ── 同步 i18n 预加载 ──
let _i18nBoot = null;
try {
  const res = ipcRenderer.sendSync('orkas:bootI18n');
  if (res && res.ok) _i18nBoot = { lang: res.lang, tables: res.tables };
} catch (_) { /* 回退到异步路径 */ }

contextBridge.exposeInMainWorld('__orkasI18nBoot', _i18nBoot);

// ── 白名单 API ──
contextBridge.exposeInMainWorld('orkas', {
  // 请求/响应
  invoke: (channel, payload) =>
    ipcRenderer.invoke('orkas.invoke', { channel, payload: payload || {} }),

  // SSE 风格流，返回 { promise, cancel }
  stream: function(channel, payload, onEvent) {
    const requestId = _nextRequestId();
    const channelKey = `stream:${requestId}`;
    let settled = false, cancelled = false;

    const promise = new Promise((resolve, reject) => {
      const listener = (_evt, ev) => {
        if (!ev || settled) return;
        if (ev.type === 'done') {
          settled = true;
          ipcRenderer.removeListener(channelKey, listener);
          cancelled ? reject(new Error('stream cancelled'))
                    : resolve();
          return;
        }
        try { onEvent(ev); }
        catch (err) { settled = true; ipcRenderer.removeListener(channelKey, listener); reject(err); }
      };
      ipcRenderer.on(channelKey, listener);
      ipcRenderer.send('orkas.streamStart', { requestId, channel, payload });
    });

    const cancel = () => {
      if (settled || cancelled) return;
      cancelled = true;
      ipcRenderer.send('orkas.streamCancel', requestId);
    };
    return { promise, cancel };
  },

  // 主进程发起的推送事件（权限请求、状态更新）
  onPushEvent: function(channel, handler) {
    if (!_isAllowedPushChannel(channel))
      throw new Error(`push channel not allowed: ${channel}`);
    const listener = (_evt, payload) => { try { handler(payload); } catch(_) {} };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // 便利方法
  ping: () => ipcRenderer.invoke('orkas.ping'),
  env: () => ipcRenderer.invoke('orkas.env'),
  getLanguage: () => ipcRenderer.invoke('config.getLanguage'),
  setLanguage: (lang) => ipcRenderer.invoke('config.setLanguage', { language: lang }),
  getLocales: () => ipcRenderer.invoke('config.getLocales'),
  recycleBin: { list, restore, delete },
  quality: { readSkillReport, readAgentReport },
});

// ── 推送事件频道白名单 ──
const PUSH_EVENT_PREFIXES = [
  'marketplace:', 'conversations:', 'connectors:',
  'client-config:', 'delete_file.', 'bridge:', 'bash:'
];
```

**设计要点：**

- **用 `{promise, cancel}` 而不是 `AbortSignal`。** 在 `sandbox` + `contextIsolation` 下，跨 `contextBridge` 的对象原型链会被剥掉，`AbortSignal` 的 `addEventListener` 丢失。普通函数可安全跨上下文克隆。
- **推送频道白名单。** `onPushEvent` 只接受以 `PUSH_EVENT_PREFIXES` 开头的频道，防止渲染进程窃听任意内部 IPC 流量。
- **`invoke` 的 `log.record` 通道**即发即弃——日志失败不破坏用户交互。

### 2.2 IPC 路由垫片（ipc-shim.js）

**对应源码：** `src/renderer/modules/ipc-shim.js`（~333 行）

**仿写要点：**

- 原始应用通过 HTTP 提供，每个网络调用经过 `apiFetch(url, options)` 包装 `fetch`。Electron 化后，垫片将 URL + method 转换为 IPC 通道 + 有效负载，返回类 Response 对象。
- 路由表 `_IPC_ROUTES` 是核心：每个条目 = `[method, pathMatcher, channel, paramKeys?, opts?]`。
- `pathMatcher` 支持精确字符串匹配和 RegExp（带捕获组 → paramKeys）。

**路由表结构（精简示例）：**

```js
const _IPC_ROUTES = [
  // 精确路由
  ['GET',  '/api/auth/status',           { fake: { ok: true, authenticated: true } }],
  ['GET',  '/api/agents/list',           'agents.list'],
  ['POST', '/api/agents/create',         'agents.create'],
  ['GET',  '/api/skills/list',           'skills.list'],
  ['POST', '/api/conversations/create',  'conversations.create'],

  // 模式路由（带路径参数）
  ['GET',  /^\/api\/agents\/([^/]+)$/,                    'agents.get',        ['agent_id']],
  ['PUT',  /^\/api\/agents\/([^/]+)\/update$/,            'agents.update',     ['agent_id'], { wrapAsUpdates: true }],
  ['POST', /^\/api\/agents\/([^/]+)\/chat\/send\/stream$/, 'agents.chat.sendStream', ['id'], { stream: true }],
  ['POST', /^\/api\/conversations\/([^/]+)\/send$/,       'groupChat.send',    ['cid']],
  ['POST', /^\/api\/conversations\/([^/]+)\/abort$/,      'groupChat.abort',   ['cid']],

  // 文件上传特殊处理
  ['POST', /^\/api\/conversations\/([^/]+)\/attachments\/upload$/, { upload: 'conversations.attachments.upload' }, ['cid']],
];

function _matchRoute(method, pathname) {
  for (const entry of _IPC_ROUTES) {
    const [m, matcher, channel, paramKeys, opts] = entry;
    if (m !== method) continue;
    if (typeof matcher === 'string') {
      if (matcher === pathname) return { channel, opts };
    } else if (matcher instanceof RegExp) {
      const match = pathname.match(matcher);
      if (match) {
        const params = {};
        if (paramKeys) paramKeys.forEach((k, i) => { params[k] = match[i + 1]; });
        return { channel, opts, params };
      }
    }
  }
  return null;
}

// ── 核心 apiFetch 替换 ──
async function apiFetch(url, options = {}) {
  const { pathname } = new URL(url, 'http://localhost');
  const method = (options.method || 'GET').toUpperCase();
  const route = _matchRoute(method, pathname);
  if (!route) throw new Error(`No IPC route for ${method} ${pathname}`);

  // 处理特殊情况
  if (route.channel && typeof route.channel === 'object') {
    if (route.channel.fake) return _fakeResponse(route.channel.fake);
    if (route.channel.upload) return _uploadRequest(route, options);
  }

  // 合并参数
  const payload = { ...(options.body ? JSON.parse(options.body) : {}), ...(route.params || {}) };

  // 流或普通请求
  if (route.opts && route.opts.stream) {
    return _streamRequest(route.channel, payload);
  }
  return _invokeRequest(route.channel, payload, route.opts);
}
```

**设计要点：**

- **认证完全消失。** 本地 IPC 建立了信任，`X-Access-Password` header 变成无操作。`/api/auth/status` 始终返回 `{ authenticated: true }`。
- **`fake` 通道**用于不需要主进程参与的请求（如认证状态检查）。
- **`upload` 通道**需要特殊处理（FormData → 文件路径）。

### 2.3 流式通信

**仿写要点：**

- 聊天消息发送是流式的：`stream(channel, payload, onEvent)` → 每收到一个 SSE 形态事件，回调 `onEvent(ev)`。
- 流事件类型：`text_delta`（增量文本）、`tool_use`（工具调用）、`tool_result`（工具结果）、`message_end`（消息结束）、`error`（错误）。
- `cancel()` 可中止进行中的流——用户点击"停止"按钮时调用。
- 流通过 `{ promise, cancel }` 模式管理——`promise` 在流正常结束时 resolve，`cancel()` 时 reject。

### 2.4 推送事件与 Bridge 权限

**对应源码：** `src/renderer/modules/bridge.js`（~63 行）

**仿写要点：**

- 主进程通过 `webContents.send` 向渲染进程推送事件（如 `bridge:permission`、`bash:permission`、`delete_file.confirm`）。
- Bridge 权限队列 FIFO ——两个并发 CLI 运行不会重叠堆叠对话框。
- `onPushEvent` 订阅生命周期与渲染进程一致，无应答（用户关闭对话框或走开）导致主进程侧超时拒绝。

---

## 第三阶段：UI 组件体系

### 3.1 对话框与确认

**对应源码：** `src/renderer/modules/dialogs.js`

**仿写要点：**

- `uiChoice({ title, message, choices, cancelLabel })` — 多选对话框，返回 Promise。
- `uiConfirm({ title, message, confirmLabel, cancelLabel })` — 二选一确认框。
- `uiAlert({ title, message })` — 单按钮提示框。
- 所有对话框共享同一个 overlay 层，叠加时 FIFO 显示（一次只有一个对话框）。
- **对话框 HTML 动态创建和销毁**，不是预先放在 index.html 中。

### 3.2 动态表单渲染（chat-input-form.js）

**对应源码：** `src/renderer/modules/chat-input-form.js`

**仿写要点：**

- Agent 可通过 `ChatFormPayload` 向用户请求结构化输入。
- 表单字段类型支持：`text`、`number`、`textarea`、`select`、`checkbox`、`radio`。
- 表单在聊天气泡内渲染（非弹窗），提交后转为只读展示。
- 未提交的草稿保留在内存 Map 中，切换会话再回来不会丢失。

### 3.3 侧边栏系统

**对应源码：** `src/renderer/modules/sidebar-resize.js`、`boot.js`（侧边栏部分）

**仿写要点：**

- **拖拽调整宽度**：`mousedown` 在 resize handle 上启动 → `mousemove` 更新 `--sidebar-width` CSS 变量 → `mouseup` 停止并持久化到 localStorage。
- **双击重置**：双击 resize handle 恢复默认宽度。
- **会话桶分组**：会话列表按日期分组（Today / Yesterday / 日期），在午夜自动刷新分组。
- **项目列表**：项目通过目录扫描获取，按钮高亮当前活动项目。

### 3.4 上下文菜单

**对应源码：** `src/renderer/modules/context-menu.js`

**仿写要点：**

- 自定义右键菜单，替换浏览器默认菜单。
- 位置计算确保菜单不溢出视口（`getBoundingClientRect` 边界检测）。
- 点击外部或按 Escape 关闭。

---

## 第四阶段：Agent 与 Skill 管理

这是前端最核心的业务模块。Agent 管理约 4000 行代码，Skill 管理约 2865 行。

### 4.1 Agent 管理（列表/详情/编辑）

**对应源码：** `src/renderer/modules/agents.js`（~4004 行）

**仿写要点：**

- **三栏布局**：Agent 列表（左）→ 详情（中）→ 内联编辑聊天（右）
- **两级缓存**：
  - `_agentsCache` — 摘要缓存（仅名称/头像，用于 @-mention 和侧边栏）
  - `_agentsCacheIsSummary` — 标记缓存是否为摘要；进入 Agents 选项卡时升级为完整列表
- **数据来源**：`window.orkas.invoke('agents.list')` → 主进程 `features/agents.ts` → cloud/marketplace 合并
- **Agent 卡片**：显示名称、描述（双语按语言选择）、分类标签、版本号、来源标记（平台/自定义/外部CLI）
- **详情面板**：Profile、Workflow steps、Memory 条目、关联 Skills、运行时统计
- **内联编辑**：直接在详情面板修改字段，自动保存（debounce 定时器）

**关键函数映射：**

```js
// 数据加载
async function loadAgents(force, opts)    // force=true 跳过缓存；opts.summary=true 仅摘要
async function _refreshAgent(agentId)    // 单个 Agent 刷新

// 渲染
function renderAgentList(agents)         // 左栏网格
function renderAgentDetail(agent)        // 中栏详情
function _renderAgentProfile(agent)      // Profile 区域
function _renderAgentWorkflow(agent)     // Workflow steps
function _renderAgentSkills(agent)       // 关联 Skills 列表

// 编辑
async function _saveAgentField(agentId, field, value)  // 自动保存
async function _updateAgentSpec(agentId, updates)      // spec 更新
```

**Agent 来源标记：**

```js
function _agentSource(source) {
  // 'marketplace' → 平台内置
  // 'custom' → 用户自定义
  // 其他 → 外部 CLI agent
}

function _isExternalCliAgent(agent) {
  return !!(agent && agent.runtime && agent.runtime.kind === 'cli');
}
```

### 4.2 Skill 管理（列表/详情/文件树）

**对应源码：** `src/renderer/modules/skills.js`（~2865 行）

**仿写要点：**

- **两级列表**：
  - `_skillsCache` — 完整 Skill 列表（卡片网格）
  - `_openSkillsCache` — 只读开放层条目（外部包呈现为包卡片）
- **详情面板**：
  - SKILL.md 渲染（frontmatter 解析 + Markdown 正文）
  - 源文件树视图（可展开/折叠目录）
  - 文件选中后在详情区渲染内容
- **自定义覆盖平台**：同 id 的 custom skill shadow marketplace skill；同展示名不同 id 共存。
- **i18n-change 重新渲染**：监听 `window.addEventListener('i18n-change', ...)`，语言切换时重新选择描述字段并重新渲染卡片。
- **树缓存失效**：Commander 通过 `<<<skill-file>>>` 编辑文件后，`invalidateSkillTreeCacheFor(skillId)` 清缓存。

**关键函数映射：**

```js
// 数据加载
async function loadSkills(force)         // force=true 跳过缓存
async function refreshSkillsAfterMarketplaceReconcile()

// 渲染
function renderSkillsGrid(skills)        // 卡片网格
async function selectSkillFile(source, id, filepath, nodeEl)  // 查看文件
async function expandSkillTree(source, id, treeEl)            // 展开目录

// 树缓存
function invalidateSkillTreeCacheFor(skillId)
```

**Skill 卡片元数据 HTML：**

```js
function _skillCardChipsHtml(s) {
  const parts = [];
  if (s.version) parts.push(`<span class="skill-card-chip is-version">v${s.version}</span>`);
  const catLabel = _resolveCategoryLabel(s.category);
  if (catLabel) parts.push(`<span class="skill-card-chip">${catLabel}</span>`);
  return parts.join('');
}
```

### 4.3 外部 Agent（CLI）集成

**对应源码：** `src/renderer/modules/local-agents.js`（~600 行）

**仿写要点：**

- 支持多种 CLI Agent：Claude Code、Codex、OpenClaw、OpenCode、Hermes。
- **`CLI_DEFAULTS`** 字典定义每种 CLI 的默认 name、双语 description、`isCoding` 标记。
- **检测时机**：当用户打开"外部 Agent"选择器或运行时选择器时才检测，不在启动时预加载。
- **两个使用面**：
  1. Agent 编辑模式"external"选项卡 — 选择器列出已检测的 CLI
  2. Agent 详情运行时选择器 — 对已有 CLI 绑定 Agent 显示轻量列表

### 4.4 市场浏览与安装

**对应源码：** `src/renderer/modules/marketplace.js`（~1500 行）

**仿写要点：**

- **双标签切换**：Agents 网格 ↔ Skills 网格
- **类别芯片条**：从 marketplace API 获取类别列表，三级缓存（渲染器内存 → localStorage → 主进程文件）
- **详情页**：每个 item 的完整内容 + 安装/卸载按钮
- **安装流程**：`installAgent(id)` / `installSkill(id)` → 主进程下载并物化到 `local/marketplace/` → 刷新本地列表
- **仅开发模式上传**：通过 `body.is-dev` class 判断是否显示上传/编辑菜单

---

## 第五阶段：聊天系统

聊天系统是整个应用的核心交互面，约 11215 行的 `conversation.js` 是其主模块。

### 5.1 会话列表与导航

**仿写要点：**

- 会话列表从 `conversations[]` 全局状态渲染
- **日期桶分组**：Today / Yesterday / 具体日期。桶在午夜自动刷新。
- **内联重命名**：点击会话标题进入编辑模式，Enter 提交，Escape 取消
- **删除确认**：走 `delete-file-confirm.js` 订阅——主进程 `delete_file` 工具触发确认卡片，渲染进程渲染确认 UI

### 5.2 消息发送与流式渲染

**这是聊天系统最核心的流程。**

```
用户输入 → sendMessage(cid, text)
  │
  ▼
apiFetch POST /api/conversations/:cid/send  (stream: true)
  │
  ├─ 主进程 → group_chat/bus.ts → enqueue
  │            → AgentRunner.runStream()
  │            → webContents.send('stream:<requestId>', ev)
  │
  ▼
渲染进程 onEvent(ev):
  ├─ ev.type === 'text_delta'      → 增量追加到消息气泡
  ├─ ev.type === 'tool_use'        → 渲染工具调用卡片
  ├─ ev.type === 'tool_result'     → 渲染工具结果（可能折叠）
  ├─ ev.type === 'message_end'     → 标记消息完成，触发下一条排队消息
  └─ ev.type === 'error'           → 渲染错误气泡
```

**关键设计：**

- **排队而非并发**。`messageQueues` 按 cid 隔离，同会话消息 FIFO 发送——下一条在上一条流完成后才发出。
- **停止按钮。** `pendingConvs.get(cid).controller.abort()` → 主进程收到 `groupChat.abort` → 群聊 abort 是**所有 actor 的唯一停止路径**。
- **消息持久化在 Main 进程。** 渲染进程不直接写文件，所有消息经 IPC 发送后由主进程写入 JSONL。

### 5.3 轮询与状态同步

**仿写要点：**

- 即使页面刷新或重连后，也能检测到助手响应。
- `pollTimers` Map — 每个 cid 的 `setInterval` 定时器
- `pollMsgCounts` Map — 每个 cid 最后已知的消息标识
- **轮询判断逻辑**：`_isPolledAssistantMsg(m)` 检查 `m.from !== 'user'`——直接看 `from` 字段，而非旧的 `role` 字段。原因是后端 `/api/conversations/<cid>/history` 返回原始 GroupMessage 记录（`{id, ts, from, to, text, ...}`），不是旧的 `{role, content, time}` 形态。

### 5.4 富文本输入与 @-mention

**仿写要点：**

- 聊天输入使用 `contenteditable` div（而非裸 textarea）以支持内联 chip 渲染
- `_chatRichComposerEditor` — 获取 contenteditable 编辑器引用
- `_chatRichSerializeNode` — 将编辑器 DOM 序列化为纯文本（chip token → 展开文本）
- **@-mention 高亮**：在渲染后的 DOM 上做 TreeWalker 遍历，将 `@<token>` 匹配包装在 `<span class="msg-mention">` 中。**跳过** `<code>`、`<pre>`、`<a>` 节点（代码块和链接受保护）。
- **动态正则构建**：已知 Agent 名称按长度降序排列进正则 alternation，确保 "软件需求分析师" 在 "软件" 之前匹配。

```js
function _buildMentionRe() {
  const names = []; // 从 conversations 和 agents 收集已知名称
  // 按长度降序 → 长的优先匹配
  names.sort((a, b) => b.length - a.length);
  const escaped = names.map(n => _escapeForRegex(n));
  if (escaped.length) {
    return new RegExp(`@(${escaped.join('|')}|${_MENTION_FALLBACK_CLASS})`, 'g');
  }
  return new RegExp(`@(${_MENTION_FALLBACK_CLASS})`, 'g');
}
```

### 5.5 Skill/Connector 内联芯片（chat-use.js）

**对应源码：** `src/renderer/modules/chat-use.js`（~649 行）

**仿写要点：**

- Skills 和 Connectors 作为紧凑标记直接存储在 textarea/编辑器中：`@{kind:value}`
- 使用**不可见 Unicode 字符**编码 token，避免与普通文本混淆：
  - `⁣` — Token 开始
  - `⁢` — 元数据分隔符
  - `⁤` — Token 结束
  - `​` — 零宽空格（二进制 0）
  - `‌` — 零宽非连接符（二进制 1）
- **镜像渲染**：编辑器下方 overlay 将 token 渲染为内联 chip（带 × 按钮移除）
- **发送时展开**：token 被替换为本地化的纯文本描述

**Token 编码方案：**

```js
const _CHAT_USE_TOKEN_OPEN = '@{';
const _CHAT_USE_TOKEN_KINDS = new Set(['skill', 'connector']);
const _CHAT_USE_TOKEN_START = '⁣';  // 不可见分隔符
const _CHAT_USE_TOKEN_META  = '⁢';
const _CHAT_USE_TOKEN_END   = '⁤';
const _CHAT_USE_TOKEN_ZERO  = '​';  // 零宽空格
const _CHAT_USE_TOKEN_ONE   = '‌';  // 零宽非连接符

function _chatUseTokenFor(selection) {
  // 编码: @{START}{kind}{META}{id}{META}{name}{END}
  // 其中 kind/id/name 中的特殊字符被转义
  return `@{${_CHAT_USE_TOKEN_START}${escapedKind}${_CHAT_USE_TOKEN_META}${escapedId}${_CHAT_USE_TOKEN_META}${escapedName}${_CHAT_USE_TOKEN_END}}`;
}
```

### 5.6 动态表单渲染（chat-input-form.js）

**对应源码：** `src/renderer/modules/chat-input-form.js`（~450 行）

**仿写要点：**

- Agent 发布 `ChatFormPayload` → 渲染为聊天气泡内的交互式表单
- 支持的字段类型：`text`、`number`、`textarea`、`select`、`checkbox`、`radio`、`file`
- **草稿保留**：未提交的表单值存储在 `_formDrafts` Map（key = `${cid}::${form_id}`），切换会话后回来不丢失
- **提交后变只读**：提交成功后的表单用 `presetValue` + `disabled=true` 重新渲染，视觉保持不变
- **编码提交**：`encodeChatFormSubmission(values)` → 人可读摘要 + 机器标签文本

### 5.7 权限确认卡片

**仿写要点：**

三种权限确认各有独立的渲染器-主进程通道：

| 卡片类型 | 触发源 | 订阅模块 | 推送频道 |
|---|---|---|---|
| Delete File 确认 | 主进程 `delete_file` 工具 | `delete-file-confirm.js` | `delete_file.<cid>` |
| Bash 权限确认 | 主进程 `bash` 工具 | `bash_permission.js` | `bash:` |
| Bridge 权限确认 | 外部 CLI Agent 调用 connector | `bridge.js` | `bridge:permission` |

**权限响应模式：**

```js
// bridge.js
async function _showBridgePermissionDialog(info) {
  const choice = await uiChoice({
    title: t('bridge.permission.title'),
    message: t('bridge.permission.message', { agent, connector, tool }),
    cancelLabel: t('bridge.permission.deny'),
    choices: [
      { id: 'allow_once', label: t('bridge.permission.allow_once') },
      { id: 'allow_always', label: t('bridge.permission.allow_always') },
    ],
  });
  await window.orkas.invoke('bridge.permission_response', {
    request_id: info.request_id,
    allow: choice === 'allow_once' || choice === 'allow_always',
    always: choice === 'allow_always',
  });
}
```

---

## 第六阶段：启动与性能

### 6.1 三阶段启动流水线

**对应源码：** `src/renderer/modules/boot.js`（~557 行）

**仿写要点：**

应用启动遵循严格的三阶段流水线，目标是**让用户尽可能快看到最后一次对话**。

```
bootApp()
  │
  ├─ initI18n()                          // 同步优先（preload sendSync 已在手）
  │
  ├─ Stage A（并行，无相互依赖）        // ~1500ms 阈值
  │   ├─ _stampSettingsVersion()         //   版本号 + is-dev body class
  │   ├─ initUser() → initUserWorkspace() //  用户信息 + 工作区路径
  │   ├─ initAvatarCatalog()              //   头像图标 SVG 预加载
  │   └─ loadProjects()                   //   项目列表
  │
  ├─ Stage B（并行，依赖 Stage A）       // 用户现在可以看到最后一次对话
  │   ├─ loadConversations({ startup: true })  // 侧边栏会话列表
  │   └─ loadAgents(false, { summary: true })  // Agent 摘要缓存（@-mention 用）
  │
  ├─ _restoreLastView()                  // 恢复上次视图
  ├─ _ensureCommanderAvatarLoaded()      // 即发即弃，预热指挥官头像
  ├─ startDeleteFileConfirmSubscription() // 订阅 delete_file 确认（防止主进程 5min 超时）
  │
  └─ Stage C（延迟 ~2.5s）               // 不阻塞首次交互
      ├─ refreshModelGuard()              //   模型可用性检查
      └─ startAutoEventsSubscription()    //   Auto 任务事件订阅
```

**性能护栏规则：**

```js
const _BOOT_STAGE_WARN_MS = 1500;   // 单阶段超 1.5s → warn
const _BOOT_TOTAL_WARN_MS = 3000;   // 总启动超 3s → warn

async function _bootStage(name, fn) {
  const t0 = performance.now();
  try { return await fn(); }
  finally {
    const ms = Math.round(performance.now() - t0);
    if (ms > _BOOT_STAGE_WARN_MS) {
      _bootLog.warn(`boot stage slow: ${name} ${ms}ms`);
    }
  }
}
```

**三个结构规则（R1-R3）：**

1. **R1. 只有三个阶段。** 不要在 `initI18n` 和 `_restoreLastView` 之间添加第四个串行 `await`。
2. **R2. Stage A/B 任务必须"即发即返回"。** 同一 `Promise.all` 内不嵌套 `await`。
3. **R3. 非关键工作进 Stage C。** 对首次绘制无贡献的任务延迟 2.5s 执行。

### 6.2 按需功能加载

**对应源码：** `src/renderer/modules/lazy-features.js`

**仿写要点：**

- 不是所有模块都在启动时加载。进入某个面板时才通过 `loadRendererFeature(feature)` 加载对应脚本。
- 支持的功能模块：`agents`、`skills`、`marketplace`、`settings`、`contexts`、`apps`、`memory`、`auto`、`devtools`。
- **加载失败处理**：显示"加载失败"横幅，提供重试按钮。

```js
function _loadViewFeature(feature, view, run) {
  Promise.resolve(loadRendererFeature(feature))
    .then(() => {
      _clearLazyFeatureError(view);
      if (currentView === view) run();  // 用户仍在同一视图才执行
    })
    .catch((err) => {
      _showLazyFeatureError(feature, view, err, run);
    });
}
```

### 6.3 侧边栏导航温启动

- 启动后约 3.5s 内的侧边栏导航受到**温启动保护**——避免在关键绘制路径上与 Stage B 的数据加载竞争。
- 每个侧边栏导航按钮的实际数据加载通过 `_deferSidebarNavWork(key, fn, delayMs)` 调度。

---

## MVP 可运行示例

一个最小可用的 Agent 前端 UI：

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>My Agent UI</title>
  <style>
    .app-container { display: flex; height: 100vh; }
    .sidebar { width: 260px; background: #1a1a2e; color: #eee; }
    .main-content { flex: 1; }
    .panel { display: none; }
    .panel.active { display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div class="app-container">
    <aside class="sidebar">
      <button id="new-chat-btn">Commander</button>
      <button id="agents-btn">Agents</button>
      <div id="conversation-list"></div>
    </aside>
    <main class="main-content">
      <section class="panel active" id="panel-new-chat">
        <textarea id="composer" placeholder="Ask anything..."></textarea>
        <button id="send-btn">Send</button>
        <div id="chat-messages"></div>
      </section>
      <section class="panel" id="panel-agents">
        <div id="agents-grid"></div>
      </section>
    </main>
  </div>
  <!-- vendor -->
  <script src="./js/vendor/dompurify/purify.min.js"></script>
  <!-- app -->
  <script>
    // ── 状态 ──
    let currentView = 'new-chat';
    let conversations = [];

    // ── IPC ──
    async function apiFetch(url, options = {}) {
      // 路由 URL → IPC channel（简化版）
      const channel = url.includes('/agents/list') ? 'agents.list'
        : url.includes('/conversations/list') ? 'conversations.list'
        : url.includes('/send') ? 'groupChat.send'
        : null;
      if (!channel) throw new Error('No route');
      const result = await window.orkas.invoke(channel, JSON.parse(options.body || '{}'));
      if (!result.ok) throw new Error(result.error);
      return { json: () => result };
    }

    // ── 视图切换 ──
    function setView(view) {
      currentView = view;
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${view}`).classList.add('active');
      if (view === 'agents') loadAgents();
    }

    // ── Agent 加载 ──
    async function loadAgents(force) {
      const cacheKey = '_agents';
      if (!force) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) return renderAgentGrid(JSON.parse(cached));
      }
      const res = await apiFetch('GET /api/agents/list');
      const data = await res.json();
      sessionStorage.setItem(cacheKey, JSON.stringify(data.agents));
      renderAgentGrid(data.agents);
    }

    function renderAgentGrid(agents) {
      const grid = document.getElementById('agents-grid');
      grid.innerHTML = agents.map(a => `
        <div class="agent-card">
          <h3>${escapeHtml(a.name)}</h3>
          <p>${escapeHtml(a.description_en || '')}</p>
        </div>
      `).join('');
    }

    // ── 聊天 ──
    async function sendMessage(text) {
      const msgs = document.getElementById('chat-messages');
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble assistant';
      msgs.appendChild(bubble);

      const { promise, cancel } = window.orkas.stream('groupChat.send', { text }, (ev) => {
        if (ev.type === 'text_delta') {
          bubble.textContent += ev.text;
        } else if (ev.type === 'error') {
          bubble.textContent = `Error: ${ev.error}`;
        }
      });

      document.getElementById('send-btn').onclick = () => cancel();
      await promise;
    }

    document.getElementById('send-btn').addEventListener('click', () => {
      const text = document.getElementById('composer').value.trim();
      if (text) sendMessage(text);
    });

    document.getElementById('agents-btn').addEventListener('click', () => setView('agents'));
    document.getElementById('new-chat-btn').addEventListener('click', () => setView('new-chat'));
  </script>
</body>
</html>
```

---

## 建议节奏

| 阶段     | 天数      | 产出 |
| -------- | --------- | ---- |
| 第一阶段 | Day 1-2   | HTML 骨架 + 图标系统 + i18n + 工具函数 + 全局状态 → 可交互的静态 UI |
| 第二阶段 | Day 3-4   | preload API + IPC 路由垫片 + 流式通信 + 推送订阅 → 🎉 **能发消息并看到回复！** |
| 第三阶段 | Day 5-6   | 对话框 + 表单渲染 + 侧边栏 + 上下文菜单 → 完整 UI 组件库 |
| 第四阶段 | Day 7-9   | Agent CRUD UI + Skill CRUD UI + 外部 Agent + 市场 → 完整的 Agent/Skill 管理 |
| 第五阶段 | Day 10-13 | 会话列表 + 消息流式渲染 + 轮询 + @-mention + 内联芯片 + 权限卡片 → 完整聊天体验 |
| 第六阶段 | Day 14    | 启动优化 + 懒加载 → 生产级性能 |

---

## 核心设计模式总结

| 模式 | 来源 | 说明 |
| ---- | ---- | ---- |
| **全局变量模块通信** | 所有模块 | 经典 `<script>` 标签顺序 = 依赖顺序；顶层 `let`/`const`/`function` 跨文件可见 |
| **IIFE 封装** | `icons.js`、`i18n.js` | 立即执行函数表达式创建闭包，内部变量不污染全局 |
| **同步优先 i18n** | `i18n.js` + `preload.js` | `sendSync` 在 DOM 脚本运行前获取翻译表 → 零语言闪烁首次绘制；异步作为回退 |
| **HTTP→IPC 路由表** | `ipc-shim.js` | 正则/字符串匹配 URL → IPC channel，带参数提取；上游代码无需感知协议切换 |
| **`{promise, cancel}` 流控制** | `preload.js` | 跨 `contextBridge` 的 AbortSignal 原型链丢失，用普通函数替代 |
| **FIFO 消息队列** | `state.js` | 同会话消息排队发送，上一条流完成后才发下一条 |
| **内容快照轮询** | `conversation.js` | 按 cid 独立 setInterval + 消息标识去重；直接看 `from` 字段而非旧 `role` |
| **不可见字符 Token 编码** | `chat-use.js` | 零宽字符编码 skill/connector 标记 → 不干扰正常文本选择和 IME |
| **TreeWalker 安全后处理** | `conversation.js` | @-mention 高亮遍历文本节点，跳过 `<code>`/`<pre>`/`<a>` |
| **三阶段启动流水线** | `boot.js` | A 并行准备 → B 首次绘制 → C 延迟非关键；性能护栏 1.5s/3s 阈值 |
| **按需功能加载** | `lazy-features.js` | 面板入口才加载对应脚本；失败显示横幅 + 重试 |
| **DOM 直接操作** | 全部 | 无虚拟 DOM，`innerHTML`（经 DOMPurify）+ `classList` + `createElement` |
| **localStorage 持久化** | `boot.js`、`sidebar.js` | 最后视图、侧边栏宽度、消息草稿、搜索历史 → 刷新后恢复 |
| **权限队列 FIFO** | `bridge.js` | 多次权限请求不堆叠对话框，逐个处理 |

---

## 参考源码路径索引

| 模块 | Orkas 路径 |
| ---- | ---------- |
| HTML 入口 | `src/renderer/index.html` |
| 全局样式 | `src/renderer/style.css` |
| Preload API | `src/main/preload.js` |
| IPC 路由垫片 | `src/renderer/modules/ipc-shim.js` |
| 国际化 i18n | `src/renderer/modules/i18n.js` |
| 图标系统 | `src/renderer/modules/icons.js` |
| 工具函数 | `src/renderer/modules/utils.js` |
| 全局状态 | `src/renderer/modules/state.js` |
| 启动入口 | `src/renderer/modules/boot.js` |
| Agent 管理 | `src/renderer/modules/agents.js` |
| Skill 管理 | `src/renderer/modules/skills.js` |
| 聊天系统 | `src/renderer/modules/conversation.js` |
| 内联芯片 | `src/renderer/modules/chat-use.js` |
| 动态表单 | `src/renderer/modules/chat-input-form.js` |
| 市场浏览 | `src/renderer/modules/marketplace.js` |
| 外部 Agent | `src/renderer/modules/local-agents.js` |
| 对话框 | `src/renderer/modules/dialogs.js` |
| Bridge 权限 | `src/renderer/modules/bridge.js` |
| Bash 权限 | `src/renderer/modules/bash_permission.js` |
| 删除确认 | `src/renderer/modules/delete-file-confirm.js` |
| 上下文菜单 | `src/renderer/modules/context-menu.js` |
| 侧边栏调整 | `src/renderer/modules/sidebar-resize.js` |
| 懒加载 | `src/renderer/modules/lazy-features.js` |
| 日志（渲染端） | `src/renderer/modules/logger.js` |
| 国际化翻译表 | `src/renderer/locales/*.json` |
| DOMPurify | `src/renderer/vendor/dompurify/purify.min.js` |
| Main IPC 路由 | `src/main/ipc/index.ts` |
| Agent feature (Main) | `src/main/features/agents.ts` |
| Skill feature (Main) | `src/main/features/skills.ts` |
| 群聊 bus (Main) | `src/main/features/group_chat/bus.ts` |

---

## 与后端指南的衔接点

前端指南中每个 UI 模块都对应后端指南中的特定功能模块：

| 前端模块 | 后端对应 | 衔接说明 |
| -------- | -------- | -------- |
| `chat.js` 流式渲染 | `agent/runner.ts` | Runner 的 `runStream()` 通过 IPC 推送事件到渲染进程 |
| `agents.js` 列表/详情 | `features/agents.ts` | Agent CRUD 操作 → IPC → feature 函数 |
| `skills.js` 文件树 | `features/skills.ts` + `core-agent/skills/` | Skill 加载/编辑 → IPC → feature + runner |
| `chat-use.js` Skill 选择 | `model/core-agent/skill-registry.ts` | Skill 列表来自 registry，注入 system prompt |
| `chat-input-form.js` | `agent/runner.ts` | Agent 通过 `ChatFormPayload` 请求用户输入 |
| `bash_permission.js` | `tools/local-tools.ts` | Bash 工具执行前推送权限请求到渲染进程 |
| `delete-file-confirm.js` | `tools/file-tools.ts` | 文件删除前推送确认请求 |
| `bridge.js` | `features/connectors/` | 外部 CLI Agent 调用 connector 需用户授权 |
| `local-agents.js` | `features/local_agents/runner.ts` | CLI Agent 检测/创建的 UI |
| `marketplace.js` | `features/marketplace*.ts` | 安装/缓存管理 UI |
