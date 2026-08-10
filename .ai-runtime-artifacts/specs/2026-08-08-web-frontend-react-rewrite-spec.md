---
title: Web 前端重写 — 从 vanilla JS 升级到 React + Vite + Tailwind v4
date: 2026-08-08
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
  - frontend-ui-engineering
  - source-driven-development
skills_evidence:
  - ~/.claude/skills/brainstorming/SKILL.md（已 Load）
  - harness-kit/.claude/rules/ai-entry.md（always-loaded）
  - .claude/skills/document-review/{SKILL.md, review-rules/design.md, checklists/review-checklist.md}（修订阶段 Load）
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/artifact-templates/spec.harness-overlay.md
  - /Users/mima0000/Documents/学习-001/源码学习/Orkas/resources/app-ui/home-zh.jpg
  - /Users/mima0000/Documents/学习-001/源码学习/Orkas/resources/app-ui/home-en.jpg
  - .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
  - .ai-runtime-artifacts/reviews/2026-08-08-web-frontend-spec-document-review.md（三路审查报告）
  - src/web/server/{csp,static,sse,index}.ts（后端实情）
created_at: 2026-08-08
updated_at: 2026-08-08
status: revised
approved: false
prior_reviews:
  - reviews/2026-08-08-web-frontend-spec-document-review.md（v1 review）
  - reviews/2026-08-08-web-frontend-spec-document-review-v2.md（v2 review, 13 Critical + 18 Important）
revision_history:
  - v2: 解 v1 review 15 Critical（删除 httpOnly cookie、改 SSE 为 fetch+ReadableStream、改用 HashRouter、补后端最小改动清单等）
  - v3: 补 § 12 完整交互合同（60+ 交互）
  - v4: 解 v2 review 13 Critical + 18 Important（错误码全表 27 个 code、状态机边界分流 + submitting 10s 超时 + reconnecting 终止态、19 endpoint 统一、新增 3 个用户高频动作 § 12.1.7/8/9）
---

# Web 前端重写 — 从 vanilla JS 升级到 React + Vite + Tailwind v4

> 本文为 my-agent 项目前端视觉/技术栈升级的设计 spec（**修订版 v4**，已对照 v2 review 综合报告完成 13 Critical + 18 Important 修订）。
> 起点：当前 `web/` 下是基于 vanilla JS + 手写 CSS 的浏览器前端（已在 2026-08-07 spec 中实现），用户主观评价"有点丑"。
> 视觉参考：Orkas `home-zh.jpg` / `home-en.jpg`（极简、留白、克制色彩、左侧窄边栏）。
> 约束：**借鉴** Orkas 视觉语言，**不** 1:1 照搬；页面结构、导航项、首页内容以本项目 wire-routes 实际能力为准。
> 代码改动尚未开始。本 spec 通过审批 + 后续 writing-plans 阶段生成的实施计划批准后才进入实现。

---

## 1. 背景与目标

### 1.1 问题陈述

- 当前 `web/` 前端是纯 vanilla JS（无构建步骤、无类型检查），主要组件在 `web/js/components/`（24 个手写组件 + 11 个 modals）。
- 视觉表现用户不满意：配色平淡、信息密度低、组件复用度差、没有主题系统。
- 后端 19 个 wire-routes（Provider 8 + Session 5 + Chat 2 + Agent 2 + Skill 2；详见 `contracts/2026-08-07-web-frontend-api-contract.md` § 1）已经稳定，本期**后端最小改动清单见 § 3.4**。

### 1.2 目标

1. **观感现代化**：对标 Orkas 视觉语言（极简 + 留白 + 克制色彩），不 1:1 照搬。
2. **技术栈升级**：引入 React + TypeScript + Vite + Tailwind v4 + shadcn/ui，获得类型安全与组件化能力。
3. **架构清晰**：pages + components 分层，跨领域复用走 `features/`，通用 UI 走 `components/ui/`。
4. **保留行为**：所有 wire-routes 行为不变；SSE 流式聊天、@ 提及、slash 命令、⌘K 等已有交互保留并升级。
5. **可访问性 ≥ WCAG 2.1 AA**：所有交互键盘可达，颜色对比 ≥ 4.5:1。
6. **性能预算**：首屏 JS（gzipped）≤ 180KB，LCP ≤ 1.2s（**prod 预览**模式测量，非 dev）。

### 1.3 非目标

- **不**改后端业务路由（19 个 wire-routes）、SSE 事件协议、CSP 主体策略（`script-src` / `style-src` 不动）。
- **不**引入桌面壳（Electron / Tauri）。
- **不**做 SSR / Next.js；本期纯 CSR。
- **不**国际化扩展（保留现有 `zh-CN` / `en`，不引入 i18n 框架如 `react-i18next`）。
- **不**优化移动端触摸交互（**v4 新增**：本期仅桌面；hover/right-click 在触屏不可用，操作菜单通过 kebab button `⋮` 触发；移动端体验列入后续 backlog）。
- **不**做账户系统 / 多用户 / cookie 认证（API Key 本就由后端 ProvidersStore 持有，前端不接触）。
- **后端允许的最小改动**见 § 3.4（csp.ts 增 `font-src 'self'`、static.ts 增扩展白名单 / 改 mime fallback、sse.ts 维持）。其余文件零改动。

---

## 2. 技术栈决策

### 2.1 选型 + 不选理由（带对照，避免 Golden Hammer）

| 层 | 选择 | 不选 X 的理由 |
|---|---|---|
| 框架 | **React 19.1.x** | 不选 Vue 3：本项目 TS 生态更熟；不选 Svelte：生态薄 |
| 构建 | **Vite 6.3.x** | 不选 Rsbuild/Rspack：生态较新、插件需手写；不选 Next.js：与本期轻量架构不符 |
| 样式 | **Tailwind CSS 4.0.x**（**CSS-first `@theme`**） | 不选 CSS Modules：复用 utility 需手写；不选 UnoCSS：生态比 Tailwind 薄 |
| 组件库 | **shadcn/ui（手拷模式）+ Radix Primitives ≥ 1.1.x** | 不选 Ant Design / MUI：样式重塑成本高；不选完全自写：a11y 风险 |
| 客户端状态 | **Zustand 5.x**（≤ 4 个 slice） | 不选 Redux Toolkit：当前瞬态 < 5 个 slice，样板代码过多 |
| 服务端状态 | **TanStack Query v5.x** | 不选 SWR：缓存/失效/infiniteQuery 不如 Query 灵活；不选原生 fetch：缺缓存层 |
| 路由 | **React Router v6.28.x（HashRouter）** | 不选 BrowserRouter：现有静态服务无 SPA history fallback（见 § 3.4 C 项） |
| Markdown | **react-markdown 9.x + remark-gfm 4.x + rehype-sanitize 6.x（按需 `rehype-raw`）** | 不选延续 marked + DOMPurify：等价行为需 `rehype-raw`，见 § 7.4 |
| 表单 | **react-hook-form 7.x + zod 3.x**（与后端共享 schema） | 不选 Formik：性能 / 重渲染风险 |
| 日期 | **date-fns 4.x（仅具名 import）** | 不选 dayjs：API 不够函数式 |
| 图标 | **lucide-react 0.4xx** | 不选 emoji：跨 OS 渲染差异大、与 shadcn 默认搭配 |
| 类名合并 | **clsx 2.x + tailwind-merge 2.x** | 不选 classnames：缺 tw-merge |
| SSE 客户端 | **`fetch(POST) + ReadableStream`** 手写解析 | 不选 EventSource：POST + body 不支持；不选 @microsoft/fetch-event-source：+5KB、超预算 |
| 测试 | **Vitest 2.x（jsdom）+ @testing-library/react 16.x + Playwright 1.4x + @axe-core/playwright** | 不选 Cypress：DX/速度不如 Playwright |

### 2.2 依赖版本表（精确锁定）

```jsonc
// web/package.json 核心依赖
{
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^6.28.0",     // HashRouter
    "@tanstack/react-query": "^5.62.0",
    "zustand": "^5.0.0",
    "react-hook-form": "^7.54.0",
    "zod": "^3.24.0",                  // 与后端 ^3.24.0 对齐
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-sanitize": "^6.0.0",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.469.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-dropdown-menu": "^2.1.4",
    "@radix-ui/react-tabs": "^1.1.2",
    "@radix-ui/react-tooltip": "^1.1.6",
    "@radix-ui/react-toast": "^1.2.4",
    "@radix-ui/react-slot": "^1.1.1"
  },
  "devDependencies": {
    "vite": "^6.3.0",
    "@vitejs/plugin-react": "^4.3.4",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",            // 与根对齐
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/node": "^22.0.0",          // 与根对齐
    "vitest": "^2.1.0",                // 与根对齐
    "jsdom": "^25.0.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@playwright/test": "^1.49.0",
    "@axe-core/playwright": "^4.10.0",
    "rollup-plugin-visualizer": "^5.13.0"
  }
}
```

### 2.3 包管理器与 workspace

- **使用 npm**（仓库现状 `package-lock.json` + 无 workspace 字段；保持 npm 一致，避免混用锁文件）
- **不**建 pnpm workspace（避免引入双包管理器与 root 改造动作）
- `web/` 与根通过 npm install 分别安装；共享依赖（`zod` / `vitest` / `typescript`）在 root 与 web 各装一份（版本对齐即可，不强制去重）

### 2.4 安装命令（一行复制）

```bash
cd web && npm install
```

---

## 3. 架构与目录结构

### 3.1 整体形态

单 SPA（Vite build），**dev 阶段不引入 Vite proxy**（dev 与 prod 均直接打后端 4321 端口，详见 § 3.3）；prod 阶段由现有 `src/web/server/static.ts` 服务 `web/dist/` 产物。

后端 wire-routes **零业务改动**；前端 `lib/api.ts` 复用 `contracts/2026-08-07-web-frontend-api-contract.md` 中的 Zod schema 做运行时校验。

### 3.2 目录结构（精确）

```
web/
├── package.json
├── vite.config.ts                     # base='./'（相对路径，与 HashRouter 兼容）；plugins: react + visualizer
├── tsconfig.json                      # extends 根 tsconfig.json，前端 lib: ["DOM","ES2022","DOM.Iterable"]
├── postcss.config.js                  # plugins: { '@tailwindcss/postcss': {} }
├── components.json                    # shadcn/ui CLI 配置（手拷模式，alias "@/" → "./src/"）
├── index.html                         # 最小骨架：<html lang="zh-CN">、<meta viewport>、<title>my-agent</title>、#root、<script type="module" src="/src/main.tsx">
├── public/                            # favicon、logo（暂用 my-agent 字标）
└── src/
    ├── main.tsx                       # createRoot + StrictMode + QueryClientProvider + RouterProvider + ThemeProvider
    ├── App.tsx                        # Router shell（HashRouter）
    ├── routes.tsx                     # createHashRouter 配置
    ├── i18n/
    │   ├── zh.json                    # 中文文案
    │   └── en.json                    # 英文文案
    ├── styles/
    │   ├── globals.css                # Tailwind v4 @import + design tokens（CSS vars）
    │   └── tokens.ts                  # TS 导出 token 给 shadcn/ui 使用
    ├── lib/
    │   ├── cn.ts                      # cn() = clsx + tailwind-merge
    │   ├── api.ts                     # fetch wrapper + Zod 校验
    │   ├── sse.ts                     # fetch(POST) + ReadableStream 解析 + 断线重连 + abort
    │   ├── i18n.ts                    # i18n loader（zh/en 切换 + 持久化）
    │   └── keymap.ts                  # 全局快捷键注册（平台无关逻辑）
    ├── components/
    │   ├── ui/                        # shadcn/ui 手拷（Button、Dialog、DropdownMenu、Tabs、Tooltip、Toast、Input、Textarea、Card 等）
    │   ├── layout/
    │   │   ├── AppShell.tsx           # Sidebar + Topbar + <Outlet />
    │   │   ├── Sidebar.tsx            # 导航 + 会话列表槽位
    │   │   └── Topbar.tsx             # 当前页标题 + 主题切换 + 语言切换
    │   ├── chat/
    │   │   ├── Composer.tsx           # 输入框 + @ 提及 + To: + 工作区 + 发送
    │   │   ├── MessageList.tsx        # 消息列表（含自动滚动、增量 append）
    │   │   ├── MessageBubble.tsx      # 单条 user / assistant（Markdown 懒加载）
    │   │   ├── Markdown.tsx           # react-markdown + rehype-sanitize（lazy import）
    │   │   ├── ToolCallCard.tsx       # tool-call + tool-result 渲染
    │   │   └── StreamIndicator.tsx    # 流式中"正在输入"动画
    │   └── feedback/
    │       ├── EmptyState.tsx
    │       ├── ErrorBoundary.tsx
    │       └── ConfirmDialog.tsx      # 通用确认壳
    ├── features/
    │   ├── chat/
    │   │   ├── useChatStream.ts       # SSE 流式 hook（唯一实现；不在 hooks/ 重复声明）
    │   │   ├── composerDraftStore.ts  # Zustand slice：Composer 草稿 + @ 提及候选（不存 sessionId）
    │   │   └── types.ts
    │   ├── sessions/
    │   │   ├── useSessions.ts         # list + create + delete + rename
    │   │   └── SessionListItem.tsx    # 在 Sidebar 内渲染
    │   ├── providers/
    │   │   └── ProviderForm.tsx       # 受控表单（react-hook-form + zod）
    │   ├── skills/
    │   │   ├── SkillPicker.tsx
    │   │   └── SkillCard.tsx
    │   └── agents/
    │       ├── AgentList.tsx
    │       └── AgentForm.tsx
    ├── pages/
    │   ├── DashboardPage.tsx          # /  默认（欢迎 + 最近会话 + Composer 快速发起）
    │   ├── ChatPage.tsx               # /chat 与 /chat/:sessionId
    │   ├── SessionsPage.tsx           # /sessions
    │   ├── ProvidersPage.tsx          # /providers
    │   ├── SkillsPage.tsx             # /skills
    │   ├── AgentsPage.tsx             # /agents
    │   ├── SettingsPage.tsx           # /settings
    │   └── NotFoundPage.tsx           # *
    └── hooks/
        ├── useDebounce.ts
        ├── useKeyMap.ts               # React 订阅包装 lib/keymap.ts
        ├── useTheme.ts                # dark | light | system（监听 prefers-color-scheme）
        └── useMediaQuery.ts           # 与 Tailwind 断点同步（md=768 / lg=1024）
```

> **store/ 目录不再独立** — 所有 slice 与领域强相关，全部下沉到 `features/<domain>/`。`store/ui.ts`（主题/语言/Sidebar 折叠）改为 `features/ui/useUiStore.ts`。

### 3.3 集成点

- **运行时端口**：dev 与 prod 均直连 `http://localhost:4321`（**前端不再用 Vite proxy**；HashRouter + 同源 fetch 天然绕过跨域；详见 § 5.1 路由方案）
- **prod 启动**：设环境变量 `MY_AGENT_WEB_ROOT=web/dist node bin/my-agent-web.ts`（`bin/my-agent-web.ts` 已有该 env 支持）
- **CSP**：维持 `src/web/server/csp.ts` 主体；**仅增** `font-src 'self'`（详见 § 3.4）
- **静态服务**：维持 `src/web/server/static.ts`；**仅扩展** `ALLOWED_EXTS`（详见 § 3.4）

### 3.4 后端最小改动清单（精确定位）

| 文件 | 改动 | 是否可 env 规避 | 优先级 |
|---|---|---|---|
| `src/web/server/csp.ts` | `font-src` 增 `'self'` | 否 | M2 |
| `src/web/server/static.ts` | `ALLOWED_EXTS` 增 `.mjs`/`.woff2`/`.png`/`.webmanifest`/`.map`；cache-control 改为按 hash 二分（详见 § 7.7） | 否 | M2 |
| `src/web/server/index.ts` | 零改动 | — | — |
| `src/web/server/sse.ts` | 零改动（事件协议以源码 `SSE_EVENT_TYPES` 为准；契约 § 4.3 表格待后端澄清） | — | — |
| `src/web/server/routes/*` | 零改动 | — | — |
| `bin/my-agent-web.ts` | 零改动（已支持 `MY_AGENT_WEB_ROOT` / `MY_AGENT_WEB_PORT`） | — | — |
| `package.json`（根） | 零改动 | — | — |
| `vitest.config.ts`（根） | 零改动（web 自建 `web/vitest.config.ts`，include 仅 `web/src/**`） | — | — |

> **未列入清单 = 不允许改**。任何超出清单的改动必须先开 spec issue 重新审批。

### 3.5 模块依赖方向矩阵（强制）

```
            components   components/ui   components/chat   components/layout   components/feedback   features   pages   hooks   lib
pages              ✓                ✓                ✓                    ✓                    ✓            ✓        ✓       ✓      ✓
features           △(只读)           ✗                ✗                    ✗                    ✗            �        ✗       ✓      ✓
components/chat    ✓                ✓                 —                    ✗                    △           ✗        ✗       ✓      ✓
components/layout  ✓                ✓                 ✗                    —                    △           △        ✓       ✓      ✓
components/feedb.  ✓                ✓                 ✗                    ✗                    —           ✗        △       ✓      ✓
components/ui      ✗                —                 ✗                    ✗                    ✗           ✗        ✗       ✗      ✓(cn)
hooks              ✓                ✗                 ✓                    ✓                    ✓           ✓        ✓       △      ✓
lib                ✓                ✗                 ✓                    ✓                    ✓           ✓        ✓       ✓      —
```

> `✓` 允许 import；`✗` 禁止 import；`△` 限定场景（`features` 只能被 `pages` 导入；`components/chat` 不能导入 `features/*`，必须由 page 编排）。

---

## 4. 视觉设计系统

### 4.1 Design Tokens（CSS-first，写入 `styles/globals.css`）

**Light theme**（写入 `:root`）：

```css
:root {
  /* Surfaces */
  --bg:              #f7f8fa;
  --surface:         #ffffff;
  --surface-hover:   #f3f4f6;
  --border:          #ececef;

  /* Text */
  --text:            #1f2328;          /* on --bg: 13.6:1 ✓ AA */
  --text-muted:      #4b5563;          /* on --bg: 7.6:1 ✓ AA（替代原 #6b7280 的 4.8:1 边缘） */
  --text-faint:      #6b7280;          /* 仅用于非关键提示 */

  /* Accents */
  --accent:          #f0efff;          /* 激活态淡紫底 */
  --accent-fg:       #4f46e5;          /* on --accent: 5.4:1 ✓ AA */
  --primary:         #6c5ce7;
  --primary-fg:      #ffffff;          /* on --primary: 5.4:1 ✓ AA */

  /* Status */
  --danger:          #e5484d;
  --danger-bg:       #fef2f2;
  --success:         #30a46c;
  --warning:         #f5a524;

  /* Type */
  --font-sans: Inter, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;

  --text-h1:    28px / 700 / -0.01em;
  --text-h2:    18px / 600 / 0;
  --text-body:  14px / 400 / 0;
  --text-mute:  13px / 400 / 0;

  /* Radius */
  --radius-sm:   6px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-full: 9999px;

  /* Shadows（默认不用；模态用 shadow-lg opacity 8%） */
  --shadow-modal: 0 10px 30px rgba(0,0,0,0.08);

  /* 自托管 woff2 路径（web/public/fonts/） */
  --font-sans-url: url("/fonts/Inter-Regular.woff2") format("woff2");
  --font-sans-bold-url: url("/fonts/Inter-Bold.woff2") format("woff2");
}
```

**Dark theme**（写入 `:root[data-theme="dark"]` + `:root[data-theme="system"][data-system-theme="dark"]`）：

```css
:root[data-theme="dark"],
:root[data-theme="system"][data-system-theme="dark"] {
  --bg:              #0f1115;
  --surface:         #16181d;
  --surface-hover:   #1d2025;
  --border:          #2a2d33;

  --text:            #e6e7ea;          /* on --bg: 14.2:1 ✓ AA */
  --text-muted:      #9ca3af;          /* on --bg: 6.4:1 ✓ AA */
  --text-faint:      #6b7280;

  --accent:          #2a2452;
  --accent-fg:       #a5b4fc;          /* on --accent: 7.8:1 ✓ AA */
  --primary:         #7c6df0;
  --primary-fg:      #0f1115;

  --danger:          #f87171;
  --danger-bg:       #2a1313;
  --success:         #4ade80;
  --warning:         #fbbf24;
}
```

> 主题切换策略：`data-theme` 属性（`dark` / `light` / `system`）持久化到 `localStorage:my-agent.theme`；`system` 监听 `prefers-color-scheme` 媒体查询；切换由 `useTheme.ts` 驱动。**禁止 FOUC**：`<head>` 内嵌同步初始化脚本在 React 挂载前读 localStorage 并设置 `data-theme` 属性。

### 4.2 字体方案（决策）

- **自托管 woff2** + `font-display: swap` + `unicode-range` 子集化
- 路径：`web/public/fonts/Inter-{Regular,Bold,Medium}.woff2` + `JetBrainsMono-Regular.woff2`
- **不用 Google Fonts**（避免渲染阻塞 + 离线不可用 + 跨域）
- CSP 改动：详见 § 3.4（`font-src` 增 `'self'`）

### 4.3 关键组件视觉规范

| 组件 | 规范 |
|---|---|
| `Sidebar` | 固定 272px，白底（`--surface`）+ 1px 右边框；nav item 高 36px 圆角 `--radius-sm`；激活态左侧 3px 紫色条 + `--accent` 底 |
| `Topbar` | 56px 高，`--surface` + 1px 下边；右侧放主题切换、语言切换、�K 提示 |
| `DashboardPage` 欢迎 | 主区垂直居中（`min-h-[calc(100vh-56px)] flex items-center`），大标题 + 灰色描述 |
| `Composer` | 宽 720px max、圆角 `--radius-lg`、`shadow-sm`，底部一行 `+` 按钮、`To:` 标签、`工作区:` 下拉、紫色发送按钮 |
| `MessageBubble` | 用户右对齐 `--surface-hover`；助手左对齐 `--surface` + 1px `--border` |
| `EmptyState` | 居中 + 24px 灰色图标 + 灰色短句 + 主 CTA |
| `Modal` | Radix Dialog；backdrop 黑 30%；内容圆角 `--radius-lg`、`--shadow-modal` |

### 4.4 动效（克制）

- 路由切换：200ms 淡入淡出
- Sidebar 激活态：150ms 背景过渡
- Composer focus：150ms 边框色过渡
- 流式"正在输入"：3 个点循环（每点 200ms）
- **全部尊重 `prefers-reduced-motion: reduce`**：关闭所有非必要动画

---

## 5. 路由与页面

### 5.1 路由方案：**HashRouter**（关键决策）

- **决策理由**：现有 `src/web/server/static.ts:resolveStaticPath` 只把精确 `/` 映射到 `/index.html`，**没有 SPA history fallback**（已读源码确认）。改用 `BrowserRouter` 需后端加 fallback，违反"后端最小改动"。改用 **`HashRouter`** 后所有路由变成 `/#/chat/abc`，静态服务只需服务 `index.html`，无需后端改动。
- **代价**：`/api/...` 仍是同源 path，不受 HashRouter 影响；URL 含 `#`，SEO 不可用（本期 CSR，无 SEO 需求）。

### 5.2 路由表

| 路径 | 页面 | 说明 |
|---|---|---|
| `/` | `DashboardPage` | 欢迎语 + 最近会话列表 + Composer 快速发起 |
| `/chat` | `ChatPage`（无 session 时空态） | |
| `/chat/:sessionId` | `ChatPage`（加载历史消息） | sessionId 来自 URL，**不写 Zustand** |
| `/sessions` | `SessionsPage` | |
| `/providers` | `ProvidersPage` | |
| `/skills` | `SkillsPage` | |
| `/agents` | `AgentsPage` | |
| `/settings` | `SettingsPage` | |
| `*` | `NotFoundPage` | |

### 5.3 Sidebar 导航（lucide-react 图标）

1. `MessageSquare` 对话 → `/chat`
2. `History` 会话 → `/sessions`
3. `Bot` 子 Agent → `/agents`
4. `Plug` Skills → `/skills`
5. `Settings2` 提供商 → `/providers`
6. ——— 分隔 ———
7. `SlidersHorizontal` 设置 → `/settings`（置底）

> **未引入** Orkas 的 Commander / Auto / Library / My Apps / Projects / Tasks —— 项目无对应 wire-routes。

### 5.4 DashboardPage（默认首页）

```
[Sidebar]  │  [Topbar]
           │  （主区垂直居中）
           │   ─────────────────
           │   下午好，朋友
           │   想做什么？描述任务，或选一个最近会话继续
           │
           │   �──────────────────────────────┐
           │   │ Composer（宽 720px）          │
           │   └──────────────────────────────┘
           │
           │   最近会话
           │   ─────────
           │   • 修复登录 bug            · 2 小时前
           │   • 写单元测试 for chat    · 昨天
           │   • 重构 SSE 模块            · 3 天前
```

### 5.5 ChatPage（核心交互页）

```
[Sidebar] │  [Topbar (会话名 + 操作)]
          │  ┌─────────────────────────────────────┐
          │  │ MessageList（自动滚动 + 增量 append）│
          │  │  ┌─ user ─────────────────────┐    │
          │  │  │ 你好                       │    │
          │  │  └────────────────────────────┘    │
          │  │  ┌─ assistant ────────────────┐    │
          │  │  │ 你好！有什么可以帮你？     │    │
          │  │  └────────────────────────────┘    │
          │  │  ┌─ assistant streaming ──────┐    │
          │  │  │ · · ·                       │    │
          │  │  └────────────────────────────┘    │
          │  └─────────────────────────────────────┘
          │  [Composer]
```

### 5.6 其它页面

- `ProvidersPage`：左侧 list（280px）+ 右侧 edit 面板；顶部 "+ 新建 provider" 按钮
- `SkillsPage`：grid 卡片（3 列 desktop / 1 列 mobile）
- `AgentsPage`：表格 + 行内操作
- `SessionsPage`：表格 + 搜索 + 删除
- `SettingsPage`：分组卡片（外观 / 语言 / 快捷键 / 关于）

### 5.7 快捷键（行为对齐 + 不丢既有）

| 快捷键 | 行为 |
|---|---|
| `⌘K` / `Ctrl+K` | 命令面板（搜索会话/页面/命令） |
| `⌘/` | 聚焦 Composer |
| `⏎`（Composer focus） | 发送 |
| `⇧⏎` | 换行 |
| `Esc` | 关闭模态 / 取消流式 |
| `⌘B` | 折叠 Sidebar |
| `⌘,` | 打开 Settings（**不用 ⌘.**，与浏览器"停止加载"冲突） |

> 对照既有 `web/js/app.keymap.js` 全部 12 个快捷键，行为对齐；新增的仅 `⌘,`。

---

## 6. 数据流

### 6.1 状态分层

| 层 | 工具 | 职责 |
|---|---|---|
| 服务端状态 | TanStack Query | API 数据（sessions / providers / skills / agents）；缓存、失效、重试 |
| 客户端瞬态 | Zustand slice（领域内） | UI 偏好（主题/语言/Sidebar 折叠） + Composer 草稿 + @ 提及候选 |
| 流式状态 | `useChatStream`（React state + ref） | 正在生成的 assistant token 缓冲；commit 后用 `setQueryData` 写回 cache |
| 路由状态 | React Router v6 HashRouter | 当前 URL；sessionId **只读自 URL**，不写 Zustand |

### 6.2 QueryClient 默认配置

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,                 // 列表 30s / 详情 5min（按 query key 覆写）
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status ?? 0;
        return status >= 500 && failureCount < 2;  // 不重试 4xx（含 CHAT_SESSION_BUSY 429）
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,                           // mutation 一律不重试
    },
  },
});
```

### 6.3 Query keys（factories 命名约定）

```ts
export const queryKeys = {
  sessions: {
    all:    ['sessions'] as const,
    detail: (id: string) => ['session', id] as const,
  },
  providers: {
    all:    ['providers'] as const,
    detail: (id: string) => ['provider', id] as const,
  },
  skills: {
    all: ['skills'] as const,
    detail: (id: string) => ['skill', id] as const,
  },
  agents: {
    all: ['agents'] as const,
    detail: (id: string) => ['agent', id] as const,
  },
} as const;
```

Mutation 成功后失效：
- `POST /api/sessions` → invalidate `queryKeys.sessions.all`
- `PUT/DELETE /api/sessions/:id` → invalidate `queryKeys.sessions.detail(id)` + `.all`
- 流式完成后用 `queryClient.setQueryData(queryKeys.sessions.detail(id), …)` 写回，不走 invalidate（避免打断其它订阅）

### 6.4 SSE 流式聊天（fetch + ReadableStream）

#### 6.4.1 传输方式

- **POST** `/api/sessions/:id/messages/stream` 带 body `{ text, systemPrompt? }`
- 用 `fetch(POST, { body: JSON.stringify(…), signal })` 发起；不通过 `EventSource`（不支持 POST/body）
- 读取响应 `response.body.getReader()`（`ReadableStream<Uint8Array>`）
- 按 SSE 协议逐帧解析（`event:` / `id:` / `data:` 三行 + 空行）

#### 6.4.2 事件枚举（**以 `src/web/server/sse.ts:SSE_EVENT_TYPES` 源码为准**）

> ⚠️ 契约文档 § 4.3 表格（`text_delta / tool_delta / tool_start / ...`）与源码 `SSE_EVENT_TYPES`（`message_start / content_block_delta / tool_use / tool_result / message_delta / message_stop / error / done / aborted / usage / ping`）**不一致**。spec 以源码为准；契约表格待后端开 issue 澄清（不在本期修）。

| 事件 | data payload（按源码） | 客户端处理 |
|---|---|---|
| `message_start` | `{ streamId, cid, seq }` | 记录 streamId / 起始 seq；不渲染 |
| `content_block_start` | `{ seq, type: 'text' \| 'tool_use', index }` | 标记 assistant 块边界（用于 text replacement 与 tool_use 切换）|
| `content_block_delta` | `{ seq, delta: { text?: string } }` | append 到 assistant message |
| `content_block_stop` | `{ seq, index }` | 关闭当前 assistant 块 |
| `tool_use` | `{ seq, name, id, input }` | 插入 ToolCallCard（输入态） |
| `tool_result` | `{ seq, name, id, result, isError? }` | 关闭 ToolCallCard |
| `message_delta` | `{ seq, stop_reason?, usage? }` | 累积 usage；不渲染 |
| `message_stop` | `{ seq }` | 标记完成；保留已渲染内容 |
| `error` | `{ code, message }` | Toast 报错；标记 assistant 失败；不重试 |
| `done` | `{ finalMessage }` | 关闭连接；commit 到 cache |
| `aborted` | `{ seq, reason? }` | 用户中止后端确认 |
| `usage` | `{ inputTokens, outputTokens, totalTokens }` | 仅记账，**v4 显式存储位置**：累积到 `queryKeys.sessions.detail(id).usage`（**不**落 localStorage，避免跨会话泄露）；不渲染到 UI（**本期不上线用量统计页面**） |
| `ping` | `{ ts }` | 忽略 |

> **未列出的事件类型一律忽略**（不 throw），与 sse.ts 后续扩展保持兼容。

#### 6.4.3 状态机（**v4 修订：error/reconnecting 分流 + 显式超时 + 终止态定义**）

```
                    ┌─────────────────────┐
                    ↓                     │
idle → submitting → streaming → done / aborted / error
                         ↓
                      reconnecting ───────┘ (成功 → streaming)
                         │ (重试耗尽)
                         ↓
                       error (commit partial + Toast "连接已断开，请刷新")
```

**转换矩阵**（每条转换的进入条件与下一状态）：

| 当前态 | 触发事件 | 下一态 | 备注 |
|---|---|---|---|
| `idle` | Composer 提交 | `submitting` | 用户点发送 |
| `submitting` | `message_start` 收到 | `streaming` | 进入流式读取 |
| `submitting` | 10s 后仍未收到 `message_start` | `error` | **超时**：Toast "服务无响应"；释放 controller；清空占位（**不** commit 空内容）|
| `submitting` | POST 5xx / 网络断（TypeError） | `error` | **不**进 reconnecting：POST 不可幂等重发 |
| `streaming` | reader 抛错（断网 / 5xx）| `reconnecting` | 进重连流程 |
| `streaming` | 用户点"停止" / `Esc` | `aborted` | 走 § 12.1.2 abort |
| `streaming` | `message_stop` 或 `done` 任一到达 | `done` | 200ms 缓冲期等 `done`；超时按 `done` 处理（避免长尾 message_stop 后 server 异常 close）|
| `streaming` | `error` 事件 | `error` | code=`CHAT_RUNNER_ERROR` → 红条；其他 → Toast |
| `reconnecting` | 重连成功 | `streaming` | **不**重发 POST；resume 后续帧 |
| `reconnecting` | 5 次重连耗尽（1s/2s/4s/8s/16s）| `error` | commit 已收内容到 cache（**保留** partial 文本，标红 assistant 消息）；Toast "连接已断开，请刷新" |
| `done` / `aborted` / `error` | 用户开始编辑 Composer | `idle` | 回 idle，等待下一次提交 |
| `error` | 助手消息下方"重试发送"按钮 | `submitting` | 走 § 12.1.3 重试 |

**Composer 发送按钮禁用条件**（**重要**：避免重复点击导致多次 POST）：
- `submitting` / `streaming` / `reconnecting` 期间 → 按钮 disabled
- 多 tab 同时打开同 cid → 第二 tab POST 返回 429 `CHAT_SESSION_BUSY` → 按钮 disabled `retryAfterMs` ms（默认 1000ms），timer 到期自动恢复，**disable 期间可继续编辑 draft**
- `aborted` 后再次点击 → 清空旧 controller ref、重置 streamId 缓存、走新提交

**重试发送按钮出现条件**：
- 仅在 `error` 态的助手消息下方出现
- `streaming` 期间**不**显示重试；停止按钮固定为"停止"

**关键修复**：
- 旧 v3 "error: 标记失败, commit 已收到的内容（不丢弃）" 与 § 12.1.3 "重试删除占位" 冲突 → **统一**：error 态 commit partial 文本（标红），由 § 12.1.3 重试时**复用**占位重新发起 POST（**不**删除已有 partial 内容）
- 旧 v3 "网络断开" 同时分配到 error + reconnecting → **分流**：`submitting` 阶段网络断 → `error`（POST 不可幂等）；`streaming` 阶段网络断 → `reconnecting`（resync 后续帧）

#### 6.4.4 abort 通道（关键）

- 后端在响应头下发 `X-Stream-Id`（契约 § 4.1）
- 客户端记录 `streamId`；用户停止 → `POST /messages/abort` 带 `{ streamId }` → 后端 `SseHub.abort(streamId)`（`src/web/server/sse.ts`）
- 客户端 `controller.abort()` 关闭本地 reader
- **不**只调 `EventSource.close()`（EventSource 不可用 + 即使可用也不通知后端）

#### 6.4.5 Last-Event-ID 续传

- 后端 `sse.ts:LastEventIdLru`（cap=100）+ `parseLastEventId` 支持断点续传
- **本期不实现客户端续传**（POST 流不可幂等重放，续传=重新跑一次 LLM）；仅在客户端断开**前**缓存最后 seq；后续若后端提供 GET resume 端点再实现

---

## 7. 错误处理 / 可访问性 / 性能 / 安全

### 7.1 错误处理（**v4 修订：删 401/403 + 与 § 12.10 一致性**）

| 来源 | UI | 恢复 |
|---|---|---|
| API 4xx 校验（`VALIDATION_FAILED` / `INVALID_JSON`）| 表单内联红字 + 字段提示 + Toast（仅全局 fetch 失败时）| 用户修改后重试；表单聚焦首个错误字段（react-hook-form `setFocus`）|
| ~~API 401/403~~ | **v4 删除**：契约 enum 无 401/403 code；本期无认证系统 | — |
| API 429 `CHAT_SESSION_BUSY` | Toast "会话正在处理，请稍候" | Composer 按钮 disabled **error.details.retryAfterMs** ms（**v4 修正**：不用硬编码 1s）；timer 到期自动恢复；disable 期间可继续编辑 draft；前端**不**自动重试 |
| API 5xx `INTERNAL` | Toast "服务异常" + "重试"按钮 | 列表/详情页**保留旧数据** |
| SSE 错误事件 `CHAT_RUNNER_ERROR` | **助手消息下方红条** + "重试发送"按钮（**v4 区分**：不走 Toast）| 走 § 12.1.3 重试 |
| SSE 错误事件 其他 code（如 `CHAT_INVALID_EVENT`）| Toast | "重试"按钮 |
| 网络断开（fetch 抛 TypeError） | Composer 上方条 "重新连接中…" + 禁用发送 | 监听 `online` 事件恢复（**v4 强制 1.5s debounce**：避免抖动刷屏） |
| 离线 + 新提交 | Toast "网络不可用，请检查连接" + 禁用 Composer 发送按钮 | `online` 后恢复（**v4 强制 1.5s debounce**） |
| JS 运行时错误 | `ErrorBoundary` 友好降级 | "刷新"按钮 + `console.error` |

> **与 § 12.10 一致性约束**：本表与 § 12.10 是同一张规则的两视图；任何变更必须同步两处。

### 7.2 可访问性（WCAG 2.1 AA）

- Radix 自带键盘 / aria；shadcn/ui 直接复用
- 焦点环：Tailwind `focus-visible:ring-2 ring-primary ring-offset-2`
- 保留 skip link
- 颜色对比：见 § 4.1 每个 token 标注（正文 ≥ 4.5:1，UI 元素 ≥ 3:1）
- 全部交互键盘可达；Modal 陷阱焦点（Radix）
- `prefers-reduced-motion`：关闭非必要动画
- axe-core CI 扫描 0 critical / 0 serious（ruleset: WCAG 2.1 AA，全部 7 页）

### 7.3 性能预算（**prod 预览**测量，非 dev）

| 指标 | 目标 | 测量命令 |
|---|---|---|
| 首屏 JS（gzipped，路由 `/`） | ≤ 180KB | `npm run build && for f in web/dist/assets/index-*.js; do gzip -c $f | wc -c; done`（汇总） |
| 首屏 CSS（gzipped） | ≤ 20KB | `for f in web/dist/assets/index-*.css; do gzip -c $f | wc -c; done` |
| LCP（prod preview，本地） | ≤ 1.2s | `vite preview` + Playwright Lighthouse / `web-vitals` 实测 |
| TTI | ≤ 1.5s | 同上 |

**Bundle 拆分**（`vite.config.ts` `build.rollupOptions.output.manualChunks`）：

```
react-vendor    → react + react-dom + scheduler
router-vendor   → react-router-dom
query-vendor    → @tanstack/react-query
radix-vendor    → 所有 @radix-ui/react-* 聚合
markdown        → react-markdown + remark-gfm + rehype-sanitize + unified 链
                 （lazy import，仅 MessageBubble 引入）
其余            → 默认按路由懒加载
```

**门禁**：`rollup-plugin-visualizer` + `size-limit` 在 CI 强制；超阈值 PR 失败。

**已知风险与规避**：
- React 19 + react-dom ≈ 45KB、react-router ≈ 16KB、@tanstack/react-query ≈ 13KB、zod 3 ≈ 14KB、Radix ≈ 25-40KB、zustand ≈ 1KB → 合计 ~120-140KB，余量 < 30%
- date-fns 必须**仅用具名 import**（全量 ≈ 20KB 会吃穿余量）
- react-markdown 链必须 lazy（≈ 60-90KB；DashboardPage 不渲染 markdown）
- 流式 commit 走 `setQueryData` 不走 invalidate，避免重渲染

### 7.4 安全

#### 7.4.1 API Key 策略（**删除原 httpOnly cookie 方案**）

- 前端**不接触** API Key；密钥经 `POST /api/providers` 传给后端 `ProvidersStore` 持久化（契约 § 2.1 `apiKey: z.string().max(256)`）
- localStorage **不存** API Key（契约 § 10 锁定字段不含 apiKey，符合预期）
- **本期不引入 cookie 认证**（与 § 1.3 "不做账户系统" 一致）

#### 7.4.2 localStorage 字段（**保持契约 § 10 不变**）

| Key | 用途 |
|---|---|
| `my-agent.lastView` | `{ view, cid? }`（保留用于未来迁移到新 SPA） |
| `my-agent.apiBase` | `http://localhost:4321`（修正契约过期值 5173 → 4321） |
| `my-agent.theme` | `dark` / `light` / `system` |
| `my-agent.sidebarWidth` | number |
| `my-agent.locale` | `zh-CN` / `en`（新增，i18n 持久化） |

#### 7.4.3 CSP（**仅最小改动**）

- `script-src 'self'` 维持
- `style-src` 已含 `'unsafe-inline'`，Radix 内联定位样式合法
- `font-src` 增 `'self'`（自托管 woff2 需要）— 详见 § 3.4
- Vite 产物可能注入 modulepreload polyfill inline script：**M2 实测 `web/dist/index.html`**，若有内联 script 用 `build.modulePreload.polyfill: false` 消除，**不**放宽 CSP

#### 7.4.4 Markdown XSS（**react-markdown vs marked+DOMPurify 决策**）

- 现有 `marked + DOMPurify` 行为：原始 HTML **经 sanitize 后保留**
- `react-markdown` v9 默认**不**渲染原始 HTML（视为转义文本）
- **决策（产品）**：消息 Markdown **不**支持原始 HTML；用户输入的 `<script>` 等被转义。`react-markdown` 默认行为已足够安全
- 安全增强：`rehype-sanitize`（GitHub 默认 schema）+ react-markdown 默认 `urlTransform` 拦截 `javascript:` 协议
- 若未来需要代码高亮 className 或内联组件 → 加 `rehype-raw`（**必须排在 sanitize 之前**，sanitize schema 显式 allowList `className` 子集）
- **XSS 测试**（§ 8.2 强制）：`<img onerror=alert(1)>`、`[x](javascript:alert(1))`、`<script>`、`![x](data:text/html,...)`、`<iframe src=...>` 五个向量必须断言被拦截

#### 7.4.5 fetch 凭证

- 所有 fetch 带 `credentials: 'same-origin'`
- 本期无 cookie 认证，`credentials` 仅用于未来扩展兼容；当前实际效果 = 不携带凭据

### 7.5 i18n（自研 mini-i18n，**v4 补 Toast 文案规范**）

- 数据：`web/src/i18n/{zh,en}.json`（平铺 key-value；嵌套用 `.` 分隔）
- loader：`web/src/lib/i18n.ts`（Context Provider + `useT()` hook + 切换持久化到 `my-agent.locale`）
- **v4 fallback 规则（修复 vanilla JS bug）**：`useT(key)` 在 key 缺失时返回 `key` 本身（导致 UI 显示 `[session.new]`）；**正确行为**：返回 `fallback` 参数；fallback 也缺则返回 `key` 并 `console.warn` 上报
- 形态：

```ts
type Locale = 'zh-CN' | 'en';
const I18nContext = createContext<{ t: (key: string, fallback?: string) => string; locale: Locale; setLocale: (l: Locale) => void }>(...);
```

**Toast 文案规范（v4 新增）**：
- 单行 ≤ **16 字（zh）** / **≤ 80 字符（en）**
- imperative + 行动建议（如 "压缩完成，节省 X tokens" 而非 "压缩已被执行"）
- 复合提示拆为 title + body 两段（如 `SESSION_CORRUPT_FILE` → title "会话文件损坏" + body Modal 显示原始 spec + requestId）
- 文案统一收敛到 `i18n/toast.json`（zh + en 两份），**禁止**在组件内拼接英文
- 所有 § 7.1 / § 12.10 引用的 Toast 字符串必须在该文件落地

### 7.6 环境变量（新增 0 后端变量）

| 变量 | 用途 | 默认 | 示例 |
|---|---|---|---|
| `MY_AGENT_WEB_PORT` | 后端端口（已存在） | `4321` | `4321` |
| `MY_AGENT_WEB_ROOT` | 静态目录（已存在） | `<cwd>/web` | `web/dist`（prod） |
| `VITE_API_BASE` | 前端 API 基础 URL（dev/prod 同源可不设；如需跨域则设） | `http://localhost:4321` | — |

**新增文件**：`web/.env.example`（仅 `VITE_*` 占位；**禁止放密钥**，Vite 会把 `VITE_*` 内联进产物）。

### 7.7 静态资源缓存策略（binary split）

- `assets/<hash>.<ext>`（Vite 产物）：`Cache-Control: public, max-age=31536000, immutable`
- `index.html`：`Cache-Control: no-cache`（保证 hash 引用最新）
- 其它（如 favicon）：`Cache-Control: public, max-age=86400`

**后端改动**：详见 § 3.4 `static.ts`。

---

## 8. 测试策略

### 8.1 单元测试（Vitest + jsdom）

- `web/vitest.config.ts`：`environment: 'jsdom'`、`include: ['web/src/**/*.{test,spec}.{ts,tsx}']`、`setupFiles: ['./src/test-setup.ts']`
- `lib/cn.ts`、`lib/i18n.ts`、`lib/keymap.ts` 逻辑
- `features/*/use*` 业务逻辑
- `lib/sse.ts` **mock `fetch` + `ReadableStream`**（不再 mock EventSource）

### 8.2 组件测试（Vitest + @testing-library/react）

- `Composer` 提交、@ 提及、键盘行为
- `MessageBubble` Markdown 渲染、XSS 防护（5 个向量用例见 § 7.4.4）
- `MessageBubble` 复制按钮（§ 12.1.8）：mock `navigator.clipboard.writeText` → 点击 → 断言调用参数 === message.text
- `Sidebar` 折叠、激活态
- `useChatStream` 状态机各分支（idle / submitting / streaming / done / aborted / error / reconnecting）；**v4 必含用例**：
  - `chat-stream-state.spec.ts` reconnecting 分支：mock reader 在第 2 帧抛 TypeError → 状态 `reconnecting` → mock 成功 → 状态 `streaming`
  - `chat-stream-state.spec.ts` reconnecting 终止：mock 连续 5 次抛错 → 状态 `error` + Toast 断言
  - `chat-stream-state.spec.ts` submitting 超时：mock `message_start` 10s 内未到达 → 状态 `error` + Toast
  - `chat-stream-state.spec.ts` done vs message_stop 双事件：mock 只到 message_stop → 200ms 缓冲 → 状态 `done`
- `Composer` 重试按钮仅在 `error` 态出现（`streaming` 期间不显示）

### 8.3 E2E（Playwright）

- `npm run e2e` 启动 `vite preview` + Node server，跑全部用例
- 启动 → 打开 `/` → 看到欢迎
- 进入会话 → 发送消息 → 收到流式回复（mock 后端 SSE）
- 设置主题 / 语言 → 切换 → 刷新保留
- 7 路由全部可达断言（路由枚举器）

### 8.4 可访问性测试

- `@axe-core/playwright` 在 E2E 中对 7 个页面 + NotFound 扫描
- CI 失败阈值：0 critical / 0 serious（ruleset: WCAG 2.1 AA）

### 8.5 覆盖率门槛（CI 强制）

- `lib/` ≥ 90% lines
- `features/` ≥ 80% lines
- `components/` ≥ 60% lines

---

## 9. 迁移路径

### 9.1 一次性替换 + 阶段化

```
Step 0  git checkout -b feat/web-react-rewrite（保持 main 不污染）
Step 1  新建 web/{package.json,vite.config.ts,tsconfig.json,postcss.config.js,components.json}（**不动旧 web/{index.html,style.css,js/}**）
Step 2  git mv test/web → test/web-legacy（标 @deprecated；M8 删除）
Step 3  npm install（按 § 2.2 依赖表）
Step 4  按 M1-M8 顺序实现（见 § 9.2）
Step 5  prod 启动：MY_AGENT_WEB_ROOT=web/dist node bin/my-agent-web.ts（**不改任何后端代码**）
Step 6  跑 axe + Playwright + Vitest；回归现有 19 个 wire-routes 行为
Step 7  M8 验证通过后，git rm -r web/{index.html,style.css,js/} && git rm -r test/web-legacy
```

### 9.2 阶段化（M1-M8）+ 验证命令

| 阶段 | 交付物 | 验证（命令 + 阈值） |
|---|---|---|
| **M1** 脚手架 | Vite + TS + Tailwind v4 + shadcn/ui 手拷一个 Button 跑通 | `npm run build && test -f web/dist/index.html && ls web/dist/assets/*.js`；首屏 JS（gzip）≤ **80KB**（仅脚手架基线）；Vitest 单测跑通 |
| **M2** 后端联动 | `src/web/server/{csp,static}.ts` 最小改动（§ 3.4）；自托管 woff2 入仓 | `grep "font-src.*'self'" src/web/server/csp.ts` 命中；`grep ".woff2" src/web/server/static.ts` 命中；`curl -I http://localhost:4321/web/dist/assets/index-*.js` 返回 200 + `Cache-Control: ... immutable` |
| **M3** Layout | `AppShell` + `Sidebar` + `Topbar` 静态版（占位数据） | Playwright `npm run e2e -- layout.spec.ts`：8 个路由断言 URL hash 与关键 selector；axe 0 critical |
| **M4** 数据层 | `lib/api.ts` + `lib/sse.ts`（**fetch + ReadableStream**）+ TanStack Query 接入；mock 后端跑通 | Vitest `lib/sse.test.ts` 全绿（mock fetch 模拟 SSE 帧序列：message_start → content_block_start → content_block_delta → content_block_stop → message_stop）；`lib/api.test.ts` Zod 校验覆盖 19 个 endpoint 入参/出参 |
| **M5** 聊天流 | `Composer` + `MessageList` + `Markdown`（lazy）+ SSE 端到端闭环 | Playwright `chat-stream.spec.ts`：发送 → 收到至少 3 帧 → `done` 事件触发 commit；abort 用例：点停止 → `aborted` 事件收到；reconnecting 用例：mock reader 第 2 帧抛 TypeError → 状态 `reconnecting` → mock 成功 → 状态 `streaming`；submitting 10s 超时用例：mock headers hang → 状态 `error` |
| **M6** 业务页面 | Providers / Skills / Agents / Sessions / Settings 真实表单 | Playwright route enumerator：8 路由全部断言关键 selector；表单提交用例覆盖 19 个 wire-route 中至少 80% |
| **M7** a11y + 性能 + i18n | axe 扫描、bundle 拆分、locale 切换、暗色切换 | `npm run build && size-limit` 阈值 ≤ 180KB / 20KB；Playwright + axe 8 路由全扫 0 critical / 0 serious；locale 切换 + 主题切换 + 刷新保留 |
| **M8** 尾盘 | `verification-lite` + `code-review` + 删除旧 `web/{index.html,style.css,js/}` 与 `test/web-legacy/` | `definition-of-done.md` 全部 20+ 项打勾；19 个 wire-route 全覆盖 Playwright 报告；reconnecting 状态机测试 PASS（**v4 I9 显式**） |

### 9.3 回滚预案

- **M1-M7 任一阶段失败** → 保留旧 `web/{index.html,style.css,js/}`；新前端在 `feat/web-react-rewrite` 分支内迭代，不合流 main
- **main 合流后失败** → `git revert <merge-commit>` 回退；旧前端天然存活（从未删除）
- **Step 7 删除已发生** → 只能 `git revert` 恢复；不可 forward-fix（删除是不可逆 git 操作前需二次确认）

### 9.4 旧 → 新迁移对应表

| 旧 `web/js/...` | 新位置 |
|---|---|
| `app.js`（路由 + 启动） | `src/main.tsx` + `src/routes.tsx` |
| `app.keymap.js` | `src/lib/keymap.ts`（平台无关注册）+ `src/hooks/useKeyMap.ts`（React 订阅） |
| `state/state.js` | 废弃；TanStack Query + Zustand slice 各自自治 |
| `shared/api.js` | `src/lib/api.ts`（fetch + Zod） |
| `shared/utils.js` | `src/lib/cn.ts`（仅保留 cn）；其它散入 `features/*` 或 `lib/*` |
| `shared/icons.js` | 弃用；改 `lucide-react` |
| `shared/theme.js` | `src/hooks/useTheme.ts` + `src/styles/globals.css` `:root[data-theme]` |
| `shared/i18n.js` | `src/lib/i18n.ts` + `src/i18n/{zh,en}.json` |
| `features/chat.js` | `src/features/chat/useChatStream.ts` + `src/components/chat/*` |
| `features/sessions.js` | `src/features/sessions/useSessions.ts` + `SessionListItem.tsx`（Sidebar 内渲染） |
| `features/agents.js` / `providers.js` / `skills.js` | `src/features/<domain>/*` |
| `features/slash.js` | `src/features/chat/composerDraftStore.ts`（@ 提及候选） + `Composer.tsx` 内部 |
| `features/menu.js` / `settings.js` / `theme.js` | `src/pages/SettingsPage.tsx` + `useTheme.ts` |
| `components/{button,input,textarea,modal,tabs,dropdown,card,toast,tooltip,spinner,skeleton,badge,empty-state,sidebar,panels}.js` | shadcn/ui 手拷 `components/ui/*` + `components/layout/*` + `components/feedback/*` |
| `components/modals/{confirm}.js` | `src/components/feedback/ConfirmDialog.tsx` |
| `components/modals/{provider-add,provider-edit,agent-create,agent-launch,skill-use,session-new,session-export,session-rename,settings-edit}.js` | `src/features/<domain>/<Action>Dialog.tsx`（如 `features/providers/ProviderEditDialog.tsx`） |
| `vendor/marked.min.js` + `vendor/dompurify.min.js` | `src/components/chat/Markdown.tsx`（lazy：`react-markdown` + `remark-gfm` + `rehype-sanitize`） |

---

## 10. 风险与缓解

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | React 19 + Radix 并发渲染兼容（Dialog forceMount / useId SSR） | 中 | 高 | M1 跑通 Dialog + DropdownMenu 两个组件的 StrictMode 双调用；遇 issue 先升 Radix 试，再 React 18.3.1 降级（同时验证 TanStack Query v5 peer 范围） |
| R2 | SSE 重连策略与后端 `CHAT_SESSION_BUSY` 429 冲突 | 中 | 高 | 客户端**不自动重试 POST 流**；429 仅 Toast 提示；指数退避仅用于 reader 抛错（断网），不重发 POST |
| R3 | Bundle 超 180KB 预算 | 中 | 高 | M1 即配 `rollup-plugin-visualizer` + `size-limit` 设 CI 阈值；date-fns 必须具名 import；react-markdown 链必须 lazy；超阈值 PR 拒绝合流 |
| R4 | pnpm/workspace 不兼容（如误用 pnpm） | 低 | 中 | § 2.3 锁定 npm；M1 `npm install` 验证；CI 强制 npm（package-lock.json） |
| R5 | Tailwind v4 + shadcn/ui CLI init 不兼容（CLI 输出 v3 配置） | 中 | 中 | § 2.1 决策 shadcn/ui 走**手拷模式**（不跑 `init`）；手动建 `components.json`；UI 组件按 shadcn 源码逐个拷 |
| R6 | react-markdown 与 marked+DOMPurify 行为不等价（影响"保留行为"目标） | 中 | 中 | § 7.4.4 决策不渲染原始 HTML；§ 8.2 5 个 XSS 向量用例强制覆盖；行为差异在 plan 阶段列入 done criteria |
| R7 | 自托管字体加载被 CSP / static.ts ALLOWED_EXTS 拦截 | 中 | 高 | § 3.4 列入后端最小改动清单；M2 必须验证 `curl` 返回 200 + 正确 mime + `font-src 'self'` CSP 命中 |
| R8 | 旧 `test/web/` 17 个用例与新 Vitest 套件重叠/冲突 | 高 | 低 | § 9.1 Step 2 `git mv test/web → test/web-legacy` 标 `@deprecated`；M8 一并删除 |
| R9 | 静态服务 `Cache-Control: no-cache` 硬编码破坏 LCP/TTI | 高 | 中 | § 7.7 改为按 hash 二分；列入后端最小改动清单；M2 必须验证 hash 文件返回 `immutable` |
| R10 | dev 与 prod 测量不可比（dev 含 HMR / 未压缩） | 高 | 低 | § 7.3 明确 prod `vite preview` 测量；CI 跑 preview 而非 dev |
| R11 | 契约 § 4.3 SSE 事件表格与 `sse.ts:SSE_EVENT_TYPES` 源码不一致 | 高 | 中 | § 6.4.2 spec 以源码为准；开后端 issue 澄清契约（不在本期修） |
| R12 | Zustand slice 与 TanStack Query 边界模糊（领域 state 走哪边？） | 中 | 中 | § 6.1 明确：服务端数据走 Query；UI 偏好与领域内瞬态走 Zustand；流式 commit 用 `setQueryData` 不走 invalidate |
| R13 | `lucide-react` 全量约 100KB+，按需引入配置繁琐 | 中 | 中 | § 3.2 决策 lucide-react；M1 实测 tree-shake 后实际打包大小（应 < 30KB）；超阈值则改 `vite-plugin-lucide` 按需 |
| R14 | 暗色模式切换 FOUC（React 挂载前未设 `data-theme`） | 中 | 低 | § 4.1 末尾 `<head>` 内嵌同步初始化脚本；M3 验证列加"切换 dark 后无 FOUC" |
| R15 | 旧 `web/js/state/state.js` 注册中心模式被默默替换，破坏跨模块通信 | 低 | 低 | § 9.4 显式迁移表；M3 验证列加"无遗留 `state.js` 引用" |

---

## 11. 验收口径（definition-of-done，每条含命令 + 阈值 + 回退）

| # | 验收点 | 命令 | 阈值 | 回退 |
|---|---|---|---|---|
| A1 | `npm run build` 产物可被 Node server 服务 | `npm run build && MY_AGENT_WEB_ROOT=web/dist node bin/my-agent-web.ts &` 然后 `curl -I http://localhost:4321/` | 200 + `Content-Type: text/html` | 回退到 M8 之前的状态 |
| A2 | 8 路由全部可达（含 NotFound） | `npm run e2e -- routes.spec.ts` | 8/8 PASS；URL hash 含 `#/<path>` | 修路由表或 HashRouter 配置 |
| A3 | 行为与现有 19 个 wire-routes 一致 | `npm run e2e -- wire-routes.spec.ts`（引用契约 § 1 总表） | 19/19 PASS | 修 `lib/api.ts` 或对照 `contract` schema |
| A4 | 流式聊天端到端跑通 | `npm run e2e -- chat-stream.spec.ts` + `npm run test -- chat-stream-state.spec.ts` | 发送 → 至少 3 帧 → `done` → cache 更新；abort → `aborted` 收到；reconnecting 状态机：mock reader 第 2 帧抛 TypeError → 状态 `reconnecting` → mock 成功 → 状态 `streaming`；submitting 10s 超时：mock headers hang → 状态 `error` | 修 `lib/sse.ts` 或 `useChatStream` |
| A5 | 主题 / 语言切换刷新保留 | `npm run e2e -- persistence.spec.ts` | 切换 dark + zh-CN → 刷新 → `data-theme="dark"` 与 `<html lang="zh-CN">` 保留 | 修 `useTheme.ts` / `lib/i18n.ts` |
| A6 | 快捷键全部生效 | `npm run e2e -- keymap.spec.ts` | 7/7 快捷键命中（含 ⌘,） | 修 `lib/keymap.ts` |
| A7 | axe 0 critical / 0 serious | `npm run e2e -- a11y.spec.ts`（@axe-core/playwright） | 0 critical / 0 serious（WCAG 2.1 AA ruleset） | 修组件 a11y |
| A8 | Bundle ≤ 180KB（首屏 JS gzip） | `npm run build && size-limit` | ≤ 180KB；超阈值 CI 失败 | 拆 chunk / 移除依赖 |
| A9 | Bundle ≤ 20KB（首屏 CSS gzip） | `npm run build && for f in web/dist/assets/index-*.css; do gzip -c $f | wc -c; done` | ≤ 20KB | 移除未用 utility |
| A10 | LCP ≤ 1.2s（prod preview） | Playwright Lighthouse 实测 | ≤ 1200ms（本地，CPU 不节流） | 优化关键路径 / 字体子集 |
| A11 | 旧 `web/{index.html,style.css,js/}` 与 `test/web-legacy/` 已删除 | `git ls-files | grep -E "^(web/index.html|web/style.css|web/js/|test/web-legacy/)"` | 空输出 | `git checkout HEAD~ -- <path>` 恢复 |
| A12 | 19 个 wire-route 客户端契约与契约文档一致 | `npm run e2e -- contract-conformance.spec.ts` | 19/19 PASS | 修 `lib/api.ts` schema |
| A13 | 5 个 XSS 向量全部拦截 | `npm run test -- markdown-xss.spec.ts` | 5/5 拦截断言 | 修 Markdown.tsx sanitize schema |
| A14 | 后端最小改动清单 100% 落地 | `git diff main --stat src/web/server/ bin/` | diff 仅限 csp.ts + static.ts；其它文件无 diff | `git checkout main -- <path>` |
| A15 | 覆盖率门槛 | `npm run test:coverage` | lib ≥ 90% / features ≥ 80% / components ≥ 60% | 补测试 |

---

## Next

**（spec 已按 P0/P1 修订完成，待用户 review — 见 `harness-kit/core/routing.md` § 阶段门禁）**

修订对照原审查报告：

| 审查项 | 修订位置 |
|---|---|
| C1 SSE 传输 | § 2.1 / § 6.4.1 / § 8.1 |
| C2 SSE 事件枚举 | § 6.4.2（以源码为准） |
| C3/C4/C14 httpOnly cookie 伪需求 | § 1.3 / § 7.4.1（删除） |
| C5 i18n 路径 | § 3.2 / § 7.5 |
| C6 sessionId 数据源 | § 6.1（URL 唯一） |
| C7 useChatStream 归属 | § 3.2（单一 `features/chat/useChatStream.ts`） |
| C8 迁移回滚冲突 | § 9.1（Step 0/1/2/7） |
| C9 pnpm workspace | § 2.3（锁定 npm，不建 workspace） |
| C10 Tailwind v4 + shadcn CLI | § 2.1（手拷模式）+ R5 |
| C11 SPA fallback | § 5.1（改 HashRouter） |
| C12 字体 CSP | § 3.4 / § 4.2 / R7 |
| C13 端口 | § 3.3（4321） |
| C15 契约 vs 源码不一致 | § 6.4.2 / R11 |
| I1 依赖版本表 | § 2.2 / § 2.4 |
| I2 不选 X 理由 | § 2.1 |
| I3 依赖方向矩阵 | § 3.5 |
| I4 modals 去向 | § 9.4 |
| I5 Step 4 抽象 | § 9.1（拆 Step 0-7） + § 9.2 |
| I6 阶段化验证 | § 9.2（命令 + 阈值） |
| I7 验收量化 | § 11（A1-A15 全部含命令 + 阈值 + 回退） |
| I8 暗色 token | § 4.1（双主题 + system） |
| I9 QueryClient defaults | § 6.2 |
| I10 性能预算 | § 7.3（preview 测量 + size-limit） |
| I11 react-markdown 决策 | § 7.4.4 |
| I12 ALLOWED_EXTS | § 3.4 / R9 |

请用户 review 后选择：

- 「写计划」/「制定实施计划」 → Load `writing-plans` → 输出 `plans/2026-08-08-web-frontend-react-rewrite-plan.md`
- 具体修改意见 → inline 修订
- 「再审一轮」 → 重新委派 3 个 reviewer

---

## 12. 交互合同（Interaction Contract）

> **目标**：把"每个按钮 → 哪个 endpoint → 什么入参 → 什么出参 → 错误怎么呈现 → 状态如何变化 → 如何测试"全写清楚。
> 覆盖契约 § 1 的 **19 个 endpoint** + 前端独有的纯客户端交互（命令面板、快捷键、主题切换等）。
> 实现阶段严格按本节逐项落地；任何遗漏须开 spec issue。
> 错误码全集见契约 § 3（`ApiErrorCode`）；本节只列"该交互会触发的错误码"。

### 12.1 聊天核心（端到端，**最优先**）

> 涉及契约 § 1.3（2 个 endpoint）+ § 1.2 Session 域的 `history` / `compact`。
> 状态机详见 § 6.4.3；本节聚焦**触发链**与**前后端契约**。

#### 12.1.1 发送消息 → 流式接收

| 项 | 内容 |
|---|---|
| 触发 | Composer 提交（点击发送按钮 / `⏎`） |
| 前置状态 | `idle` 或上一轮 `done` / `error` |
| HTTP | `POST /api/sessions/:id/messages/stream` |
| 入参 | `{ text: string (1-32000), systemPrompt?: string (≤8000) }`（`StreamMessageSchema`）。**前端预校验**：text > 32000 时先 Toast 阻止提交，**不**发请求（避免触发 PAYLOAD_TOO_LARGE） |
| 出参 | SSE 流（`text/event-stream`），首帧 `message_start` 含 `streamId` |
| 错误码 | `CHAT_SESSION_BUSY (429)` → Toast "会话正在处理，请稍候" + 按钮 disabled `retryAfterMs` ms（默认 1000ms，timer 到期自动恢复，disable 期间可继续编辑 draft），**不重试**；`CHAT_RUNNER_ERROR` → 助手消息下方红条 + "重试发送"按钮；`PAYLOAD_TOO_LARGE` → Toast "内容过长，请精简" + 阻止提交（**不**自动截断，**不**发请求） |
| 状态变化 | URL 不变（sessionId 已在 `/chat/:id`）；Zustand `composerDraftStore` 清空 draft；Query cache `queryKeys.sessions.detail(id).messages` 追加 user 消息（乐观）+ assistant 占位；`useChatStream` 状态 `idle → submitting → streaming` |
| 流式帧 | 覆盖全部 `SSE_EVENT_TYPES` 13 种事件（`message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `tool_use` / `tool_result` / `message_delta` / `message_stop` / `error` / `done` / `aborted` / `usage` / `ping`）；处理细则见 § 6.4.2 |
| 测试 | `tests/e2e/chat-stream.spec.ts`：发送 → 至少 3 帧 → `done`；abort 用例：点"停止" → 收到 `aborted`；5xx 用例：mock 5xx → reader 抛错 → 状态 `error` |

#### 12.1.2 中止生成

| 项 | 内容 |
|---|---|
| 触发 | 点击流式中的"停止"按钮 / `Esc` |
| 前置状态 | `streaming` |
| HTTP | `POST /api/sessions/:id/messages/abort` |
| 入参 | `{ streamId?: string }`（**optional**：从 `message_start` 事件获取，存于 `useChatStream` ref；**无 streamId 时后端按 cid abort 当前 in-flight 流**——契约 § 1.3 注） |
| 出参 | `{ ok: true }` |
| 错误码 | 网络断开 → 客户端本地 abort 仍生效；后端 5xx → Toast 但本地状态已切到 `aborted` |
| 状态变化 | `streaming → aborted`；客户端 reader `controller.abort()`；后端 `SseHub.abort(streamId)`（若 streamId 缺失则按 cid abort）；保留已收到的 assistant 文本（不丢弃） |
| 测试 | `tests/e2e/chat-abort.spec.ts`：开始流式 → 点停止 → 收到 `aborted` → 后续帧不再到达 |

#### 12.1.3 重试失败消息

| 项 | 内容 |
|---|---|
| 触发 | 助手消息下方红条的"重试发送"按钮 |
| 前置状态 | `error`（上一轮发送失败） |
| HTTP | 同 12.1.1（重新发起 POST） |
| 入参 | 同 12.1.1（保留原 `text` / `systemPrompt`） |
| 出参 | 同 12.1.1 |
| 错误码 | 同 12.1.1 |
| 状态变化 | **复用**上一次失败 assistant 占位（保留 partial 文本标红）；状态 `error → submitting → streaming` |
| 测试 | `tests/e2e/chat-retry.spec.ts`：mock 5xx → 失败 → 点重试 → mock 正常 → 收到流式 |

#### 12.1.4 加载历史消息

| 项 | 内容 |
|---|---|
| 触发 | 路由进入 `/chat/:sessionId`（或直接打开深链） |
| HTTP | `GET /api/sessions/:id/history` |
| 入参 | — |
| 出参 | `{ messages: SerializedMessage[] }`（含 user / assistant / tool 三类） |
| 错误码 | `SESSION_NOT_FOUND` → Toast "会话不存在" + 跳转 `/sessions`；`SESSION_CORRUPT_FILE` → Toast "会话文件损坏" + 详情 Modal（**v4 统一**：与 § 12.10 用 Modal 而非"详情链接"，避免歧义；Modal 显示 `error.details`） |
| 状态变化 | Query cache `queryKeys.sessions.detail(id).messages` 写入；MessageList 渲染；滚动到底部 |
| 测试 | `tests/e2e/chat-load.spec.ts`：打开 `/chat/<id>` → 看到历史消息 → URL hash 正确 |

#### 12.1.5 压缩会话（context compaction，**v4 修订：量化阈值 + Modal 规格 + 前置态**）

| 项 | 内容 |
|---|---|
| 触发 | (a) Composer 旁"压缩"按钮（手动）；(b) **自动判断**：`message_stop` 后若响应头/上一帧 ratio > **0.9** 则自动弹 Modal 询问（**v4 量化阈值**）|
| 前置状态 | `idle` / `done` / `aborted` / `error`（无 in-flight 流）；`submitting` / `streaming` / `reconnecting` 期间按钮 disabled |
| HTTP | `POST /api/sessions/:id/compact` |
| 入参 | `{ confirm?: boolean }`（`CompactRequestSchema`）|
| 出参（estimate，无 confirm） | `{ used, limit, ratio, willCompact: true }`（`CompactEstimate`）|
| 出参（成功） | `{ tokensBefore, tokensAfter, durationMs, summary? }`（`CompactResult`）|
| 错误码 | `CHAT_SESSION_BUSY (429)` → Toast + 按钮 disabled 1s；`INTERNAL (500)` → Toast + 保留旧 messages |
| **二段式流程**（**避免重做 vanilla JS 调 /compact/preview 404 bug**）| 1. POST `/compact`（不传 confirm）→ 响应分支：<br>　(a) 返回 `CompactResult` → 直接完成，Toast "压缩完成，节省 X tokens"<br>　(b) 返回 `CompactEstimate` `{ willCompact: true }` → 弹 **ConfirmDialog**：`当前 usage 已达 X/Y（Z%），压缩后预计节省 ~N tokens。是否继续？`；按钮 "确认压缩" / "取消"<br>2. 用户确认 → 再次 POST `/compact` `{ confirm: true }` → 返回 `CompactResult`；取消 → 关闭 Modal 不动 state |
| 状态变化 | invalidate `queryKeys.sessions.detail(id)`；MessageList 重新渲染（首条可能变为 summary） |
| 测试 | `tests/unit/compact-button.spec.tsx`：mock willCompact=true → 显示 ConfirmDialog（断言含 `used`/`limit`/`ratio` 三字段渲染）→ 点击确认 → 第二次 POST → mock 成功 → 重新拉 history |

#### 12.1.6 @ 提及智能体 / 技能

| 项 | 内容 |
|---|---|
| 触发 | Composer 输入 `@` → 弹出候选 popover（Radix Popover） |
| 数据源 | `queryKeys.agents.all` + `queryKeys.skills.all`（TanStack Query 缓存；**首次打开 @ 时若缓存为空则 prefetch**） |
| 选中行为 | 选中后插入 `@<name>` 到 Composer；不影响实际发送的 `text` 字段（仅 UI 装饰；后端按 plain text 处理）；**不**改 `text` schema |
| **产品决策（v4 新增）** | **本期为纯 UI 装饰**，不联动 `systemPrompt`；未来若需联动需开后端契约 issue |
| 状态变化 | Zustand `composerDraftStore.mentions` 追加候选 |
| 测试 | `tests/unit/composer-mention.spec.tsx`：输入 `@` → 看到候选列表 → 选中 → 文本框插入 `@<name>` → **提交时 fetch mock 的 body.text 严格等于 `原 draft + '@<name>'`**（plain text，不转译）|

#### 12.1.7 重新生成回复（**v4 新增；用户高频动作**）

| 项 | 内容 |
|---|---|
| 触发 | assistant 消息 hover/右键菜单 → "↻ 重新生成"按钮 |
| 前置状态 | 该消息**非**当前流式（`done` / `aborted` / `error`）；不能对"上一轮流式正在生成的消息"重新生成（需先停止）|
| HTTP | 同 § 12.1.1（`POST /api/sessions/:id/messages/stream`） |
| 入参 | **复用**上一条 user 消息原文作为 `text`；保留原 `systemPrompt` |
| 出参 | 同 § 12.1.1（SSE 流式）|
| 错误码 | 同 § 12.1.1 |
| **与"重试发送"的区别** | 重试发送（§ 12.1.3）：失败 assistant 占位复用；重新生成：**删除**旧 assistant 消息，新建占位（"用户已看了但不想要"）|
| 状态变化 | `done/aborted/error → submitting → streaming`；MessageList 删除旧 assistant + 新占位；Query cache `queryKeys.sessions.detail(id).messages` 删除旧 + 新占位 |
| 测试 | `tests/e2e/chat-regenerate.spec.ts`：mock 已有 done 的 assistant → 点"重新生成" → 旧消息消失 → 新流式开始 → mock done → 新消息落位 |

#### 12.1.8 复制消息文本（**v4 新增；用户基本动作**）

| 项 | 内容 |
|---|---|
| 触发 | MessageBubble hover → 右上角浮出"📋"按钮（lucide `Copy`）；或右键菜单"复制" |
| HTTP | 客户端调用 `navigator.clipboard.writeText(message.text)`（无后端调用）|
| 出参 | — |
| 错误码 | Clipboard API 抛错（如非 HTTPS / 权限拒绝）→ Toast "复制失败" + `console.error`；**不**降级为选中文本（无法在 Tauri/Electron 外可靠实现）|
| 状态变化 | 按钮点击后 1s 内显示 ✓ 标记（lucide `Check`），然后回到 📋；Toast "已复制" |
| 测试 | `tests/unit/message-copy.spec.tsx`：mock `navigator.clipboard.writeText` → 点击 → 断言调用参数 === message.text；mock writeText 抛错 → 断言 Toast 出现 |

#### 12.1.9 撤销刚才发送的消息（**v4 新增；用户高频纠错**）

| 项 | 内容 |
|---|---|
| 触发 | 消息发出后短暂显示"已发送 [撤销]"toast（**5 秒内**可点击） |
| 前置状态 | user 消息**刚发送**且 **尚未生成** assistant 回复（若 assistant 已开始流式则不显示撤销，改为显示"停止"）|
| HTTP | `DELETE /api/sessions/:id/messages/:msgId`（**契约 § 1.2 缺此 endpoint**）|
| 出参 | `{ ok: true }` |
| 错误码 | `NOT_FOUND` → Toast "消息已被删除" + 刷新视图 |
| **本期处理** | **UI 显示但**后端无对应 endpoint；点击撤销 → 客户端仅移除本地 MessageList 中 user 消息 + 不删服务端历史（**已知局限**，开 issue 给后端加 `DELETE /api/sessions/:id/messages/:msgId`）|
| 状态变化 | MessageList 移除 user 消息；Query cache `queryKeys.sessions.detail(id).messages` 移除该条 |
| 测试 | `tests/e2e/chat-undo.spec.ts`：发送 → 5s 内 toast 可见 → 点击撤销 → 消息从列表消失 |

### 12.2 DashboardPage 交互（`/`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| D-1 | 页面挂载 | `GET /api/sessions` | `{ archived: undefined, limit: 10 }`（**v4 修正**：archived 显式不传；limit=10 表示 Dashboard 首页最多显示 10 条最近会话；暂不传 offset，等会话数 > 200 时再引入分页） | `{ sessions: SessionMeta[] }` | — → Toast 失败 | `queryKeys.sessions.all` 写入；最近会话列表渲染 |
| D-2 | Composer 提交 | 同 12.1.1 | 同 12.1.1 | 同 12.1.1 | 同 12.1.1 | 跳转到 `/chat/<newId>`（POST /api/sessions 先建空 session 再 stream） |
| D-3 | 最近会话项点击 | — | — | — | — | `navigate('/chat/' + id)` |
| D-4 | "查看全部"按钮 | — | — | — | — | `navigate('/sessions')` |

#### D-2 详细链路（**避免重做"做出来不能交互"，v4 加超时保护**）

```
1. POST /api/sessions { kind?: 'gconv' }          →  { session: { id } }
   失败保护：若第一步 5xx / 网络断 → Toast + 留在 Dashboard + 不 navigate
2. navigate('/chat/' + id)                          →  URL 更新
3. ChatPage 挂载 → GET /api/sessions/:id/history   →  渲染空 list
   失败保护：若 history 404 → Toast + 跳转 /sessions
4. POST /api/sessions/:id/messages/stream          →  流式聊天开始
   失败保护：提交按钮 disable 状态走 § 6.4.3 状态机（submitting 10s 超时）
```

**navigate 行为（v4 决策）**：若用户在**非 chat 页面**（如 `/providers` / `/settings`）点"新建会话" → 全局 navigate 跳转（**不**弹 Modal 二次确认，避免打断；如需打断另起 plan 阶段讨论）。

**测试**：`tests/e2e/dashboard-send.spec.ts` — Dashboard 输入 → mock 三步成功 → URL 变成 `#/chat/<id>` → 看到流式回复；失败用例：mock step1 5xx → 断言留在 Dashboard + Toast 出现 + URL 未变。

### 12.3 ChatPage 交互（`/chat`, `/chat/:sessionId`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| C-1 | 路由 `/chat/:id` 挂载 | 同 12.1.4 | — | 同 12.1.4 | 同 12.1.4 | Query cache 写入；MessageList 渲染 |
| C-2 | 路由 `/chat`（无 id） | — | — | — | — | 显示"选择一个会话或新建"空态 + Composer（提交时按 D-2 链路） |
| C-3 | 发送消息 | 同 12.1.1 | 同 12.1.1 | 同 12.1.1 | 同 12.1.1 | 见 12.1.1 |
| C-4 | 中止 | 同 12.1.2 | 同 12.1.2 | 同 12.1.2 | 同 12.1.2 | 见 12.1.2 |
| C-5 | 重试失败 | 同 12.1.3 | 同 12.1.3 | 同 12.1.3 | 同 12.1.3 | 见 12.1.3 |
| C-6 | 顶部"删除会话" | `DELETE /api/sessions/:id` | — | `{ ok: true }` | `SESSION_NOT_FOUND` → Toast + 跳转 `/chat` | invalidate `queryKeys.sessions.all` + navigate `/sessions` |
| C-7 | 顶部"重命名" | （**契约 § 1.2 缺此 endpoint**） | — | — | — | **本期不实现**；UI 仅显示会话标题（不可编辑）；开 issue 给后端加 `PUT /api/sessions/:id/rename` |
| C-8 | 自动滚动（**v4 修订：避免打断用户阅读**） | — | — | — | — | MessageList `useEffect`：新消息追加后**仅当** `scrollTop + clientHeight >= scrollHeight - 100px`（即"距底部 ≤ 100px"）时才 `scrollIntoView`；**用户向上滚动后**：自动暂停自动滚动，下方出现 `↓ N 条新消息` 浮动按钮（点击滚到底）；尊重 `prefers-reduced-motion` |

### 12.4 SessionsPage 交互（`/sessions`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| S-1 | 页面挂载 | `GET /api/sessions` | `{ archived: undefined, limit: 200 }`（**v4 修正**：archived 显式不传而非 `false`） | `{ sessions: SessionMeta[] }` | — → Toast 失败 | `queryKeys.sessions.all` 写入；表格渲染（最多 200 条） |
| S-2 | 搜索框输入 | — | — | — | — | `useDebounce(300ms)` → 客户端过滤已加载列表（**不**调 API）；**v4 匹配字段**：`name`（fuzzy）+ `id`（prefix）+ 最新消息 `preview`（contains）；**v4 空态**：搜索无结果时表格内显示"无匹配会话"灰色占位 |
| S-3 | 行点击 | — | — | — | — | `navigate('/chat/' + id)` |
| S-4 | 行内"删除" | `DELETE /api/sessions/:id` | — | `{ ok: true }` | `SESSION_NOT_FOUND` → Toast + 自动移除行 | optimistic update：移除行；失败时回滚 |
| S-5 | 顶部"+ 新会话" | `POST /api/sessions` | `{ kind?: 'gconv' }` | `{ session: { id } }` | `VALIDATION_FAILED` → Toast（**v4 改名**：原 spec 误写 `VALIDATION_ERROR`）| invalidate `.all` + `navigate('/chat/' + id)` |
| S-6 | 行内"导出"（**契约 § 1.2 缺此 endpoint**） | — | — | — | — | **本期不实现**；UI 隐藏导出按钮；disabled 按钮挂 tooltip "导出功能开发中"（**v4 I1 占位说明**）|
| S-7 | "查看归档"切换 | `GET /api/sessions` | `{ archived: true, ... }` | 同上 | 同 S-1 | 重新拉取并切换列表渲染（**v4 I3 验证**：invalidate `queryKeys.sessions.all` 不覆盖 detail 数据） |

### 12.5 ProvidersPage 交互（`/providers`，**v4 修订**）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| P-1 | 页面挂载 | `GET /api/providers` | — | `{ providers: ProviderConfigEntry[], activeId: string }` | — → Toast | `.all` 写入（含 `activeId`）；master-detail 列表渲染 + 激活态高亮 |
| P-`active` | 启动时（`main.tsx` Query prefetch）| `GET /api/providers/active` | — | `{ provider: ProviderConfigEntry, activeId: string }` | — → 静默失败（fallback `.all`）| `queryClient.setQueryData(queryKeys.providers.active, …)` 写入；**v4 新增**：DashboardPage 与 ProvidersPage 都需读 |
| P-2 | 行点击 | **客户端缓存读取**（**v4 修正**：契约 § 1.1 **无** `GET /api/providers/:id` endpoint，按 id 从 P-1 `.all` 缓存取；缓存命中零额外请求）| `provider = .all.find(id)` | — | 缓存 miss（极端）：清除选中 + Toast "Provider 已失效" | 右侧 edit 面板填充表单 |
| P-3 | "+ 新建 provider" 按钮 | — | — | — | — | 打开右侧空白表单（`mode: 'create'`） |
| P-4 | 表单提交（新建） | `POST /api/providers` | `ProviderUpsertSchema`（见契约 § 2.1） | `{ provider: ProviderConfigEntry }` | `PROVIDER_DUPLICATE_ID` → id 字段红字；`INVALID_JSON` → Toast；`VALIDATION_FAILED` → 字段红字；`PROVIDER_INVALID_BASE_URL` → baseUrl 字段红字；`PROVIDER_INVALID_TYPE` → type 字段红字；`PROVIDER_API_KEY_EMPTY` → apiKey 字段红字；`PROVIDER_ALREADY_EXISTS` → Toast；`INTERNAL` → Toast "服务异常" | **提交期间**：disable submit button + 显示 spinner + cancel 不可用（**v4 强制**：避免重复提交）；成功 → `queryClient.setQueryData(.all, append)`（避免 invalidate 触发 refetch）；切换到 detail 视图 |
| P-5 | 表单提交（编辑） | `PUT /api/providers/:id` | `Partial<ProviderUpsertSchema>` | `{ provider: ProviderConfigEntry }` | `PROVIDER_NOT_FOUND` → Toast；`VALIDATION_FAILED` → 字段红字；`PROVIDER_INVALID_BASE_URL` → baseUrl；`PROVIDER_INVALID_TYPE` → type；`PROVIDER_API_KEY_EMPTY` → apiKey；`INTERNAL` → Toast | **提交期间**：disable submit + spinner；成功 → `queryClient.setQueryData(.all, replaceById)` + `setQueryData(.detail(id), ...)`；右侧面板刷新 |
| P-6 | "删除 provider" | `DELETE /api/providers/:id` | — | `{ ok: true }` | `PROVIDER_NOT_FOUND` → Toast；`PROVIDER_ACTIVE_NOT_DELETABLE` → Modal "不能删除当前激活的 provider，请先切换"；`INTERNAL` → Toast | optimistic：移除行；失败时 `queryClient.setQueryData(.all, restoreById)` 回滚 |
| P-7 | "启用/停用" 切换 | `POST /api/providers/:id/toggle` | — | `{ enabled: boolean }` | `PROVIDER_NOT_FOUND` → Toast；`INTERNAL` → Toast | optimistic：切换 enabled；失败时 `queryClient.setQueryData(.all, restoreEnabled)` 回滚 |
| P-8 | "设为激活" | `PUT /api/providers/active` | `{ id: string }` | `{ ok: true }` | `PROVIDER_NOT_FOUND` → Toast；`INTERNAL` → Toast | `queryClient.setQueryData(.all, replaceActiveId)`（**v4 修正**：用 setQueryData 而非 invalidate，避免触发 .all 全列表 refetch 打断其它订阅）；同步 `queryClient.setQueryData(.active, ...)` |
| P-9 | "切换默认模型" | `PATCH /api/providers/active/model` | `{ model: string }`（`PatchActiveModelSchema`） | `{ provider: ProviderConfigEntry }` | `MODEL_NOT_FOUND` → Toast "该 provider 不支持此模型"；`INTERNAL` → Toast | `queryClient.setQueryData(.all, updateById(activeId, { defaultModel }))` + `setQueryData(.detail(activeId), ...)`（**v4 修正**：用 setQueryData 替代 invalidate） |
| P-10 | 表单字段实时校验 | — | — | — | — | react-hook-form + zod resolver（**v4 显式**：哪些字段必填 / 可选见契约 § 2.1）；字段红字提示 |

> **API Key 字段特殊处理**：表单输入框 `type="password"`；提交时走 HTTPS（已通过 § 1.3 同源 + CSP）；**不**回显到列表行（只显示 `••••` + 长度）；**不**落 localStorage。
> **返回类型约定（v4 新增）**：mutation 返回类型严格按契约 § 1.1（`{ provider: ProviderConfigEntry }` 用于 create/update；`{ ok: true }` 用于 delete/setActive），**不**自创返回结构。

### 12.6 SkillsPage 交互（`/skills`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| K-1 | 页面挂载 | `GET /api/skills` | — | `{ skills: SkillSpec[] }` | — → Toast | `.all` 写入；grid 卡片渲染 |
| K-2 | 卡片点击 | `GET /api/skills/:id` | — | `{ skill: { name, id, body } }` | `SKILL_NOT_FOUND` → Toast + 移除卡片 | `.detail(id)` 写入；打开详情 Modal（只读） |
| K-3 | 详情 Modal 关闭 | — | — | — | — | — |
| K-4 | "在 Composer 中引用"（**契约 § 1.4 无 enable/disable endpoint**） | — | — | — | — | **本期不实现**；UI 隐藏该按钮；开 issue 给后端加 `POST /api/skills/:id/toggle` |

### 12.7 AgentsPage 交互（`/agents`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| A-1 | 页面挂载 | `GET /api/agents` | — | `{ agents: AgentListItem[] }` | — → Toast | `.all` 写入；表格渲染 |
| A-2 | 行点击 | `GET /api/agents/:id` | — | `{ spec: AgentSpec }` | `AGENT_NOT_FOUND` → Toast；`AGENT_SPEC_INVALID_JSON` → Toast "该 Agent 配置损坏" | `.detail(id)` 写入；打开详情 Modal（只读）。**v4 Modal 内容来源（契约未明示）**：前端 fallback 显示 `error.details.body`（若存在）+ `error.requestId`（必有）|
| A-3 | "新建 Agent"（**契约 § 1.4 缺 create/update/delete endpoint**） | — | — | — | — | **本期不实现**；UI 隐藏该按钮；开 issue 给后端加 `POST/PUT/DELETE /api/agents` |
| A-4 | "启动 Agent"（**契约 § 1.4 缺 launch endpoint**） | — | — | — | — | **本期不实现**；UI 隐藏该按钮；开 issue 给后端加 `POST /api/agents/:id/launch` |

### 12.8 SettingsPage 交互（`/settings`）

| ID | 触发 | HTTP | 入参 | 出参 | 错误码 → UI | 状态变化 |
|---|---|---|---|---|---|---|
| T-1 | 主题切换（dark/light/system） | — | — | — | — | localStorage `my-agent.theme`；`<html data-theme>` 即时更新；`useTheme` 订阅；system 模式 `matchMedia('(prefers-color-scheme: dark)')` |
| T-2 | 语言切换（zh-CN/en） | — | — | — | — | localStorage `my-agent.locale`；Context Provider 切换；下次启动持久化 |
| T-3 | "快捷键说明" 区块 | — | — | — | — | 纯渲染，引用 § 5.7 |
| T-4 | "关于" 区块 | — | — | — | — | 纯渲染，显示版本号 + 仓库地址 |

### 12.9 全局交互

| ID | 触发 | HTTP / 客户端 | 行为 |
|---|---|---|---|
| G-1 | `⌘K` / `Ctrl+K` | 客户端 | 打开 `CommandPalette`（Radix Dialog）：搜索框 + 模糊匹配会话/页面/命令；**v4 数据源**：会话走 `useSessions()` Query cache（已加载即用，不重新 fetch）；选中后 `navigate` 或执行 |
| G-2 | `⌘/` | 客户端 | `document.querySelector('[data-composer]')?.focus()` |
| G-3 | `⌘B` | 客户端 | Zustand slice `sidebarCollapsed.toggle()` |
| G-4 | `⌘,` | 客户端 | `navigate('/settings')` |
| G-5 | `Esc` | 客户端 | 关闭最上层 Dialog / 取消流式（若在流式中则触发 § 12.1.2） |
| G-6 | 离线检测（**v4 debounce 防抖**） | `window.addEventListener('online'/'offline')` | 离线：Composer 禁用 + Toast "网络不可用"；**上线**：debounce 1.5s 后才触发 Toast "已恢复连接"（避免网络抖动刷屏）+ 解禁 Composer；**不**自动重连已断开的 SSE |
| G-7 | 任意 API 错误（非预期 code） | 客户端 | Toast "服务异常（code: <code>）" + `console.error` 上报（v1 仅 console；后续接 observability） |
| G-8 | JS 运行时错误 | `ErrorBoundary` 包裹 `<Outlet />` | 友好降级页 + "刷新"按钮 + `console.error` |
| G-9 | 主题初始化（防 FOUC） | `<head>` 内嵌同步脚本 | React 挂载前读 localStorage 并设 `data-theme` + `<html lang>` |

### 12.10 错误码 → UI 映射（统一规则，**v4 全集重写**）

> **契约 § 3 + `errors.ts:ApiErrorCode` 定义的 27 个 code 全覆盖如下**。
> HTTP 状态码以契约 § 3 / `errors.ts:ERROR_STATUS_MAP` 源码为准（**v4 修正**：Provider 校验错 400 → 422）。
> 本表作为实现时查表依据，避免每个交互重复决策。

**通用 4xx / 5xx（7）**

| 错误码 | HTTP | UI 反馈 | 自动行为 |
|---|---|---|---|
| `INVALID_JSON` | 400 | Toast "请求格式错误"（无对应表单时）；表单上下文仅字段红字 | 表单聚焦首个错误字段 |
| `VALIDATION_FAILED` | 422 | Toast + 表单字段红字（**v4 改名**：原 spec 误写为 `VALIDATION_ERROR`，与 enum 对齐）| 表单聚焦首个错误字段 |
| `NOT_FOUND` | 404 | Toast "资源不存在" | 列表页自动移除失效项 |
| `METHOD_NOT_ALLOWED` | 405 | Toast "接口不支持此操作" | — |
| `PAYLOAD_TOO_LARGE` | 413 | Toast "内容过长，请精简" | **不自动截断**（避免静默丢失用户已输入内容）；高亮超出字符数 + 阻止提交 |
| `RATE_LIMITED` | 429 | Toast "操作过快，请稍候" | 读 `error.details.retryAfterMs` 退避（**v4 修正**：不用硬编码 1s）|
| `INTERNAL` | 500 | Toast "服务异常" + "重试"按钮 | 列表/详情页**保留旧数据**（**v4 区分**：INTERNAL 不主动清空 cache）|

**Provider 域（8）**

| 错误码 | HTTP | UI 反馈 | 自动行为 |
|---|---|---|---|
| `PROVIDER_NOT_FOUND` | 404 | Toast "Provider 不存在" + 清除选中 | 列表页移除该项 |
| `PROVIDER_DUPLICATE_ID` | 409 | `id` 字段红字 "id 已存在" | — |
| `PROVIDER_INVALID_BASE_URL` | 422 | `baseUrl` 字段红字（**v4 修正**：HTTP 400 → 422）| — |
| `PROVIDER_INVALID_TYPE` | 422 | `type` 字段红字（**v4 修正**：HTTP 400 → 422）| — |
| `PROVIDER_API_KEY_EMPTY` | 422 | `apiKey` 字段红字（**v4 修正**：HTTP 400 → 422）| — |
| `PROVIDER_ACTIVE_NOT_DELETABLE` | 409 | Modal "不能删除当前激活的 provider，请先切换" | 引导切换激活 |
| `PROVIDER_ALREADY_EXISTS` | 409 | Toast "Provider 已存在"（**v4 新增**：原 spec 漏）| — |
| `MODEL_NOT_FOUND` | 404 | Toast "该 provider 不支持此模型"（**v4 新增**：原 spec 仅在 § 12.5 P-9 出现）| 还原 model 字段 |

**Session 域（3）**

| 错误码 | HTTP | UI 反馈 | 自动行为 |
|---|---|---|---|
| `SESSION_NOT_FOUND` | 404 | Toast "会话不存在" + 跳转 `/sessions`（§ 12.1.4）| navigate |
| `SESSION_ALREADY_EXISTS` | 409 | Toast "会话已存在"（**v4 新增**：原 spec 漏）| — |
| `SESSION_CORRUPT_FILE` | 500 | Toast "会话文件损坏" + 详情 Modal（**v4 统一**：用 Modal 而非"详情链接"，避免歧义）| 详情 Modal 显示 `error.details`（fallback requestId）|

**Chat 流域（6）**

| 错误码 | HTTP | UI 反馈 | 自动行为 |
|---|---|---|---|
| `CHAT_SESSION_BUSY` | 429 | Toast "会话正在处理，请稍候" | Composer 按钮 disabled **error.details.retryAfterMs** ms（**v4 修正**：不用硬编码 1s）；timer 到期自动恢复；disable 期间可继续编辑 draft |
| `CHAT_ABORTED` | 200 | **不算错误**（**v4 新增**：原 spec 漏；abort 是用户行为，后端 200 确认）| 关闭 reader + 切 `aborted` 态；保留已收内容 |
| `CHAT_RUNNER_ERROR` | 500 | 助手消息下方红条 + "重试发送"按钮（**v4 独立一行**：原 spec 与 INTERNAL 合并会丢失专属上下文）| 不走 Toast |
| `CHAT_INVALID_EVENT` | 500 | Toast "服务端事件异常" + "重试"按钮（**v4 新增**：原 spec 漏）| 关闭流 + 切 `error` 态 |
| `STREAM_ALREADY_RUNNING` | 409 | Toast "流已在运行"（**v4 新增**：原 spec 漏；流重启竞态）| — |
| `STREAM_NOT_FOUND` | 404 | Toast "流已结束" + 关闭 reader（**v4 新增**：原 spec 漏；abort 时引用已结束 streamId 触发）| — |

**Agent / Skill 域（3）**

| 错误码 | HTTP | UI 反馈 | 自动行为 |
|---|---|---|---|
| `AGENT_NOT_FOUND` | 404 | Toast "Agent 不存在" | 列表页移除 |
| `AGENT_SPEC_INVALID_JSON` | 500 | Toast "Agent 配置损坏" + 详情 Modal | 详情 Modal 显示原始 spec + requestId |
| `SKILL_NOT_FOUND` | 404 | Toast "Skill 不存在" + 移除卡片 | — |

**§ 7.1 与 § 12.10 一致性约束（v4 新增）**：

- § 7.1 "API 401/403 → Toast + 跳 Settings"：**契约 enum 无 401/403 code**，本期无认证系统，删除该行（**v4 删除**）
- `CHAT_RUNNER_ERROR` 与 `INTERNAL` 区分：`CHAT_RUNNER_ERROR` **专属于流式上下文**（助手消息红条 + 重试按钮），`INTERNAL` 走 Toast + 通用重试按钮
- `CHAT_SESSION_BUSY` retryAfterMs 从 `error.details` 读取，**不**硬编码 1s
- 表单上下文出现 `INVALID_JSON` 时仅字段红字（**不** Toast）；非表单上下文（全局 fetch 失败）才走 Toast

### 12.11 缺失 endpoint 清单（**实现前必开 issue**）

> 本节明确列出"用户期望但后端契约未提供"的 endpoint；spec 不为这些交互做实现，UI 必须**隐藏对应按钮**，避免出现"点了 404"。

| 期望功能 | 缺哪个 endpoint | 处理 | issue 标题建议 |
|---|---|---|---|
| 重命名会话 | `PUT /api/sessions/:id/rename` | UI 隐藏 | `[contract] add session rename endpoint` |
| 导出会话 | `GET /api/sessions/:id/export` | UI 隐藏 + tooltip "导出功能开发中"（**v4 I1 占位**）| `[contract] add session export endpoint` |
| 启用/停用 skill | `POST /api/skills/:id/toggle` | UI 隐藏 | `[contract] add skill toggle endpoint` |
| 新建/编辑/删除 agent | `POST/PUT/DELETE /api/agents` | UI 隐藏 | `[contract] add agent CRUD endpoints` |
| 启动 agent | `POST /api/agents/:id/launch` | UI 隐藏 | `[contract] add agent launch endpoint` |
| 撤销刚才发送的消息 | `DELETE /api/sessions/:id/messages/:msgId` | UI 显示但仅本地删除（**v4 新增**：§ 12.1.9）| `[contract] add message delete endpoint` |
| 单条 provider 详情接口 | `GET /api/providers/:id` | **v4 决策**：前端从 § 12.5 P-1 `.all` 缓存按 id 取；不要求后端补 | `[contract] clarify front-end actual need for provider detail endpoint` |
| 修正契约 § 4.3 SSE 事件表格 | 与 `sse.ts:SSE_EVENT_TYPES` 对齐 | 以源码为准（**v4 § 6.4.2 已对齐 13 个事件**）| `[contract] reconcile SSE event table with sse.ts` |

> 所有 issue 在 plan 阶段统一建；spec 实现期间**不**等待 issue 解决，按"UI 隐藏"或"本地 fallback"交付。

---

## Next（v4 更新）

**spec v4 已完成 v2 review 综合报告 13 Critical + 18 Important 全部修订。请用户 review。**

### v4 修订对照表（**针对 v2 review**）

| Critical | 修订内容 | 章节 |
|---|---|---|
| **C1** 缺 `GET /api/providers/active` | 新增 P-`active`（main.tsx prefetch + 缓存读取）| § 12.5 |
| **C2** P-2 引用不存在的 `GET /api/providers/:id` | 改为客户端缓存读取（P-1 `.all` 按 id 取）| § 12.5 P-2 |
| **C3** Provider 校验错 HTTP 状态码（400→422）| 表中 3 处状态码统一改为 422 | § 12.10 Provider 域 |
| **C4** § 12.10 错误码枚举缺 7 个 + 命名错位 | 全表重写为 27 个 code；`VALIDATION_ERROR` → `VALIDATION_FAILED` | § 12.10 |
| **C5** § 12.1.1 流式帧漏 `content_block_start`/`stop` | § 6.4.2 与 § 12.1.1 都补齐 13 个 SSE 事件 | § 6.4.2 / § 12.1.1 |
| **C6** § 6.4.3 状态机 error/reconnecting 入口冲突 | 转换矩阵 + 显式分流（submitting→error / streaming→reconnecting）| § 6.4.3 |
| **C7** submitting 超时阈值缺失 | 显式 10s 超时切 error + Toast | § 6.4.3 / § 7.1 |
| **C8** reconnecting 终止态未定义 | 5 次重连耗尽→error + commit partial + Toast | § 6.4.3 |
| **C9** "21 wire-routes" vs 实际 19 | § 1.1 / § 1.3 / § 9.1 / § 9.2 / § 11 / § 6.4.3 全改为 19 | 多处 |
| **C10** PAYLOAD_TOO_LARGE 自动截断危险 | 删除自动截断 + 前端 32000 字符预校验 | § 12.1.1 / § 12.10 |
| **C11** § 12.1.5 压缩缺量化阈值 | 量化阈值 ratio > 0.9 自动弹 Modal | § 12.1.5 |
| **C12** § 12 缺"重新生成回复"交互 | 新增 § 12.1.7 | § 12.1.7 |
| **C13** § 12 缺"复制消息文本"交互 | 新增 § 12.1.8 | § 12.1.8 |

| Important | 修订内容 | 章节 |
|---|---|---|
| I1 | streamId 改 optional + 缺时按 cid abort | § 12.1.2 |
| I2 | § 12.10 表格重排四列 + 段首注 27 个 code 全覆盖 | § 12.10 |
| I3 | § 12.11 增 `GET /providers/:id` 本地缓存说明 | § 12.11 |
| I4 | § 7.1 / § 12.10 UI 一致性 + CHAT_RUNNER_ERROR 独立行 | § 7.1 / § 12.10 |
| I5 | 多 tab in-flight 429 retryAfterMs 自动恢复 | § 6.4.3 / § 12.1.1 |
| I6 | Composer 按钮在 submitting/streaming/reconnecting 期间 disabled | § 6.4.3 |
| I7 | 重试按钮仅在 error 态出现；streaming 期间停止按钮固定"停止" | § 6.4.3 / § 12.1.3 |
| I8 | done vs message_stop 双事件：任一即可，200ms 缓冲 | § 6.4.3 |
| I9 | reconnecting 独立测试用例 | § 8.2 / § 11 A4 |
| I10 | error 状态 commit 与 § 12.1.3 重试语义统一（复用占位）| § 6.4.3 / § 12.1.3 |
| I11 | Toast 文案规范（≤16 字 zh / ≤80 字符 en + imperative + 行动建议）| § 7.5 |
| I12 | online Toast debounce 1.5s 防刷屏 | § 7.1 / § 12.9 |
| I13 | 自动滚动仅当距底部 ≤ 100px；浮动按钮 "↓ N 条新消息" | § 12.3 C-8 |
| I14 | @ 提及测试断言 body.text 严格等于原 draft + '@<name>' | § 12.1.6 |
| I15 | § 12.4 S-2 搜索无结果空态 + 匹配字段（name fuzzy + id prefix + preview contains）| § 12.4 |
| I16 | § 12.5 P-4/P-5 表单提交期间 disable submit + spinner | § 12.5 |
| I17 | 新增 § 12.1.9 撤销发送 | § 12.1.9 |
| I18 | § 12.5 P-8/P-9 用 setQueryData 替代 invalidate | § 12.5 |

### v3 → v4 总览

- spec 行数：1150 → **1304 行**
- § 12.10 错误码表行数：11 → **27**（覆盖 `errors.ts:ApiErrorCode` 全集）
- § 12 交互数：60+ → **66**（新增 § 12.1.7 重新生成 + § 12.1.8 复制 + § 12.1.9 撤销；§ 12.5 P-`active`）
- v4 修订标记：74 处（grep `v4` 计数）

请用户 review 后选择下一步（同 v3）。
