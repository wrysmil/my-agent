import { describe, it, expect } from "vitest";
import type {
  ModelCapabilities,
  ModelDescriptor,
  ReasoningConfig,
  ReasoningLevel,
} from "../../src/providers/types.js";

describe("ModelCapabilities", () => {
  it("should allow full capability declaration (all true)", () => {
    const caps: ModelCapabilities = {
      vision: true,
      tool_use: true,
      thinking: true,
      json_mode: true,
      prompt_caching: true,
      streaming: true,
    };
    expect(caps.vision).toBe(true);
    expect(caps.tool_use).toBe(true);
    expect(caps.thinking).toBe(true);
    expect(caps.json_mode).toBe(true);
    expect(caps.prompt_caching).toBe(true);
    expect(caps.streaming).toBe(true);
  });

  it("should allow minimal capability declaration (all false except streaming)", () => {
    const caps: ModelCapabilities = {
      vision: false,
      tool_use: false,
      thinking: false,
      json_mode: false,
      prompt_caching: false,
      streaming: true,
    };
    expect(caps.vision).toBe(false);
    expect(caps.tool_use).toBe(false);
    expect(caps.thinking).toBe(false);
    expect(caps.json_mode).toBe(false);
    expect(caps.prompt_caching).toBe(false);
    expect(caps.streaming).toBe(true);
  });
});

describe("ModelDescriptor", () => {
  it("should allow basic construction", () => {
    const descriptor: ModelDescriptor = {
      id: "gpt-4o",
      providerId: "openai",
      label: "GPT-4o",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      capabilities: {
        vision: true,
        tool_use: true,
        thinking: false,
        json_mode: true,
        prompt_caching: false,
        streaming: true,
      },
      api: "openai-completions",
    };
    expect(descriptor.id).toBe("gpt-4o");
    expect(descriptor.providerId).toBe("openai");
    expect(descriptor.label).toBe("GPT-4o");
    expect(descriptor.contextWindow).toBe(128000);
    expect(descriptor.maxOutputTokens).toBe(4096);
    expect(descriptor.api).toBe("openai-completions");
    expect(descriptor.capabilities.vision).toBe(true);
    expect(descriptor.pricing).toBeUndefined();
  });

  it("should allow construction with reasoningLevels and pricing", () => {
    const descriptor: ModelDescriptor = {
      id: "claude-sonnet-4-20250514",
      providerId: "anthropic",
      label: "Claude Sonnet 4",
      contextWindow: 200000,
      maxOutputTokens: 8192,
      capabilities: {
        vision: true,
        tool_use: true,
        thinking: true,
        json_mode: true,
        prompt_caching: true,
        streaming: true,
      },
      api: "anthropic-messages",
      pricing: { inputPer1k: 0.003, outputPer1k: 0.015 },
      reasoningLevels: ["off", "low", "medium", "high"],
    };
    expect(descriptor.id).toBe("claude-sonnet-4-20250514");
    expect(descriptor.pricing).toEqual({ inputPer1k: 0.003, outputPer1k: 0.015 });
    expect(descriptor.reasoningLevels).toEqual(["off", "low", "medium", "high"]);
    expect(descriptor.reasoningLevels).toHaveLength(4);
  });
});

describe("ReasoningConfig", () => {
  it("should allow off level", () => {
    const config: ReasoningConfig = { level: "off" };
    expect(config.level).toBe("off");
    expect(config.budgetTokens).toBeUndefined();
  });

  it("should allow high level with budgetTokens", () => {
    const config: ReasoningConfig = { level: "high", budgetTokens: 8000 };
    expect(config.level).toBe("high");
    expect(config.budgetTokens).toBe(8000);
  });
});

describe("ReasoningLevel", () => {
  const validLevels: ReasoningLevel[] = ["off", "low", "medium", "high"];

  it("should have exactly 4 valid values", () => {
    expect(validLevels).toHaveLength(4);
  });

  validLevels.forEach((level) => {
    it(`should accept "${level}"`, () => {
      const config: ReasoningConfig = { level };
      expect(config.level).toBe(level);
    });
  });
});
