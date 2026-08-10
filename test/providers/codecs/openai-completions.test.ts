import { describe, it, expect } from "vitest";
import { OpenAiCompletionsCodec } from "../../../src/providers/codecs/openai-completions.js";
import type { ToolDefinition } from "../../../src/providers/base.js";
import type { MessageContent } from "../../../src/shared/types.js";
import { CapabilityUnsupportedError } from "../../../src/shared/errors.js";

const visionCaps = { vision: true, tool_use: true, thinking: true, json_mode: false, prompt_caching: false, streaming: true };
const noVisionCaps = { ...visionCaps, vision: false };

describe("OpenAiCompletionsCodec.buildTools", () => {
  it("空工具列表 → 空数组", () => {
    const codec = new OpenAiCompletionsCodec(visionCaps);
    expect(codec.buildTools([])).toEqual([]);
  });

  it("单个工具 → OpenAI function 格式", () => {
    const codec = new OpenAiCompletionsCodec(visionCaps);
    const tools: ToolDefinition[] = [{ name: "read", description: "read file", inputSchema: { type: "object", properties: {} } }];
    const result = codec.buildTools(tools) as any[];
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("function");
    expect(result[0].function.name).toBe("read");
  });
});

describe("OpenAiCompletionsCodec.mapStopReason", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("tool_calls → tool_use", () => expect(codec.mapStopReason("tool_calls")).toBe("tool_use"));
  it("length → max_tokens", () => expect(codec.mapStopReason("length")).toBe("max_tokens"));
  it("stop → end_turn", () => expect(codec.mapStopReason("stop")).toBe("end_turn"));
  it("content_filter → content_filter", () => expect(codec.mapStopReason("content_filter")).toBe("content_filter"));
  it("null → end_turn (default)", () => expect(codec.mapStopReason(null)).toBe("end_turn"));
  it("undefined → end_turn (default)", () => expect(codec.mapStopReason(undefined)).toBe("end_turn"));
});

describe("OpenAiCompletionsCodec.outbound — text block", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("text block → { role, content }", () => {
    const block: MessageContent = { type: "text", text: "hello" };
    const result = codec.outbound(block) as any;
    expect(result.role).toBe("user");
    expect(result.content).toBe("hello");
  });
});

describe("OpenAiCompletionsCodec.outbound — vision gating", () => {
  it("vision=true 时 image block 正常生成", () => {
    const codec = new OpenAiCompletionsCodec(visionCaps);
    const block: MessageContent = { type: "image", data: "abc", mediaType: "image/png" };
    const result = codec.outbound(block) as any;
    expect(result.role).toBe("user");
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("image_url");
  });

  it("vision=false 时 image block 抛 CapabilityUnsupportedError", () => {
    const codec = new OpenAiCompletionsCodec(noVisionCaps);
    const block: MessageContent = { type: "image", data: "abc", mediaType: "image/png" };
    expect(() => codec.outbound(block)).toThrow(CapabilityUnsupportedError);
    try { codec.outbound(block); } catch (e) {
      expect((e as any).capability).toBe("vision");
    }
  });
});

describe("OpenAiCompletionsCodec.outbound — thinking block", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("thinking block → assistant + reasoning_content", () => {
    const block: MessageContent = { type: "thinking", thinking: "let me analyze..." };
    const result = codec.outbound(block) as any;
    expect(result.role).toBe("assistant");
    expect(result.content).toBeNull();
    expect(result.reasoning_content).toBe("let me analyze...");
  });
});

describe("OpenAiCompletionsCodec.outbound — tool_use block", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("tool_use block → assistant + tool_calls", () => {
    const block: MessageContent = { type: "tool_use", id: "call_1", name: "read", input: { path: "/x" } };
    const result = codec.outbound(block) as any;
    expect(result.role).toBe("assistant");
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].id).toBe("call_1");
    expect(result.tool_calls[0].function.name).toBe("read");
    expect(result.tool_calls[0].function.arguments).toBe('{"path":"/x"}');
  });
});

describe("OpenAiCompletionsCodec.outbound — tool_result block", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("tool_result block → tool role + tool_call_id", () => {
    const block: MessageContent = { type: "tool_result", toolUseId: "call_1", content: "file contents" };
    const result = codec.outbound(block) as any;
    expect(result.role).toBe("tool");
    expect(result.tool_call_id).toBe("call_1");
    expect(result.content).toBe("file contents");
  });
});

describe("OpenAiCompletionsCodec.outbound — unknown block", () => {
  const codec = new OpenAiCompletionsCodec(visionCaps);

  it("未知 block type → null", () => {
    const result = codec.outbound({ type: "unknown" } as any);
    expect(result).toBeNull();
  });
});

describe("OpenAiCompletionsCodec.api field", () => {
  it("api = 'openai-completions'", () => {
    const codec = new OpenAiCompletionsCodec(visionCaps);
    expect(codec.api).toBe("openai-completions");
  });
});
