---
artifact: execution-log
route: orchestration:dispatcher-workflow
spec: .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md
dispatch: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-dispatch.md
contract: .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
worktree: wt-web-frontend-2026-08-07
branch: harness/wt-web-frontend-2026-08-07
created_at: 2026-08-07
status: in_progress
---

# Web 前端 — 实施执行日志（GROUP-1 + 3 + 2）

> 本文件按 dispatch.md 的 GROUP 顺序追加；同 GROUP 内 WU 按 commit 时间排序。
> 每条记录含：状态 / commit / 变更 / 关键决策 / 偏差。

---

## GROUP-1（串行启动）

### WU-01 (B1) HTTP 服务器骨架

- **状态**：✅ success（首派被用户中止，重派后成功）
- **commit**：`3e9d9b3 feat(web): B1 — HTTP server 骨架 + CSP + 静态文件 + 优雅关闭`
- **变更**：9 files, 1249 insertions（+2 deletions）；新文件 7 个
  - `bin/my-agent-web.ts` (111 行)
  - `src/web/server/{index,csp,router,static,graceful-shutdown}.ts`
  - `src/web/server/index.test.ts` (258 行, 14 用例)
  - 修改 `package.json`（加 `bin` + `scripts.web`）+ `vitest.config.ts`（include `src/**/*.test.ts`）
  - 删除 `test/web/server/index.test.ts`（旧 WU 残留，引用不存在的 `startServer`）
- **关键决策**：
  - `createServer(deps)` 工厂：deps 全 optional（`logger? providersStore? sessionStore? port? host? webRoot?`）
  - CSP 完整字符串：包含 `form-action 'self'`（spec § 6.1 必填，上游 contract 漏掉）
  - Permissions-Policy 仅 HTML 响应附（`csp.ts applySecurityHeaders(res, {html:true})`）
  - 路径穿越：`path.resolve + path.sep` 严格边界 + NUL 字节 + 扩展名 allowlist
  - 优雅关闭：SIGINT/SIGTERM + 5s `forceExitMs` + `closeIdleConnections()`
- **测试**：tsc 0 错误；vitest 14/14；完整 `npm test` 477/477 全绿
- **偏差**：
  - 任务描述「21 路由」vs spec § 6.2 实有 19 → 落地 19；测试 `expect(ROUTES.length).toBe(19)` 附说明。→ **#deviation-1**
  - 删除 `test/web/server/index.test.ts`（旧 WU 残留）— 允许列表外但必要修复
  - 修改 `vitest.config.ts` 扩展 include（任务允许列表未含）— 必要修复让 vitest 收 `src/**/*.test.ts`

---

## GROUP-3（前端基础设施，与 GROUP-2 并行）

### WU-03a (F0) Design System + theme.js

- **状态**：✅ success
- **产出**：
  - `web/style.css` (294 行，73 unique CSS tokens，13 三态选择器行)
  - `web/js/shared/theme.js` (133 行)
- **v3.3 Safari polyfill 修复**（与 v3.2 关键差异）：
  - v3.2 误：`mql.addListener(mql, cb)`（第二个参数错误）
  - v3.3 修：`mql.addListener((e) => apply(e.matches))`

### WU-03b (F1) index.html 骨架

- **状态**：✅ success
- **commit**：`c7f2d52 feat(web): F1 — index.html 骨架`
- **产出**：186 行，42 scripts，含 placeholder `integrity` 属性（待 F2 真实 hash 覆盖）
- **a11y**：skip-link + ARIA landmarks + `<meta name="viewport">`

### WU-03c (F2) vendor + SRI hash

- **状态**：✅ success
- **产出**：
  - `web/js/vendor/dompurify.min.js` (29,474 bytes, v3.4.13)
  - `web/js/vendor/marked.min.js` (35,479 bytes, v12.0.2)
  - `web/js/vendor/README.md`（升级步骤 + hash 表）
  - `web/index.html` L11-13 integrity 属性已替换为真实 sha384
- **SRI 一致性**：README 与 index.html 三处 integrity 完全一致

### WU-03d (F4) Lucide icons

- **状态**：✅ success
- **产出**：
  - `web/js/shared/icons.js` (171 行)
  - `test/web/shared-icons.test.ts` (190 行, 85/85 全绿)
- **20 图标**：send / stop / plus / trash-2 / settings / message-square / history / users / sparkles / zap / search / x / check / chevron-right / chevron-down / loader-2 / alert-triangle / info / check-circle-2 / x-circle
- **关键决策**：
  - `iconHtml(name, size=24)` + `hasIcon()` + `ICON_NAMES` 导出
  - IIFE 全局挂载，匹配 `web/index.html:138` 的 `<script defer>` 加载方式
  - `size` 经 `normalizeSize()` 数值收敛，非法值回退 24，杜绝属性注入
- **偏差**：
  - 未用 jsdom（worktree 未装）→ 改用 `node:vm` 起干净全局上下文
  - 6 个图标从 Lucide v0.400.0 取（上游 main 已重命名）→ 保留 spec 原名（`stop`/`loader-2`/`alert-triangle`/`check-circle-2`/`x-circle`/`history`），源码注释标注上游现名
  - **spec § 4.5 vs § 4.4.6 矛盾**：§ 4.4.6 要求 `icons.js`，§ 4.5 写「暂缓，先用 emoji」YAGNI → 按 § 4.4.6 + plan 实现。→ **#deviation-3**

---

## GROUP-2（后端 5 域，并行）

### WU-02a (B2) Provider 域 8 REST

- **状态**：✅ success
- **commit**：`0e81b26 feat(web): B2 — Provider 域 8 REST + Zod 校验`
- **变更**：3 files, 1529 insertions
  - `routes/providers.ts` (457 行)
  - `routes/providers.test.ts` (806 行, 26 用例，超 ≥12 要求)
  - `validators/providers.ts` (266 行)
- **关键决策**：
  - 路径穿越 4 重防御：`/` `\` NUL `..` + 编码 `%2F` `%5C` `%00`
  - toggle fallback 边界：保留 `activeProviderId` 不调 `setActiveProvider("")`
  - `body.id ≠ url :id` → 422 VALIDATION_FAILED
  - Zod `.strict()` 防字段注入
  - 测试用 `createServer + fetch` 端到端，每个测试用 `MY_AGENT_HOME` 隔离 tmp dir
- **测试**：tsc 0 错；完整 `npm test` 645/645 全绿
- **偏差**：
  - **自托管 `ApiError`**（`validators/providers.ts:32-48`）：因 WU-02e 报告时尚未 commit，prompt 允许「stub `throw { code, status, message }`」。WU-02e commit 后需要 codemod 统一到 `errors.ts`。→ **#deviation-5**
  - 测试 helper 命名 bug：`postJson/putJson/...` 返回 `respBody` 而测试解构为 `body` → 已修

### WU-02b (B3) Session + Chat + SSE

- **状态**：✅ success
- **commit**：`94c4928 feat(web): B3 — Session + Chat + SSE 完整协议`
- **变更**：8 files, 3248 insertions；59/59 自身测试
- **关键产出**：
  - `sse.ts` — 13 event types + `SseHub` (streamId→AbortController) + `Last-Event-ID` LRU cap=100 + auto-heartbeat
  - `routes/messages.ts` — `adaptStreamEvent` mapper（`StreamEvent` → 13 SSE events）
  - `validators/sessions.ts` — 4 Zod schema
  - `routes/sessions.ts` — 5 routes（list/create/history/delete/compact 501 占位）
  - `http-helpers.ts` — `readBodyJson` (1MiB limit) + `sendJsonError` + `sendJsonOk` + ERROR_STATUS_MAP (12 codes)
- **关键 bug 修复（自检发现）**：
  - `messages.ts:248-253` LRU dedup 逻辑反：原「检查之前写入的 seq 是否在 LRU」（恒为 true）→ 后续 event 全跳过
  - 修复：先递增 seq → 检查候选 seq 是否在 LRU → 记录
- **测试 helper 修复**：
  - inline `ROUTES.find` regex `.source` filter 失败（RegExp 转义 `/` 为 `\/`）→ 用 `findStreamRoute()` / `findAbortRoute()` 改 `endsWith("messages\\/stream$")`
- **偏差**：
  - **`http-helpers.ts` ERROR_STATUS_MAP 重复**（12 codes vs errors.ts 22 codes）→ GROUP-7 codemod 删除 http-helpers.ts 版本。→ **#deviation-6**

### WU-02c (B4) Agent + Skill GET

- **状态**：✅ success
- **commit**：`494183e feat(web): B4 — Agent + Skill 域 4 GET 路由`
- **变更**：4 files；20/20 自身测试
- **数据源**：
  - Agent：复用 `loadAgentSpec` + `loadAgentSpecFromDir`（既有模块）
  - Skill：复用 `SkillLoader.scan` + `SkillLoader.load`（既有模块）
- **偏差**：
  - 加 `scope: "builtin"|"user"|"both"` 字段（保留 `source`）— 与 CLI `agent-menu.ts:discoverAgents()` 覆盖语义一致
  - `enabled` 字段全 `true`（无禁用机制）— 字段预留
  - spec § 3.1.4 用 `skill_list` → 任务用 `tools` — 按任务名实现
  - 路径穿越测试改用 `foo..bar`（Node URL 自动规整裸 `..`）

### WU-02d (B5) open-browser

- **状态**：✅ success
- **commit**：`5eca317 feat(web): B5 — open-browser 跨平台模块`
- **变更**：2 files, 725 insertions
  - `open-browser.ts` (308 行)
  - `open-browser.test.ts` (417 行, 11 用例)
- **平台覆盖**：
  - darwin → `open <url>` (detached)
  - linux / *nix → fallback 链：`xdg-open` → `gio open` → `firefox --new-window` → `google-chrome` → `chromium`
  - win32 → `cmd /c start "" <url>`
  - 其他 → `{ ok: false, error: 'unsupported platform' }`
- **关键决策**：
  - `detached: true` + `child.unref()`（父进程退出不影响浏览器）
  - `stdio: 'pipe'` → stdout/stderr `data` → `logger.debug`；缺省 logger = no-op `NULL_LOGGER`
  - **永不抛**（try/catch + `error` 事件 → `{ ok: false }` resolve 路径）
- **未触碰**：`bin/my-agent-web.ts`（wiring 留给 GROUP-7），`package.json`

### WU-02e (B7) 统一错误处理器

- **状态**：✅ success
- **commit**：`3708e2c feat(web): B7 — 统一错误处理器 + ApiErrorCode`
- **变更**：
  - `errors.ts` (~290 行) + `errors.test.ts` (52 用例)
  - `index.ts` 最小接入：4 处 `sendJsonError` → `handleError(new ApiError(...))`；删本地 `ApiErrorBody` + `sendJsonError`
  - `index.test.ts` 1 处断言：ROUTE_NOT_FOUND → NOT_FOUND
- **22 ApiErrorCode**（按 contract § 3 落地）：
  - 通用 6：INVALID_JSON / NOT_FOUND / METHOD_NOT_ALLOWED / PAYLOAD_TOO_LARGE / RATE_LIMITED / INTERNAL
  - Provider 7：PROVIDER_NOT_FOUND / PROVIDER_DUPLICATE_ID / PROVIDER_INVALID_BASE_URL / PROVIDER_INVALID_TYPE / PROVIDER_API_KEY_EMPTY / PROVIDER_ACTIVE_NOT_DELETABLE / MODEL_NOT_FOUND
  - Session 2：SESSION_NOT_FOUND / SESSION_CORRUPT_FILE
  - Chat 4：CHAT_SESSION_BUSY / CHAT_ABORTED / CHAT_RUNNER_ERROR / CHAT_INVALID_EVENT
  - Agent/Skill 3：AGENT_NOT_FOUND / AGENT_SPEC_INVALID_JSON / SKILL_NOT_FOUND
- **关键决策**：
  - `ApiErrorCode` 用 `as const` 对象 + `satisfies` 守门（与项目 strict TS 对齐）
  - `ERROR_STATUS_MAP` 用 `satisfies Record<ApiErrorCodeValue, number>` 守门
  - `handleError` Express-style 但项目不用 Express → 改直接 `res.statusCode + res.end()`
  - `requestId` 在 `createServer` 入口生成（保证 body 与 `X-Request-Id` 头一致）
  - `future-proof errorMiddleware` 占位（不暴露业务调用）
- **测试**：tsc 0 错；vitest 52/52
- **偏差**：
  - 任务说「21 code」实际 contract § 3 枚举 **22 个** → 落地 22。→ **#deviation-1**
  - `ZodError → INVALID_JSON (400)` 而非 `VALIDATION_FAILED (422)`：contract 路由表文字提及 VALIDATION_ERROR 但枚举未列 → 复用 INVALID_JSON；Zod `details.issues` 透传。→ **#deviation-2**

---

## 偏差清单（closeout 修复）

| # | 描述 | 来源 | 修复归属 |
| --- | --- | --- | --- |
| 1 | 「21 路由」vs spec § 6.2 实有 19；「21 code」vs contract § 3 实有 22 | WU-01 / WU-02e | **spec § 6.2 + contract § 3 修订** |
| 2 | contract 文字 `VALIDATION_ERROR` vs 枚举未列 | WU-02e | **contract § 3 加 VALIDATION_ERROR (422)** |
| 3 | spec § 4.5「emoji 暂缓」YAGNI 与 § 4.4.6 `icons.js` 矛盾 | WU-03d | **spec § 4.5 修订删除 emoji 段** |
| 4 | （保留位 — 当前未使用） | — | — |
| 5 | `validators/providers.ts` 自托管 `ApiError`（与 errors.ts 重复）| WU-02a | **GROUP-7 codemod**：删除 validators/providers.ts 内的 `ApiError` 类 + handler 改 `throw new ApiError(...)` from errors.ts |
| 6 | `http-helpers.ts` ERROR_STATUS_MAP 重复（12 codes vs errors.ts 22）| WU-02b | **GROUP-7 codemod**：删除 http-helpers.ts 内 ERROR_STATUS_MAP；handler 改用 errors.ts |

---

## 集成验证（GROUP-1+3+2 全 commit 后）

```
$ cd <worktree>
$ npm run check
> tsc --noEmit
(0 errors)

$ npm test
Test Files  37 passed (37)
     Tests  645 passed (645)
```

✅ 全绿。

---

## 进度

- [x] T0 WORKTREE-INIT
- [x] T0.5 ContextPack（api-contract.md）
- [x] T1 GROUP-1（WU-01）
- [x] T3 GROUP-3（WU-03a/b/c/d）
- [x] T2 GROUP-2（WU-02a/b/c/d/e）
- [ ] T4 GROUP-4（next — WU-04a F3 + WU-04d F18-theme.js）
- [ ] T5 GROUP-5（F7-F14，硬顶 5，分两批）
- [ ] T6 GROUP-6（B8 + F11 + F15+F16）
- [ ] T7 GROUP-7（F18 全套 + F17 + B6 + README + codemod #5 #6）
- [ ] T8 GROUP-8（集体测试 + reviewer + security-auditor + perf-auditor）

---

## Next

GROUP-4 批 1 并行（无依赖 / 弱依赖）：
- **WU-04a** F3 shared utils/api/i18n（依赖 WU-03a + WU-03c — 已完成）
- **WU-04d** F18-theme.js `/theme` 命令（依赖 WU-03a — 已完成）

批 2（等 WU-04a commit）：
- WU-04b F5 state.js（依赖 WU-04a）
- WU-04c F6 基础组件 13 个（依赖 WU-04a）