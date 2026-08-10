import { describe, it, expect } from "vitest";
import { AnthropicMessagesCodec } from "../../../src/providers/codecs/anthropic-messages.js";
import type { ModelCapabilities } from "../../../src/providers/types.js";
import type { MessageContent } from "../../../src/shared/types.js";
import { CapabilityUnsupportedError } from "../../../src/shared/errors.js";

const FULL_CAPS: ModelCapabilities = {
  vision: true,
  tool_use: true,
  thinking: true,
  json_mode: true,
  prompt_caching: true,
  streaming: true,
};

const NO_VISION_CAPS: ModelCapabilities = { ...FULL_CAPS, vision: false };

function makeCodec(caps = FULL_CAPS) {
  return new AnthropicMessagesCodec(caps);
}

// ============================================================
// buildTools
// ============================================================

describe("AnthropicMessagesCodec.buildTools", () => {
  it("converts ToolDefinition to Anthropic format", () => {
    const codec = makeCodec();
    const result = codec.buildTools([
      { name: "get_weather", description: "Get weather", inputSchema: { type: "object" } },
    ]);
    expect(result).toEqual([
      { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
    ]);
  });

  it("returns empty array for no tools", () => {
    const codec = makeCodec();
    expect(codec.buildTools([])).toEqual([]);
  });

  it("does NOT wrap in type:function (Anthropic format)", () => {
    const codec = makeCodec();
    const result = codec.buildTools([
      { name: "t", description: "d", inputSchema: {} },
    ]);
    const tool = result[0] as Record<string, unknown>;
    expect(tool).not.toHaveProperty("type");
    expect(tool).toHaveProperty("name");
    expect(tool).toHaveProperty("input_schema");
  });
});

// ============================================================
// mapStopReason
// ============================================================

describe("AnthropicMessagesCodec.mapStopReason", () => {
  it("maps end_turn → end_turn", () => {
    expect(makeCodec().mapStopReason("end_turn")).toBe("end_turn");
  });

  it("maps max_tokens → max_tokens", () => {
    expect(makeCodec().mapStopReason("max_tokens")).toBe("max_tokens");
  });

  it("maps stop_sequence → stop_sequence", () => {
    expect(makeCodec().mapStopReason("stop_sequence")).toBe("stop_sequence");
  });

  it("maps tool_use → tool_use", () => {
    expect(makeCodec().mapStopReason("tool_use")).toBe("tool_use");
  });

  it("defaults null/undefined to end_turn", () => {
    expect(makeCodec().mapStopReason(null)).toBe("end_turn");
    expect(makeCodec().mapStopReason(undefined)).toBe("end_turn");
  });

  it("defaults unknown reason to end_turn", () => {
    expect(makeCodec().mapStopReason("some_unknown")).toBe("end_turn");
  });
});

// ============================================================
// outbound
// ============================================================

describe("AnthropicMessagesCodec.outbound", () => {
  it("converts text block to Anthropic text content block", () => {
    const block: MessageContent = { type: "text", text: "Hello" };
    expect(makeCodec().outbound(block)).toEqual({
      type: "text",
      text: "Hello",
    });
  });

  it("converts image block to Anthropic image content block", () => {
    const block: MessageContent = {
      type: "image",
      data: "abc123",
      mediaType: "image/png",
    };
    expect(makeCodec().outbound(block)).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "abc123",
      },
    });
  });

  it("throws CapabilityUnsupportedError when vision is disabled", () => {
    const codec = makeCodec(NO_VISION_CAPS);
    const block: MessageContent = {
      type: "image",
      data: "abc",
      mediaType: "image/png",
    };
    expect(() => codec.outbound(block)).toThrow(CapabilityUnsupportedError);
  });

  it("converts thinking block preserving signature", () => {
    const block: MessageContent = {
      type: "thinking",
      thinking: "Let me think...",
      thinkingSignature: "sig_abc123",
    };
    expect(makeCodec().outbound(block)).toEqual({
      type: "thinking",
      thinking: "Let me think...",
      signature: "sig_abc123",
    });
  });

  it("converts thinking block with empty signature when missing", () => {
    const block: MessageContent = {
      type: "thinking",
      thinking: "Let me think...",
    };
    const result = makeCodec().outbound(block) as Record<string, unknown>;
    expect(result.type).toBe("thinking");
    expect(result.thinking).toBe("Let me think...");
    expect(result.signature).toBe("");
  });

  it("converts tool_use block to Anthropic format", () => {
    const block: MessageContent = {
      type: "tool_use",
      id: "toolu_001",
      name: "get_weather",
      input: { location: "NYC" },
    };
    expect(makeCodec().outbound(block)).toEqual({
      type: "tool_use",
      id: "toolu_001",
      name: "get_weather",
      input: { location: "NYC" },
    });
  });

  it("converts tool_result block to Anthropic format", () => {
    const block: MessageContent = {
      type: "tool_result",
      toolUseId: "toolu_001",
      content: "Sunny, 72F",
    };
    expect(makeCodec().outbound(block)).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_001",
      content: "Sunny, 72F",
    });
  });

  it("includes is_error when tool_result is error", () => {
    const block: MessageContent = {
      type: "tool_result",
      toolUseId: "toolu_001",
      content: "Error!",
      isError: true,
    };
    const result = makeCodec().outbound(block) as Record<string, unknown>;
    expect(result.is_error).toBe(true);
  });

  it("returns null for unknown block type", () => {
    const block = { type: "unknown_type" } as unknown as MessageContent;
    expect(makeCodec().outbound(block)).toBeNull();
  });
});

// ============================================================
// inbound
// ============================================================

describe("AnthropicMessagesCodec.inbound", () => {
  it("converts Anthropic text block to TextContent", () => {
    const result = makeCodec().inbound({ type: "text", text: "Hello there" });
    expect(result).toEqual([{ type: "text", text: "Hello there" }]);
  });

  it("converts Anthropic thinking block to ThinkingContent with signature", () => {
    const result = makeCodec().inbound({
      type: "thinking",
      thinking: "Let me reason...",
      signature: "sig_xyz",
    });
    expect(result).toEqual([
      {
        type: "thinking",
        thinking: "Let me reason...",
        thinkingSignature: "sig_xyz",
        api: "anthropic-messages",
      },
    ]);
  });

  it("converts Anthropic tool_use block to ToolUseContent", () => {
    const result = makeCodec().inbound({
      type: "tool_use",
      id: "toolu_002",
      name: "search",
      input: { query: "hello" },
    });
    expect(result).toEqual([
      {
        type: "tool_use",
        id: "toolu_002",
        name: "search",
        input: { query: "hello" },
      },
    ]);
  });

  it("converts Anthropic tool_result block to ToolResultContent", () => {
    const result = makeCodec().inbound({
      type: "tool_result",
      tool_use_id: "toolu_002",
      content: "results here",
    });
    expect(result).toEqual([
      {
        type: "tool_result",
        toolUseId: "toolu_002",
        content: "results here",
      },
    ]);
  });

  it("returns empty for null input", () => {
    expect(makeCodec().inbound(null)).toEqual([]);
  });

  it("returns empty for unknown block type", () => {
    expect(makeCodec().inbound({ type: "unknown" })).toEqual([]);
  });

  it("returns empty for block without type", () => {
    expect(makeCodec().inbound({})).toEqual([]);
  });
});

// ============================================================
// api field
// ============================================================

describe("AnthropicMessagesCodec.api", () => {
  it('has api = "anthropic-messages"', () => {
    expect(makeCodec().api).toBe("anthropic-messages");
  });
});
