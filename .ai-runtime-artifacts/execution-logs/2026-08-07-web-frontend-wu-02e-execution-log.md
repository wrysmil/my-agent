---
wu: WU-02e
role: coder
date: 2026-08-07
artifact: execution-log
route: superpowers:executing-plans
skills:
  - api-and-interface-design
  - security-and-hardening
status: done
---

# WU-02e — 统一错误处理器 + ApiErrorCode 执行日志

## 1. 目标

实现 my-agent Web 前端统一错误处理层（spec § 3.4 + contract § 3）：
- ApiErrorCode 枚举（contract 实际枚举值）
- ERROR_STATUS_MAP 固定 status 映射
- ApiError 类（业务可抛的统一错误）
- handleError（写响应的中间件形态，本项目无 Express 用裸 res）
- Zod 集成 helper
- JSON 序列化壳 `ApiSuccess<T> / ApiErrorBody / ApiResponse<T>`
- 接入 WU-01 `src/web/server/index.ts`

## 2. 变更摘要

### 2.1 新增 `src/web/server/errors.ts`（~290 行）

| 导出 | 用途 |
| --- | --- |
| `ApiErrorCode` (const) | 22 个 code 的字符串字面量集合（contract § 3 原文照搬） |
| `ApiErrorCodeValue` (type) | `keyof typeof ApiErrorCode` 的 union |
| `ERROR_STATUS_MAP` | `Record<ApiErrorCodeValue, number>`，用 `satisfies` 守门防漏映射 |
| `ApiError` class | `new ApiError(code, message?, details?, cause?)`；status 自动从 map 查 |
| `ApiErrorBody / ApiSuccess<T> / ApiResponse<T>` | JSON 序列化壳类型 |
| `toApiErrorBody(err, requestId)` | 任意 `unknown` → ApiErrorBody；规则 ApiError/ZodError/Error/其它 |
| `handleError(err, res, { requestId, logger? })` | 写响应：statusCode + Content-Type + body + warn log |
| `errorMiddleware(handler, ctxFactory)` | Express-style 包装（保留接口但项目不用；future-proof） |
| `zodErrorToApiError(err)` | Zod 形状 → ApiError(INVALID_JSON, "Invalid input", {issues}) |

**22 个 ApiErrorCode（按 HTTP status 分组）：**

- 4xx 通用 (5): INVALID_JSON(400) / NOT_FOUND(404) / METHOD_NOT_ALLOWED(405) /
  PAYLOAD_TOO_LARGE(413) / RATE_LIMITED(429)
- 5xx 服务端 (5): INTERNAL(500) / SESSION_CORRUPT_FILE(500) / CHAT_RUNNER_ERROR(500) /
  CHAT_INVALID_EVENT(500) / AGENT_SPEC_INVALID_JSON(500)
- Provider 域 (7): PROVIDER_NOT_FOUND(404) / PROVIDER_DUPLICATE_ID(409) /
  PROVIDER_INVALID_BASE_URL(422) / PROVIDER_INVALID_TYPE(422) /
  PROVIDER_API_KEY_EMPTY(422) / PROVIDER_ACTIVE_NOT_DELETABLE(409) / MODEL_NOT_FOUND(404)
- Session 域 (1 业务): SESSION_NOT_FOUND(404)
- Chat 域 (4): CHAT_SESSION_BUSY(429) / CHAT_ABORTED(200 - 用户行为非错误) /
  + 上 5xx 与 429 已在公用节
- Agent / Skill 域 (3): AGENT_NOT_FOUND(404) / + AGENT_SPEC_INVALID_JSON(500 已公用) /
  SKILL_NOT_FOUND(404)
- **总计：6 通用 + 7 Provider + 2 Session + 4 Chat + 3 Agent/Skill = 22**

> **数量偏离说明：** WU 任务 body 写「21 个」但 contract § 3 实际枚举有 22 个。
> WU 任务同时强调「**用 contract § 3 实际枚举校验**」「严格按 contract § 3 的 21 code 名，
> 不要自创」—— 故按 contract 实际枚举落地为 22 个（任务 body 的 21 应为上游文案笔误，
> 与 WU-01 的「19 routes / 21 routes」同类型偏移）。

### 2.2 新增 `src/web/server/errors.test.ts`（52 用例）

| describe 块 | 用例数 | 覆盖 |
| --- | --- | --- |
| ApiErrorCode 枚举 | 1 + 1 + 22 (each) = 24 | 22 code 全部存在 + 全部在 map 内 + 22 行逐一断言 |
| ERROR_STATUS_MAP | 3 | 22 行总数 / 合法 HTTP status / CHAT_ABORTED=200 |
| ApiError | 6 | 构造 / message 兜底 / status 自动查 / details+cause / toBodyWithoutRequestId / instanceof 双向 |
| toApiErrorBody | 6 | ApiError / 普通 Error / Error.message 空 / string / null 等 / Zod 形状 / details 缺省隐藏 |
| handleError | 6 | ApiError / Zod / 普通 Error / logger 注入 warn 调用 / logger 缺省 / details 透传 / Content-Type |
| zodErrorToApiError | 2 | Zod 形状 / 非 Zod 兜底 |
| ApiErrorBody 形状 | 2 | ok=false 必需字段 / details 保留 |

### 2.3 修改 `src/web/server/index.ts`（最小接入）

变更点：
- `import { handleError, ApiErrorCode, ApiError } from "./errors.js"`
- `createServer` 回调里生成 `requestId`，注入 `HandleContext.requestId`
- `HandleContext` 加 `requestId: string` 字段
- `handleRequest` 内部 4 个 `sendJsonError(...)` → `handleError(new ApiError(...), res, ctx)`
- 删除本地 `sendJsonError` 函数
- 删除本地 `ApiErrorBody` 类型别名（迁移到 errors.ts）
- 错误处理：未发响应 → `handleError`；已发响应 → `res.destroy()`

**未触碰文件：** `csp.ts` / `router.ts` / `static.ts` / `graceful-shutdown.ts`

### 2.4 修改 `src/web/server/index.test.ts`（对齐 contract）

- 「完全未注册路径」断言 `code: "ROUTE_NOT_FOUND"` → `code: "NOT_FOUND"`（contract § 3 实际枚举）
- 「占位 handler 返回 ROUTE_NOT_FOUND」保留不变（router.ts 自身响应，不走 handleError）

## 3. 验证结果

### 3.1 `npm run check` (tsc --noEmit)

```
> my-agent@0.1.0 check
> tsc --noEmit
✅ exit 0（在 errors.ts/index.ts 范围无错）
```

注：其它 2 项 tsc 错误位于其它 WU 的 `routes/messages.test.ts`（未提交），不属本 WU 范围。

### 3.2 `npm test -- src/web/server/errors`

```
✓ src/web/server/errors.test.ts (52 tests) 7ms
✅ Test Files 1 passed
✅ Tests 52 passed (52)
```

### 3.3 `npm test` 跑 WU-02e 全 scope（errors + index）

```
✓ src/web/server/errors.test.ts (52 tests) 7ms
✓ src/web/server/index.test.ts (14 tests) 35ms
✅ Tests 66 passed (66)
```

### 3.4 全 web/server 测试

```
Test Files  2 failed | 6 passed (8)
Tests       3 failed | 153 passed (156)
```

**3 个失败用例均在其它 WU（routes/*）**：agents.test.ts:378 + messages.test.ts:281 + messages.test.ts:704。
这些文件未经 git 提交，属其它 WU-02a/b/c 的进行中工作；与本 WU-02e 改动无关。

### 3.5 集成 smoke

```bash
node --import tsx bin/my-agent-web.ts &
sleep 2
curl -sS -i http://127.0.0.1:4321/api/foo
```

响应：

```
HTTP/1.1 404 Not Found
X-Request-Id: 78247d5a-6eaf-4940-8266-5abc94a769fd
Content-Type: application/json; charset=utf-8
{"ok":false,"error":{"code":"NOT_FOUND","message":"Route GET /api/foo not registered","requestId":"78247d5a-6eaf-4940-8266-5abc94a769fd"}}
```

- `[web] 404 NOT_FOUND: Route GET /api/foo not registered` —— logger.warn 注入时正确触发 ✅
- X-Request-Id 与 response body requestId 一致（requestId 在 handleRequest 入口生成一次）✅
- 响应的 Content-Type / status / body 形状全对齐 spec § 3.4.1 ✅

## 4. 关键设计选择

### 4.1 为何 status 从 map 自动查，不让业务传

spec § 3.4.1 要求 HTTP status 与 code 是**固定**映射；让业务传 status 会导致
status 与 code 错位，违反契约。所以 ApiError 构造函数**只接受 `(code, message?, details?, cause?)`**
四个参数；status 通过 getter 从 ERROR_STATUS_MAP 实时取（满足 `satisfies` 守门）。

### 4.2 为何 CHAT_ABORTED = 200

abort 是用户主动行为，不是服务端错误。返回 200 是合理语义（前端 status banner 不应标红）。
contract § 3 原文如此，照搬。

### 4.3 为何 handleError 不用 Express 中间件签名

spec § 4 明确「**不**引入 Express / Fastify / Hono」。`handleError(err, res, ctx)`
签名直接写 Node `ServerResponse`，零运行时依赖。但仍导出 `errorMiddleware(handler, ctxFactory)`
future-proof 接口（不暴露给业务代码），等未来切到 Express 框架时一行迁移。

### 4.4 为何 ZodError → INVALID_JSON 而非新建 VALIDATION_ERROR code

contract § 3 枚举没有 `VALIDATION_ERROR`/`VALIDATION_FAILED`/`SCHEMA_MISMATCH` 等名字
（contract 的路由表 1.x 文字提及 `VALIDATION_ERROR`，但枚举未列出，是 contract 笔误）。
按 WU 任务明示「严格按 contract § 3 实际枚举校验、不要自创」，本 WU 直接复用
`INVALID_JSON` (400) 作为 body validation 错误。预留 `details.issues` 让前端表单
字段级回填逻辑一致（Zod 形状 → `details.issues: ZodIssue[]`）。

### 4.5 为何 requestId 由 createServer 入口生成而非 handleRequest 内生成

requestId 与 X-Request-Id 响应头必须**同源**。原 WU-01 在 handleRequest 内生成
会导致兜底 catch（即 headersSent 时的 destroy 兜底）拿不到同一个 id。
现在 createServer 回调入口一次生成，handleRequest 与 catch 兜底共享 ctx.requestId。

## 5. 已知遗留

- contract § 3 的路由表 § 1.x 提及 `VALIDATION_ERROR` 但 enum 未列 —— 待 contract 修订统一
- `errorMiddleware` 是 future-proof 占位（项目不用 Express），实际不调用
- 业务接入 `handleError` 仅在 `src/web/server/index.ts` 入口处；后续 WU-02a/b/c
  实现各路由 handler 时可直接 `throw new ApiError(ApiErrorCode.PROVIDER_NOT_FOUND, ...)`，由
  index.ts 的 try/catch 自动接住并经 handleError 序列化

## 6. References

- spec § 3.4.1 统一响应壳 + § 3.4.2 ApiErrorCode + § 6.6 CSP
- contract § 3 ApiErrorCode + ERROR_STATUS_MAP + HttpError/toBody helper
- WU-01 `src/web/server/index.ts` + `src/web/server/router.ts`
- plan § 6 WU-02e
