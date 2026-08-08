---
artifact: implementation-plan
route: superpowers:writing-plans -> orchestration
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - ~/.agents/skills/writing-plans/SKILL.md
  - harness-kit/core/orchestration/dispatcher-workflow.md
source:
  - .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/context-map.md
  - harness-kit/project.profile.md
  - harness-kit/references/definition-of-done.md
created_at: 2026-08-07
status: draft
approved: false
tier: 2
dispatch: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-dispatch.md
---

# my-agent Web 前端 — 实施计划（v3.3 校对版）

> 本文为 `.ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md` (v3.3 Reviewer 修复版) 的实施拆解。
> Goal = spec § 1.3；非目标、约束、风险均以 spec 为准，本文仅把 spec § 7 的 WU 列表细化为可执行的实施步骤。

## 1. Goal（对齐 spec § 1.3）

1. 提供**本地 Web 前端**：浏览器打开 `http://localhost:5173` 即用，**完全复用** `src/` 现有逻辑（含 `AgentRunner.runStream`、`ProvidersStore`、`SessionStore`、`PersistentSession`、`Skills/Orchestration`）。
2. 保持与 CLI **状态文件兼容**：`~/.my-agent/providers.json` / `sessions/*.jsonl` / `agents/` 两边共享，**不需要迁移**。
3. 用 **vanilla HTML / CSS / JS**（无构建工具 / 无框架）实现，遵循设计系统（Code Dark + Run Green / JetBrains Mono + IBM Plex Sans / 6 色数字菜单）。
4. 流式聊天用 **SSE**（Server-Sent Events）实现，对应 `AgentRunEvent` schema 逐事件推送。
5. 提供**对等的 CLI 命令**：`npm run web` 启动服务 + 自动打开浏览器；老 CLI 入口 `npm run chat` 完全不动。

## 2. Architecture Overview

```
[浏览器 @127.0.0.1:5173]
  web/index.html + web/style.css + web/js/{shared,state,components,features}/*.js
       │  fetch() + SSE
       ▼
[Node 单进程：bin/my-agent-web.ts]
  ├─ src/web/server/index.ts  (HTTP 骨架 + 静态文件 + CSP 头)
  ├─ src/web/server/routes/{providers,sessions,messages,agents,skills}.ts
  ├─ src/web/server/sse.ts        ← AsyncIterable<AgentRunEvent> → SSE
  ├─ src/web/server/errors.ts     ← ApiErrorCode → HTTP 状态码映射
  └─ src/web/server/open-browser.ts (macOS/Linux/Windows)
       │  直接复用
       ▼
[现有 src/* 模块 — 一行不改 CLI 入口]
  ├─ src/storage/providers-store.ts
  ├─ src/storage/session-store.ts
  ├─ src/agent/runner.ts        (B8 扩展 compactNow + Session.getTokenEstimate)
  ├─ src/agent/persistent-session.ts
  ├─ src/orchestration/tools.ts
  └─ src/skills/loader.ts
```

**双入口并存策略（spec § 2.1）：** `npm run chat` 与 `npm run web` 互不冲突；`ProvidersStore` 用 `atomicWrite`、`SessionStore` 通过 `PersistentSession` 内部锁串行化写。

## 3. Tech Stack（已确认）

| 层 | 技术 | 来源 |
| --- | --- | --- |
| 后端运行时 | Node.js (ESM, `"type": "module"`) | `package.json` |
| 后端语言 | TypeScript ^5.7.0（target ES2023） | `package.json` |
| 后端 HTTP | Node 内置 `http.createServer`（**零**新增依赖） | spec § 4.1 |
| 后端校验 | Zod ^3.24.0 | `package.json` |
| 后端执行器 | `tsx ^4.0.0` | `package.json` |
| 后端互斥 | `async-mutex ^0.5.0` | `package.json`（B8 cid-mutex 直接复用） |
| 前端 | vanilla HTML/CSS/JS | spec § 4.2 |
| 前端 Markdown | DOMPurify v3 + marked v12（**手动放 `web/js/vendor/`**） | spec § 4.2 |
| 测试 | Vitest ^2.0.0（现有） | `package.json` |
| 静态检查 | `npm run check`（tsc --noEmit） | `project.verification.md` |

## 4. Critical Files Inventory

### 4.1 新建文件（后端）

| 路径 | 归属 WU | 职责 |
| --- | --- | --- |
| `bin/my-agent-web.ts` | B1 | 入口：`loadConfig` + `ProvidersStore.load` + `SessionStore` + `startServer` + `openBrowser` |
| `src/web/server/index.ts` | B1 | `http.createServer` + 路由分发 + 静态文件 + CSP 头 + 中间件链 |
| `src/web/server/errors.ts` | B7 | `ApiErrorCode` 枚举 + `HttpError` + 错误响应壳 |
| `src/web/server/sse.ts` | B3 | `streamAgentRun()` + `abortStream()` + `_liveStreams` Map |
| `src/web/server/open-browser.ts` | B5 | 三平台 `open` / `xdg-open` / `start` |
| `src/web/server/validators/providers.ts` | B2 | Zod schema：`ProviderUpsertSchema` |
| `src/web/server/validators/sessions.ts` | B3 | Zod schema：`ListSessionsQuerySchema` + `CompactRequestSchema` |
| `src/web/server/routes/providers.ts` | B2 | 6 个 Provider REST handler |
| `src/web/server/routes/sessions.ts` | B3 + B8 | 4 个 Session REST + `compactSession` |
| `src/web/server/routes/messages.ts` | B3 | `postMessageStream` + `abortMessage` |
| `src/web/server/routes/agents.ts` | B4 | 2 个 Agent GET |
| `src/web/server/routes/skills.ts` | B4 | 2 个 Skill GET |

### 4.2 新建文件（前端）

| 路径 | 归属 WU | 职责 |
| --- | --- | --- |
| `web/index.html` | F1 | 骨架 + Skip-link + ARIA landmark |
| `web/style.css` | F0 | Design System 完整 token |
| `web/js/shared/utils.js` | F3 | escapeHtml / menuColorHex / formatTime |
| `web/js/shared/api.js` | F3 | apiFetch + 统一错误解码 |
| `web/js/shared/i18n.js` | F3 | 单语 + 字典（保留扩展点） |
| `web/js/shared/theme.js` | F0 | applyTheme + `system` 模式 Safari < 14 polyfill |
| `web/js/shared/icons.js` | F4 | Lucide inline SVG（≈30 个） |
| `web/js/state/state.js` | F5 | 全局状态 + messageQueues + lastView 持久化 |
| `web/js/components/{Button,Card,Input,Modal,Toast,Skeleton,EmptyState,ErrorState,Tabs,Tooltip,ConfirmDialog,DropdownMenu,MenuCard}.js` | F6 | 13 个基础组件 |
| `web/js/components/sidebar.js` + `panels.js` | F7 | 5 个 panel DOM + 视图切换 |
| `web/js/features/menu.js` | F8 | Bento Grid 主菜单 |
| `web/js/features/providers.js` | F9 | Provider 表格 + 编辑表单 + 422 回填 |
| `web/js/features/sessions.js` | F10 | 侧边栏会话列表 |
| `web/js/features/chat.js` | F11 | SSE 消费 + 工具卡片 + Markdown |
| `web/js/features/agents.js` | F12 | 子 Agent 列表 + 详情 |
| `web/js/features/skills.js` | F13 | Skill 列表 + 详情 |
| `web/js/features/settings.js` | F14 | 主题 + 端口信息 |
| `web/js/features/slash.js` + `theme.js` | F18 | 18 条 slash + `/theme` 循环 |
| `web/js/components/HelpModal.js` / `HistoryModal.js` / `ToolsModal.js` / `SkillsModal.js` / `SkillDetailModal.js` / `AgentsModal.js` / `ProviderModal.js` / `CompactModal.js` / `UsageModal.js` | F18 | 9 个 slash Modal |
| `web/js/app.js` | F15 | 启动流水线（三段） |
| `web/js/app.keymap.js`（可选拆分）或合并到 `app.js` | F16 | 全站快捷键 |
| `web/js/vendor/dompurify.min.js` + `web/js/vendor/marked.min.js` + `web/js/vendor/README.md` | F2 | 手动 vendor + SRI hash |

### 4.3 修改文件（最小侵入）

| 路径 | 修改内容 | 归属 WU |
| --- | --- | --- |
| `src/agent/runner.ts` | 新增 `public compactNow(cid, signal): Promise<{tokensBefore, tokensAfter, durationMs, summary?}>`；把 `prepareContextBeforeModelCall`（[runner.ts:1037](src/agent/runner.ts#L1037)）的压缩逻辑提取为可复用 `private compactContextInternal()` | B8 |
| `src/agent/session.ts` | 新增 `public getTokenEstimate(): { used, limit, ratio }` | B8 |
| `src/agent/persistent-session.ts` | override `getTokenEstimate()` | B8 |
| `package.json` | `scripts.web`: `tsx bin/my-agent-web.ts`；可选 `web:dev`: `vite` | B1 |
| `tsconfig.json` | 不变（strict ESM 已就绪） | — |
| `vitest.config.ts` | 不变（test/`*.test.ts` 已 include） | — |
| `README.md` | 新增「Web 模式」一节 + 主菜单 / 对话 / 设置三张截图说明 | 收尾 |

### 4.4 复用模块（spec § 2 强调「不动」）

- `src/cli/menu.ts` — `mainMenuChoices` 6 项作前端菜单 1:1 对应；不调用，仅作对照
- `src/cli/io.ts` — `menuColor(i)` 颜色映射表 1:1 对应
- `src/skills/loader.ts` + `src/orchestration/tools.ts` — `/api/skills` `/api/agents` 直接读取

## 5. Constraints / Acceptance Criteria

### 5.1 功能（spec § 8.1）

- `npm run web` 启动后浏览器自动打开 `http://localhost:5173`，看到 Bento Grid 6 色数字彩菜单。
- 主菜单 6 项点击行为 = 对应 CLI 选项（缺 Key → 顶部 banner；删除 active → 提示切回等）。
- 对话页输入消息后立即看到 SSE 流式吐字（首个 token < 1.5s）。
- 「■ 停止」按钮 / `Cmd/Ctrl+.` 在 200ms 内中断流。
- 工具调用以 `🔧 <name>(<params>)` 卡片显示在 assistant 气泡内，✅/❌ 状态切换。
- 6 色数字与 CLI `menuColor(i)` 对应：dark / light 主题下分别验证。
- `npm run chat` 同时运行**不受影响**。

### 5.2 流式 / 状态 / 协议（spec § 8.2）

- 同一会话内连续发送两条消息，第二条在第一条流完后才发出（FIFO），UI 显示排队位置。
- SSE 协议严格按 `event: start | text_delta | ... | done | error` 命名，每个事件含 `seq`。
- 客户端 seq 去重；服务端心跳 15s；X-Stream-Id 响应头。
- 同 cid 第二次 send 在第一次未 done 时 → 服务端 429 + `Retry-After`。

### 5.3 Slash 命令 18 条（spec § 8.2.1）

- 18 case 全跑通：`/help` `/quit` `/exit` `/clear` `/new` `/save` `/history` `/tools` `/skills` `/skill` `/agents` `/provider` `/model` `/compact` `/retry` `/copy` `/theme` `/usage` + 未知命令 Toast warning。

### 5.4 API 契约（spec § 8.3）

- 响应壳统一 `{ ok: true, data }` / `{ ok: false, error: { code, message, requestId } }`。
- HTTP 状态码映射固定；Zod 边界校验；隐式 v1。
- 错误码枚举 21 个在 `src/web/server/errors.ts` 注册并单测。
- 所有 POST/PUT 请求体大小上限 1MB → 413 `PAYLOAD_TOO_LARGE`。

### 5.5 设计系统 / 视觉 / 交互（spec § 8.4）

- Color tokens 全部落地（spec § 4.4.1 14 个 + 6 色菜单），CSS 变量化；dark / light 双主题切换。
- Typography：JetBrains Mono 用于数字 + 代码 / IBM Plex Sans 用于正文；Google Fonts 预连接。
- Spacing scale 0.25rem 倍数；自定义 px 值 grep 为 0（lint 强制）。
- 无 AI 风格（无紫色默认 / 无 rounded-2xl 到处 / 无 placeholder）。
- 图标系统：全部 Lucide inline SVG，无 emoji 图标（错误 UI 文字描述除外）。
- 空 / 加载 / 错误三态每个有数据的组件都处理。

### 5.6 可访问性（spec § 8.6）

- `npx @axe-core/cli http://localhost:5173` 0 critical / 0 serious。
- 键盘可达：仅用 Tab / Enter / Esc / 方向键可走完「启动 → 主菜单 → 进入设置 → 编辑 Provider → 保存 → 进入对话 → 发送消息 → 收到回复」。
- Skip link / 焦点可见 / `aria-live` / `prefers-reduced-motion` 全部覆盖。

### 5.7 兼容与安全（spec § 8.7）

- `~/.my-agent/providers.json` / `sessions/*` 两个入口读写完全共享。
- 路径参数过 `assertPathSegment()`（已存在于 `src/storage/paths.ts`）；payload 用 Zod + 1MB 上限。
- XSS：所有用户文本经 `escapeHtml`，Markdown 经 DOMPurify 净化。
- CSP 头：服务端写死。
- DOMPurify / marked SRI hash 正确。
- API Key 不写入 localStorage / sessionStorage / IndexedDB。

### 5.8 质量（spec § 8.8）

- `tsc --noEmit` 无错误；`vitest run` 全绿。
- 每个 REST 路由覆盖：200 / 400 / 404 / 422 / 429 / 500 各一例。
- `grep -r "rounded-2xl" web/` 为 0。
- README 更新「Web 模式」一节。
- `.ai-runtime-artifacts/verifications/2026-08-07-web-frontend-verification.md` 落盘。
- Playwright 脚本 `test/e2e/web-smoke.spec.ts` 跑通 5 个用户旅程，CI 强制（**本期不接入 CI**，仅落盘脚本）。

## 6. WU 拆解（spec § 7 → 可执行实施步骤）

> spec § 7.1/§ 7.2 已经定义 B1-B8 / F0-F18 共 28 个 WU。本文逐 WU 加 **Done criteria** + **测试覆盖** + **依赖文件清单**，作为 worker prompt 的输入。

### 6.1 后端 WU

#### B1 — HTTP 服务器骨架

- **Done criteria**：
  - `bin/my-agent-web.ts` 启动并打印 `🌐 my-agent Web 已启动: http://localhost:5173`。
  - `GET /` 返回 `web/index.html`（200），`Content-Type: text/html; charset=utf-8`。
  - 所有 `text/event-stream` 与静态资源响应头含 CSP `default-src 'self'; script-src 'self'; style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com; connect-src 'self'; img-src 'self' data:;`
  - `process.env.MY_AGENT_WEB_PORT` 可覆盖端口（默认 5173）。
  - SIGINT 优雅退出：关闭 server + `sessionsStore.closeAll()`。
- **测试**：`test/web/server/index.test.ts`：① 默认启动 → GET `/` 200 + HTML；② 端口冲突 → 报错；③ CSP 头存在；④ SIGINT → 优雅退出。
- **产出**：`bin/my-agent-web.ts` + `src/web/server/index.ts` + `test/web/server/index.test.ts`。

#### B2 — Provider 域 REST（6 个端点）

- **Done criteria**：
  - 6 个端点按 spec § 3.1.1 全部 200 走通。
  - `POST/PUT /api/providers` Zod 校验失败 → 422 + `details`。
  - 删除当前 active provider → 409 `PROVIDER_ACTIVE_NOT_DELETABLE`（除非回退有 enabled）。
- **测试**：每个端点 200/400/404/422/429 各一例；active 不可删；原子写入后 provider.json 文件权限 0o600（macOS/Linux）。
- **产出**：`src/web/server/routes/providers.ts` + `src/web/server/validators/providers.ts` + `test/web/server/routes/providers.test.ts`。

#### B3 — Session 域 + Chat 流

- **Done criteria**：
  - `GET /api/sessions?archived=&limit=&offset=` 按 spec § 3.1.2 走通；query schema 校验。
  - `POST /api/sessions` 创建 `gconv` 会话并返回 `id`。
  - `GET /api/sessions/:id/history` 返回 `messages`。
  - `POST /api/sessions/:id/messages/stream` 触发 `runner.runStream`，按 spec § 6.1 序列化 SSE（带 seq、心跳、X-Stream-Id）。
  - `POST /api/sessions/:id/messages/abort` 取 `streamId` → 触发对应 `controller.abort()`。
  - 同 cid 第二次 send 在第一次未 done 时 → 429 `CHAT_SESSION_BUSY` + `Retry-After: <ms>`。
- **测试**：用 stub runner（`runStream` 返回 `AsyncIterable<AgentRunEvent>`）跑 SSE；abort 200ms 内生效；429 触发条件。
- **产出**：`src/web/server/routes/sessions.ts` + `src/web/server/routes/messages.ts` + `src/web/server/sse.ts` + `src/web/server/validators/sessions.ts` + `test/web/server/{routes,sse}.test.ts`。

#### B4 — Agent / Skill 域（4 个 GET）

- **Done criteria**：
  - `GET /api/agents` 列出 builtin（fixtures/orchestration/agents/）+ user（`~/.my-agent/agents/`），每项含 `id / source / name / description_zh / description_en / skill_list`。
  - `GET /api/agents/:id` 返回完整 spec；404 `AGENT_NOT_FOUND`。
  - `GET /api/skills` + `GET /api/skills/:id` 同模式。
- **测试**：builtin 列表非空；用户目录为空时只返回 builtin；404 路径。
- **产出**：`src/web/server/routes/agents.ts` + `src/web/server/routes/skills.ts` + `test/web/server/routes/{agents,skills}.test.ts`。

#### B5 — 自动打开浏览器

- **Done criteria**：
  - macOS 调 `open <url>`；Linux 调 `xdg-open <url>`；Windows 调 `start "" <url>`。
  - `process.env.CI === "1"` 时跳过。
  - 命令失败仅 stderr 输出，不阻塞 server 启动。
- **测试**：jest 中 mock `child_process.exec` 验证三平台调用的命令形态。
- **产出**：`src/web/server/open-browser.ts` + `test/web/server/open-browser.test.ts`。

#### B6 — 端到端冒烟（手测）

- **Done criteria**：
  - 文档 `.ai-runtime-artifacts/verifications/2026-08-07-web-smoke.md`：列出 `npm run web` 后的 6 步手测（启动 / 主菜单 / Provider 编辑 / 新建会话 / 发送消息 / 停止）。
  - 6 个域 curl 命令清单 + 期望输出示例。
- **产出**：手测清单。

#### B7 — 统一错误处理器

- **Done criteria**：
  - `ApiErrorCode` 枚举含 spec § 3.4.2 全 21 个错误码。
  - `HttpError(code, status, details?)` 构造器；`toResponseBody(requestId)` 返回 `{ ok: false, error: { code, message, requestId, details? } }`。
  - `errors.ts` 注册到 `src/web/server/index.ts` 的 try/catch 中间件。
- **测试**：每个错误码 → 对应 HTTP status；`requestId` 来自 `crypto.randomUUID()`。
- **产出**：`src/web/server/errors.ts` + `test/web/server/errors.test.ts`。

#### B8 — 新增 3 个端点 + AgentRunner API 扩展

- **Done criteria**：
  - `AgentRunner.compactNow(cid: string, opts?: { signal?: AbortSignal }): Promise<{ tokensBefore, tokensAfter, durationMs, summary? }>` 公开方法。
    - 内部复用 `prepareContextBeforeModelCall` 逻辑（提取为 `private compactContextInternal()`）。
    - 同 cid 上已有 in-flight 流 → 抛 `AlreadyCompactingError`。
  - `Session.getTokenEstimate(): { used, limit, ratio }`（[session.ts](src/agent/session.ts)）；`PersistentSession` override。
  - 3 个新端点按 spec § 3.1.5 实现：
    - `GET /api/providers/active` (F-S-0)
    - `PATCH /api/providers/active/model` (F-S-1) — 422 `MODEL_NOT_FOUND`
    - `POST /api/sessions/:cid/compact` (F-S-2) — body `{ confirm?: boolean }`；首次取 estimate，二次触发 `compactNow`
  - cid-mutex 用 `async-mutex`（已存在于 `package.json`）防止 R-22 竞态。
- **测试**：
  - `runner.compactNow` 单元：mock Session、tokenizer；tokensAfter < tokensBefore；abort 后抛错。
  - `Session.getTokenEstimate` 单元：空 Session → 0；mock tokenizer 后正确。
  - 三个端点：200 + 404 + 409 + 422；`/compact` 两次请求流程；cid-mutex 并发。
- **产出**：3 个 handler + 1 个 `AgentRunner.compactNow` + 1 个 `Session.getTokenEstimate` override + `test/agent/runner-compact.test.ts` + `test/web/server/routes/{providers-active,sessions-compact}.test.ts`。

### 6.2 前端 WU

#### F0 — Design System 落地

- **Done criteria**：
  - `web/style.css` 含 spec § 4.4.1 全部 14 个 token + 6 色菜单 token。
  - dark / light / system 三态：`data-theme="system"` + `data-system-theme="dark|light"` 双属性选择器（**v3.3 修复：v3.2 只搬动 JS 未搬 CSS**）。
  - Google Fonts 预连接 + IBM Plex Sans / JetBrains Mono。
  - `prefers-reduced-motion` 全站降级 0ms。
- **产出**：`web/style.css` + `web/js/shared/theme.js`（含 `addListener` polyfill 落实 R-26）。

#### F1 — index.html 骨架

- **Done criteria**：
  - 含 `Skip to main content` 链接（首焦点元素）。
  - ARIA landmark：`<header>` `<aside>` `<main>` `<footer>`。
  - `<html lang="zh-CN">`。
  - 顺序 `<script>` 标签：vendor → shared → state → components → features → app.js。
- **产出**：`web/index.html`。

#### F2 — vendor 文件 + SRI

- **Done criteria**：
  - `web/js/vendor/dompurify.min.js` v3.x.x + `web/js/vendor/marked.min.js` v12.x.x。
  - `web/index.html` 引用含 `<script integrity="sha384-..." crossorigin="anonymous">`。
  - `web/js/vendor/README.md` 注明来源 + sha384 来源（`https://www.srihash.org/`） + 升级步骤。
- **产出**：2 个 vendor 文件 + README。

#### F3 — shared 工具 / api / i18n

- **Done criteria**：
  - `utils.js#escapeHtml(s)` / `menuColorHex(i, theme)` / `formatTime(ts)`。
  - `api.js#apiFetch(url, opts)` 统一错误解码（`safeJson` + 错误码 → toast 映射）。
  - `i18n.js#t(key)` 字典查表（默认中文）；预留 `setLocale(locale)`。
- **测试**：vitest jsdom：escapeHtml 5 case；menuColorHex 6 数字 × 2 主题 = 12 case；apiFetch 错误解码。
- **产出**：3 文件 + `test/web/shared.test.ts`。

#### F4 — icons（Lucide SVG）

- **Done criteria**：
  - `web/js/shared/icons.js` 提供 `iconHtml(name, size)`，至少 18 个：send / stop / plus / trash-2 / settings / message-square / history / users / sparkles / zap / search / x / check / chevron-right / chevron-down / loader-2 / alert-triangle / info / check-circle-2 / x-circle。
  - 24×24 viewBox，`stroke-width: 2`，`stroke: currentColor`。
- **测试**：每个 name 返回非空 SVG 字符串；size 应用到 width/height。
- **产出**：`web/js/shared/icons.js` + `test/web/shared-icons.test.ts`。

#### F5 — state 状态管理

- **Done criteria**：
  - `state.js` 暴露 `currentView` / `currentCid` / `conversations` / `pendingConvs` / `messageQueues`。
  - `setView(view, cid?)` 写 `localStorage['my-agent.lastView']`。
  - `enqueueMessage(cid, text)` + `drainQueue(cid)` FIFO 串行化。
- **测试**：FIFO 顺序；lastView 持久化 + 读取。
- **产出**：`web/js/state/state.js` + `test/web/state.test.ts`。

#### F6 — 基础组件 13 个

- **Done criteria**：
  - `Button` 4 variant × 3 size；`focus-visible` ring。
  - `Modal` 用原生 `<dialog>` + focus trap + ESC 关闭。
  - `Toast` 全局单例，4 队列上限；aria-live / role 区分。
  - `Skeleton` / `EmptyState` / `ErrorState` 三态组件就绪。
  - `MenuCard` 6 色数字菜单专用，hover transform + 边框变色。
- **测试**：vitest jsdom：focus trap、Toast FIFO、EmptyState 大图标 + CTA。
- **产出**：13 文件 + `test/web/components.test.ts`。

#### F7 — sidebar + panels

- **Done criteria**：
  - `sidebar.js`：Logo + 主菜单 6 项 + 会话列表 + 设置入口。
  - `panels.js`：5 个 panel DOM（main-menu / chat / providers / agents / settings）+ `setView()` 切换 + 焦点移到 panel h1。
- **测试**：view 切换 → 对应 panel `display` 切换；sidebar 折叠（Cmd+B）。
- **产出**：2 文件。

#### F8 — features/menu 主菜单

- **Done criteria**：
  - Bento Grid 4+2 布局（① 大卡片 + ②⑤⑥ + ③④⑤）。
  - 键盘 ↑↓ 切换、1-6 直接选、Enter 触发。
  - ① 缺 Key 时跳转设置。
- **测试**：键盘 1-6 命中对应卡片。
- **产出**：`web/js/features/menu.js`。

#### F9 — features/providers Provider 设置

- **Done criteria**：
  - 表格 + 6 项操作（列 / 编 / 切 / 启禁 / 删 / 返回）。
  - 表单 422 `details` 回填到具体字段。
  - 删除当前 active → 409 Modal 提示先切换。
- **测试**：表单校验、422 回填。
- **产出**：`web/js/features/providers.js`。

#### F10 — features/sessions 侧边栏会话列表

- **Done criteria**：
  - 列出 gconv 会话；日期桶分组；删除带 ConfirmDialog。
  - 新建会话（POST /api/sessions）。
- **产出**：`web/js/features/sessions.js`。

#### F11 — features/chat 流式聊天

- **Done criteria**：
  - 发送按钮 + Cmd/Ctrl+Enter；Cmd/Ctrl+. 停止。
  - SSE 消费按 spec § 6.4；`tool_start` 创建卡片（v3.3 修复 Finding 5）。
  - Markdown 走 DOMPurify；用户文本 `escapeHtml`。
  - 错误 UI：SSE 断开显示「↻ 重试发送」按钮（**不**自动重连）。
- **测试**：模拟 server-sent-event stream；dispatch 顺序；seq 去重。
- **产出**：`web/js/features/chat.js` + `test/web/features/chat.test.ts`。

#### F12 — features/agents

- **Done criteria**：
  - 列出 builtin + user agents；点击进入详情（描述 + workflow 前 3 行 + skill 列表）。
- **产出**：`web/js/features/agents.js`。

#### F13 — features/skills

- **Done criteria**：
  - 列表 + 详情 Modal（Markdown + DOMPurify）。
- **产出**：`web/js/features/skills.js`。

#### F14 — features/settings

- **Done criteria**：
  - 主题切换（/theme 三态）+ 端口信息 + 重启按钮（仅 placeholder）。
- **产出**：`web/js/features/settings.js`。

#### F15 — app.js 启动

- **Done criteria**：
  - 三阶段：① theme 应用（F0）→ ② 拉 `/api/providers/active` 状态条 → ③ 恢复 lastView 视图。
  - 全局错误捕获 + Toast 显示。
- **产出**：`web/js/app.js`。

#### F16 — 全站快捷键

- **Done criteria**：
  - Cmd/Ctrl+K 快速跳转；Cmd/Ctrl+B 折叠侧边栏；Cmd/Ctrl+/ 打开帮助弹窗；Cmd/Ctrl+Enter 发送；Cmd/Ctrl+. 停止；Esc 关闭顶层 Modal；1-6 主菜单；↑↓ 主菜单焦点。
  - `<input>` / `<textarea>` 内禁用非 Enter/Esc 快捷键。
- **产出**：合并到 `app.js` 或单独 `app.keymap.js`。

#### F17 — 前端冒烟测试 + a11y 自检

- **Done criteria**：
  - `test/e2e/web-smoke.spec.ts` 5 个用户旅程：启动 → 主菜单 → 进入设置 → 编辑 Provider → 保存 → 进入对话 → 发送消息 → 收到回复。
  - `npx @axe-core/cli http://localhost:5173` 0 critical / 0 serious。
  - `.ai-runtime-artifacts/verifications/2026-08-07-web-frontend-verification.md` 落盘（含 axe 报告 + 截图清单）。
- **产出**：Playwright 脚本 + verification 产物。

#### F18 — Slash 命令全套（spec § 5.4.1）

- **Done criteria**：
  - `web/js/features/slash.js`：`tryHandleSlash` + `dispatchSlashKind` + `SLASH_COMMANDS` 字典 18 条（spec § 5.4.1）。
  - 11 个 Modal：HelpModal / HistoryModal / ToolsModal / SkillsModal / SkillDetailModal / AgentsModal / ProviderModal / CompactModal / UsageModal + theme.js。
  - `/compact` Modal 内有「立即压缩」按钮 → POST `/api/sessions/:cid/compact`。
  - `/theme` 与 F0 `shared/theme.js` 共享 `my-agent.theme` localStorage key，通过 `CustomEvent('my-agent-theme-change')` 通信。
- **测试**：`slash.test.js` 每条命令各 case（空消息 / 参数缺失 / 未知命令 / 命中 / 服务端失败 / clipboard 权限拒绝 / theme 三态循环）。
- **产出**：11 文件 + 单测。

### 6.3 测试覆盖矩阵（自检）

| 模块 | 单测覆盖 | 集成 / E2E |
| --- | --- | --- |
| `bin/my-agent-web.ts` | index.test.ts | E2E 启动 |
| routes/providers.ts | 6 端点 × 5 status | E2E 编辑保存 |
| routes/sessions.ts | 4 端点 × 5 status | — |
| sse.ts | seq / heartbeat / abort | E2E 流式 |
| routes/messages.ts | 429 + abort | E2E 流式 |
| routes/agents/skills.ts | 列表 / 详情 / 404 | E2E AgentsModal |
| errors.ts | 21 个错误码 → HTTP | — |
| open-browser.ts | 三平台 mock | — |
| runner.compactNow | tokensAfter < tokensBefore / abort | — |
| Session.getTokenEstimate | 空 / 填充 | — |
| 前端 utils/api/icons/state | 单测 (jsdom) | E2E 主菜单 |
| 前端 components | 13 个单测 | E2E Modal/Toast |
| 前端 features | chat/slash 主单测 | E2E 5 旅程 |

## 7. 依赖图与执行顺序（与 spec § 7.3 一致）

```
                          B1 ──┬── B2 ──── B7 ──┐
                               ├── B3 ─────────┤
                               ├── B4 ─────────┤
                               └── B5 ─────────┘
                                              │
                                              ▼
                              (B6 手测)  ←───┘
                                              │
                  F0 ─┬─ F3 ─┬─ F5 ─┬─ F7 ─┬─ F8  ──┐
                      ├─ F4 ─┤       ├───── F9 ─┤     │
                      └─ F2 ─┘       ├───── F10 ┤     │
                                     ├───── F11 ┤     │
                                     ├───── F12 ┤     │
                                     ├───── F13 ┤     │
                                     ├───── F14 ┘     │
                                     ├─ F15 ── F16 ───┘
                                     ├─ F18
                                      └───── B8 ── F18 依赖
```

**关键路径：**
1. `B1 → B3 → F11 → F15 → F16 → F17`（后端核心 + 前端流式 + 冒烟）
2. `F0 → F6 → F8 → F15 → F16 → F17`（前端设计 + 组件 + 主菜单）
3. `B1 → B8 → F18`（compactNow + slash `/compact`）

**可并行窗口：**
- B1 完成后 B2 / B3 / B4 / B5 并行。
- F0-F4 完成后 F5-F14 可大量并行（前端无依赖）。
- B8 与 B3 并行（B8 仅依赖 B1 + B7）；F18 等 B8 + F6 + F11 完成。

### 7.1 派发 GROUP（执行图见 `*-dispatch.md`）

| GROUP | WU | 备注 |
| --- | --- | --- |
| GROUP-1（并行） | B1 | 串行启动；先落 `bin/` + `src/web/server/index.ts` 骨架 |
| GROUP-2（并行） | B2 / B3 / B4 / B5 | B1 完成后；4 个 route handler + open-browser 并行 |
| GROUP-3（并行） | F0 / F1 / F2 / F4 | 前端基础设施并行；F3 依赖 F0 + F2 |
| GROUP-4（并行） | F3 / F5 / F6 / F18-theme | F0/F2 完成后 |
| GROUP-5（并行） | F7 / F8 / F9 / F10 / F12 / F13 / F14 | F5+F6 完成后；F11 等 B3 + F11 自身 |
| GROUP-6（串行） | B7 → B8 → F11 → F15 → F16 | B7 串行；B8 / F11 与前端并行 |
| GROUP-7（并行） | F17 / F18 / B6 | 收尾 + 集体测试 |

## 8. Definition of Done 检查（来自 `harness-kit/references/definition-of-done.md`）

### 8.1 Correctness

- [ ] 所有 § 5 验收清单通过
- [ ] `npm run check`（tsc --noEmit）0 错误
- [ ] `npm test`（vitest run）全绿
- [ ] 新行为有单测覆盖（fail without → pass with）
- [ ] 边界 / 错误路径有覆盖（429 / 422 / abort / 损坏文件）

### 8.2 Quality

- [ ] 代码通过命名 / 结构自释（无解释性 `// what` 注释）
- [ ] 零重复业务逻辑
- [ ] 无死代码 / 调试 print / 注释掉的块
- [ ] 改动范围限于本任务
- [ ] Lint/Format pass（如未来启用 ESLint）

### 8.3 Integration

- [ ] CLI `npm run chat` 不受影响（双入口并存验证）
- [ ] `~/.my-agent/providers.json` / `sessions/*` 双端共享（写入后 CLI 可读）
- [ ] 公接口变更考虑向后兼容（隐式 v1；新字段 optional）

### 8.4 Documentation

- [ ] 公共 API / 用户面行为有文档（README 「Web 模式」节）
- [ ] 架构决策（如 slash 命令独立于 B8 后端）记录到 `.ai-runtime-artifacts/decisions/`（**本期不写**，spec 已收敛）
- [ ] 文档用 timeless 语言描述当前状态（不是变更日志）

### 8.5 Ship-readiness

- [ ] 安全：XSS / CSP / SRI / 路径穿越 / 文件权限 0o600 全部覆盖（spec § 6.6）
- [ ] 可观测：服务启动 / 错误码分布 / SSE 心跳计数（最小化日志，console 输出 requestId）
- [ ] 回滚：删除 `bin/my-agent-web.ts` + `src/web/` 目录即可回滚（CLI 不受影响）
- [ ] 人工审核 plan 通过（本产物）

## 9. References 检查

> 本节为产物合规模块，须在实施前预 Read 并在 execution-log 中保留 `pass / fail / n/a` 结论。

| Reference | 检查内容 | 来源 |
| --- | --- | --- |
| `definition-of-done.md` | § 8 全量 25+ 项逐项打勾 | `harness-kit/references/definition-of-done.md` |
| `testing-patterns.md` | AAA + Mock 边界 + 反模式 | `harness-kit/references/testing-patterns.md` |
| `security-checklist.md` | OWASP Top 10 + LLM Top 10（XSS / CSP / API Key 不外传 / model 输出不可信） | `harness-kit/references/security-checklist.md` |
| `accessibility-checklist.md` | WCAG 2.1 AA（键盘 / 屏幕阅读器 / 颜色对比 / ARIA live） | `harness-kit/references/accessibility-checklist.md` |
| `orchestration-patterns.md` | 编排反模式自检（WORKTREE-INIT / 不委派整个 epic / 上下文打包 / 多层审查） | `harness-kit/references/orchestration-patterns.md` |
| `project.verification.md` | 验证命令 = `npm run check && npm test` + `bash harness-kit/scripts/harness-check.sh` | `harness-kit/project.verification.md` |

**前置已 Read（本文撰写时）：** `routing.md` / `artifacts.md` / `plan.harness-overlay.md` / `dispatch.harness-overlay.md` / `dispatcher-workflow.md` / `project.profile.md` / `context-map.md` / `definition-of-done.md` / `security-checklist.md` / `testing-patterns.md` / `accessibility-checklist.md` / `orchestration-patterns.md` / `src/agent/types.ts` / `src/storage/providers-store.ts` / `src/storage/session-store.ts` / `src/agent/persistent-session.ts`（部分）/ `src/agent/runner.ts`（grep 公共方法）。

## 10. 风险与对策（来自 spec § 9；本期重点关注）

| ID | 风险 | 对策落到 |
| --- | --- | --- |
| R-22 | `/compact` 与 runner 自动 compaction 竞态 | B8 cid-mutex + 前端 disable 按钮 |
| R-23 | `/usage` 内存增长 | F18 `/usage` 实现内 `setView('chat', newCid)` 清零 |
| R-24 | `/history` 大列表性能 | F18 HistoryModal 分页 `?limit=200&offset=50` |
| R-25 | `/copy` clipboard 权限失败 | F18 `slash.js` try/catch + 回退 `execCommand` |
| R-26 | `/theme` system 模式 Safari < 14 | F0 `theme.js` polyfill `addListener` |
| **新** | **CSP 头过严破坏字体加载** | B1 CSP 显式 `style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com` |
| **新** | **vendor 升级 SRI 不同步** | F2 README 写升级步骤 |
| **新** | **agent-browser skill 不可用** | 本期不引入；仅写 E2E 脚本供人工跑 |

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

| 用户指令 | 触发动作 |
| --- | --- |
| 「**开始实现**」/「**执行**」 | 进入 orchestration 阶段：WORKTREE-INIT → ContextPack → GROUP 派发 → 集体测试 → 多层审查 → execution-log |
| 「**改计划**」/「**调整 XX**」 | 直接给修改意见，按 diff 修订本文 + `*-dispatch.md` |
| 「**改方案**」 | 回到 spec（`.ai-runtime-artifacts/specs/`）；先改 spec 再改本文 |
| 「**审擦**」 | 派发 reviewer 子 Agent → 产出 `reviews/2026-08-07-web-frontend-plan-review.md` |

**前置依赖（动手前再核一次）：**

- [x] spec 文档已落盘到 `.ai-runtime-artifacts/specs/`
- [ ] 用户已审阅本 plan（本文）
- [ ] 用户明确进入实现阶段（「开始实现」/「执行」）
- [ ] 用户接受 dispatch 并行策略（`*-dispatch.md`）