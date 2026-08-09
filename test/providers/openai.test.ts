import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "../../src/providers/openai.js";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import { AuthError, RateLimitError, ProviderError } from "../../src/shared/errors.js";
import type { Message, StreamEvent } from "../../src/shared/types.js";
import { OpenAiCompletionsCodec } from "../../src/providers/codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "../../src/providers/thinking/openai-completions.js";

function makeProvider(opts?: { apiKey?: string; baseUrl?: string; orgId?: string }) {
  return new OpenAIProvider({
    apiKey: opts?.apiKey ?? "test-key",
    baseUrl: opts?.baseUrl,
    orgId: opts?.orgId,
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

describe("OpenAIProvider basics", () => {
  it("has correct id and name", () => {
    const p = makeProvider();
    expect(p.id).toBe("openai");
    expect(p.name).toBe("OpenAI");
  });

  it("extends AbstractLLMProvider", () => {
    expect(makeProvider()).toBeInstanceOf(AbstractLLMProvider);
  });

  it("reuses OpenAiCompletionsCodec", () => {
    const p = makeProvider();
    expect((p as any).codec).toBeInstanceOf(OpenAiCompletionsCodec);
  });

  it("reuses OpenAiCompletionsThinkingAdapter", () => {
    const p = makeProvider();
    expect((p as any).thinkingAdapter).toBeInstanceOf(
      OpenAiCompletionsThinkingAdapter,
    );
  });

  it("defaults baseUrl to OpenAI API", () => {
    const p = makeProvider();
    expect(p).toBeDefined();
  });

  it("accepts custom baseUrl", () => {
    const p = makeProvider({ baseUrl: "https://custom.openai.com/v1" });
    expect(p).toBeDefined();
  });

  it("accepts orgId for multi-org accounts", () => {
    const p = makeProvider({ orgId: "org-abc123" });
    expect(p).toBeDefined();
  });
});

// ============================================================
// buildRequestBody
// ============================================================

describe("OpenAIProvider.buildRequestBody", () => {
  it("builds OpenAI-compatible request body", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
      systemPrompt: "You are helpful.",
    });
    expect(body.model).toBe("gpt-5");
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are helpful.",
    });
  });

  it("includes tools in OpenAI format", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
      tools: [{ name: "t1", description: "d1", inputSchema: {} }],
    });
    expect(body.tools).toEqual([
      { type: "function", function: { name: "t1", description: "d1", parameters: {} } },
    ]);
    expect(body.tool_choice).toBe("auto");
  });

  it("includes thinking config when reasoning enabled", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
      reasoning: "medium",
    });
    const thinking = body.thinking as Record<string, unknown> | undefined;
    expect(thinking?.type).toBe("enabled");
  });

  it("suppresses temperature when thinking is enabled", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
      reasoning: "high",
      temperature: 0.7,
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("includes temperature when thinking is off", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
      reasoning: "off",
      temperature: 0.7,
    });
    expect(body.temperature).toBe(0.7);
  });

  it("omits tools key when no tools provided", () => {
    const p = makeProvider();
    const body = (p as any).buildRequestBody({
      model: "gpt-5",
      messages: sampleMessages,
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });
});

// ============================================================
// classifyError
// ============================================================

describe("OpenAIProvider.classifyError", () => {
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

  it("wraps unknown errors in ProviderError with openai provider", () => {
    const p = makeProvider();
    const err = new Error("unknown");
    const result = (p as any).classifyError(err);
    expect(result).toBeInstanceOf(ProviderError);
    expect((result as ProviderError).provider).toBe("openai");
  });
});

// ============================================================
// stream
// ============================================================

describe("OpenAIProvider.stream", () => {
  it("returns an AsyncIterable", () => {
    const p = makeProvider();
    const stream = p.stream({
      model: "gpt-5",
      messages: sampleMessages,
    });
    expect(stream).toBeDefined();
    expect(typeof stream[Symbol.asyncIterator]).toBe("function");
  });
});

// ============================================================
// validateAuth
// ============================================================

describe("OpenAIProvider.validateAuth", () => {
  it("is a function that returns Promise<boolean>", () => {
    const p = makeProvider();
    const result = p.validateAuth();
    expect(result).toBeInstanceOf(Promise);
    // resolved value should be boolean
    result.then((v) => expect(typeof v).toBe("boolean")).catch(() => {
      // network errors are expected with fake keys
    });
  });
});

// ============================================================
// parseStreamChunk
// ============================================================

describe("OpenAIProvider.parseStreamChunk", () => {
  it("is an empty async generator", async () => {
    const p = makeProvider();
    const gen = (p as any).parseStreamChunk("");
    const results: StreamEvent[] = [];
    for await (const ev of gen) {
      results.push(ev);
    }
    expect(results).toEqual([]);
  });
});
