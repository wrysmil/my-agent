import { describe, it, expect } from "vitest";
import { GoogleProvider } from "../../src/providers/google.js";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import { GoogleGenerativeAiCodec } from "../../src/providers/codecs/google-generative-ai.js";
import { GoogleThinkingAdapter } from "../../src/providers/thinking/google-generative-ai.js";
import { AuthError, RateLimitError, ProviderError } from "../../src/shared/errors.js";
import type { Message, StreamEvent } from "../../src/shared/types.js";

function make(opts?: { apiKey?: string }) {
  return new GoogleProvider({ apiKey: opts?.apiKey ?? "test-key" });
}

const msgs: Message[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

describe("GoogleProvider basics", () => {
  it("id/name", () => {
    const p = make();
    expect(p.id).toBe("google");
    expect(p.name).toBe("Google");
  });
  it("extends AbstractLLMProvider", () => {
    expect(make()).toBeInstanceOf(AbstractLLMProvider);
  });
  it("uses GoogleGenerativeAiCodec", () => {
    expect((make() as any).codec).toBeInstanceOf(GoogleGenerativeAiCodec);
  });
  it("uses GoogleThinkingAdapter", () => {
    expect((make() as any).thinkingAdapter).toBeInstanceOf(GoogleThinkingAdapter);
  });
});

describe("GoogleProvider.buildRequestBody", () => {
  it("system prompt → systemInstruction", () => {
    const body = (make() as any).buildRequestBody({ model: "gemini-2.5-flash", messages: msgs, systemPrompt: "Be helpful." });
    expect(body.systemInstruction).toEqual({ parts: [{ text: "Be helpful." }] });
  });
  it("user→user, assistant→model role", () => {
    const body = (make() as any).buildRequestBody({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        { role: "assistant", content: [{ type: "text", text: "a" }] },
      ],
    });
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[1].role).toBe("model");
  });
  it("tool role → function role", () => {
    const body = (make() as any).buildRequestBody({
      model: "gemini-2.5-flash",
      messages: [
        { role: "tool", content: [{ type: "tool_result", toolUseId: "f", content: "ok" }] },
      ],
    });
    expect(body.contents[0].role).toBe("function");
  });
  it("includes thinkingConfig when reasoning enabled", () => {
    const body = (make() as any).buildRequestBody({ model: "gemini-2.5-flash", messages: msgs, reasoning: "medium" });
    expect(body.thinkingConfig).toBeDefined();
  });
  it("includes generationConfig", () => {
    const body = (make() as any).buildRequestBody({ model: "gemini-2.5-flash", messages: msgs, maxTokens: 100, temperature: 0.5 });
    expect(body.generationConfig.maxOutputTokens).toBe(100);
    expect(body.generationConfig.temperature).toBe(0.5);
  });
  it("no systemInstruction when no systemPrompt", () => {
    const body = (make() as any).buildRequestBody({ model: "gemini-2.5-flash", messages: msgs });
    expect(body.systemInstruction).toBeUndefined();
  });
});

describe("GoogleProvider.classifyError", () => {
  it("passes through known errors", () => {
    const p = make();
    expect((p as any).classifyError(new AuthError("x"))).toBeInstanceOf(AuthError);
    expect((p as any).classifyError(new RateLimitError("x"))).toBeInstanceOf(RateLimitError);
  });
  it("wraps unknown", () => {
    const r = (make() as any).classifyError(new Error("x"));
    expect(r).toBeInstanceOf(ProviderError);
    expect((r as ProviderError).provider).toBe("google");
  });
});

describe("GoogleProvider.validateAuth", () => {
  it("returns Promise<boolean>", () => {
    const r = make().validateAuth();
    expect(r).toBeInstanceOf(Promise);
  });
});

describe("GoogleProvider.parseStreamChunk", () => {
  it("empty generator", async () => {
    const results: StreamEvent[] = [];
    for await (const ev of (make() as any).parseStreamChunk("")) results.push(ev);
    expect(results).toEqual([]);
  });
});
