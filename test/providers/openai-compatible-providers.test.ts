import { describe, it, expect } from "vitest";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import { OpenAiCompletionsCodec } from "../../src/providers/codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "../../src/providers/thinking/openai-completions.js";
import { MoonshotProvider } from "../../src/providers/moonshot.js";
import { QwenProvider } from "../../src/providers/qwen.js";
import { MistralProvider } from "../../src/providers/mistral.js";
import { GrokProvider } from "../../src/providers/grok.js";
import { ProviderError } from "../../src/shared/errors.js";
import type { Message, StreamEvent } from "../../src/shared/types.js";

// ============================================================
// 共享的测试模式 — 所有 OpenAI 兼容 provider 的结构验证
// ============================================================

function testOpenAiCompatibleProvider(
  label: string,
  Factory: new (opts: { apiKey: string; baseUrl?: string }) => AbstractLLMProvider,
  expected: { id: string; name: string; defaultBaseUrl: string },
) {
  const msgs: Message[] = [{ role: "user", content: [{ type: "text", text: "hi" }] }];

  describe(`${label} basics`, () => {
    it("id and name", () => {
      const p = new Factory({ apiKey: "k" });
      expect(p.id).toBe(expected.id);
      expect(p.name).toBe(expected.name);
    });
    it("extends AbstractLLMProvider", () => {
      expect(new Factory({ apiKey: "k" })).toBeInstanceOf(AbstractLLMProvider);
    });
    it("reuses OpenAiCompletionsCodec", () => {
      expect((new Factory({ apiKey: "k" }) as any).codec).toBeInstanceOf(OpenAiCompletionsCodec);
    });
    it("reuses OpenAiCompletionsThinkingAdapter", () => {
      expect((new Factory({ apiKey: "k" }) as any).thinkingAdapter).toBeInstanceOf(OpenAiCompletionsThinkingAdapter);
    });
  });

  describe(`${label} buildRequestBody`, () => {
    it("builds OpenAI-compatible body", () => {
      const p = new Factory({ apiKey: "k" });
      const body = (p as any).buildRequestBody({ model: "test", messages: msgs, systemPrompt: "Be helpful." });
      expect(body.model).toBe("test");
      expect(body.stream).toBe(true);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be helpful." });
    });
    it("includes tools in OpenAI format", () => {
      const p = new Factory({ apiKey: "k" });
      const body = (p as any).buildRequestBody({ model: "test", messages: msgs, tools: [{ name: "t", description: "d", inputSchema: {} }] });
      expect(body.tools).toBeDefined();
    });
  });

  describe(`${label} classifyError`, () => {
    it("wraps unknown errors", () => {
      const p = new Factory({ apiKey: "k" });
      const r = (p as any).classifyError(new Error("x"));
      expect(r).toBeInstanceOf(ProviderError);
    });
  });

  describe(`${label} stream`, () => {
    it("returns AsyncIterable", () => {
      const p = new Factory({ apiKey: "k" });
      const s = p.stream({ model: "x", messages: msgs });
      expect(typeof s[Symbol.asyncIterator]).toBe("function");
    });
  });

  describe(`${label} validateAuth`, () => {
    it("returns Promise<boolean>", () => {
      expect(new Factory({ apiKey: "k" }).validateAuth()).toBeInstanceOf(Promise);
    });
  });

  describe(`${label} parseStreamChunk`, () => {
    it("empty generator", async () => {
      const results: StreamEvent[] = [];
      for await (const ev of (new Factory({ apiKey: "k" }) as any).parseStreamChunk("")) results.push(ev);
      expect(results).toEqual([]);
    });
  });
}

// ============================================================
// 实际测试套件
// ============================================================

testOpenAiCompatibleProvider("MoonshotProvider", MoonshotProvider, {
  id: "moonshot",
  name: "Moonshot (月之暗面)",
  defaultBaseUrl: "https://api.moonshot.cn/v1",
});

testOpenAiCompatibleProvider("QwenProvider", QwenProvider, {
  id: "qwen",
  name: "Qwen (通义千问)",
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

testOpenAiCompatibleProvider("MistralProvider", MistralProvider, {
  id: "mistral",
  name: "Mistral AI",
  defaultBaseUrl: "https://api.mistral.ai/v1",
});

testOpenAiCompatibleProvider("GrokProvider", GrokProvider, {
  id: "xai",
  name: "Grok (xAI)",
  defaultBaseUrl: "https://api.x.ai/v1",
});
