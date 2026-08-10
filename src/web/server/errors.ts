/**
 * my-agent Web 前端 — 统一错误处理层（WU-02e / B7）。
 *
 * 来源：spec § 3.4.1 / § 3.4.2 + contract § 3。
 *
 * 本文件导出：
 * - `ApiErrorCode` 枚举：与 contract § 3 严格一致（共 22 个 code，按状态码分组）
 * - `ERROR_STATUS_MAP`：每个 code → HTTP status 的固定映射
 * - `ApiError` 类：业务可抛的统一错误（status 从 map 查）
 * - `ApiErrorBody` / `ApiSuccess<T>`：JSON 序列化壳
 * - `toApiErrorBody`：任意 `unknown` → ApiErrorBody
 * - `handleError`：Express-style 包装（但本项目没用 Express，所以
 *   改成直接 `res.statusCode + res.end()`，接 index.ts 的 try/catch 入口）
 * - `zodErrorToApiError`：Zod 集成 helper —— ZodError → ApiError(INVALID_JSON, …)
 *
 * **不入 Express** 是 spec § 1.4 / § 4 的明确决策（避免大框架）。
 * 但保留 `errorMiddleware` 形态的原因是：future-proof 写法 + spec/contract
 * 命名一致。
 *
 * @see .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md § 3
 */

import type { ServerResponse } from "node:http";

import type { Logger } from "../../shared/logger.js";

// ============================================================
// 1. ApiErrorCode 枚举（与 contract § 3 严格一致；22 个 code）
// ============================================================

/**
 * 全部 HTTP API 错误码（机器可读固定枚举）。
 *
 * **本枚举是 spec § 3.4.2 的最终事实来源** —— 上游 spec 草稿列过
 * 一组别名（VALIDATION_FAILED / BAD_REQUEST / NOT_IMPLEMENTED 等），
 * 但已统一到 contract § 3 的命名（INVALID_JSON / INTERNAL / ...）。
 *
 * 分组（按 HTTP 状态码，参考 ERROR_STATUS_MAP）：
 * - 4xx 客户端：INVALID_JSON / NOT_FOUND / METHOD_NOT_ALLOWED /
 *   PAYLOAD_TOO_LARGE / RATE_LIMITED
 * - 5xx 服务端：INTERNAL / SESSION_CORRUPT_FILE / CHAT_RUNNER_ERROR /
 *   CHAT_INVALID_EVENT / AGENT_SPEC_INVALID_JSON
 * - 业务 404：PROVIDER_NOT_FOUND / MODEL_NOT_FOUND / SESSION_NOT_FOUND /
 *   AGENT_NOT_FOUND / SKILL_NOT_FOUND
 * - 业务 422 / 409 / 429：见 ERROR_STATUS_MAP
 * - 特殊 200：CHAT_ABORTED（abort 是用户行为，不算错误）
 */
export const ApiErrorCode = {
  // ── 通用（7） ──
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",

  // ── Provider 域（8） ──
  PROVIDER_NOT_FOUND: "PROVIDER_NOT_FOUND",
  PROVIDER_DUPLICATE_ID: "PROVIDER_DUPLICATE_ID",
  PROVIDER_INVALID_BASE_URL: "PROVIDER_INVALID_BASE_URL",
  PROVIDER_INVALID_TYPE: "PROVIDER_INVALID_TYPE",
  PROVIDER_API_KEY_EMPTY: "PROVIDER_API_KEY_EMPTY",
  PROVIDER_ACTIVE_NOT_DELETABLE: "PROVIDER_ACTIVE_NOT_DELETABLE",
  PROVIDER_ALREADY_EXISTS: "PROVIDER_ALREADY_EXISTS",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",

  // ── Session 域（3） ──
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_ALREADY_EXISTS: "SESSION_ALREADY_EXISTS",
  SESSION_CORRUPT_FILE: "SESSION_CORRUPT_FILE",

  // ── Chat 域（6） ──
  CHAT_SESSION_BUSY: "CHAT_SESSION_BUSY",
  CHAT_ABORTED: "CHAT_ABORTED",
  CHAT_RUNNER_ERROR: "CHAT_RUNNER_ERROR",
  CHAT_INVALID_EVENT: "CHAT_INVALID_EVENT",
  STREAM_ALREADY_RUNNING: "STREAM_ALREADY_RUNNING",
  STREAM_NOT_FOUND: "STREAM_NOT_FOUND",

  // ── Agent / Skill 域（3） ──
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_SPEC_INVALID_JSON: "AGENT_SPEC_INVALID_JSON",
  SKILL_NOT_FOUND: "SKILL_NOT_FOUND",
} as const;

/**
 * `ApiErrorCode` 字面量联合类型（导出给业务 handler 用作类型守卫）。
 *
 * 注意：用 `keyof typeof` 而非 enum —— 与项目 strict TS 配置对齐，
 * 避免 `preserveConstEnums` 之类的工具链差异。
 */
export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

// ============================================================
// 2. ERROR_STATUS_MAP（HTTP status 固定映射；contract § 3 原文照搬）
// ============================================================

/**
 * 每个 ApiErrorCode 对应的 HTTP status（固定 —— 客户端按此路由 status banner）。
 *
 * **增减 code 时必须同步本表**（TS `satisfies` 守门：任何漏映射的 code 会编译失败）。
 */
export const ERROR_STATUS_MAP = {
  // ── 4xx ──
  INVALID_JSON: 400,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,

  // ── 5xx ──
  INTERNAL: 500,
  SESSION_CORRUPT_FILE: 500,
  CHAT_RUNNER_ERROR: 500,
  CHAT_INVALID_EVENT: 500,
  AGENT_SPEC_INVALID_JSON: 500,

  // ── Provider ──
  PROVIDER_NOT_FOUND: 404,
  PROVIDER_DUPLICATE_ID: 409,
  PROVIDER_INVALID_BASE_URL: 422,
  PROVIDER_INVALID_TYPE: 422,
  PROVIDER_API_KEY_EMPTY: 422,
  PROVIDER_ACTIVE_NOT_DELETABLE: 409,
  PROVIDER_ALREADY_EXISTS: 409,
  MODEL_NOT_FOUND: 404,

  // ── Session ──
  SESSION_NOT_FOUND: 404,
  SESSION_ALREADY_EXISTS: 409,

  // ── Chat ──
  CHAT_SESSION_BUSY: 429,
  CHAT_ABORTED: 200,            // abort 是用户行为，不是服务端错误
  STREAM_ALREADY_RUNNING: 409,
  STREAM_NOT_FOUND: 404,
  // CHAT_RUNNER_ERROR / CHAT_INVALID_EVENT 见 5xx 节

  // ── Agent / Skill ──
  AGENT_NOT_FOUND: 404,
  // AGENT_SPEC_INVALID_JSON 见 5xx 节
  SKILL_NOT_FOUND: 404,
} as const satisfies Record<ApiErrorCodeValue, number>;

/**
 * 导出可读类型 `Record<ApiErrorCodeValue, number>`（与上同形；方便业务 import）。
 */
export type ErrorStatusMap = typeof ERROR_STATUS_MAP;

// ============================================================
// 3. ApiError 类
// ============================================================

/**
 * 统一 API 错误类型。
 *
 * 字段：
 * - `code: ApiErrorCodeValue` —— 机器可读（前端按 code 路由错误 banner）
 * - `status: number` —— 自动从 ERROR_STATUS_MAP 取（业务无须手填）
 * - `message: string` —— 人可读（中文优先，i18n 友好；本期硬编码）
 * - `details?: Record<string, unknown>` —— 字段级错误（Zod issues 等）
 * - `cause?: unknown` —— 原始错误（沿 Error.cause 链）
 *
 * 构造签名：`new ApiError(code, message?, details?, cause?)`。
 *
 * 为什么 `status` 自动从 map 查：spec § 3.4.1 要求 status 是**固定**的，
 * 不允许业务覆盖（防前端 status banner 与 code 错位）。
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCodeValue;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCodeValue,
    message?: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    // 默认 message = code（兜底；业务应传可读文案）
    super(message ?? code, cause !== undefined ? { cause } : undefined);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS_MAP[code];
    this.details = details;

    // 让 ApiError.prototype 的 instanceof 正常工作
    // （extends Error + compile target ES2023 必须显式 setPrototypeOf）
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /**
   * 序列化为前端消费的 ApiErrorBody（不含 requestId）。
   *
   * 注意：本函数**不会**注入 `requestId` —— requestId 由调用方
   * （`handleError` / `toApiErrorBody`）注入。
   */
  toBodyWithoutRequestId(): {
    ok: false;
    error: {
      code: ApiErrorCodeValue;
      message: string;
      details?: Record<string, unknown>;
    };
  } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

// ============================================================
// 4. JSON 序列化壳
// ============================================================

/**
 * 失败响应统一壳（spec § 3.4.1）。
 *
 * 注意：`error.code` 在客户端按 code 字符串分发；`error.message` 显示。
 */
export type ApiErrorBody = {
  ok: false;
  error: {
    code: ApiErrorCodeValue;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};

/**
 * 成功响应统一壳。
 */
export type ApiSuccess<T> = { ok: true; data: T };

/**
 * 响应壳 union（前端 fetch 包装直接消费）。
 */
export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

// ============================================================
// 5. toApiErrorBody —— 任意 unknown → ApiErrorBody
// ============================================================

/**
 * 把任意 `unknown` 序列化为 ApiErrorBody。
 *
 * 规则：
 * - `ApiError` → 直接用其 code / status / message / details
 * - `ZodError` → `INVALID_JSON` (400) + `details: { issues }`
 * - 其他 `Error` / 任意值 → `INTERNAL` (500) + `err.message` / `String(err)`
 *
 * **不写 response** —— 纯序列化。让 `handleError` 写响应。
 *
 * @param err 任意错误
 * @param requestId 服务端 request id（日志关联用）
 */
export function toApiErrorBody(err: unknown, requestId: string): ApiErrorBody {
  // ① ApiError —— 直接用其字段
  if (err instanceof ApiError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }

  // ② ZodError —— INVALID_JSON (400) + issues
  if (isZodError(err)) {
    return {
      ok: false,
      error: {
        code: ApiErrorCode.INVALID_JSON,
        message: "Invalid input",
        requestId,
        details: { issues: err.issues },
      },
    };
  }

  // ③ 普通 Error —— INTERNAL (500)
  if (err instanceof Error) {
    return {
      ok: false,
      error: {
        code: ApiErrorCode.INTERNAL,
        message: err.message || "Internal Server Error",
        requestId,
      },
    };
  }

  // ④ 其它（非 Error 对象 / string / null 等）—— INTERNAL (500)
  return {
    ok: false,
    error: {
      code: ApiErrorCode.INTERNAL,
      message: typeof err === "string" ? err : "Internal Server Error",
      requestId,
    },
  };
}

// ============================================================
// 6. handleError —— 写响应
// ============================================================

/**
 * handleError 调用上下文。
 */
export type HandleErrorContext = {
  /** request id（已写入响应头 X-Request-Id） */
  requestId: string;
  /** Logger；缺省时静默（与 index.ts 兜底 SILENT_LOGGER 一致） */
  logger?: Logger;
};

/**
 * Express-style 错误中间件的「裸版」—— 不引 Express，直接写 `res`。
 *
 * 行为：
 * 1) `err` → `toApiErrorBody` 序列化
 * 2) `res.statusCode` ← `body.error.code` 对应的 status（ApiError 透传 / Zod 400 / INTERNAL 500）
 * 3) 写 `Content-Type: application/json; charset=utf-8`
 * 4) `logger.warn(err)`（INFO 级别已知错误 / ERROR 未知错误，均为 warn 兜底）
 * 5) `res.end(JSON.stringify(body))`
 *
 * 如果响应**已经发送**（headersSent / writableEnded），调用方应 `res.destroy()` 兜底
 * —— 本函数不重复处理这种情况，由调用方决策。
 *
 * @param err 任意错误
 * @param res Node ServerResponse
 * @param ctx requestId + logger
 *
 * @example
 *   try {
 *     await handler(req, res, params);
 *   } catch (err) {
 *     if (res.headersSent || res.writableEnded) {
 *       res.destroy();
 *       return;
 *     }
 *     handleError(err, res, { requestId, logger });
 *   }
 */
export function handleError(
  err: unknown,
  res: ServerResponse,
  ctx: HandleErrorContext,
): void {
  const body = toApiErrorBody(err, ctx.requestId);

  // 状态码：ApiError 自带 status；其它由 code 反查 map（INVALID_JSON 400 / INTERNAL 500 等）
  const status = err instanceof ApiError
    ? err.status
    : ERROR_STATUS_MAP[body.error.code];

  // logger 注入时记录 warn —— 业务错误可重试，但服务端仍要可观测
  if (ctx.logger) {
    ctx.logger.warn(
      `⚠️ ${status} ${body.error.code}: ${body.error.message}`,
    );
  }

  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Express-style 错误中间件包装（保留接口形态但不被实际使用）。
 *
 * 业务代码**不**应调用本函数（项目不用 Express）；仅在 future-proof
 * 写法或单测中可能用到。实际错误处理走 `handleError(err, res, ctx)`。
 *
 * @deprecated 项目不用 Express；调用 `handleError` 直接写 res。
 */
export function errorMiddleware<P extends Record<string, string>>(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    params: P,
  ) => Promise<void> | void,
  ctxFactory?: (
    req: import("node:http").IncomingMessage,
  ) => HandleErrorContext,
): (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  params: P,
) => Promise<void> {
  return async (req, res, params) => {
    const ctx = ctxFactory
      ? ctxFactory(req)
      : { requestId: getOrGenerateRequestId(req) };
    try {
      await handler(req, res, params);
    } catch (err) {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      handleError(err, res, ctx);
    }
  };
}

// ============================================================
// 7. Zod 集成 helper
// ============================================================

/**
 * Zod 错误的极简类型守卫（避免 `import { ZodError } from "zod"` 顶层依赖）。
 *
 * 判定规则：`obj.issues` 是 array 且每个元素含 `code` / `path` / `message`。
 */
function isZodError(err: unknown): err is { issues: ReadonlyArray<{ code: string; path: ReadonlyArray<unknown>; message: string }> } {
  return (
    typeof err === "object" &&
    err !== null &&
    "issues" in err &&
    Array.isArray((err as { issues: unknown }).issues)
  );
}

/**
 * Zod 错误 → ApiError 适配器。
 *
 * 用法（handler 边界）：
 * ```ts
 * const parsed = schema.safeParse(body);
 * if (!parsed.success) {
 *   throw zodErrorToApiError(parsed.error);
 * }
 * ```
 *
 * 映射到 `INVALID_JSON` (400) + `details: { issues: parsed.error.issues }`。
 * 注：contract route table 同时提及 VALIDATION_ERROR 用于「schema 不匹配」，
 * 但该 code 未纳入主枚举（contract 笔误）。本期统一回 INVALID_JSON，
 * 等 contract 修订后切换映射（一行改动）。
 */
export function zodErrorToApiError(err: unknown): ApiError {
  // 兜底：非 ZodError 走 INTERNAL
  if (!isZodError(err)) {
    return new ApiError(
      ApiErrorCode.INTERNAL,
      "Internal Server Error",
      undefined,
      err,
    );
  }
  return new ApiError(
    ApiErrorCode.INVALID_JSON,
    "Invalid input",
    { issues: err.issues },
    err,
  );
}

// ============================================================
// 8. 工具
// ============================================================

/**
 * 从 request header 提取已有的 X-Request-Id；缺省时生成新 UUID。
 *
 * 注：本函数保留给 future-proof（如需）。index.ts 当前已经独立生成
 * requestId 并写 header；handleError ctx 由调用方注入。
 */
function getOrGenerateRequestId(
  _req: import("node:http").IncomingMessage,
): string {
  // 故意保留未使用参数（避免 signuture 不稳定的 eslint 噪声）
  // 实际调用方负责注入 ctx.requestId
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
}
