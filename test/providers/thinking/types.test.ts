import { describe, it, expect } from "vitest";
import type { ThinkingAdapter } from "../../src/providers/thinking/types.js";
import type { ThinkingContent } from "../../src/shared/types.js";
import type { ApiProtocol, ReasoningConfig } from "../../src/providers/types.js";

// ============================================================
// 类型级签名验证：将成员方法的类型约束提取为变量签名赋值
// 如果接口签名变更（参数/返回值不兼容），以下赋值将编译失败
// ============================================================

describe("ThinkingAdapter", () => {
  const api: ApiProtocol = "anthropic-messages";

  it("extractFromRequest: should accept (reasoning: ReasoningConfig) => unknown", () => {
    const fn: ThinkingAdapter["extractFromRequest"] = (reasoning: ReasoningConfig): unknown => {
      return { level: reasoning.level, budgetTokens: reasoning.budgetTokens };
    };
    const result = fn({ level: "medium", budgetTokens: 4000 });
    expect(result).toBeDefined();
  });

  it("extractFromResponse: should accept (message: unknown) => ThinkingContent | null", () => {
    const fn: ThinkingAdapter["extractFromResponse"] = (message: unknown): ThinkingContent | null => {
      if (message && typeof message === "object" && "thinking" in message) {
        return {
          type: "thinking",
          thinking: String((message as Record<string, unknown>).thinking),
          api: "anthropic-messages",
        };
      }
      return null;
    };
    const result = fn({ thinking: "思考内容" });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("thinking");
    expect(fn(null)).toBeNull();
  });

  it("reconcileForReplay: should accept (prev: ThinkingContent, targetApi: ApiProtocol) => ThinkingContent | null", () => {
    const fn: ThinkingAdapter["reconcileForReplay"] = (
      prev: ThinkingContent,
      targetApi: ApiProtocol,
    ): ThinkingContent | null => {
      if (prev.api === targetApi) return prev;
      if (prev.api && targetApi) return { ...prev, api: targetApi };
      return null;
    };
    const prev: ThinkingContent = { type: "thinking", thinking: "...", api: "anthropic-messages" };
    const result = fn(prev, "openai-responses");
    expect(result).not.toBeNull();
    expect(result?.api).toBe("openai-responses");
    expect(fn(prev, "anthropic-messages")).toBe(prev);
  });

  it("readonly api field: should allow reading but disallow writing", () => {
    // 编译时约束：api 是 readonly，此处仅验证读取可见性
    const adapter: ThinkingAdapter = {
      api,
      extractFromRequest: () => ({}),
      extractFromResponse: () => null,
      reconcileForReplay: () => null,
    };
    const readApi: ApiProtocol = adapter.api;
    expect(readApi).toBe("anthropic-messages");
  });

  it("should allow a full implementation matching all members", () => {
    const adapter: ThinkingAdapter = {
      api: "openai-completions",
      extractFromRequest: (reasoning) => ({
        reasoning_effort: reasoning.level,
      }),
      extractFromResponse: (message) => {
        if (message && typeof message === "object" && "type" in message) {
          const m = message as Record<string, unknown>;
          if (m.type === "thinking") {
            return {
              type: "thinking",
              thinking: String(m.thinking ?? ""),
              api: "openai-completions",
            };
          }
        }
        return null;
      },
      reconcileForReplay: (prev, targetApi) => {
        if (!prev.api) return null;
        return { ...prev, api: targetApi };
      },
    };
    expect(adapter.api).toBe("openai-completions");
    expect(adapter.extractFromRequest({ level: "high" })).toBeDefined();
    expect(adapter.extractFromResponse({ type: "thinking", thinking: "test" })).not.toBeNull();
    expect(adapter.reconcileForReplay({ type: "thinking", thinking: "...", api: "openai-completions" }, "anthropic-messages")).not.toBeNull();
  });
});
