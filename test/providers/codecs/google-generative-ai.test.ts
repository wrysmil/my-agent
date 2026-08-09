import { describe, it, expect } from "vitest";
import { GoogleGenerativeAiCodec } from "../../../src/providers/codecs/google-generative-ai.js";
import type { ModelCapabilities } from "../../../src/providers/types.js";
import type { MessageContent } from "../../../src/shared/types.js";
import { CapabilityUnsupportedError } from "../../../src/shared/errors.js";

const FULL_CAPS: ModelCapabilities = {
  vision: true, tool_use: true, thinking: true,
  json_mode: true, prompt_caching: false, streaming: true,
};
const NO_VISION: ModelCapabilities = { ...FULL_CAPS, vision: false };

function c(caps = FULL_CAPS) { return new GoogleGenerativeAiCodec(caps); }

describe("GoogleGenerativeAiCodec.buildTools", () => {
  it("wraps in functionDeclarations array", () => {
    const r = c().buildTools([{ name: "f", description: "d", inputSchema: {} }]);
    expect(r).toEqual([{ functionDeclarations: [{ name: "f", description: "d", parameters: {} }] }]);
  });
  it("returns empty for no tools", () => {
    expect(c().buildTools([])).toEqual([]);
  });
});

describe("GoogleGenerativeAiCodec.mapStopReason", () => {
  it("STOP→end_turn, MAX_TOKENS→max_tokens, SAFETY→safety", () => {
    expect(c().mapStopReason("STOP")).toBe("end_turn");
    expect(c().mapStopReason("MAX_TOKENS")).toBe("max_tokens");
    expect(c().mapStopReason("SAFETY")).toBe("safety");
  });
  it("RECITATION→content_filter", () => {
    expect(c().mapStopReason("RECITATION")).toBe("content_filter");
  });
  it("defaults null/unknown to end_turn", () => {
    expect(c().mapStopReason(null)).toBe("end_turn");
    expect(c().mapStopReason("OTHER")).toBe("end_turn");
  });
});

describe("GoogleGenerativeAiCodec.outbound", () => {
  it("text → {text}", () => {
    expect(c().outbound({ type: "text", text: "hi" })).toEqual({ text: "hi" });
  });
  it("image → inlineData", () => {
    expect(c().outbound({ type: "image", data: "abc", mediaType: "image/png" }))
      .toEqual({ inlineData: { mimeType: "image/png", data: "abc" } });
  });
  it("vision gate: CapabilityUnsupportedError", () => {
    expect(() => c(NO_VISION).outbound({ type: "image", data: "x", mediaType: "image/png" }))
      .toThrow(CapabilityUnsupportedError);
  });
  it("thinking → {text, thought:true}", () => {
    const r = c().outbound({ type: "thinking", thinking: "reason..." }) as Record<string, unknown>;
    expect(r.text).toBe("reason...");
    expect(r.thought).toBe(true);
  });
  it("tool_use → functionCall", () => {
    expect(c().outbound({ type: "tool_use", id: "x", name: "f", input: { a: 1 } }))
      .toEqual({ functionCall: { name: "f", args: { a: 1 } } });
  });
  it("tool_result → functionResponse", () => {
    const r = c().outbound({ type: "tool_result", toolUseId: "f", content: "ok" }) as Record<string, unknown>;
    expect(r.functionResponse).toBeDefined();
    expect((r.functionResponse as any).name).toBe("f");
  });
});

describe("GoogleGenerativeAiCodec.inbound", () => {
  it("text part → TextContent", () => {
    expect(c().inbound({ text: "hello" })).toEqual([{ type: "text", text: "hello" }]);
  });
  it("thought part → ThinkingContent", () => {
    expect(c().inbound({ text: "reason", thought: true })).toEqual([
      { type: "thinking", thinking: "reason", api: "google-generative-ai" },
    ]);
  });
  it("functionCall → ToolUseContent", () => {
    expect(c().inbound({ functionCall: { name: "f", args: { x: 1 } } }))
      .toEqual([{ type: "tool_use", id: "f", name: "f", input: { x: 1 } }]);
  });
  it("functionResponse → ToolResultContent", () => {
    const r = c().inbound({ functionResponse: { name: "f", response: { content: "ok" } } });
    expect(r[0].type).toBe("tool_result");
  });
  it("inlineData → ImageContent", () => {
    const r = c().inbound({ inlineData: { mimeType: "image/png", data: "abc" } });
    expect(r[0].type).toBe("image");
  });
  it("null/unknown → empty", () => {
    expect(c().inbound(null)).toEqual([]);
    expect(c().inbound({})).toEqual([]);
  });
});

describe("GoogleGenerativeAiCodec.api", () => {
  it('is "google-generative-ai"', () => {
    expect(c().api).toBe("google-generative-ai");
  });
});
