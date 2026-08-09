// ============================================================
// 错误层级
// ============================================================

export class CoreAgentError extends Error {
  public readonly code: string;
  constructor(message: string, code: string, cause?: Error) {
    super(message, { cause });
    this.name = "CoreAgentError";
    this.code = code;
  }
}

export class AuthError extends CoreAgentError {
  constructor(message: string, cause?: Error) {
    super(message, "AUTH_ERROR", cause);
    this.name = "AuthError";
  }
}

export class RateLimitError extends CoreAgentError {
  public readonly retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number, cause?: Error) {
    super(message, "RATE_LIMIT", cause);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ContextOverflowError extends CoreAgentError {
  constructor(message: string, cause?: Error) {
    super(message, "CONTEXT_OVERFLOW", cause);
    this.name = "ContextOverflowError";
  }
}

export class OutputLimitError extends CoreAgentError {
  constructor(message: string, cause?: Error) {
    super(message, "OUTPUT_LIMIT", cause);
    this.name = "OutputLimitError";
  }
}

export class ProviderError extends CoreAgentError {
  public readonly provider: string;
  public readonly statusCode?: number;
  constructor(message: string, provider: string, statusCode?: number, cause?: Error) {
    super(message, "PROVIDER_ERROR", cause);
    this.name = "ProviderError";
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export class TimeoutError extends CoreAgentError {
  constructor(message: string, cause?: Error) {
    super(message, "TIMEOUT", cause);
    this.name = "TimeoutError";
  }
}

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ============================================================
// 可重试错误类别
// ============================================================
export type RetryableErrorKind =
  | "rate_limit"
  | "timeout"
  | "connection_dropped"
  | "service_unavailable"
  | "server_error"
  | "network";

// ============================================================
// 瞬时 HTTP 状态码
// ============================================================
const TRANSIENT_STATUS = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
  520, 521, 522, 523, 524, 529, 598, 599,
]);

// ============================================================
// 瞬时错误消息正则（按类别）
// ============================================================
const TRANSIENT_MESSAGE_PATTERNS: Array<[RetryableErrorKind, RegExp]> = [
  ["service_unavailable", /\b(502|503|504|520|521|522|523|524|529|598|599)\b|bad gateway|service unavailable|overloaded|connection.?refused/i],
  ["timeout", /\btimed out\b|\btimeout\b|etimedout/i],
  ["connection_dropped", /\bterminated\b|\bfetch failed\b|socket (hang up|closed|close)|connection (closed|close|reset|dropped)|premature close|econnreset|epipe/i],
  ["network", /network.?(error|failure)|enetunreach|enetdown|eai_again|econnrefused/i],
  ["rate_limit", /rate.?limit|too many requests|\b429\b/i],
  ["server_error", /\b500\b|internal server error/i],
];

// ============================================================
// 永久失败信号
// ============================================================
const PERMANENT_STATUS = new Set([
  400, 401, 402, 403, 404, 405, 406, 410, 411, 413, 414, 415, 422,
]);

const PERMANENT_MESSAGE_RE = new RegExp(
  [
    /\b(400|401|402|403|404|405|406|410|411|413|414|415|422)\b/.source,
    /invalid[_\s-]?api[_\s-]?key|unauthorized/.source,
    /\bforbidden\b|permission[_\s-]?denied/.source,
    /context[_\s-]?(length|overflow|too[_\s-]?long)/.source,
    /unsupported[_\s-]?model|model[_\s-]?not[_\s-]?found/.source,
  ].join("|"),
  "i",
);

// ============================================================
// 辅助函数
// ============================================================
function errorMessageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "";
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
  }
  return "";
}

function errorStatusOf(err: unknown): number | undefined {
  if (err instanceof ProviderError) return err.statusCode;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    const raw = rec.statusCode ?? rec.status;
    const s = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(s) ? s : undefined;
  }
  return undefined;
}

function errorCauseOf(err: unknown): unknown {
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if ("cause" in rec) return rec.cause;
  }
  return null;
}

// ============================================================
// 核心分类逻辑
// ============================================================

/** 沿 cause 链检查是否存在永久失败信号。 */
function hasPermanentSignal(err: unknown): boolean {
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 8) {
    const status = errorStatusOf(cur);
    if (status && PERMANENT_STATUS.has(status)) return true;
    const msg = errorMessageOf(cur);
    if (msg && PERMANENT_MESSAGE_RE.test(msg)) return true;
    cur = errorCauseOf(cur);
    depth++;
  }
  return false;
}

/** 沿 cause 链匹配瞬时网络错误模式。 */
function classifyTransient(err: unknown): RetryableErrorKind | null {
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 8) {
    const msg = errorMessageOf(cur);
    if (msg) {
      for (const [kind, pattern] of TRANSIENT_MESSAGE_PATTERNS) {
        if (pattern.test(msg)) return kind;
      }
    }
    cur = errorCauseOf(cur);
    depth++;
  }
  return null;
}

/** 通过 HTTP 状态码判断重试类别。 */
function retryKindForStatus(err: unknown): RetryableErrorKind | null {
  const status = errorStatusOf(err);
  if (!status || !TRANSIENT_STATUS.has(status)) return null;
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 524 || status === 598 || status === 599) return "timeout";
  if ([502, 503, 504, 520, 521, 522, 523, 529].includes(status)) return "service_unavailable";
  return "server_error";
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 判断错误是否可重试，返回重试类别或 null。
 *
 * 决策优先级：
 * 1. Auth/Context/Output → 永远不重试
 * 2. 永久失败信号（4xx 状态码、auth 消息） → 不重试
 * 3. 瞬时网络模式匹配 → 可重试
 * 4. 瞬时 HTTP 状态码链 → 可重试
 * 5. RateLimit/Timeout 实例 → 可重试
 * 6. 未知错误 → 默认重试（宁可多试也不错失进度）
 */
export function classifyRetryableError(err: unknown): RetryableErrorKind | null {
  if (err == null) return null;

  if (
    err instanceof AuthError ||
    err instanceof CapabilityUnsupportedError ||
    err instanceof ContextOverflowError ||
    err instanceof OutputLimitError
  ) return null;

  if (hasPermanentSignal(err)) return null;

  const transient = classifyTransient(err);
  if (transient) return transient;

  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 8) {
    const kind = retryKindForStatus(cur);
    if (kind) return kind;
    cur = errorCauseOf(cur);
    depth++;
  }

  if (err instanceof RateLimitError) return "rate_limit";
  if (err instanceof TimeoutError) return "timeout";

  return "network";
}

export function isRetryableError(err: unknown): boolean {
  return classifyRetryableError(err) !== null;
}

export function isTransientNetworkError(err: unknown): boolean {
  return classifyTransient(err) !== null;
}

// ============================================================
// 能力不支持错误
// ============================================================

export class CapabilityUnsupportedError extends CoreAgentError {
  public readonly capability: "vision" | "tool_use" | "thinking" | "json_mode" | "prompt_caching";
  public readonly providerId: string;

  constructor(
    message: string,
    capability: CapabilityUnsupportedError["capability"],
    providerId: string,
    cause?: Error,
  ) {
    super(message, "CAPABILITY_UNSUPPORTED", cause);
    this.name = "CapabilityUnsupportedError";
    this.capability = capability;
    this.providerId = providerId;
  }
}

// ============================================================
// i18n 错误键映射
// ============================================================

export function toLocalizedErrorKey(err: unknown): string {
  // Instance checks first — some error types (e.g. CapabilityUnsupportedError)
  // are not filtered by classifyRetryableError and would be misclassified as
  // "network" if we checked kind first.
  if (err instanceof AuthError) return "errors.provider.auth";
  if (err instanceof CapabilityUnsupportedError) return "errors.provider.capability_unsupported";
  if (err instanceof ContextOverflowError) return "errors.provider.context_overflow";
  if (err instanceof OutputLimitError) return "errors.provider.output_limit";

  const kind = classifyRetryableError(err);
  if (kind === "rate_limit") return "errors.provider.rate_limited";
  if (kind === "timeout") return "errors.provider.timeout";
  if (kind === "connection_dropped") return "errors.provider.connection_dropped";
  if (kind === "service_unavailable" || kind === "server_error") return "errors.provider.server";
  if (kind === "network") return "errors.provider.network";
  return "errors.provider.unknown";
}
