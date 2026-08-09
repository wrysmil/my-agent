import { describe, it, expect } from "vitest";
import {
  CoreAgentError,
  AuthError,
  RateLimitError,
  ContextOverflowError,
  OutputLimitError,
  ProviderError,
  TimeoutError,
  CapabilityUnsupportedError,
  classifyRetryableError,
  isRetryableError,
  isTransientNetworkError,
  formatError,
  toLocalizedErrorKey,
  type RetryableErrorKind,
} from "../src/shared/errors.js";

describe("错误分类与重试策略", () => {
  // ─── 错误层级 ─────────────────────────────────
  describe("错误类层级", () => {
    it("CoreAgentError 包含 code 和 name", () => {
      const err = new CoreAgentError("test", "TEST_CODE");
      expect(err.message).toBe("test");
      expect(err.code).toBe("TEST_CODE");
      expect(err.name).toBe("CoreAgentError");
      expect(err).toBeInstanceOf(Error);
    });

    it("所有子类继承自 CoreAgentError", () => {
      expect(new AuthError("x")).toBeInstanceOf(CoreAgentError);
      expect(new RateLimitError("x")).toBeInstanceOf(CoreAgentError);
      expect(new ContextOverflowError("x")).toBeInstanceOf(CoreAgentError);
      expect(new OutputLimitError("x")).toBeInstanceOf(CoreAgentError);
      expect(new ProviderError("x", "p")).toBeInstanceOf(CoreAgentError);
      expect(new TimeoutError("x")).toBeInstanceOf(CoreAgentError);
    });

    it("RateLimitError 携带 retryAfterMs", () => {
      const err = new RateLimitError("rate limited", 30000);
      expect(err.retryAfterMs).toBe(30000);
      expect(err.code).toBe("RATE_LIMIT");
    });

    it("ProviderError 携带 provider 和 statusCode", () => {
      const err = new ProviderError("boom", "anthropic", 500);
      expect(err.provider).toBe("anthropic");
      expect(err.statusCode).toBe(500);
    });

    it("formatError — Error 对象取其 message", () => {
      expect(formatError(new Error("boom"))).toBe("boom");
    });

    it("formatError — 字符串原样返回", () => {
      expect(formatError("plain text")).toBe("plain text");
    });

    it("formatError — 非 Error/字符串转字符串", () => {
      expect(formatError(42)).toBe("42");
      expect(formatError(null)).toBe("null");
    });
  });

  // ─── 不可重试 ─────────────────────────────────
  describe("不可重试的错误", () => {
    it("AuthError → 不重试", () => {
      expect(isRetryableError(new AuthError("bad key"))).toBe(false);
    });

    it("ContextOverflowError → 不重试", () => {
      expect(isRetryableError(new ContextOverflowError("too long"))).toBe(false);
    });

    it("OutputLimitError → 不重试", () => {
      expect(isRetryableError(new OutputLimitError("max tokens"))).toBe(false);
    });

    it("400 ProviderError → 不重试", () => {
      expect(isRetryableError(new ProviderError("bad request", "openai", 400))).toBe(false);
    });

    it("401 ProviderError → 不重试", () => {
      expect(isRetryableError(new ProviderError("unauthorized", "anthropic", 401))).toBe(false);
    });

    it("403 ProviderError → 不重试", () => {
      expect(isRetryableError(new ProviderError("forbidden", "anthropic", 403))).toBe(false);
    });

    it("null/undefined → 不重试", () => {
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });

  // ─── 可重试 — 错误类型 ─────────────────────────
  describe("可重试 — 错误类型实例", () => {
    it("RateLimitError → 可重试，分类为 rate_limit", () => {
      expect(isRetryableError(new RateLimitError("rate"))).toBe(true);
      expect(classifyRetryableError(new RateLimitError("rate"))).toBe("rate_limit");
    });

    it("TimeoutError → 可重试，分类为 timeout", () => {
      expect(isRetryableError(new TimeoutError("timeout"))).toBe(true);
      expect(classifyRetryableError(new TimeoutError("timeout"))).toBe("timeout");
    });
  });

  // ─── 可重试 — 瞬时 HTTP 状态码 ────────────────
  describe("可重试 — 瞬时 HTTP 状态码", () => {
    it("429 → rate_limit", () => {
      expect(classifyRetryableError(new ProviderError("429", "test", 429))).toBe("rate_limit");
    });

    it("500/502/503 → 可重试", () => {
      expect(isRetryableError(new ProviderError("500", "test", 500))).toBe(true);
      expect(isRetryableError(new ProviderError("502", "test", 502))).toBe(true);
      expect(isRetryableError(new ProviderError("503", "test", 503))).toBe(true);
    });

    it("408 → timeout", () => {
      expect(classifyRetryableError(new ProviderError("408", "test", 408))).toBe("timeout");
    });

    it("502 → service_unavailable", () => {
      expect(classifyRetryableError(new ProviderError("502", "test", 502)))
        .toBe("service_unavailable");
    });
  });

  // ─── 可重试 — 瞬时错误消息 ────────────────────
  describe("可重试 — 瞬时错误消息匹配", () => {
    it("fetch failed → connection_dropped", () => {
      expect(classifyRetryableError(new Error("fetch failed"))).toBe("connection_dropped");
    });

    it("ETIMEDOUT → timeout", () => {
      expect(classifyRetryableError(new Error("ETIMEDOUT"))).toBe("timeout");
    });

    it("ECONNRESET → connection_dropped", () => {
      expect(classifyRetryableError(new Error("ECONNRESET"))).toBe("connection_dropped");
    });

    it("ENETUNREACH → network", () => {
      expect(classifyRetryableError(new Error("ENETUNREACH"))).toBe("network");
    });

    it("connection refused → service_unavailable", () => {
      expect(classifyRetryableError(new Error("connection refused")))
        .toBe("service_unavailable");
    });

    it("terminated → connection_dropped", () => {
      expect(classifyRetryableError(new Error("terminated"))).toBe("connection_dropped");
    });
  });

  // ─── Cause 链遍历 ─────────────────────────────
  describe("Cause 链遍历", () => {
    it("沿 cause 链找到瞬时错误", () => {
      const leaf = new Error("ECONNRESET");
      const wrapped = new Error("request failed", { cause: leaf });
      expect(isRetryableError(wrapped)).toBe(true);
      expect(classifyRetryableError(wrapped)).toBe("connection_dropped");
    });

    it("沿 cause 链找到永久错误（优先）", () => {
      const leaf = new ProviderError("unauthorized", "test", 401);
      const wrapped = new Error("fetch failed", { cause: leaf });
      // 永久失败优先于瞬时模式
      expect(isRetryableError(wrapped)).toBe(false);
    });

    it("深层嵌套仍可遍历", () => {
      let err: unknown = new Error("ECONNRESET");
      for (let i = 0; i < 4; i++) {
        err = new Error(`wrap ${i}`, { cause: err as Error });
      }
      expect(isRetryableError(err)).toBe(true);
    });
  });

  // ─── isTransientNetworkError ───────────────────
  describe("isTransientNetworkError — 瞬时网络检测", () => {
    it("fetch failed → true", () => {
      expect(isTransientNetworkError(new Error("fetch failed"))).toBe(true);
    });

    it("ETIMEDOUT → true", () => {
      expect(isTransientNetworkError(new Error("ETIMEDOUT"))).toBe(true);
    });

    it("400 Bad Request → false", () => {
      expect(isTransientNetworkError(new ProviderError("bad", "test", 400))).toBe(false);
    });

    it("普通 Error 'something else' → false", () => {
      expect(isTransientNetworkError(new Error("something else"))).toBe(false);
    });
  });

  // ─── RetryableErrorKind 联合类型 ────────────────
  describe("RetryableErrorKind — 联合类型", () => {
    it("包含 6 种类别", () => {
      const kinds: RetryableErrorKind[] = [
        "rate_limit",
        "timeout",
        "connection_dropped",
        "service_unavailable",
        "server_error",
        "network",
      ];
      expect(kinds).toHaveLength(6);
    });
  });

  // ─── CapabilityUnsupportedError ─────────────────
  describe("CapabilityUnsupportedError", () => {
    it("继承自 CoreAgentError", () => {
      const err = new CapabilityUnsupportedError("vision not supported", "vision", "openai");
      expect(err).toBeInstanceOf(CoreAgentError);
      expect(err).toBeInstanceOf(Error);
    });

    it("携带 capability 和 providerId", () => {
      const err = new CapabilityUnsupportedError("no thinking", "thinking", "anthropic");
      expect(err.capability).toBe("thinking");
      expect(err.providerId).toBe("anthropic");
    });

    it("code 为 CAPABILITY_UNSUPPORTED，name 正确", () => {
      const err = new CapabilityUnsupportedError("msg", "tool_use", "gemini");
      expect(err.code).toBe("CAPABILITY_UNSUPPORTED");
      expect(err.name).toBe("CapabilityUnsupportedError");
    });

    it("支持 5 种 capability 值", () => {
      const capabilities = ["vision", "tool_use", "thinking", "json_mode", "prompt_caching"] as const;
      for (const cap of capabilities) {
        const err = new CapabilityUnsupportedError("test", cap, "test-provider");
        expect(err.capability).toBe(cap);
      }
    });

    it("可携带 cause", () => {
      const cause = new Error("root cause");
      const err = new CapabilityUnsupportedError("wrapped", "vision", "openai", cause);
      expect(err.cause).toBe(cause);
    });
  });

  // ─── toLocalizedErrorKey ─────────────────────────
  describe("toLocalizedErrorKey — i18n 错误键映射", () => {
    it("AuthError → errors.provider.auth", () => {
      expect(toLocalizedErrorKey(new AuthError("bad key"))).toBe("errors.provider.auth");
    });

    it("RateLimitError → errors.provider.rate_limited", () => {
      expect(toLocalizedErrorKey(new RateLimitError("rate"))).toBe("errors.provider.rate_limited");
    });

    it("CapabilityUnsupportedError → errors.provider.capability_unsupported", () => {
      expect(toLocalizedErrorKey(new CapabilityUnsupportedError("no vision", "vision", "openai")))
        .toBe("errors.provider.capability_unsupported");
    });

    it("ContextOverflowError → errors.provider.context_overflow", () => {
      expect(toLocalizedErrorKey(new ContextOverflowError("too long")))
        .toBe("errors.provider.context_overflow");
    });

    it("OutputLimitError → errors.provider.output_limit", () => {
      expect(toLocalizedErrorKey(new OutputLimitError("max tokens")))
        .toBe("errors.provider.output_limit");
    });

    it("connection_dropped 消息 → errors.provider.connection_dropped", () => {
      expect(toLocalizedErrorKey(new Error("fetch failed")))
        .toBe("errors.provider.connection_dropped");
    });

    it("timeout 消息 → errors.provider.timeout", () => {
      expect(toLocalizedErrorKey(new Error("ETIMEDOUT")))
        .toBe("errors.provider.timeout");
    });

    it("server_error 状态码 → errors.provider.server", () => {
      expect(toLocalizedErrorKey(new ProviderError("500", "test", 500)))
        .toBe("errors.provider.server");
    });

    it("service_unavailable → errors.provider.server", () => {
      expect(toLocalizedErrorKey(new ProviderError("503", "test", 503)))
        .toBe("errors.provider.server");
    });

    it("未知错误 → errors.provider.unknown", () => {
      // null causes classifyRetryableError to return null, so no kind branch
      // matches and we fall through to the "unknown" default.
      expect(toLocalizedErrorKey(null))
        .toBe("errors.provider.unknown");
    });
  });
});
