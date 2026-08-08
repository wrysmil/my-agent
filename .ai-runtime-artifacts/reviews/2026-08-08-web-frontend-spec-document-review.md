---
title: Web 前端重写 spec — 三路并行审查综合报告
date: 2026-08-08
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .claude/skills/document-review/SKILL.md（已 Load）
  - .claude/skills/document-review/review-rules/design.md（已 Load）
  - .claude/skills/document-review/checklists/review-checklist.md（已 Load）
source:
  - .ai-runtime-artifacts/specs/2026-08-08-web-frontend-react-rewrite-spec.md（被审文档）
  - .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
  - src/web/server/{csp,static,sse,index}.ts
  - bin/my-agent-web.ts
  - harness-kit/core/routing.md
  - harness-kit/artifact-templates/document-review.md
created_at: 2026-08-08
status: draft
approved: false
reviewers:
  - name: Reviewer A
    focus: 架构 / 模块边界 / 设计模式 / 复杂度
    verdict: BLOCK
  - name: Reviewer B
    focus: 环境准备 / 依赖 / 性能预算 / 安全 / CSP
    verdict: BLOCK
  - name: Reviewer C
    focus: 可执行性 / 迁移路径 / 风险 / 范围
    verdict: BLOCK
overall_verdict: BLOCK
---

# Web 前端重写 spec — 三路并行审查综合报告

> **结论：BLOCK** — 三路 reviewer 一致 BLOCK，共 **15 项 Critical** / **20+ 项 Important**。建议**重大修订**后再走 self-review → 用户 review。

---

## 文档类型

架构/技术设计文档（spec，对应 `.claude/skills/document-review/review-rules/design.md` § 1-6）。

---

## 审查规则加载

- [x] 通用审查流程（`SKILL.md`）
- [x] 文档类型特定规则：`review-rules/design.md` § 1-6
- [x] 环境准备审查规则：`review-rules/design.md` § 4 + `checklists/review-checklist.md` § 环境准备

---

## 评分

| 维度 | 评分 | 说明 |
|---|---|---|
| **1. 文档完整性** | 基本完整 | 11 节齐全；缺 i18n 路径对齐、§ 环境变量、§ 暗色 token、依赖版本表 |
| **2. 逻辑清晰度** | 基本清晰 | 多处自相矛盾（见缺失项 #C1/C3/C5/C6/C8），术语基本一致 |
| **3. 环境准备完整性** | 不完整 | 无版本号、无 Node/浏览器下限、无 .env.example、缺字体/CSP 后端改动清单 |
| **4. 可执行性** | 不达标 | M1-M8 验证列多为"跑通"等模糊动词；无自动化命令、无测量阈值 |
| **5. 后端契合度** | 严重不符 | SSE 协议、端口、CSP、静态服务、localStorage 与后端实情多处矛盾 |

---

## Critical 缺失项（按优先级排序）

> 三路 reviewer 各自发现的 Critical 项已去重合并。

### C1. **SSE 传输方式根本不兼容** — Reviewer B
spec § 3.2 / § 6.2 / § 8.1 用 `EventSource` 封装。契约 § 1.3 流式入口是 **POST** `/api/sessions/:id/messages/stream` 带 body `{text, systemPrompt?}`；浏览器 `EventSource` 只支持 GET 且**不能**带 body。
**修复**：改用 `fetch(POST) + ReadableStream` 手写 SSE 解析；或引入 `@microsoft/fetch-event-source`（需列入依赖表 + bundle 预算）；同步改 § 8.1 测试策略为 mock `fetch` + `ReadableStream`。

### C2. **SSE 事件名与契约枚举根本对不上** — Reviewer A / B / C
spec § 6.2 写 `text-delta` / `tool-call` / `tool-result` / `done`（kebab-case + 4 类）。
契约 § 4.3 实际枚举为 `message_start / content_block_delta / tool_use / tool_result / message_delta / message_stop / error / done / aborted / usage / ping` 等 10+ 类（snake_case）。
**修复**：以 `src/web/server/sse.ts:SSE_EVENT_TYPES` 源码为准，逐条列出事件名 + payload；spec § 6.2 必须 100% 对齐。同时契约自身 § 4.3 与 sse.ts 源码也存在差异，建议开后端澄清 Issue。

### C3. **§ 7.4 与 § 1.3 后端范围冲突（多处反复出现）** — Reviewer A / B / C
spec § 1.3 明确「不动后端 wire-routes」，但 § 7.4 要求：
- API Key 改 httpOnly cookie（**必须**后端新增 `/api/auth/*` 端点 + Set-Cookie）
- § 3.3 改 `src/web/server/csp.ts` 注入 nonce
- § 3.3 改 `src/web/server/static.ts` 扩白名单
- § 9.1 Step 5 改 `static.ts` 指向 dist

**修复**：删除 § 7.4 的 httpOnly cookie 条款（API Key 本就在后端 ProvidersStore，**不存在**前端存密钥的问题）；独立加一节「后端最小改动清单」，列出**确需改**的文件 + 改动点 + 是否能用 env var 规避（如 `MY_AGENT_WEB_ROOT=web/dist` 已存在，可不改代码）。

### C4. **§ 7.4 API Key httpOnly cookie 是伪需求** — Reviewer B
契约 § 10 localStorage key 列表只有 `lastView / apiBase / theme / sidebarWidth`，**不含** `apiKey`；API Key 由后端 `ProvidersStore` 持有（契约 § 2.1 `apiKey` 是 POST body 字段）。
**修复**：整段删除 httpOnly cookie / CSRF 论述；改为「前端不接触 API Key」。

### C5. **i18n 路径不一致** — Reviewer A
§ 3.2 写 `src/lib/i18n.ts`（单文件）；§ 7.5 写 `src/i18n/{zh,en}.json`（数据）。
**修复**：统一为「`src/lib/i18n.ts` 是导入入口（含 Context/Provider/切换 hook），`src/i18n/{zh,en}.json` 是文案数据」，并在 § 3.2 目录树显式画出 `src/i18n/` 子目录。

### C6. **sessionId 数据源双写** — Reviewer A
§ 5.1 把 sessionId 放 URL `/chat/:sessionId`（React Router 状态）；§ 6.1 又把"当前 sessionId"塞 Zustand。两份 source of truth 必竞态。
**修复**：URL 为唯一真相，Zustand 仅持有 UI 瞬态（主题/语言/Sidebar 折叠/Composer 草稿）。

### C7. **useChatStream 归属与实现位置不明** — Reviewer A
spec § 3.2 同时列出 `hooks/useChatStream.ts` 与 `features/chat/useChatStream + types`；§ 6.1 又称"流式状态由 useChatStream（React state）"。
**修复**：明确单一归属 — `hooks/useChatStream.ts` 作为唯一实现；`features/chat/` 仅做类型导出与编排。

### C8. **§ 9.1 Step 1 与 § 9.3 回滚方案直接冲突** — Reviewer C
Step 1 "删除 `web/{index.html,style.css,js/}`"；§ 9.3 "保留旧 web，新前端走 `/web-new/` 灰度"。两步不能并存。
**修复**：§ 9.1 加 Step 0「`git checkout -b feat/web-react-rewrite`；旧 web/ 不删直到 M8」；或 § 9.3 改为「Step 1 已删除时只能 forward-fix + git revert」二选一。

### C9. **pnpm workspace 与根 package.json 不兼容** — Reviewer B / C
仓库无 `pnpm-workspace.yaml`，根 `package.json` 无 `workspaces` 字段，锁文件是 `package-lock.json`。spec § 2 写 "pnpm（推荐）" + § 3.2 写"pnpm workspace"，但无任何 root 改造动作。
**修复**：在 § 9 M1 显式补一条「创建 `pnpm-workspace.yaml`（packages: ['.', 'web']）；把 `zod`/`vitest`/`tsx` 升到 root devDependencies 并从 web/package.json 移除；切换根 lockfile 或保留 npm + 不建 workspace」。

### C10. **Tailwind v4 + shadcn/ui CLI init 不兼容** — Reviewer C
Tailwind v4 把配置改为 CSS-first `@theme`（spec § 3.2 已用 `@tailwindcss/postcss`）；但 shadcn/ui CLI 的 `init` 仍输出 v3 `tailwind.config.ts`。
**修复**：风险表加一条；缓解改为「手动写 `components.json`，UI 组件按 shadcn 源码逐个拷贝（不跑 init）」。

### C11. **深链路由在现有静态服务下 404，无 SPA fallback** — Reviewer B
`static.ts:resolveStaticPath` 只把精确 `/` 映射到 `/index.html`；`/chat/abc` → 文件不存在 → 404。契约 § 5.1 列的 9 个路由（含 `:sessionId`）都会失败。
**修复**：要么后端加 history fallback（从非目标移除），要么**改用 HashRouter**（推荐，无后端改动）。

### C12. **自托管字体被 CSP `font-src` 拦截** — Reviewer B
spec § 4.1 用 `--font-sans Inter` / `--font-mono JetBrains Mono`，§ 1.3 "CSP 维持不改"。但 `csp.ts:CSP_HEADER` 的 `font-src https://fonts.gstatic.com data:` **不含 `'self'`**；`static.ts:ALLOWED_EXTS` 也不含 `.woff2`。自托管双重被拒；走 Google Fonts 是渲染阻塞 + 离线不可用 + LCP 杀手。
**修复**：明确字体方案（推荐：自托管 woff2 + `font-display: swap` + `font-display: optional` 兜底）；承认需改 csp.ts + static.ts，列入后端最小改动清单。

### C13. **Vite dev proxy 端口三处不一致** — Reviewer B / C
- spec § 3.3：8787
- `src/web/server/index.ts:137` 默认：4321
- `bin/my-agent-web.ts:37` 读 `MY_AGENT_WEB_PORT ?? "4321"`
- 契约 § 10 `apiBase: http://localhost:5173`（过期）

**修复**：统一为 4321，并修正契约 § 10 过期值。

### C14. **§ 7.4 API Key httpOnly cookie 与 § 1.3「不做账户系统」双重冲突** — Reviewer A / B
引入 cookie 认证隐含会话/账户体系，与 § 1.3「不做账户系统」直接冲突。
**修复**：见 C3/C4，删除该方案。

### C15. **契约自身 § 4.3 与 sse.ts:SSE_EVENT_TYPES 不一致** — Reviewer B
契约文档 § 4.3 表格列 `text_delta / tool_delta / tool_start / tool_progress / tool_end / compaction`；源码 `sse.ts:SSE_EVENT_TYPES` 列 `message_start / content_block_delta / tool_use / tool_result / message_delta / message_stop / error / done / aborted / usage / ping`。
**修复**：开 Issue 让后端澄清；spec 端以源码为准。

---

## Important 缺失项（精选 Top 12）

| # | 项 | 章节 | 修复方向 |
|---|---|---|---|
| I1 | 依赖表完全无版本号/安装命令/锁文件策略 | § 2 | 补精确版本表 + `pnpm add` 一行复制 + 锁文件策略 |
| I2 | § 2 决策表缺"不选 X 理由"（Zustand/TanStack Query 是否过度工程） | § 2 | 每条决策加 1-2 行对照说明 |
| I3 | § 3 缺模块依赖方向规则矩阵 | § 3 | 加 `pages→components+features`、`features→hooks+lib+store`、`components→lib+ui` 矩阵；约束 `components/*` 不得 import `features/*` |
| I4 | 旧 `web/js/components/modals/` 11 个弹窗去向未交代 | § 9.1 | 加迁移对应表：通用 confirm → `components/common/ConfirmDialog`，业务弹窗 → `features/<domain>/<Action>Dialog.tsx` |
| I5 | § 9.1 Step 4 "按 WU 顺序实现"过于抽象 | § 9.1 | 拆成 Step 4a-f，对应 M2-M7 |
| I6 | § 9.2 阶段化验证标准不够具体（多"跑通"动词） | § 9.2 | 每阶段验证列改 `<自动化命令> + <通过标准> + <不可自动化项处理>` |
| I7 | § 11 验收口径 9 条中至少 4 条不可量化 | § 11 | axe 0 critical / bundle ≤ 180KB / 7 路由可达 / 旧 test/web/ 全绿 → 全部补测量命令 + 阈值 + 失败回退 |
| I8 | § 4.1 仅定义浅色 token，缺暗色模式策略 + token | § 4.1 | 补 `:root[data-theme="dark"]` + `system` 模式 + `prefers-color-scheme` 监听 + 暗色 token 全量表 |
| I9 | § 6.3 TanStack Query 默认 `staleTime`/`gcTime`/`retry` 未定义 | § 6.3 | 给默认配置（`staleTime` 列表 30s / 详情 5min；`retry: (n, err) => err.status >= 500 && n < 2`） |
| I10 | § 7.3 性能预算"180KB"无实测基线 + 测量方法 + CI 门禁 | § 7.3 | 加 `rollup-plugin-visualizer` + `size-limit` 在 M1 设 CI 阈值；明确 prod `vite preview` 测量 |
| I11 | react-markdown v9 与 marked+DOMPurify 行为**不等价**，会影响"保留行为"目标 | § 7.4 | 决策：是否支持原始 HTML？若否 → 安全但行为变；若加 `rehype-raw` → 需精确定义 sanitize schema（允许代码高亮 className + `urlTransform`） |
| I12 | § 10 风险表漏掉 `src/web/server/static.ts:ALLOWED_EXTS` 不覆盖 Vite 产物（缺 `.mjs`/`.woff2`/`.png`/`.webmanifest`/`.map`） | § 9.2 / § 10 | M2 验证列加「`static.ts` ALLOWED_EXTS 扩展或改通用 mime fallback」 |

---

## Suggestion（精选 Top 6）

1. **§ 2 决策**：shadcn/ui 引入但 § 5.2 Sidebar 用 emoji → 改用 `lucide-react`（与 shadcn 默认搭配一致）
2. **§ 5.6**：`⌘.` 与浏览器"停止加载"冲突 → 改 `⌘,`
3. **§ 6.3**：Query key 用 factories（`queryKeys.sessions.list()` / `.detail(id)`）防拼写错
4. **§ 3.2 `components.json`**：alias 约定未写明（推荐 `@/` → `web/src/`）
5. **§ 7.1**：缺离线场景 UX（`fetch` 抛 TypeError → Toast + 禁用 Composer + 监听 `online` 恢复）
6. **§ 7.4**：静态资源缓存策略缺位（Vite hash 文件应 `immutable, max-age=31536000`；当前 `no-cache` 是开发期遗留）

---

## Nit（精选 Top 5）

1. § 5.2 "7 个 page" → 实际 8 个（含 NotFoundPage）
2. § 7.4 写 "CSP 维持 `src/web/server/csp.ts`"，但 contract § 7 暗示 csp 在 `index.ts` middleware 里 — 需复核实际路径
3. § 11 验收"行为与现有 wire-routes 一致"缺行为清单 — 引用契约 § 1 路由总表作对照
4. § 6.2 SSE 重连"1s/2s/4s/8s max" 缺最大次数与最终放弃行为 — 补 `max retries=5 → Toast '连接已断开，请刷新'`
5. § 1.1 行数估算"约 1.2K 行"过时（实测 3K+ 行含 24 个 components 与 8 个 features）

---

## 改进建议（按优先级）

### P0（必须修订才能继续）

1. **删除 httpOnly cookie 段**（§ 7.4 / § 1.3 联动）— 见 C3 / C4 / C14
2. **重写 SSE 章节**（§ 3.2 / § 6.2 / § 8.1）— 见 C1 / C2 / C15
3. **决定路由方案**（§ 3.2 / § 5.1）— 见 C11（推荐 HashRouter，避免后端改动）
4. **重写后端最小改动清单**（新增 § 3.4 或 § 10.2）— 见 C3 / C12 / I12
5. **统一端口与 i18n 路径** — 见 C5 / C13

### P1（修订后必须补）

6. **依赖版本表**（§ 2）— 见 I1
7. **环境变量表 + Node/浏览器下限**（新增 § 4.2 或 § 7.6）— 见 I1
8. **模块依赖方向矩阵**（§ 3 末尾）— 见 I3
9. **暗色 token 表 + 持久化策略**（§ 4.1 + § 5.x）— 见 I8
10. **TanStack Query 默认配置**（§ 6.3）— 见 I9
11. **性能预算实测命令 + CI 门禁**（§ 7.3 + § 9.2 M1）— 见 I10
12. **react-markdown 与 marked+DOMPurify 行为差异的决策点**（§ 7.4 + § 8.2 XSS 用例）— 见 I11
13. **可量化验收口径**（§ 11 全部条目补 `命令+阈值+回退`）— 见 I7
14. **M1-M8 验证列改自动化命令**（§ 9.2）— 见 I6

### P2（实现阶段关注）

15. 字体方案决策（自托管 vs Google Fonts）+ CSP/static 联动 — C12
16. Radix + React 19 并发渲染兼容性 spike — M1 跑通 Dialog + DropdownMenu
17. 旧 `test/web/` 17 个测试迁移策略 — M1 先 git mv 到 `test/web-legacy/` 标 `@deprecated`，M8 删除
18. 静态资源缓存策略二分（hash 文件 `immutable` + index.html `no-cache`）— § 7.4
19. emoji → lucide-react 图标统一 — § 5.2
20. ⌘. → ⌘, 调整 — § 5.6

---

## 后续步骤

按 document-review skill：

**审查不通过 → 返回修改文档**

按 Harness 阶段门禁，spec 修订后须重新走：
1. **Spec self-review**（placeholder / consistency / scope / ambiguity）
2. **用户 review**（已通过本次三路并行审查给出修订方向）
3. **再次三路审查**（可选，重点验证 Critical 是否全部解决）

建议流程：

| 步骤 | 谁 | 产物 |
|---|---|---|
| 1. 修订 spec（按 P0/P1） | Leader（直接 Write/Edit） | spec.md 更新 |
| 2. Spec self-review | Leader | inline 修复 |
| 3. 用户 review | 用户 | 「写计划」或给修改意见 |
| 4. 三路再审查（可选） | 3 个 reviewer subagent | reviews/...-document-review-v2.md |
| 5. 写实施计划 | Leader（Load `writing-plans`） | plans/2026-08-08-web-frontend-react-rewrite-plan.md |

---

## Next

- **审查不通过**（BLOCK）→ 返回修改 spec（按 P0/P1 修订）
- **修订后再走 self-review + 用户 review**
- **通过后** → 进入 `writing-plans` 阶段（写实施计划）
