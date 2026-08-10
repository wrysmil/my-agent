import { describe, it, expect } from "vitest";
import { OpenAiCompletionsThinkingAdapter } from "../../../src/providers/thinking/openai-completions.js";
import type { ThinkingContent } from "../../../src/shared/types.js";

const adapter = new OpenAiCompletionsThinkingAdapter();

// ============================================================
// extractFromRequest
// ============================================================
describe("OpenAiCompletionsThinkingAdapter.extractFromRequest", () => {
  it("off → empty object", () => {
    const result = adapter.extractFromRequest({ level: "off" });
    expect(result).toEqual({});
  });

  it("high → thinking + reasoning_effort", () => {
    const result = adapter.extractFromRequest({ level: "high" });
    expect(result).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
  });

  it("medium → thinking + reasoning_effort", () => {
    const result = adapter.extractFromRequest({ level: "medium" });
    expect(result).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "medium",
    });
  });

  it("low → thinking + reasoning_effort", () => {
    const result = adapter.extractFromRequest({ level: "low" });
    expect(result).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
    });
  });
});

// ============================================================
// extractFromResponse
// ============================================================
describe("OpenAiCompletionsThinkingAdapter.extractFromResponse", () => {
  it("has reasoning_content → ThinkingContent with api marker", () => {
    const message = { reasoning_content: "Let me think about this..." };
    const result = adapter.extractFromResponse(message);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      type: "thinking",
      thinking: "Let me think about this...",
      thinkingSignature: "reasoning_content",
      api: "openai-completions",
    });
  });

  it("no reasoning_content → null", () => {
    const result = adapter.extractFromResponse({ content: "hello" });
    expect(result).toBeNull();
  });

  it("null message → null", () => {
    const result = adapter.extractFromResponse(null);
    expect(result).toBeNull();
  });

  it("reasoning_content is empty string → null (falsy)", () => {
    const result = adapter.extractFromResponse({ reasoning_content: "" });
    expect(result).toBeNull();
  });
});

// ============================================================
// reconcileForReplay
// ============================================================
describe("OpenAiCompletionsThinkingAdapter.reconcileForReplay", () => {
  const prev: ThinkingContent = {
    type: "thinking",
    thinking: "previous thought",
    thinkingSignature: "reasoning_content",
    api: "openai-completions",
  };

  it("same api → returns original unchanged", () => {
    const result = adapter.reconcileForReplay(prev, "openai-completions");
    expect(result).toBe(prev);
  });

  it("cross api to openai-responses with valid JSON signature → returns updated", () => {
    const withJsonSig: ThinkingContent = {
      type: "thinking",
      thinking: "previous thought",
      thinkingSignature: '{"valid":"json"}',
      api: "openai-completions",
    };
    const result = adapter.reconcileForReplay(withJsonSig, "openai-responses");
    expect(result).not.toBeNull();
    expect(result).toEqual({
      type: "thinking",
      thinking: "previous thought",
      thinkingSignature: '{"valid":"json"}',
      api: "openai-responses",
    });
  });

  it("cross api to openai-responses with non-JSON signature → null (discard)", () => {
    const withNonJsonSig: ThinkingContent = {
      type: "thinking",
      thinking: "previous thought",
      thinkingSignature: "not-json",
      api: "openai-completions",
    };
    const result = adapter.reconcileForReplay(withNonJsonSig, "openai-responses");
    expect(result).toBeNull();
  });

  it("cross api to openai-responses without signature → null (discard)", () => {
    const withoutSig: ThinkingContent = {
      type: "thinking",
      thinking: "previous thought",
      api: "openai-completions",
    };
    const result = adapter.reconcileForReplay(withoutSig, "openai-responses");
    expect(result).toBeNull();
  });

  it("cross api to unsupported protocol → null", () => {
    const result = adapter.reconcileForReplay(prev, "anthropic-messages");
    expect(result).toBeNull();
  });
});

// ============================================================
// Interface conformance
// ============================================================
describe("OpenAiCompletionsThinkingAdapter interface conformance", () => {
  it("readonly api field is 'openai-completions'", () => {
    expect(adapter.api).toBe("openai-completions");
  });

  it("all methods are callable with correct signatures", () => {
    expect(typeof adapter.extractFromRequest).toBe("function");
    expect(typeof adapter.extractFromResponse).toBe("function");
    expect(typeof adapter.reconcileForReplay).toBe("function");
  });
});
