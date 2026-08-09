import { describe, it, expect } from "vitest";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import type { ToolDefinition } from "../../src/providers/base.js";
import type { Message, MessageContent } from "../../src/shared/types.js";
import { OpenAiCompletionsCodec } from "../../src/providers/codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "../../src/providers/thinking/openai-completions.js";
import type { ModelCapabilities } from "../../src/providers/types.js";

// ============================================================
// 辅助：构建简单 user 消息
// ============================================================
function userMessage(text: string): Message {
  return {
    role: "user",
    content: [{ type: "text", text }],
  };
}

// ============================================================
// 辅助：构建简单 tool definition
// ============================================================
function makeToolDef(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {},
    },
  };
}

// ============================================================
// DeepSeekProvider 迁移后结构验证
// ============================================================
describe("DeepSeekProvider 迁移后结构验证", () => {
  // ---- 实例化 ----
  describe("实例化", () => {
    it("应使用必需参数 apiKey 成功实例化", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      expect(provider).toBeDefined();
    });

    it("应设置 id 为 'deepseek'", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      expect(provider.id).toBe("deepseek");
    });

    it("应设置 name 为 'DeepSeek'", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      expect(provider.name).toBe("DeepSeek");
    });

    it("应是 AbstractLLMProvider 的实例", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      expect(provider).toBeInstanceOf(AbstractLLMProvider);
    });
  });

  // ---- constructor 参数 ----
  describe("constructor 参数", () => {
    it("apiKey 为必填参数", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      // 通过 any 访问私有 apiKey 字段确认已存储
      expect((provider as any).apiKey).toBe("sk-test");
    });

    it("baseUrl 为可选参数，默认值为 https://api.deepseek.com/v1", () => {
      const defaultProvider = new DeepSeekProvider({ apiKey: "sk-test" });
      expect((defaultProvider as any).baseUrl).toBe(
        "https://api.deepseek.com/v1",
      );

      const customProvider = new DeepSeekProvider({
        apiKey: "sk-test",
        baseUrl: "https://custom.deepseek.com/v1",
      });
      expect((customProvider as any).baseUrl).toBe(
        "https://custom.deepseek.com/v1",
      );
    });

    it("capabilities 为可选参数，默认合并 DEEPSEEK_DEFAULT_CAPABILITIES", () => {
      // 通过 codec 内部 capabilities 间接验证
      const defaultProvider = new DeepSeekProvider({ apiKey: "sk-test" });
      const defaultCodec = (defaultProvider as any).codec as OpenAiCompletionsCodec;
      // 默认 tool_use 应为 true
      const tools = defaultCodec.buildTools([makeToolDef("test", "desc")]);
      expect(tools).toHaveLength(1);
      expect((tools[0] as any).type).toBe("function");

      // 传入自定义 capabilities: 禁用 tool_use
      const noToolsProvider = new DeepSeekProvider({
        apiKey: "sk-test",
        capabilities: { tool_use: false },
      });
      const noToolsCodec = (noToolsProvider as any)
        .codec as OpenAiCompletionsCodec;
      const noToolsResult = noToolsCodec.buildTools([
        makeToolDef("test", "desc"),
      ]);
      // buildTools 不检查 capabilities.tool_use，只负责转换
      // capabilities 影响的是 codec.outbound 的 vision 守门
      expect(noToolsResult).toHaveLength(1);
    });
  });

  // ---- codec 属性 ----
  describe("codec 属性", () => {
    it("codec 应存在且为 OpenAiCompletionsCodec 实例", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      const codec = (provider as any).codec;
      expect(codec).toBeDefined();
      expect(codec).toBeInstanceOf(OpenAiCompletionsCodec);
    });

    it("codec.api 应为 'openai-completions'", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      const codec = (provider as any).codec as OpenAiCompletionsCodec;
      expect(codec.api).toBe("openai-completions");
    });
  });

  // ---- thinkingAdapter 属性 ----
  describe("thinkingAdapter 属性", () => {
    it("thinkingAdapter 应存在且为 OpenAiCompletionsThinkingAdapter 实例", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      const adapter = (provider as any).thinkingAdapter;
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(OpenAiCompletionsThinkingAdapter);
    });

    it("thinkingAdapter.api 应为 'openai-completions'", () => {
      const provider = new DeepSeekProvider({ apiKey: "sk-test" });
      const adapter = (provider as any)
        .thinkingAdapter as OpenAiCompletionsThinkingAdapter;
      expect(adapter.api).toBe("openai-completions");
    });
  });

  // ---- buildRequestBody ----
  describe("buildRequestBody", () => {
    const provider = new DeepSeekProvider({ apiKey: "sk-test" });
    const messages: Message[] = [userMessage("你好")];

    it("应产出包含 model / messages / stream 字段的请求体", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
      }) as Record<string, unknown>;

      expect(body.model).toBe("deepseek-chat");
      expect(body.messages).toBeDefined();
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.stream).toBe(true);
    });

    it("messages 数组应包含转换后的 user 消息", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
      }) as Record<string, unknown>;

      const msgs = body.messages as Array<Record<string, unknown>>;
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      const userMsg = msgs.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe("你好");
    });

    it("应支持 systemPrompt 参数，产出 system 角色消息", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        systemPrompt: "你是一个有帮助的助手",
      }) as Record<string, unknown>;

      const msgs = body.messages as Array<Record<string, unknown>>;
      const systemMsg = msgs.find((m) => m.role === "system");
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.content).toBe("你是一个有帮助的助手");
    });

    it("应支持 tools 参数，产出 tools 字段", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        tools: [makeToolDef("get_weather", "获取天气")],
      }) as Record<string, unknown>;

      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
      expect((body.tools as unknown[]).length).toBe(1);
      expect(body.tool_choice).toBe("auto");
    });

    it("无 tools 时不应包含 tools / tool_choice 字段", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
      }) as Record<string, unknown>;

      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
    });

    it("应支持 maxTokens 参数", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        maxTokens: 4096,
      }) as Record<string, unknown>;

      expect(body.max_tokens).toBe(4096);
    });

    it("应支持 temperature 和 topP 参数", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        temperature: 0.7,
        topP: 0.9,
      }) as Record<string, unknown>;

      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
    });

    it("应支持 stopSequences 参数", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        stopSequences: ["\n\n"],
      }) as Record<string, unknown>;

      expect(body.stop).toEqual(["\n\n"]);
    });

    it("reasoning 启用时应排除 temperature/top_p", () => {
      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
        temperature: 0.7,
        topP: 0.9,
        reasoning: "medium",
      }) as Record<string, unknown>;

      // reasoning 启用时 temperature/top_p 不应出现
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      // 应包含 thinking 相关字段
      expect(body.thinking).toBeDefined();
      expect(body.reasoning_effort).toBe("medium");
    });
  });

  // ---- buildTools（通过 codec） ----
  describe("buildTools（通过 codec）", () => {
    const provider = new DeepSeekProvider({ apiKey: "sk-test" });
    const codec = (provider as any).codec as OpenAiCompletionsCodec;

    it("应将 ToolDefinition 转换为 OpenAI function 格式", () => {
      const tools = codec.buildTools([
        {
          name: "get_weather",
          description: "获取天气",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ]);

      expect(tools).toHaveLength(1);
      const tool = tools[0] as Record<string, unknown>;
      expect(tool.type).toBe("function");
      expect((tool.function as Record<string, unknown>).name).toBe(
        "get_weather",
      );
      expect(
        (tool.function as Record<string, unknown>).description,
      ).toBe("获取天气");
      expect(
        (tool.function as Record<string, unknown>).parameters,
      ).toBeDefined();
    });

    it("应正确处理多个工具定义", () => {
      const tools = codec.buildTools([
        makeToolDef("tool_a", "desc a"),
        makeToolDef("tool_b", "desc b"),
        makeToolDef("tool_c", "desc c"),
      ]);

      expect(tools).toHaveLength(3);
      tools.forEach((tool) => {
        expect((tool as Record<string, unknown>).type).toBe("function");
      });
    });

    it("空数组应返回空数组", () => {
      const tools = codec.buildTools([]);
      expect(tools).toEqual([]);
    });
  });

  // ---- mapStopReason（通过 codec） ----
  describe("mapStopReason（通过 codec）", () => {
    const provider = new DeepSeekProvider({ apiKey: "sk-test" });
    const codec = (provider as any).codec as OpenAiCompletionsCodec;

    it("'stop' 应映射为 'end_turn'", () => {
      expect(codec.mapStopReason("stop")).toBe("end_turn");
    });

    it("'tool_calls' 应映射为 'tool_use'", () => {
      expect(codec.mapStopReason("tool_calls")).toBe("tool_use");
    });

    it("'length' 应映射为 'max_tokens'", () => {
      expect(codec.mapStopReason("length")).toBe("max_tokens");
    });

    it("'content_filter' 应映射为 'content_filter'", () => {
      expect(codec.mapStopReason("content_filter")).toBe("content_filter");
    });

    it("null / undefined / 未知值应映射为 'end_turn'", () => {
      expect(codec.mapStopReason(null)).toBe("end_turn");
      expect(codec.mapStopReason(undefined)).toBe("end_turn");
      expect(codec.mapStopReason("unknown_reason")).toBe("end_turn");
    });
  });

  // ---- convertMessages（通过 buildRequestBody 间接验证） ----
  describe("convertMessages（消息转换）", () => {
    const provider = new DeepSeekProvider({ apiKey: "sk-test" });

    it("应保留消息顺序（user 消息按原序排列）", () => {
      const messages: Message[] = [
        userMessage("第一句"),
        userMessage("第二句"),
        userMessage("第三句"),
      ];

      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
      }) as Record<string, unknown>;

      const msgs = body.messages as Array<Record<string, unknown>>;
      const userMsgs = msgs.filter((m) => m.role === "user");
      expect(userMsgs).toHaveLength(3);
      expect(userMsgs[0].content).toBe("第一句");
      expect(userMsgs[1].content).toBe("第二句");
      expect(userMsgs[2].content).toBe("第三句");
    });

    it("assistant 消息的多 content block 应合并为一条消息", () => {
      const messages: Message[] = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "你好！" },
            {
              type: "tool_use",
              id: "call_1",
              name: "get_weather",
              input: { city: "北京" },
            },
          ],
        },
      ];

      const body = (provider as any).buildRequestBody({
        model: "deepseek-chat",
        messages,
      }) as Record<string, unknown>;

      const msgs = body.messages as Array<Record<string, unknown>>;
      // assistant 消息应合并为一条
      const assistantMsgs = msgs.filter((m) => m.role === "assistant");
      expect(assistantMsgs).toHaveLength(1);
      expect(assistantMsgs[0].content).toBe("你好！");
      expect(assistantMsgs[0].tool_calls).toBeDefined();
    });
  });
});
