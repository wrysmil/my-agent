import { describe, it, expect } from "vitest";
import { AnthropicMessagesThinkingAdapter } from "../../../src/providers/thinking/anthropic-messages.js";
import type { ThinkingContent } from "../../../src/shared/types.js";

function makeAdapter() {
  return new AnthropicMessagesThinkingAdapter();
}

// ============================================================
// extractFromRequest
// ============================================================

describe("AnthropicMessagesThinkingAdapter.extractFromRequest", () => {
  it("returns empty object for off level", () => {
    const result = makeAdapter().extractFromRequest({ level: "off" });
    expect(result).toEqual({});
  });

  it("maps minimal to budget_tokens=1024", () => {
    const result = makeAdapter().extractFromRequest({ level: "minimal" }) as Record<string, unknown>;
    expect(result).toEqual({
      thinking: { type: "enabled", budget_tokens: 1024 },
    });
  });

  it("maps low to budget_tokens=4096", () => {
    const result = makeAdapter().extractFromRequest({ level: "low" }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(4096);
  });

  it("maps medium to budget_tokens=8192", () => {
    const result = makeAdapter().extractFromRequest({ level: "medium" }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(8192);
  });

  it("maps high to budget_tokens=16000", () => {
    const result = makeAdapter().extractFromRequest({ level: "high" }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(16000);
  });

  it("respects explicit budgetTokens override", () => {
    const result = makeAdapter().extractFromRequest({
      level: "medium",
      budgetTokens: 5000,
    }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(5000);
  });

  it("caps budgetTokens at level default (Math.min)", () => {
    // level "low" → 4096, explicit 100000 → Math.min(4096, 100000) = 4096
    const result = makeAdapter().extractFromRequest({
      level: "low",
      budgetTokens: 100000,
    }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(4096);
  });

  it("uses explicit budgetTokens when lower than level default", () => {
    // level "high" → 16000, explicit 5000 → Math.min(16000, 5000) = 5000
    const result = makeAdapter().extractFromRequest({
      level: "high",
      budgetTokens: 5000,
    }) as Record<string, unknown>;
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.budget_tokens).toBe(5000);
  });
});

// ============================================================
// extractFromResponse
// ============================================================

describe("AnthropicMessagesThinkingAdapter.extractFromResponse", () => {
  it("extracts thinking from Anthropic content block", () => {
    const result = makeAdapter().extractFromResponse({
      type: "thinking",
      thinking: "Let me reason step by step...",
      signature: "sig_abc123",
    });
    expect(result).toEqual({
      type: "thinking",
      thinking: "Let me reason step by step...",
      thinkingSignature: "sig_abc123",
      api: "anthropic-messages",
    });
  });

  it("returns null for null message", () => {
    expect(makeAdapter().extractFromResponse(null)).toBeNull();
  });

  it("returns null for undefined message", () => {
    expect(makeAdapter().extractFromResponse(undefined)).toBeNull();
  });

  it("returns null for non-thinking block", () => {
    expect(makeAdapter().extractFromResponse({ type: "text", text: "hi" })).toBeNull();
  });

  it("returns null when thinking field is empty", () => {
    expect(makeAdapter().extractFromResponse({ type: "thinking", thinking: "" })).toBeNull();
  });

  it("handles missing signature gracefully", () => {
    const result = makeAdapter().extractFromResponse({
      type: "thinking",
      thinking: "reasoning...",
    });
    expect(result?.thinkingSignature).toBeUndefined();
  });
});

// ============================================================
// reconcileForReplay
// ============================================================

describe("AnthropicMessagesThinkingAdapter.reconcileForReplay", () => {
  const prev: ThinkingContent = {
    type: "thinking",
    thinking: "previous reasoning",
    thinkingSignature: "sig_xyz",
    api: "anthropic-messages",
  };

  it("preserves block for same protocol", () => {
    const result = makeAdapter().reconcileForReplay(prev, "anthropic-messages");
    expect(result).toEqual(prev);
  });

  it("adapts to openai-completions (keeps signature, changes api)", () => {
    const result = makeAdapter().reconcileForReplay(prev, "openai-completions");
    expect(result).not.toBeNull();
    expect(result!.thinking).toBe("previous reasoning");
    expect(result!.thinkingSignature).toBe("sig_xyz");
    expect(result!.api).toBe("openai-completions");
  });

  it("adapts to openai-responses", () => {
    const result = makeAdapter().reconcileForReplay(prev, "openai-responses");
    expect(result).not.toBeNull();
    expect(result!.api).toBe("openai-responses");
  });

  it("returns null for unsupported protocol", () => {
    const result = makeAdapter().reconcileForReplay(prev, "google-generative-ai");
    expect(result).toBeNull();
  });
});

// ============================================================
// api field
// ============================================================

describe("AnthropicMessagesThinkingAdapter.api", () => {
  it('has api = "anthropic-messages"', () => {
    expect(makeAdapter().api).toBe("anthropic-messages");
  });
});
