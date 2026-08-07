---
artifact: spec
route: brainstorming → writing-plans
skills:
  - brainstorming (skipped: not found on this platform)
  - frontend-ui-engineering
  - frontend-design
  - incremental-implementation
skills_evidence:
  - skipped: brainstorming (not found)
source:
  - docs/spec/仿写Agent前端框架指南.md
  - dist/electron/ (existing Electron app)
  - AGENTS.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md
created_at: 2026-08-07
---

# 仿写Agent 前端框架 — 全阶段实现文档

> 基于 [仿写Agent前端框架指南](../../docs/spec/仿写Agent前端框架指南.md)（下称"前端指南"），
> 结合项目现有 Electron 应用（`dist/electron/`）的实际状态，编写所有阶段的融合实现方案。

---

## 〇、项目现状分析

### 0.1 已有前端资产

| 文件 | 说明 | 状态 |
|---|---|---|
| `dist/electron/main.cjs` | Electron 主进程，含 Agent 初始化、IPC 注册、窗口创建 | ✅ 可用 |
| `dist/electron/preload.cjs` | contextBridge 白名单 API（`window.myAgent.invoke/stream/on`） | ✅ 可用，需增强 |
| `dist/electron/renderer/index.html` | HTML 骨架（4 页面 + session 面板） | ✅ 可用，需重构 |
| `dist/electron/renderer/js/api.js` | IPC 封装层（sessions/chat/config/skills/providers） | ✅ 可用，需扩展 |
| `dist/electron/renderer/js/app.js` | 应用壳（导航、页面切换、hash 路由） | ✅ 可用，需重构 |
| `dist/electron/renderer/js/pages/chat.js` | 对话页（发送/流式接收/会话列表/分组） | ✅ 可用，需增强 |
| `dist/electron/renderer/js/pages/sessions.js` | 会话管理页（表格/搜索/批量操作/分页） | ✅ 可用 |
| `dist/electron/renderer/js/pages/skills.js` | Skills 管理页（网格/分类/启用开关） | ✅ 可用，需增强 |
| `dist/electron/renderer/js/pages/settings.js` | 设置页（二级导航/模型/工具/路径等 tab） | ✅ 可用 |
| `dist/electron/renderer/modules/markdown.js` | Markdown 渲染（marked 封装） | ✅ 可用 |
| `dist/electron/renderer/vendor/marked.min.js` | Markdown 解析库 | ✅ |
| `dist/electron/renderer/css/*.css` | 样式体系（variables/layout/components/chat/sessions/settings/skills/theme-dark） | ✅ 可用 |

### 0.2 与前端指南的差距

| 维度 | 前端指南（目标） | 当前项目 | 差距 |
|---|---|---|---|
| 模块系统 | IIFE + 全局变量，`<script>` 顺序 = 依赖序 | 全局对象字面量（`ChatPage = {...}`） | 基本一致，需统一规范 |
| 图标系统 | `UI_ICONS` 字典（50+ SVG），`uiIconHtml()` | emoji 硬编码（💬📋🧩⚙️） | **缺失** |
| 国际化 i18n | `t()` + `data-i18n` + 同步启动 + 语言切换 | 硬编码中文 | **缺失** |
| 安全 | `escapeHtml()` + DOMPurify + `_SAFE_URI_RE` | `marked` 渲染（无显式 XSS 防护） | **缺失** |
| IPC 层 | `{promise, cancel}` 流 + 推送白名单 + ipc-shim 路由表 | 基础的 `invoke/stream/on` | 需增强 |
| 状态管理 | `currentView/conversations/pendingConvs/messageQueues` | 分散在各 page 对象中 | **需统一** |
| 组件体系 | dialogs/context-menu/sidebar-resize/chat-form | 无独立组件层 | **缺失** |
| Agent 管理 | 三栏布局 + 两级缓存 + 详情/编辑 | 无 Agent 管理页 | **缺失** |
| 聊天系统 | 流式渲染 + 轮询 + @-mention + 内联 chip + 权限卡片 | 基础流式渲染 | 需增强 |
| 启动性能 | 三阶段流水线 + 懒加载 + 性能护栏 | 简单的 DOMContentLoaded 初始化 | **需重构** |

### 0.3 关键架构差异

| 前端指南（Orkas） | 本项目 |
|---|---|
| 命名空间 `window.orkas` | `window.myAgent` |
| 后端是 Orkas 多进程架构 | 后端是本地 TypeScript Agent 框架 |
| 有 `group_chat` 多 actor 群聊 | 单 Agent 对话 |
| 有 `connectors` 外部集成 | 无此需求 |
| 有 `marketplace` 云端市场 | 可选/简化 |
| 多语言 en/zh/ja | 中文优先，英文可选 |

### 0.4 总体演进策略

**不是推倒重来，而是渐进式重构。** 现有 Electron 应用已经可用，在此基础上按前端指南的 6 阶段逐步引入目标架构。每个阶段产出可用的增量。

```
现有应用（v0.3.0）
  │
  ├─ 阶段1：基础积木重构 ──→ 引入 icons/i18n/utils/state + 重构 HTML/CSS
  │
  ├─ 阶段2：IPC 增强 ──→ 增强 preload + ipc-shim + 流式通信规范化
  │
  ├─ 阶段3：UI 组件体系 ──→ dialogs/sidebar/context-menu/chat-form
  │
  ├─ 阶段4：Agent/Skill 管理 ──→ Agent 管理页 + Skill 增强
  │
  ├─ 阶段5：聊天系统升级 ──→ 流式增强 + 轮询 + @-mention + 权限卡片
  │
  └─ 阶段6：性能优化 ──→ 启动流水线 + 懒加载
```

---

## 一、第一阶段：基础积木重构

### 1.0 阶段目标

将现有前端中分散的硬编码字符串、emoji 图标、内联样式替换为规范化的基础模块。产出可独立测试的基础 UI 层。

### 1.1 现状 vs 目标

| 模块 | 现状 | 目标 |
|---|---|---|
| 目录结构 | `dist/electron/renderer/` 下扁平 js/pages/ | 迁移到 `src/renderer/` 按 shared/state/components/features/ 分层 |
| HTML 骨架 | emoji 图标 + 硬编码中文 | SVG 图标系统 + `data-i18n` 属性绑定 |
| 图标 | 硬编码 emoji（💬📋🧩⚙️等） | `UI_ICONS` 字典 + `uiIconHtml()` + `fileIconHtml()` |
| 国际化 | 所有文本硬编码中文 | `t()` 翻译函数 + `data-i18n` DOM 绑定 + 中文翻译表 |
| 工具函数 | 无统一安全函数 | `escapeHtml()` + `pickDesc()` + `safeHref()` |
| 状态管理 | 分散在各 page 对象中 | 统一的全局 state 模块 |

### 1.2 目录重构

```bash
# 从 dist/electron/renderer/ 迁移到 src/renderer/（纳入 TypeScript 项目治理）
src/renderer/
├── index.html              # 入口（重构后）
├── style.css               # 全局样式（合并现有 css/）
├── js/
│   ├── vendor/
│   │   └── dompurify/      # XSS 防护（新增）
│   ├── shared/
│   │   ├── i18n.js         # 国际化（新增）
│   │   ├── icons.js        # SVG 图标系统（新增）
│   │   ├── utils.js        # 安全工具函数（新增）
│   │   └── logger.js       # 渲染进程日志（新增）
│   ├── ipc/
│   │   ├── preload.js      # contextBridge API（从 preload.cjs 重构）
│   │   └── ipc-shim.js     # IPC 路由垫片（新增）
│   ├── state/
│   │   └── state.js        # 全局状态管理（新增，整合现有分散状态）
│   ├── components/
│   │   ├── dialogs.js      # 对话框系统（新增）
│   │   ├── sidebar.js      # 侧边栏（从 app.js 拆出）
│   │   ├── context-menu.js # 右键菜单（新增）
│   │   └── chat-input-form.js # 动态表单（新增）
│   ├── features/
│   │   ├── agents.js       # Agent 管理（新增）
│   │   ├── skills.js       # Skill 管理（从 pages/skills.js 重构）
│   │   ├── chat.js         # 聊天系统（从 pages/chat.js 重构）
│   │   ├── sessions.js     # 会话管理（从 pages/sessions.js 重构）
│   │   ├── settings.js     # 设置面板（从 pages/settings.js 重构）
│   │   └── marketplace.js  # 市场浏览（可选）
│   └── app.js              # 启动入口（从 app.js 重构）
└── locales/
    └── zh.json             # 中文翻译表
```

### 1.3 任务拆解

#### Task 1.1：HTML 骨架重构

**产出：** `src/renderer/index.html`（重构版）

**改动要点：**

1. **图标替换：** 将所有 emoji 图标替换为 `uiIconHtml()` 调用
   - 侧边栏图标：`💬→uiIcon('message-square')`、`📋→uiIcon('list')`、`🧩→uiIcon('puzzle')`、`⚙️→uiIcon('settings')`
   - 按钮图标同理

2. **`data-i18n` 绑定：** 所有文本用 `data-i18n` 属性标记
   ```html
   <!-- 之前 -->
   <span class="session-panel-title">对话</span>
   <!-- 之后 -->
   <span class="session-panel-title" data-i18n="sidebar.conversations">对话</span>
   ```

3. **`<script>` 标签顺序调整：**
   ```html
   <!-- vendor -->
   <script src="./js/vendor/dompurify/purify.min.js"></script>
   <script src="./js/vendor/marked.min.js"></script>
   <!-- shared（按依赖顺序） -->
   <script src="./js/shared/logger.js"></script>
   <script src="./js/shared/icons.js"></script>
   <script src="./js/shared/utils.js"></script>
   <script src="./js/shared/i18n.js"></script>
   <!-- state -->
   <script src="./js/state/state.js"></script>
   <!-- ipc -->
   <script src="./js/ipc/api.js"></script>
   <!-- components -->
   <script src="./js/components/dialogs.js"></script>
   <script src="./js/components/sidebar.js"></script>
   <!-- features -->
   <script src="./js/features/sessions.js"></script>
   <script src="./js/features/chat.js"></script>
   <script src="./js/features/agents.js"></script>
   <script src="./js/features/skills.js"></script>
   <script src="./js/features/settings.js"></script>
   <!-- app 入口 -->
   <script src="./js/app.js"></script>
   ```

4. **样式合并：** 将现有 7 个 CSS 文件合并为 `style.css`，按节组织：
   - CSS Variables / Reset / Layout / Components / Chat / Sessions / Settings / Skills / Theme

**预估代码量：** ~300 行改动（HTML + CSS 合并）

#### Task 1.2：图标系统

**产出：** `src/renderer/js/shared/icons.js`

**对应前端指南 §1.2。** 当前项目用 emoji 硬编码，需完整新建。

**核心实现：**

```js
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  // 文件扩展名分类（复用指南设计）
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico']);
  const CODE_EXTS = new Set(['py', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'sh', 'bash', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'cpp', 'sql']);
  const DATA_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'csv', 'xml']);
  // ...

  function wrapUiIcon(name, inner, className) {
    const cls = `${className || 'ui-icon'} is-${name}`;
    return `<svg class="${cls}" viewBox="0 0 24 24" width="16" height="16"
      fill="none" stroke="currentColor" stroke-width="1.9"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  const UI_ICONS = {
    // 应用必需（从指南挑选 30+ 优先级最高的）
    'message-square': '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7..."></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15..."></path>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'x': '<path d="M18 6 6 18M6 6l12 12"></path>',
    'trash': '<path d="M3 6h18"></path><path d="M8 6V4h8v2"></path>...',
    // ... 其余按需从指南复制
  };

  root.uiIconHtml = function(name, className) {
    const inner = UI_ICONS[name];
    if (!inner) return '';
    return wrapUiIcon(name, inner, className);
  };

  root.fileIconHtml = function(filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();
    const kind = _fileKindIconClass(ext);
    return `<svg class="chat-file-kind-icon is-${kind}" ...>${FILE_KIND_ICONS[kind]}</svg>`;
  };
})();
```

**预估代码量：** ~200 行

#### Task 1.3：国际化 i18n

**产出：** `src/renderer/js/shared/i18n.js` + `src/renderer/locales/zh.json`

**对应前端指南 §1.3。** 当前阶段只做中文，英文翻译表作为远期可选项。

**简化策略（与指南的差异）：**

| 指南设计 | 本项目简化 |
|---|---|
| 同步启动 `sendSync` + 异步回退 | ❌ 跳过 `sendSync`，直接走异步 IPC 加载（首次绘制约 50ms 占位闪烁可接受） |
| en/zh/ja 三语言 | 仅 zh-CN（单语言 `t()` 即可用，后续扩展只需加翻译表） |
| `i18n-change` 事件 | 保留（为后续英文切换预留） |
| `setLang()` 持久化 | 保留（调用 `window.myAgent.invoke('config:setLanguage', lang)`） |

**核心实现：**

```js
let _currentLang = 'zh';
let _tables = {};
let _ready = false;

async function initI18n() {
  if (_ready) return;
  try {
    _tables = await window.myAgent.invoke('config:getLocales');
  } catch (_) {
    // 回退到内联默认表
    _tables = { zh: DEFAULT_ZH_TABLE };
  }
  _currentLang = 'zh';
  _ready = true;
  applyDomI18n();
}

function t(key, vars) {
  const v = _tables[_currentLang]?.[key];
  if (v === undefined) return _interpolate(key, vars);
  return _interpolate(v, vars);
}

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
```

**翻译表 `locales/zh.json`（精简版，涵盖当前 UI 所有文本）：**

```json
{
  "sidebar.new_chat": "新对话",
  "sidebar.conversations": "对话",
  "sidebar.agents": "Agents",
  "sidebar.skills": "Skills",
  "sidebar.settings": "设置",
  "chat.placeholder": "输入消息... Enter 发送，Shift+Enter 换行",
  "chat.send": "发送",
  "chat.stop": "停止",
  "chat.empty": "开始一段新对话",
  "sessions.title": "会话管理",
  "sessions.search": "搜索会话标题或内容...",
  "settings.models": "模型",
  "settings.tools": "工具",
  "settings.paths": "路径与权限",
  "settings.context": "上下文",
  "settings.appearance": "外观",
  "settings.developer": "开发者"
}
```

**预估代码量：** ~120 行 JS + ~80 行 JSON

#### Task 1.4：工具函数

**产出：** `src/renderer/js/shared/utils.js`

**对应前端指南 §1.4。** 核心函数：

```js
// XSS 防护第一道防线
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 安全 URI 白名单
const _SAFE_URI_RE = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|chat-media|chat-app|kb-file|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

function safeHref(url) {
  if (!url) return '';
  return _SAFE_URI_RE.test(url) ? url : '';
}

// 双语字段选择（为后续多语言预留）
function pickLocalizedField(obj, base, lang, fallbackLang = 'en') {
  if (!obj || !base) return '';
  const cur = (lang || '').split(/[-_]/)[0] || 'zh';
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

// 清理显示文本
function normalizeDisplayText(value) {
  if (!value && value !== 0) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
}
```

**预估代码量：** ~60 行

#### Task 1.5：全局状态管理

**产出：** `src/renderer/js/state/state.js`

**对应前端指南 §1.5。** 核心是将现有分散状态集中到一处。

```js
// 视图状态
let currentView = 'chat';    // 'chat' | 'sessions' | 'agents' | 'skills' | 'settings'
let currentSessionId = null;

// 会话列表（侧边栏数据源）
let conversations = [];

// 每个会话的挂起状态
const pendingConvs = new Map(); // sessionId → { loadingEl, controller, aborted }

// 每个会话的排队消息
const messageQueues = new Map(); // sessionId → [{ id, content }, ...]

// 缓存
let _agentsCache = null;     // Agent 摘要缓存
let _skillsCache = null;     // Skill 列表缓存

// 视图切换
function setView(view, sessionId, opts = {}) {
  const prev = currentView;
  currentView = view;
  currentSessionId = sessionId || null;

  // 1. 切换面板可见性
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(`page-${view}`);
  if (page) page.classList.add('active');

  // 2. 高亮侧边栏按钮
  document.querySelectorAll('.sidebar-icon').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-nav="${view}"]`);
  if (btn) btn.classList.add('active');

  // 3. 会话面板仅在对话页显示
  const sessionPanel = document.getElementById('session-panel');
  if (sessionPanel) sessionPanel.classList.toggle('collapsed', view !== 'chat');

  // 4. 按需初始化页面
  _initPage(view);

  // 5. 持久化最后视图
  try { localStorage.setItem('myagent:lastView', view); } catch (_) {}
}
```

**预估代码量：** ~150 行

### 1.4 阶段1 完成标准

- [ ] `UI_ICONS` 覆盖所有现有用到的图标（~30 个），不再出现 emoji 硬编码
- [ ] 所有 UI 文本通过 `t()` 获取，`index.html` 中文本用 `data-i18n` 标记
- [ ] `escapeHtml()` 在聊天消息渲染中使用
- [ ] 全局状态通过 `state.js` 访问，各 page 模块不再维护独立的页面状态变量
- [ ] 现有功能（对话/会话管理/Skills/设置）在新架构下可用

### 1.5 阶段1 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/renderer/index.html` | 重构 | emoji→SVG, 硬编码→data-i18n |
| `src/renderer/style.css` | 合并 | 7 CSS → 1 style.css |
| `src/renderer/js/shared/icons.js` | 新建 | 图标系统 |
| `src/renderer/js/shared/i18n.js` | 新建 | 国际化 |
| `src/renderer/js/shared/utils.js` | 新建 | 安全工具函数 |
| `src/renderer/js/shared/logger.js` | 新建 | 渲染进程日志 |
| `src/renderer/js/state/state.js` | 新建 | 全局状态 |
| `src/renderer/locales/zh.json` | 新建 | 中文翻译表 |
| `dist/electron/renderer/` | 保留 | 作为构建输出，`src/renderer/` 是源 |

---

## 二、第二阶段：IPC 通信增强

### 2.0 阶段目标

规范化前端与 Main 进程的通信协议，增强流式通信的可靠性，建立 IPC 路由表。

### 2.1 现状 vs 目标

| 维度 | 现状 | 目标 |
|---|---|---|
| preload API | `invoke(channel, ...args)` 透传 | 规范化为 `invoke(channel, payload)` （单 payload 对象） |
| 流式通信 | `stream(channel, payload)` → `{ on, cancel }` 事件模式 | 改为 `{ promise, cancel }` 模式（与指南一致） |
| 推送事件 | `on(channel, callback)` 无白名单 | `onPushEvent(channel, handler)` 加频道白名单 |
| IPC 路由 | 无路由层，各页面直接调 `api.xxx()` | `ipc-shim.js` 路由表，URL→IPC channel 映射 |
| 错误处理 | 无统一错误处理 | IPC 层统一错误包装 |

### 2.2 任务拆解

#### Task 2.1：Preload API 增强

**产出：** `src/renderer/js/ipc/preload.js`（注：实际 preload 脚本仍需是 CJS，此处指渲染侧的 API 封装）

**当前 preload.cjs 的问题：**

```js
// 当前：invoke 透传多个参数，调用方传参不一致
invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)

// 当前：stream 返回 { on, cancel }，但 on 是事件监听模式
stream: (channel, payload) => {
  const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // ...
  return {
    on: (event, callback) => { ... },
    cancel: () => { ... },
  };
}
```

**目标：统一为 `{promise, cancel}` 模式**

```js
// preload.cjs 增强版
contextBridge.exposeInMainWorld("myAgent", {
  // 请求-响应（单 payload 对象）
  invoke: (channel, payload) =>
    ipcRenderer.invoke('myagent.invoke', { channel, payload: payload || {} }),

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
          cancelled ? reject(new Error('stream cancelled')) : resolve();
          return;
        }
        try { onEvent(ev); }
        catch (err) { settled = true; ipcRenderer.removeListener(channelKey, listener); reject(err); }
      };
      ipcRenderer.on(channelKey, listener);
      ipcRenderer.send('myagent.streamStart', { requestId, channel, payload });
    });

    const cancel = () => {
      if (settled || cancelled) return;
      cancelled = true;
      ipcRenderer.send('myagent.streamCancel', requestId);
    };
    return { promise, cancel };
  },

  // 主进程推送（加白名单）
  onPushEvent: function(channel, handler) {
    if (!_isAllowedPushChannel(channel))
      throw new Error(`push channel not allowed: ${channel}`);
    const listener = (_evt, payload) => { try { handler(payload); } catch(_) {} };
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

const PUSH_EVENT_PREFIXES = [
  'bash:', 'bridge:', 'delete_file.', 'skills:',
  'config:', 'conversations:'
];
```

**后端适配（main.cjs 侧）：** 需要新增 `myagent.invoke` handler（包装现有 channel handler）+ `myagent.streamStart` / `myagent.streamCancel` handler。

#### Task 2.2：IPC 路由垫片

**产出：** `src/renderer/js/ipc/ipc-shim.js`

**对应前端指南 §2.2。** 本项目不需要完整的 HTTP→IPC 路由表（因为原生就是 Electron 应用，没有 HTTP server），但需要一个统一的路由层来规范 IPC channel 命名和参数映射。

**简化版路由表：**

```js
// 统一 IPC 调用入口（替代直接调 window.myAgent.invoke）
const IPC = {
  // Agent
  agents: {
    list: () => window.myAgent.invoke('agents:list'),
    get: (id) => window.myAgent.invoke('agents:get', { id }),
    create: (data) => window.myAgent.invoke('agents:create', data),
    update: (id, data) => window.myAgent.invoke('agents:update', { id, ...data }),
    delete: (id) => window.myAgent.invoke('agents:delete', { id }),
  },

  // Session
  sessions: {
    list: (opts) => window.myAgent.invoke('sessions:list', opts),
    get: (id) => window.myAgent.invoke('sessions:get', { id }),
    delete: (id) => window.myAgent.invoke('sessions:delete', { id }),
    rename: (id, name) => window.myAgent.invoke('sessions:rename', { id, name }),
  },

  // Chat (stream)
  chat: {
    send: (sessionId, text, onEvent) =>
      window.myAgent.stream('chat:send', { sessionId, text }, onEvent),
    cancel: (sessionId) =>
      window.myAgent.invoke('chat:cancel', { sessionId }),
  },

  // Config
  config: {
    get: () => window.myAgent.invoke('config:get'),
    update: (patch) => window.myAgent.invoke('config:update', patch),
  },

  // Skills
  skills: {
    list: () => window.myAgent.invoke('skills:list'),
    get: (id) => window.myAgent.invoke('skills:get', { id }),
    setEnabled: (id, enabled) => window.myAgent.invoke('skills:setEnabled', { id, enabled }),
  },

  // Providers
  providers: {
    list: () => window.myAgent.invoke('providers:list'),
    save: (data) => window.myAgent.invoke('providers:save', data),
    delete: (id) => window.myAgent.invoke('providers:delete', { id }),
    test: (id) => window.myAgent.invoke('providers:test', { id }),
  },
};
```

**当前 `api.js` 已基本具备此结构**，阶段2 主要是规范化 + 加 stream 的 `{promise, cancel}` 返回。

**预估代码量：** ~50 行（主要是重构现有 api.js）

#### Task 2.3：Main 进程 IPC Handler 适配

**产出：** 修改 `dist/electron/main.cjs` + `src/ipc/` 下的 handler

当前 main.cjs 中 IPC 注册分散在 `initIpc()` 中。需要：
1. 新增 `myagent.invoke` 统一入口 handler
2. 新增 `myagent.streamStart` / `myagent.streamCancel` 统一流 handler
3. 现有 `registerChatIpc`/`registerSessionsIpc` 等改为注册到统一入口下

### 2.3 阶段2 完成标准

- [ ] preload 的 stream 返回 `{ promise, cancel }`（而非 `{ on, cancel }`）
- [ ] `onPushEvent` 有频道白名单
- [ ] IPC 路由集中在 `ipc-shim.js` 中
- [ ] 现有聊天流式功能在 `{promise, cancel}` 模式下可用
- [ ] Main 进程能正确处理 `streamStart` / `streamCancel`

---

## 三、第三阶段：UI 组件体系

### 3.0 阶段目标

建立可复用的 UI 组件层，替代现有页面中内联的确认/提示逻辑。

### 3.1 现状 vs 目标

| 组件 | 现状 | 目标 |
|---|---|---|
| 对话框/确认框 | 无（用 `confirm()` 或不处理） | `uiChoice()` / `uiConfirm()` / `uiAlert()` |
| 侧边栏 | 在 app.js 中简单实现 | 独立 `sidebar.js`：拖拽调整宽度 + 双击重置 |
| 右键菜单 | 浏览器默认 | 自定义上下文菜单，防视口溢出 |
| 动态表单 | 无 | `chat-input-form.js`（Agent 请求结构化输入时） |

### 3.2 任务拆解

#### Task 3.1：对话框系统

**产出：** `src/renderer/js/components/dialogs.js`

```js
// 多选对话框
async function uiChoice({ title, message, choices, cancelLabel }) {
  return new Promise((resolve) => {
    const overlay = _showOverlay();
    const html = `
      <div class="dialog">
        <div class="dialog-header">${escapeHtml(title)}</div>
        <div class="dialog-body">${escapeHtml(message)}</div>
        <div class="dialog-footer">
          ${choices.map(c => `
            <button class="btn btn-primary dialog-choice" data-id="${escapeHtml(c.id)}">
              ${escapeHtml(c.label)}
            </button>
          `).join('')}
          <button class="btn btn-ghost dialog-cancel">${escapeHtml(cancelLabel || t('dialog.cancel'))}</button>
        </div>
      </div>`;
    overlay.innerHTML = html;
    // 事件绑定...
  });
}

// 确认框（二选一）
async function uiConfirm({ title, message, confirmLabel, cancelLabel }) {
  return uiChoice({
    title, message,
    choices: [{ id: 'confirm', label: confirmLabel || t('dialog.confirm') }],
    cancelLabel: cancelLabel || t('dialog.cancel'),
  }).then(r => r === 'confirm');
}

// 提示框（单按钮）
async function uiAlert({ title, message }) {
  return uiChoice({
    title, message,
    choices: [{ id: 'ok', label: t('dialog.ok') }],
  });
}
```

**预估代码量：** ~120 行

#### Task 3.2：侧边栏增强

**产出：** `src/renderer/js/components/sidebar.js`

从 `app.js` 中拆出侧边栏逻辑，新增：

1. **拖拽调整宽度：** `mousedown` 在 resize handle → `mousemove` 更新 `--sidebar-width` CSS 变量 → `mouseup` 持久化
2. **双击重置：** 双击 handle 恢复默认宽度 260px
3. **会话列表日期分组：** Today / Yesterday / 具体日期，午夜自动刷新

**预估代码量：** ~100 行

#### Task 3.3：右键菜单

**产出：** `src/renderer/js/components/context-menu.js`

```js
function showContextMenu(items, x, y) {
  // 1. 创建菜单 DOM
  // 2. 位置计算（getBoundingClientRect 边界检测，确保不溢出视口）
  // 3. 点击外部 / Escape 关闭
  // 4. 返回 Promise，resolve 被选中的 item id
}
```

**预估代码量：** ~80 行

#### Task 3.4：动态表单渲染

**产出：** `src/renderer/js/components/chat-input-form.js`

对应前端指南 §3.2 和 §5.6。Agent 可通过 `ChatFormPayload` 向用户请求结构化输入。

**当前阶段仅搭框架，** 完整功能在阶段5（聊天系统升级）中接入。

```js
// 表单字段类型支持
const FORM_FIELD_TYPES = ['text', 'number', 'textarea', 'select', 'checkbox', 'radio'];

function renderChatForm(container, payload, onSubmit) {
  // 在聊天气泡内渲染表单（非弹窗）
}

// 草稿保留 Map
const _formDrafts = new Map(); // key = `${sessionId}::${formId}`
```

**预估代码量：** ~100 行（框架），阶段5 补齐 ~150 行

### 3.3 阶段3 完成标准

- [ ] 删除会话、重置设置等操作走 `uiConfirm()` 而非浏览器 `confirm()`
- [ ] 侧边栏可拖拽调整宽度，宽度持久化到 localStorage
- [ ] 右键菜单在会话列表项上可用（重命名/删除/导出）
- [ ] 对话框支持键盘操作（Enter 确认，Escape 取消）

---

## 四、第四阶段：Agent 与 Skill 管理

### 4.0 阶段目标

新增 Agent 管理页面，大幅增强 Skill 管理页面。这是前端最核心的业务模块。

### 4.1 现状 vs 目标

| 功能 | 现状 | 目标 |
|---|---|---|
| Agent 管理 | 无专门页面 | 三栏布局：列表→详情→测试聊天 |
| Agent 数据 | 无（后端 agent-spec 系统已有） | 通过 IPC 从后端获取 Agent 列表 |
| Agent 缓存 | 无 | 两级缓存（摘要 → 完整） |
| Skill 管理 | 简单网格 + 分类过滤 + 启用开关 | 增加详情面板：SKILL.md 渲染 + 文件树 |
| 外部 Agent | 无 | `local-agents.js`（检测 Claude Code 等 CLI） |
| 市场浏览 | 无 | 可选（简化为本地安装，不做在线市场） |

### 4.2 任务拆解

#### Task 4.1：Agent 管理页

**产出：** `src/renderer/js/features/agents.js`

**前端指南对应 §4.1。** 适配要点：

| 指南设计 | 本项目适配 |
|---|---|
| Orkas 多 actor（commander/worker） | 本项目仅有 builtin + 自定义 agent |
| `agents.list` → cloud/marketplace 合并 | `agents:list` → 后端 `orchestration/agent-spec.ts` |
| `_agentSource()` 标记 marketplace/custom/external | 简化为 builtin/custom/external |
| 关联 Skills 展示 | 保留（agent spec 中有 `tools` 字段） |

**核心布局：**

```
┌────────────┬──────────────────────┬──────────────────┐
│  Agent 列表 │     Agent 详情       │   测试聊天        │
│  (左栏)     │     (中栏)           │   (右栏，可选)    │
│            │                     │                  │
│ ┌────────┐ │  Profile            │  ┌────────────┐  │
│ │ Card 1 │ │  ├─ 名称/描述        │  │ 快速测试    │  │
│ │ Card 2 │ │  ├─ 分类/版本        │  │ 对话区域    │  │
│ │ Card 3 │ │  ├─ 关联 Skills     │  │            │  │
│ └────────┘ │  └─ 系统提示词       │  └────────────┘  │
│            └──────────────────────┘                  │
└──────────────────────────────────────────────────────┘
```

**关键函数：**

```js
// 数据加载（两级缓存）
async function loadAgents(force, opts)    // force=true 跳过缓存；opts.summary=true 仅摘要
async function _refreshAgent(agentId)    // 单个 Agent 刷新

// 渲染
function renderAgentList(agents)         // 左栏列表
function renderAgentDetail(agent)        // 中栏详情
function _renderAgentProfile(agent)      // Profile 区域
function _renderAgentSkills(agent)       // 关联 Skills 列表

// 编辑（debounce 自动保存）
async function _saveAgentField(agentId, field, value)
```

**后端对接：** 需要在 `src/ipc/` 新增 `registerAgentsIpc()` handler，对接 `orchestration/agent-spec.ts`。

**预估代码量：** ~800 行（相比指南 4004 行大幅简化——本项目 Agent 模型远简单于 Orkas）

#### Task 4.2：Skill 管理增强

**产出：** 重构 `src/renderer/js/features/skills.js`

**当前已有：** Skill 列表网格 + 分类过滤 + 启用开关

**需要新增：**

1. **详情面板：** 点击 Skill 卡片后展开详情
   - SKILL.md 渲染（frontmatter 解析 + Markdown 正文）
   - 关联文件列表
   - 触发词展示

2. **文件树视图：** 可展开/折叠的目录树

3. **i18n-change 监听：** 语言切换时重新渲染描述

```js
// 关键新增函数
async function selectSkillDetail(id)      // 查看 Skill 详情
async function expandSkillTree(id, el)    // 展开目录
function invalidateSkillCacheFor(id)      // 缓存失效
```

**预估代码量：** ~300 行新增（现有 skills.js 约 200 行保留）

#### Task 4.3：后端 IPC Handler 新增

**产出：** `src/ipc/agents.ts`（新建）

```ts
// src/ipc/agents.ts
import { listAgentSpecs, loadAgentSpec } from '../orchestration/agent-spec.js';

export function registerAgentsIpc() {
  ipcMain.handle('agents:list', async () => {
    const specs = await listAgentSpecs();
    return { ok: true, agents: specs };
  });

  ipcMain.handle('agents:get', async (_evt, { id }) => {
    const spec = await loadAgentSpec(id);
    return { ok: true, agent: spec };
  });
}
```

**预估代码量：** ~40 行

#### Task 4.4：外部 Agent 集成（可选）

**产出：** `src/renderer/js/features/local-agents.js`

对应前端指南 §4.3。**检测时机：** 仅在用户打开 "外部 Agent" 选择器时才检测，不预加载。

```js
const CLI_DEFAULTS = {
  'claude-code': { name: 'Claude Code', isCoding: true, ... },
  'codex': { name: 'Codex', isCoding: true, ... },
};

async function detectCliAgents() {
  // 通过 IPC 调用后端检测 CLI 是否存在于 PATH
  return window.myAgent.invoke('local-agents:detect');
}
```

**后端对接：** 需新增 `src/ipc/local-agents.ts` handler。

**优先级：P2（可选），** 如果用户主要用内置 agent，此模块可跳过。

**预估代码量：** ~150 行

### 4.3 阶段4 完成标准

- [ ] Agent 列表页可浏览所有已注册 agent（builtin + custom）
- [ ] Agent 详情展示 Profile（名称/描述/系统提示词摘要/关联工具）
- [ ] Skill 详情面板可查看 SKILL.md 渲染内容
- [ ] Agent/Skill 数据通过 IPC 从后端加载，有 sessionStorage 缓存
- [ ] 新增 "Agents" 导航入口在侧边栏中

---

## 五、第五阶段：聊天系统升级

### 5.0 阶段目标

将现有基础聊天功能升级为完整的 Agent 对话体验：增强流式渲染、消息队列、轮询同步、@-mention、权限确认卡片。

### 5.1 现状 vs 目标

| 功能 | 现状 | 目标 |
|---|---|---|
| 流式渲染 | `stream.on('data', callback)` + `textContent +=` 追加 | `{promise, cancel}` 模式 + 增量渲染 + 工具调用卡片 |
| 消息队列 | 无（直接发送） | FIFO 消息队列，上一条流完成后才发下一条 |
| 停止生成 | `cancel()` 调用（基础） | `pendingConvs` Map 追踪 + 中止 controller |
| 轮询同步 | 无 | `pollTimers` Map + 页面刷新后检测助手响应 |
| @-mention | 无 | contenteditable 编辑器 + @-mention 高亮 + TreeWalker |
| 权限卡片 | 无 | Bash 权限确认 + 文件删除确认 |
| 内联 chip | 无 | Skill/工具作为内联标记（可选简化） |

### 5.2 任务拆解

#### Task 5.1：流式渲染增强

**产出：** 重构 `src/renderer/js/features/chat.js` 中的流式处理

```js
// 流事件类型
const STREAM_EVENTS = {
  'text_delta': (ev) => { /* 增量追加到消息气泡 */ },
  'tool_use': (ev) => { /* 渲染工具调用卡片 */ },
  'tool_result': (ev) => { /* 渲染工具结果（可折叠） */ },
  'message_end': () => { /* 标记消息完成，触发下一条排队 */ },
  'error': (ev) => { /* 渲染错误气泡 */ },
};
```

**工具调用卡片渲染：**

```html
<div class="tool-call-card">
  <div class="tool-call-header">
    <span class="tool-call-icon">🔧</span>
    <span class="tool-call-name">read_file</span>
    <span class="tool-call-args">src/config/schema.ts</span>
  </div>
  <div class="tool-call-result collapsed">
    <pre>... 工具输出 ...</pre>
  </div>
</div>
```

**预估代码量：** ~200 行

#### Task 5.2：消息队列

**产出：** 在 `state.js` 中已有 `messageQueues` Map，chat.js 中使用：

```js
async function sendMessage(text) {
  const msg = { id: generateId(), content: text, timestamp: Date.now() };
  const queue = messageQueues.get(currentSessionId) || [];
  queue.push(msg);
  messageQueues.set(currentSessionId, queue);

  // 如果队列只有当前消息，立即处理
  if (queue.length === 1) {
    await processQueue(currentSessionId);
  }
}

async function processQueue(sessionId) {
  const queue = messageQueues.get(sessionId);
  while (queue && queue.length > 0) {
    const msg = queue[0];
    await _sendOneMessage(sessionId, msg);
    queue.shift();
  }
}
```

**预估代码量：** ~80 行

#### Task 5.3：停止生成（增强）

```js
function abortSession(sessionId) {
  const pending = pendingConvs.get(sessionId);
  if (pending && pending.controller) {
    pending.controller.abort();
    pending.aborted = true;
    pendingConvs.delete(sessionId);
  }
  // 清空队列
  messageQueues.delete(sessionId);
}
```

**预估代码量：** ~30 行

#### Task 5.4：轮询与状态同步

```js
const pollTimers = new Map();    // sessionId → setInterval
const pollMsgCounts = new Map(); // sessionId → 最后已知消息标识

function startPolling(sessionId) {
  if (pollTimers.has(sessionId)) return;
  const timer = setInterval(async () => {
    try {
      const { messages } = await IPC.sessions.get(sessionId);
      const lastCount = pollMsgCounts.get(sessionId) || 0;
      if (messages.length > lastCount) {
        // 有新消息，更新 UI
        _appendNewMessages(sessionId, messages.slice(lastCount));
        pollMsgCounts.set(sessionId, messages.length);
      }
    } catch (_) { /* 忽略轮询错误 */ }
  }, 3000);
  pollTimers.set(sessionId, timer);
}
```

**预估代码量：** ~60 行

#### Task 5.5：@-mention 高亮

**产出：** 在 chat.js 的消息渲染后处理中添加

```js
function _highlightMentions(rootEl) {
  const knownNames = _collectMentionNames(); // 从 conversations + agents 收集

  // 按长度降序 → 长的优先匹配
  const re = _buildMentionRe(knownNames);

  // TreeWalker 遍历文本节点，跳过 <code>/<pre>/<a>
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (['CODE', 'PRE', 'A'].includes(node.parentElement?.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  // 替换匹配为 <span class="msg-mention">
  const replacements = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (re.test(node.textContent)) {
      replacements.push(node);
    }
  }
  replacements.forEach(node => {
    const span = document.createElement('span');
    span.innerHTML = node.textContent.replace(re, '<span class="msg-mention">$&</span>');
    node.parentNode.replaceChild(span, node);
  });
}
```

**预估代码量：** ~80 行

#### Task 5.6：权限确认卡片

**产出：** 在 chat.js 中新增权限确认处理

**本项目后端已有的权限机制：** `TOOL_EXEC_MODE` 环境变量控制 Bash 执行模式（`always_allow`/`always_deny`/`prompt`）。当模式为 `prompt` 时，需要通过 IPC 向渲染进程推送权限请求。

```js
// 订阅 Bash 权限推送
window.myAgent.onPushEvent('bash:permission', async (info) => {
  const choice = await uiChoice({
    title: t('bash.permission.title'),
    message: t('bash.permission.message', { command: info.command }),
    choices: [
      { id: 'allow_once', label: t('bash.permission.allow_once') },
      { id: 'deny', label: t('bash.permission.deny') },
    ],
  });
  await window.myAgent.invoke('bash:permission_response', {
    requestId: info.requestId,
    allow: choice === 'allow_once',
  });
});

// 订阅文件删除确认
window.myAgent.onPushEvent('delete_file.confirm', async (info) => {
  const confirmed = await uiConfirm({
    title: t('delete_file.confirm.title'),
    message: t('delete_file.confirm.message', { path: info.path }),
  });
  await window.myAgent.invoke('delete_file:confirm_response', {
    requestId: info.requestId,
    confirmed,
  });
});
```

**后端对接：** 需要在 `src/ipc/` 新增权限推送 → 渲染进程的通信链路。当前 `TOOL_EXEC_MODE=prompt` 时，后端 Bash 工具通过 `webContents.send('bash:permission', info)` 推送。

**预估代码量：** ~80 行

### 5.3 不作实现的项

| 指南功能 | 本项目决策 | 理由 |
|---|---|---|
| Skill/Connector 内联芯片（chat-use.js） | ❌ 跳过 | 需要不可见字符 Token 编码方案，复杂度高，CLI 应用不需要 |
| contenteditable 富文本输入 | ❌ 保持 textarea | 简单可靠，@-mention 在渲染侧高亮即可 |
| ChatFormPayload 动态表单 | 🟡 框架在阶段3 搭好，暂不接入 | 需要 Agent 主动请求表单输入才触发 |

### 5.4 阶段5 完成标准

- [ ] 消息按 FIFO 队列发送，同会话不并发
- [ ] 工具调用渲染为可折叠卡片（工具名 + 参数 + 结果）
- [ ] "停止"按钮能中止当前流并清空队列
- [ ] 页面刷新后能检测到进行中的助手响应（轮询）
- [ ] @-mention 在渲染后的消息中高亮
- [ ] Bash 权限确认和文件删除确认对话框可用

---

## 六、第六阶段：启动优化与性能

### 6.0 阶段目标

将启动流程从简单的 `DOMContentLoaded` 初始化重构为三阶段流水线，实现首屏快速展示 + 非关键任务延迟加载。

### 6.1 现状 vs 目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 启动流程 | `App.init()` 一次性初始化所有页面 | 三阶段流水线：A 并行准备 → B 首屏渲染 → C 延迟加载 |
| 模块加载 | 所有 `<script>` 在 HTML 中一次性加载 | 面板入口才加载对应脚本（懒加载） |
| 性能监控 | 无 | `performance.now()` 护栏 + `console.warn` 超阈值告警 |
| 状态恢复 | 无 | 恢复上次视图 + 上次会话 |

### 6.2 任务拆解

#### Task 6.1：三阶段启动流水线

**产出：** 重构 `src/renderer/js/app.js`

```js
async function bootApp() {
  const t0 = performance.now();

  // ── 初始化 i18n ──
  await initI18n();

  // ═══ Stage A（并行，无相互依赖）═══
  await _bootStage('A', async () => {
    await Promise.all([
      _stampAppVersion(),       // 版本号 + body class
      _loadUserInfo(),          // 用户信息 + 头像
      _loadProjects(),          // 项目列表
    ]);
  });

  // ═══ Stage B（依赖 Stage A，并行）═══
  await _bootStage('B', async () => {
    await Promise.all([
      loadConversations({ startup: true }),
      loadAgents(true, { summary: true }),  // Agent 摘要缓存
    ]);
  });

  // ── 恢复上次视图 ──
  _restoreLastView();

  // ═══ Stage C（延迟 ~2.5s，不阻塞首次交互）═══
  setTimeout(async () => {
    await _bootStage('C', async () => {
      await Promise.all([
        _checkProviderHealth(),     // Provider 可达性检查
        _subscribePushEvents(),     // 推送事件订阅
      ]);
    });
  }, 2500);
}

// 性能护栏
const BOOT_STAGE_WARN_MS = 1500;
const BOOT_TOTAL_WARN_MS = 3000;

async function _bootStage(name, fn) {
  const t0 = performance.now();
  try { return await fn(); }
  finally {
    const ms = Math.round(performance.now() - t0);
    if (ms > BOOT_STAGE_WARN_MS) {
      console.warn(`[boot] stage ${name} slow: ${ms}ms`);
    }
  }
}
```

**预估代码量：** ~100 行

#### Task 6.2：按需功能加载

**产出：** 重构页面初始化逻辑

```js
// 功能模块注册表
const FEATURES = {
  agents: { src: 'js/features/agents.js', init: 'initAgentsPage' },
  skills: { src: 'js/features/skills.js', init: 'initSkillsPage' },
  settings: { src: 'js/features/settings.js', init: 'initSettingsPage' },
};

const _loadedFeatures = new Set();
const _featureLoadPromises = new Map();

async function loadFeature(name) {
  if (_loadedFeatures.has(name)) return;
  if (_featureLoadPromises.has(name)) return _featureLoadPromises.get(name);

  const feat = FEATURES[name];
  if (!feat) throw new Error(`Unknown feature: ${name}`);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = feat.src;
    script.onload = () => {
      _loadedFeatures.add(name);
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load: ${feat.src}`));
    document.head.appendChild(script);
  });

  _featureLoadPromises.set(name, promise);
  return promise;
}

// 在 setView() 中按需加载
async function _initPage(view) {
  if (view === 'agents') {
    await loadFeature('agents');
    if (typeof initAgentsPage === 'function') initAgentsPage();
  }
  // ...
}
```

**当前项目策略：** 页面数量少（4 个），所有页面脚本已在 HTML 中加载。阶段6 的按需加载主要是**架构规范化** ——为未来扩展做准备，当前不强制拆分。

**预估代码量：** ~50 行

### 6.3 阶段6 完成标准

- [ ] 启动流程遵循三阶段流水线（A → B → C）
- [ ] 阶段超阈值有 `console.warn` 告警
- [ ] 上次视图和会话在启动时恢复
- [ ] 首屏渲染不因非关键初始化而阻塞
- [ ] 懒加载框架就绪（功能模块可按需加载）

---

## 七、总体路线图

### 7.1 各阶段依赖关系

```
阶段1 (基础积木)
  └─→ 阶段2 (IPC增强)
        └─→ 阶段3 (UI组件)
              ├─→ 阶段4 (Agent/Skill管理)
              │     └─→ 阶段5 (聊天升级)
              │           └─→ 阶段6 (性能优化)
              └─→ 阶段5 (部分并行：消息队列/轮询等不依赖阶段4)
```

### 7.2 工作量估算

| 阶段 | 预估代码量 | 预估天数 | 优先级 | 说明 |
|---|---|---|---|---|
| 阶段1：基础积木 | ~910 行 | 3-4 天 | **P0** | icons/i18n/utils/state + HTML/CSS重构 |
| 阶段2：IPC增强 | ~200 行 | 2-3 天 | **P0** | preload增强 + ipc-shim + main侧适配 |
| 阶段3：UI组件 | ~400 行 | 2-3 天 | **P1** | dialogs/sidebar/context-menu/chat-form |
| 阶段4：Agent/Skill | ~1,290 行 | 4-5 天 | **P1** | Agent管理 + Skill增强 + 后端IPC handler |
| 阶段5：聊天升级 | ~530 行 | 3-4 天 | **P1** | 流式增强/消息队列/轮询/@-mention/权限卡片 |
| 阶段6：性能优化 | ~150 行 | 1-2 天 | **P2** | 启动流水线 + 懒加载框架 |
| **合计** | **~3,480 行** | **15-21 天** | | |

### 7.3 增量交付策略

每个阶段完成后均可独立验证，不需等到全部完成才有可用应用：

- **阶段1 完成：** 外观升级（SVG 图标 + 国际化就绪），功能不变
- **阶段2 完成：** IPC 通信规范化，流式模式改为 `{promise, cancel}`
- **阶段3 完成：** UI 交互升级（对话框/右键菜单/侧边栏拖拽）
- **阶段4 完成：** **新功能上线** —— Agent 管理页
- **阶段5 完成：** 聊天体验升级 —— 工具调用卡片/权限确认/轮询
- **阶段6 完成：** 启动速度和用户体验优化

### 7.4 与后端阶段5 的协作

本项目后端阶段5（高级特性）也在并行推进中（[stage5-advanced-features.md](2026-08-07-stage5-advanced-features.md)）。前端阶段4-5 需要后端提供对应的 IPC Handler：

| 前端需求 | 后端依赖 | 就绪状态 |
|---|---|---|
| Agent 列表/详情 | `src/ipc/agents.ts` → `orchestration/agent-spec.ts` | 🟡 agent-spec 已实现，IPC handler 待新建 |
| Skill 详情 | 现有 `skills:list` / `skills:get` | ✅ 已可用 |
| 权限确认卡片 | Bash 权限推送 → 渲染进程 | 🟡 后端工具已有 `TOOL_EXEC_MODE`，推送链路待新建 |
| 文件删除确认 | 文件工具确认推送 | 🔴 待实现 |
| 流式工具调用事件 | `tool_use` / `tool_result` 事件 | 🟡 Runner 已产生事件，需 Main 进程转发 |

### 7.5 文件迁移计划

```
阶段1 迁移：
  dist/electron/renderer/index.html → src/renderer/index.html（重构）
  dist/electron/renderer/css/*.css   → src/renderer/style.css（合并）
  + src/renderer/js/shared/*.js      （新建）
  + src/renderer/js/state/state.js   （新建）
  + src/renderer/locales/zh.json     （新建）

阶段2 迁移：
  dist/electron/preload.cjs          → 增强（加 stream promise/cancel + 推送白名单）
  dist/electron/renderer/js/api.js   → src/renderer/js/ipc/ipc-shim.js（重构）
  dist/electron/main.cjs             → 新增统一 stream handler

阶段3 新增：
  + src/renderer/js/components/*.js  （新建）

阶段4 迁移：
  dist/electron/renderer/js/pages/skills.js → src/renderer/js/features/skills.js（重构）
  + src/renderer/js/features/agents.js      （新建）
  + src/ipc/agents.ts                       （新建）

阶段5 迁移：
  dist/electron/renderer/js/pages/chat.js → src/renderer/js/features/chat.js（重构）
  dist/electron/renderer/js/pages/sessions.js → src/renderer/js/features/sessions.js（重构）
  dist/electron/renderer/js/pages/settings.js → src/renderer/js/features/settings.js（重构）

阶段6 重构：
  dist/electron/renderer/js/app.js → src/renderer/js/app.js（重构）
```

### 7.6 构建流程

开发阶段直接让 Electron 加载 `src/renderer/`：
```js
// main.cjs - 开发模式
mainWindow.loadFile(
  process.env.MYAGENT_DEV
    ? 'src/renderer/index.html'
    : 'dist/electron/renderer/index.html'
);
```

生产构建时复制 `src/renderer/` 到 `dist/electron/renderer/`：
```json
// package.json scripts
"build:renderer": "node scripts/copy-renderer.js"
```

---

## 八、关键设计决策记录

### 8.1 为什么不直接用 npm + bundler

**决策：** 保持前端指南的经典 `<script>` 标签方案，不用 TypeScript/JSX/bundler。

**理由：**
1. 前端指南明确强调此约束（来自 Orkas CLAUDE.md §Renderer）
2. 与现有 `dist/electron/` 架构一致，改动最小
3. Electron 原生支持，无需配置 webpack/vite 构建管线
4. 学习项目，保持简单可理解

### 8.2 为什么跳过 contenteditable 富文本输入

**决策：** 保持 textarea 输入，在渲染侧做 @-mention 高亮。

**理由：**
1. contenteditable + 内联 chip 渲染（chat-use.js）是前端指南中最复杂的模块（~649 行 + 不可见字符编码）
2. 本项目是 CLI/学习型 Agent 框架，不需要专业聊天 UX
3. @-mention 高亮在渲染侧实现即可满足需求

### 8.3 为什么不做 marketplace

**决策：** Skill/Agent marketplace 简化为本地目录管理。

**理由：**
1. 前端指南的 marketplace 依赖 Orkas 云端服务
2. 本项目无后端云服务
3. 本地文件系统管理 Skill 已满足需求

### 8.4 为什么不做同步 i18n 启动

**决策：** 跳过 `sendSync('orkas:bootI18n')` 同步路径，直接走异步 IPC。

**理由：**
1. 前端指南的同步启动需要 `ipcRenderer.sendSync`（Electron 已废弃此 API）
2. 本项目当前仅中文，翻译表极少（~30 条），异步加载 < 50ms
3. 首次绘制前可能出现短暂占位符，影响极小

### 8.5 为什么不直接删除 `dist/electron/` 从头开始

**决策：** 渐进式重构，`dist/electron/` 保留为构建输出。

**理由：**
1. 现有 Electron 应用已经可用，推倒重来风险大
2. `dist/electron/` 中有大量经过验证的 IPC handler（main.cjs）
3. 渐进式迁移可以每个阶段独立验证

---

## 九、参考资料

| 文件 | 用途 |
|---|---|
| [仿写Agent前端框架指南](../../docs/spec/仿写Agent前端框架指南.md) | 目标架构与设计模式来源 |
| [仿写Agent框架指南](../../docs/spec/仿写Agent框架指南.md) | 后端框架参考（IPC handler 设计需要了解后端模块） |
| [stage5-advanced-features](2026-08-07-stage5-advanced-features.md) | 后端阶段5 实现状态（前端阶段4-5 依赖） |
| [Orkas内置组件完整参考](../../docs/spec/Orkas内置组件完整参考.md) | Orkas UI 组件参考（按需查阅） |
| `dist/electron/main.cjs` | 现有 Electron 主进程（IPC handler 适配起点） |
| `dist/electron/preload.cjs` | 现有 preload API（增强起点） |
| `dist/electron/renderer/` | 现有渲染进程代码（重构起点） |

---

## Next

1. **用户确认整体方案** — 验证阶段划分和优先级是否符合预期
2. **编写阶段1 plan + dispatch** — 详细的实现计划（Task 拆解 + WU 分配）
3. **按阶段逐步实现** — 每个阶段独立验证后进入下一阶段
