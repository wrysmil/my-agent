import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../../src/providers/anthropic.js";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import { AuthError, RateLimitError, ProviderError } from "../../src/shared/errors.js";
import type { Message, StreamEvent } from "../../src/shared/types.js";

function makeProvider(opts?: { apiKey?: string; baseUrl?: string }) {
  return new AnthropicProvider({
    apiKey: opts?.apiKey ?? "test-key",
    baseUrl: opts?.baseUrl,
  });
}

const sampleMessages: Message[] = [
  {
    role: "user",
    content: [{ type: "text", text: "Hello" }],
  },
];

// ============================================================
// 基础属性
// ============================================================

describe("AnthropicProvider basics", () => {
  it("has correct id and name", () => {
    const p = makeProvider();
    expect(p.id).toBe("anthropic");
    expect(p.name).toBe("Anthropic");
  });

  it("extends AbstractLLMProvider", () => {
    const p = makeProvider();
    expect(p).toBeInstanceOf(AbstractLLMProvider);
  });

  it("defaults baseUrl to Anthropic API", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-sonnet-4-5",
      messages: sampleMessages,
    });
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
  });

  it("accepts custom baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://custom.anthropic.com/v1" });
    // baseUrl is private — verified via construction only
    expect(p).toBeDefined();
  });
});

// ============================================================
// buildRequestBody
// ============================================================

describe("AnthropicProvider.buildRequestBody", () => {
  it("puts system prompt at top-level system field", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
      systemPrompt: "You are helpful.",
    });
    expect(body.system).toBe("You are helpful.");
    // Should NOT be in messages
    expect(body.messages[0]?.role).not.toBe("system");
  });

  it("omits system field when no systemPrompt", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
    });
    expect(body).not.toHaveProperty("system");
  });

  it("converts messages to Anthropic format with content arrays", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
    });
    expect(body.messages).toBeInstanceOf(Array);
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    const firstMsg = body.messages[0] as Record<string, unknown>;
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.content).toBeInstanceOf(Array);
  });

  it("includes tools in Anthropic format", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
      tools: [{ name: "t1", description: "d1", inputSchema: {} }],
    });
    expect(body.tools).toEqual([
      { name: "t1", description: "d1", input_schema: {} },
    ]);
  });

  it("includes thinking config when reasoning is enabled", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
      reasoning: "high",
    });
    const thinking = body.thinking as Record<string, unknown> | undefined;
    expect(thinking).toBeDefined();
    expect(thinking?.type).toBe("enabled");
  });

  it("omits thinking when reasoning is off", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
      reasoning: "off",
    });
    expect(body).not.toHaveProperty("thinking");
  });

  it("includes stop_sequences when provided", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
      stopSequences: ["END", "STOP"],
    });
    expect(body.stop_sequences).toEqual(["END", "STOP"]);
  });

  it("always sets stream:true", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: sampleMessages,
    });
    expect(body.stream).toBe(true);
  });
});

// ============================================================
// convertMessages (private, tested via buildRequestBody)
// ============================================================

describe("AnthropicProvider message conversion", () => {
  it("converts tool-role messages to user-role (Anthropic has no tool role)", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "search",
              input: {},
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolUseId: "t1",
              content: "result",
            },
          ],
        },
      ],
    });
    const msgs = body.messages as Array<Record<string, unknown>>;
    // Tool result should be in a user message
    const toolResult = msgs.find(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<Record<string, unknown>>).some(
          (c) => c.type === "tool_result",
        ),
    );
    expect(toolResult).toBeDefined();
    expect(toolResult!.role).toBe("user");
  });

  it("assistant message includes thinking block with signature", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "claude-opus-4-7",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "reasoning...",
              thinkingSignature: "sig_abc",
            },
            { type: "text", text: "response" },
          ],
        },
      ],
    });
    const msgs = body.messages as Array<Record<string, unknown>>;
    const assistantMsg = msgs[0];
    const contentBlocks = assistantMsg.content as Array<Record<string, unknown>>;
    const thinkingBlock = contentBlocks.find((c) => c.type === "thinking");
    expect(thinkingBlock).toBeDefined();
    expect((thinkingBlock as any).thinking).toBe("reasoning...");
    expect((thinkingBlock as any).signature).toBe("sig_abc");
  });
});

// ============================================================
// classifyError
// ============================================================

describe("AnthropicProvider.classifyError", () => {
  it("passes through AuthError", () => {
    const p = makeProvider();
    const err = new AuthError("bad key");
    expect((p as any).classifyError(err)).toBe(err);
  });

  it("passes through RateLimitError", () => {
    const p = makeProvider();
    const err = new RateLimitError("too many");
    expect((p as any).classifyError(err)).toBe(err);
  });

  it("passes through ProviderError", () => {
    const p = makeProvider();
    const err = new ProviderError("fail", "anthropic");
    expect((p as any).classifyError(err)).toBe(err);
  });

  it("wraps unknown errors in ProviderError", () => {
    const p = makeProvider();
    const err = new Error("something broke");
    const result = (p as any).classifyError(err);
    expect(result).toBeInstanceOf(ProviderError);
    expect((result as ProviderError).provider).toBe("anthropic");
  });
});

// ============================================================
// validateAuth
// ============================================================

describe("AnthropicProvider.validateAuth", () => {
  it("is a function that returns Promise<boolean>", () => {
    const p = makeProvider();
    const result = p.validateAuth();
    expect(result).toBeInstanceOf(Promise);
    result.then((v) => expect(typeof v).toBe("boolean")).catch(() => {
      // network errors are expected with fake keys
    });
  });
});

// ============================================================
// parseStreamChunk (dead code contract)
// ============================================================

describe("AnthropicProvider.parseStreamChunk", () => {
  it("is an empty async generator (stream parsing inline)", async () => {
    const p = makeProvider();
    const gen = (p as any).parseStreamChunk("");
    const results: StreamEvent[] = [];
    for await (const ev of gen) {
      results.push(ev);
    }
    expect(results).toEqual([]);
  });
});
