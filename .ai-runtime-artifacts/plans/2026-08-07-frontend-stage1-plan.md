---
artifact: implementation-plan
route: writing-plans
skills:
  - writing-plans
skills_evidence:
  - skipped: writing-plans (not found on this platform)
dispatch: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage1-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-07-frontend-implementation-all-stages.md § 第一阶段
  - docs/spec/仿写Agent前端框架指南.md § 第一阶段
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
created_at: 2026-08-07
status: draft
approved: false
---

# 阶段1：前端基础积木 — 实现计划

> **For agentic workers:** 本计划含 4 个独立 WU + 1 个集成 WU，通过 `orchestration` 并行派发。

**Goal:** 将现有 Electron 前端 (`dist/electron/renderer/`) 中分散的硬编码字符串、emoji 图标、内联样式替换为规范化的基础模块（icons / i18n / utils / state），产出 `src/renderer/` 作为新的前端源目录，现有功能（对话/会话/Skills/设置）在新架构下可用。

**Architecture:** 经典 `<script>` 标签方案（无 bundler），模块通过 IIFE + 全局变量通信。依赖顺序：`vendor/` → `shared/`（logger→icons→utils→i18n）→ `state/` → `components/` → `features/` → `app.js`。

**Tech Stack:** 纯 HTML/CSS/JS（ES5 兼容，无 TypeScript/JSX/npm），DOMPurify（XSS 防护，新增 vendor），marked（Markdown 渲染，已有）。

---

## 一、项目现状摸底

### 1.1 已有资产（在 `dist/electron/renderer/` 下）

| 文件 | 行数(估) | 说明 |
|---|---|---|
| `index.html` | ~230 | 4 页面 + session 面板，emoji 图标 + 硬编码中文 |
| `css/*.css` (7个) | ~800 | variables/reset/layout/components/chat/sessions/settings/skills/theme-dark |
| `js/app.js` | ~120 | 导航/页面切换/hash 路由 |
| `js/api.js` | ~65 | IPC 封装（sessions/chat/config/skills/providers） |
| `js/pages/chat.js` | ~600 | 对话页：发送/流式接收/会话列表/分组 |
| `js/pages/sessions.js` | ~500 | 会话管理：表格/搜索/批量/分页 |
| `js/pages/skills.js` | ~300 | Skills：网格/分类过滤/启用开关 |
| `js/pages/settings.js` | ~500 | 设置：二级导航/模型/工具/路径等 tab |
| `modules/markdown.js` | ~60 | marked 封装 |
| `vendor/marked.min.js` | — | 第三方库 |

### 1.2 阶段1 新建文件

| 文件 | 说明 |
|---|---|
| `src/renderer/js/shared/icons.js` | SVG 图标系统（~200行） |
| `src/renderer/js/shared/i18n.js` | 国际化模块（~120行） |
| `src/renderer/js/shared/utils.js` | 安全工具函数（~60行） |
| `src/renderer/js/shared/logger.js` | 渲染进程日志（~40行） |
| `src/renderer/js/state/state.js` | 全局状态管理（~150行） |
| `src/renderer/locales/zh.json` | 中文翻译表（~80行） |

### 1.3 阶段1 重构文件

| 文件 | 改动内容 |
|---|---|
| `src/renderer/index.html` | 从 `dist/electron/renderer/index.html` 复制重构：emoji→SVG图标、硬编码中文→`data-i18n`、`<script>` 顺序重排 |
| `src/renderer/style.css` | 合并 7 个 CSS 文件为 1 个，按节组织 |

---

## 二、Task 拆解

### Task 1：图标系统 `icons.js`（独立 WU）

**产出：** `src/renderer/js/shared/icons.js`

**依赖：** 无（零依赖模块）

**内容：**
- IIFE 封装，挂 `uiIconHtml()` / `fileIconHtml()` 到 `window`
- `UI_ICONS` 字典：从指南复制 ~30 个本项目必需的 SVG icon（message-square / search / settings / plus / x / trash / chevron-down / chevron-right / folder / file / terminal / users / sparkles / puzzle / list / archive / download / upload / edit / copy / check / alert-circle / info / external-link / send / stop-circle / clock / calendar / globe / moon / sun）
- 文件类型扩展名分类 Set（IMAGE_EXTS / CODE_EXTS / DATA_EXTS 等）
- `wrapUiIcon()` 统一渲染 `<svg>` 标签
- `_fileKindIconClass()` 按扩展名选择文件图标

**验收：** 浏览器 console 中 `uiIconHtml('settings')` 返回合法 SVG 字符串；`fileIconHtml('test.ts')` 返回 code 类图标

---

### Task 2：工具函数与日志 `utils.js` + `logger.js`（独立 WU）

**产出：** `src/renderer/js/shared/utils.js` + `src/renderer/js/shared/logger.js`

**依赖：** 无

**utils.js 内容：**
- `escapeHtml(str)` — `& < > " '` 五字符转义
- `safeHref(url)` — `_SAFE_URI_RE` 白名单校验
- `pickLocalizedField(obj, base, lang)` — 双语字段选择
- `normalizeDisplayText(value)` — 多余空格清理 + 引号反转义
- `_SAFE_URI_RE` — 允许 `https?/mailto/tel/chat-media/chat-app/kb-file/blob`

**logger.js 内容：**
- `LogLevel` 枚举（debug/info/warn/error）
- `createLogger(module)` 工厂 → `{ debug, info, warn, error }`
- 默认 `console` 输出，预留 IPC 转发接口（阶段2 实现）

**验收：** `escapeHtml('<script>')` 返回 `&lt;script&gt;`；`safeHref('javascript:alert(1)')` 返回 `''`

---

### Task 3：国际化 `i18n.js` + `zh.json`（独立 WU）

**产出：** `src/renderer/js/shared/i18n.js` + `src/renderer/locales/zh.json`

**依赖：** `window.myAgent.invoke`（IPC，异步加载翻译表）

**i18n.js 内容：**
- 异步 `initI18n()` → IPC 获取翻译表（回退到内联默认表）
- `t(key, vars?)` → 查表 + `{{var}}` 插值 + fallback 到 key
- `applyDomI18n(root?)` → 扫描 `[data-i18n]` / `[data-i18n-title]` / `[data-i18n-placeholder]`
- `getLang()` / `setLang(lang)` → 语言切换 + `i18n-change` 事件
- `_interpolate(template, vars)` → `{{name}}` 替换
- **不做** `sendSync` 同步启动（Electron 已废弃此 API，异步加载 < 50ms）

**zh.json 内容：** 覆盖当前 index.html 所有文本（~30 条），按 `sidebar.*` / `chat.*` / `sessions.*` / `skills.*` / `settings.*` / `dialog.*` 分组

**验收：** `t('chat.send')` 返回 "发送"；`t('chat.empty')` 返回 "开始一段新对话"；`applyDomI18n()` 后 DOM 中 `[data-i18n]` 元素被填充

---

### Task 4：全局状态管理 `state.js`（独立 WU）

**产出：** `src/renderer/js/state/state.js`

**依赖：** 无（纯状态模块，不依赖 DOM 或 IPC）

**内容：**
- `currentView` / `currentSessionId` — 当前视图/会话
- `conversations[]` — 会话列表（侧边栏数据源）
- `pendingConvs` Map — 每个 session 的挂起状态（`{ loadingEl, controller, aborted }`）
- `messageQueues` Map — 每个 session 的排队消息
- `_agentsCache` / `_skillsCache` — Agent/Skill 缓存
- `setView(view, sessionId, opts)` — 视图切换核心函数
- `_restoreLastView()` — 从 localStorage 恢复上次视图

**关键设计：**
- 所有状态是模块级顶层变量（`let`），各模块通过全局作用域直接读写
- 不使用 Redux/Vuex/任何框架
- `setView()` 切换面板 visibility + 高亮侧边栏 + 持久化 + 按需初始化

**验收：** `setView('skills')` 后 `currentView === 'skills'`；`document.getElementById('page-skills')` 有 `.active` class

---

### Task 5：HTML/CSS 重构 + 集成（依赖 WU 1-4）

**产出：** `src/renderer/index.html`（重构版）+ `src/renderer/style.css`（合并版）

**依赖：** Task 1-4 全部完成（HTML 引用它们的 `<script>` 标签）

**index.html 改动：**

1. **图标替换：** 移除所有 emoji（💬📋🧩⚙️📁🔍📥🗑️📊🔄📎✏️✅❌…），使用 `<script>` 中调用 `uiIconHtml()` 动态渲染或保留占位元素由 JS 填充
2. **文本标记：** 所有硬编码中文文本改为 `data-i18n="key"` 属性
3. **`<script>` 顺序重排：**
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
   <!-- features（迁移现有页面） -->
   <script src="./js/features/sessions.js"></script>
   <script src="./js/features/chat.js"></script>
   <script src="./js/features/skills.js"></script>
   <script src="./js/features/settings.js"></script>
   <!-- app -->
   <script src="./js/app.js"></script>
   ```
4. **DOMPurify 引入：** 从 npm 下载 `purify.min.js` → `src/renderer/js/vendor/dompurify/`
5. **CSP 更新：** 如果加了新 vendor，确保 CSP `script-src` 不阻拦

**style.css 合并策略：**
- 按节组织：`CSS Variables` → `Reset` → `Layout` → `Components` → `Chat` → `Sessions` → `Skills` → `Settings` → `Theme (Dark)`
- 不改样式逻辑，仅合并文件 + 添加新模块需要的样式（dialog / icon / i18n 相关）

**迁移现有页面 JS：**
- `dist/electron/renderer/js/pages/chat.js` → `src/renderer/js/features/chat.js`（改全局引用：`App.xxx` → `state.xxx`，`api.xxx` → 保持）
- `dist/electron/renderer/js/pages/sessions.js` → `src/renderer/js/features/sessions.js`
- `dist/electron/renderer/js/pages/skills.js` → `src/renderer/js/features/skills.js`
- `dist/electron/renderer/js/pages/settings.js` → `src/renderer/js/features/settings.js`
- `dist/electron/renderer/js/api.js` → `src/renderer/js/ipc/api.js`
- `dist/electron/renderer/modules/markdown.js` → `src/renderer/js/shared/markdown.js`
- `dist/electron/renderer/js/app.js` → `src/renderer/js/app.js`（改用 `state.setView()` + 调用 `initI18n()`）

**main.cjs 适配：** 开发模式下加载 `src/renderer/index.html` 而非 `dist/electron/renderer/index.html`

**验收：** Electron 启动后 4 个页面均可正常导航和操作，无 console 错误，无 emoji 残留

---

## 三、依赖图

```
Task 1 (icons.js)   Task 2 (utils+logger)   Task 3 (i18n+zh.json)   Task 4 (state.js)
       │                      │                        │                    │
       └──────────────────────┼────────────────────────┼────────────────────┘
                              │                        │
                              ▼                        ▼
                          Task 5 (HTML/CSS 重构 + 集成)
                              │
                              ▼
                    阶段1 完成（现有功能在新架构下可用）
```

**Task 1-4 完全独立，可并行执行。Task 5 依赖全部完成。**

---

## 四、验证计划

### 4.1 自动化检查

- [ ] 所有新建 JS 文件无语法错误（Electron 渲染进程加载不报错）
- [ ] `escapeHtml()` 五字符转义正确
- [ ] `safeHref()` 拒绝 `javascript:` / `data:` 等危险协议
- [ ] `t()` 在 key 缺失时返回 key 本身（不回退为 undefined）

### 4.2 手动验证（Electron 中）

- [ ] **图标验证：** 侧边栏/按钮/面板中不再出现 emoji，全部显示 SVG 图标
- [ ] **i18n 验证：** 所有 UI 文本正确显示中文（与重构前一致）
- [ ] **导航验证：** 4 个页面（chat/sessions/skills/settings）正常切换
- [ ] **对话验证：** 发送消息 → 流式接收 → 消息渲染正常
- [ ] **会话验证：** 会话列表显示、搜索、重命名、删除正常
- [ ] **Skills 验证：** Skill 列表显示、分类过滤、启用/禁用正常
- [ ] **设置验证：** 设置页面各 tab 切换和内容显示正常

### 4.3 回归验证

- [ ] 无 console 错误（CSP 违规、404、JS 异常）
- [ ] 无视觉回归（对比重构前后截图）
- [ ] main.cjs 开发模式加载路径正确

---

## 五、Plan 自检

- [ ] 每个 Task 产出文件明确，无模糊描述
- [ ] Task 1-4 完全独立，无交叉依赖，可并行派发
- [ ] Task 5 的依赖关系清晰（完成 1-4 后执行）
- [ ] 验收标准可操作（非"看起来好"）
- [ ] 不涉及后端改动（纯前端重构）
- [ ] 现有功能全部保持可用

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 并行派发 → 确认后走 `orchestration` → `2026-08-07-frontend-stage1-dispatch.md`
