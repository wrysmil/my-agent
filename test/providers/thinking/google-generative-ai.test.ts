import { describe, it, expect } from "vitest";
import { GoogleThinkingAdapter } from "../../../src/providers/thinking/google-generative-ai.js";
import type { ThinkingContent } from "../../../src/shared/types.js";

function a() { return new GoogleThinkingAdapter(); }

describe("GoogleThinkingAdapter.extractFromRequest", () => {
  it("off → {}", () => {
    expect(a().extractFromRequest({ level: "off" })).toEqual({});
  });
  it("minimal → thinkingBudget:1024", () => {
    const r = a().extractFromRequest({ level: "minimal" }) as Record<string, unknown>;
    const tc = r.thinkingConfig as Record<string, unknown>;
    expect(tc.thinkingBudget).toBe(1024);
  });
  it("high → thinkingBudget:16384", () => {
    const r = a().extractFromRequest({ level: "high" }) as Record<string, unknown>;
    const tc = r.thinkingConfig as Record<string, unknown>;
    expect(tc.thinkingBudget).toBe(16384);
  });
  it("caps at level default", () => {
    const r = a().extractFromRequest({ level: "low", budgetTokens: 100000 }) as Record<string, unknown>;
    const tc = r.thinkingConfig as Record<string, unknown>;
    expect(tc.thinkingBudget).toBe(4096);
  });
});

describe("GoogleThinkingAdapter.extractFromResponse", () => {
  it("extracts thought field", () => {
    expect(a().extractFromResponse({ thought: "reasoning..." })).toEqual({
      type: "thinking", thinking: "reasoning...", api: "google-generative-ai",
    });
  });
  it("extracts thought:true + text", () => {
    expect(a().extractFromResponse({ thought: true, text: "reason" })).toEqual({
      type: "thinking", thinking: "reason", api: "google-generative-ai",
    });
  });
  it("null/undefined → null", () => {
    expect(a().extractFromResponse(null)).toBeNull();
    expect(a().extractFromResponse(undefined)).toBeNull();
  });
  it("no thought → null", () => {
    expect(a().extractFromResponse({ text: "hi" })).toBeNull();
  });
});

describe("GoogleThinkingAdapter.reconcileForReplay", () => {
  const prev: ThinkingContent = { type: "thinking", thinking: "r", api: "google-generative-ai" };
  it("same protocol preserves", () => {
    expect(a().reconcileForReplay(prev, "google-generative-ai")).toEqual(prev);
  });
  it("crosses to openai-completions", () => {
    const r = a().reconcileForReplay(prev, "openai-completions");
    expect(r?.api).toBe("openai-completions");
  });
  it("crosses to anthropic-messages", () => {
    const r = a().reconcileForReplay(prev, "anthropic-messages");
    expect(r?.api).toBe("anthropic-messages");
  });
  it("custom → null", () => {
    expect(a().reconcileForReplay(prev, "custom")).toBeNull();
  });
});

describe("GoogleThinkingAdapter.api", () => {
  it('is "google-generative-ai"', () => {
    expect(a().api).toBe("google-generative-ai");
  });
});
