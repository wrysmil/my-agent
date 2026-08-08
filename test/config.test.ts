import { describe, it, expect } from "vitest";
import {
  CoreAgentConfigSchema,
  AgentConfigSchema,
  MemoryConfigSchema,
  EvolutionConfigSchema,
  MetacognitionConfigSchema,
} from "../src/config/schema.js";
import { createConfig, loadConfig } from "../src/config/loader.js";

describe("配置加载器", () => {
  // ─── createConfig ─────────────────────────────
  describe("createConfig — 创建配置", () => {
    it("空参数生成全部默认值", () => {
      const config = createConfig();

      // Agent 默认值
      expect(config.agent.defaultModel).toBe("claude-opus-4-8");
      expect(config.agent.defaultProvider).toBe("anthropic");
      expect(config.agent.maxRetries).toBe(3);
      expect(config.agent.maxToolLoops).toBe(100);
      expect(config.agent.toolIdleTimeoutMs).toBe(1_800_000);
      expect(config.agent.thinkingLevel).toBe("off");

      // Memory 默认值
      expect(config.memory.enabled).toBe(true);
      expect(config.memory.provider).toBe("auto");
      expect(config.memory.maxResults).toBe(10);
      expect(config.memory.minScore).toBe(0.3);
      expect(config.memory.fts.enabled).toBe(true);
      expect(config.memory.vector.enabled).toBe(true);
      expect(config.memory.cache.enabled).toBe(true);

      // Evolution 默认值
      expect(config.evolution.enabled).toBe(true);
      expect(config.evolution.maxSkills).toBe(200);
    });

    it("部分覆盖保留其余默认值", () => {
      const config = createConfig({
        agent: { maxRetries: 5, maxToolLoops: 50 },
      });

      expect(config.agent.maxRetries).toBe(5);
      expect(config.agent.maxToolLoops).toBe(50);
      // 未覆盖字段保留默认
      expect(config.agent.defaultModel).toBe("claude-opus-4-8");
      expect(config.agent.thinkingLevel).toBe("off");
    });

    it("覆盖 systemPrompt", () => {
      const config = createConfig({
        agent: { systemPrompt: "You are a helpful assistant." },
      });
      expect(config.agent.systemPrompt).toBe("You are a helpful assistant.");
    });

    it("覆盖 thinkingLevel 为 high", () => {
      const config = createConfig({ agent: { thinkingLevel: "high" } });
      expect(config.agent.thinkingLevel).toBe("high");
    });

    it("配置 Provider 凭证", () => {
      const config = createConfig({
        models: {
          providers: {
            anthropic: {
              apiKey: "sk-ant-test",
              baseUrl: "https://custom.api",
              auth: "api-key",
            },
          },
        },
      });

      expect(config.models.providers.anthropic).toBeDefined();
      expect(config.models.providers.anthropic.apiKey).toBe("sk-ant-test");
      expect(config.models.providers.anthropic.baseUrl).toBe("https://custom.api");
      expect(config.models.providers.anthropic.auth).toBe("api-key");
    });

    it("配置 Model 目录", () => {
      const config = createConfig({
        models: {
          catalog: {
            "claude-sonnet-4-5": {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              contextWindow: 200_000,
              maxOutputTokens: 8192,
              supportsTools: true,
              supportsVision: true,
              supportsStreaming: true,
            },
          },
        },
      });

      const model = config.models.catalog["claude-sonnet-4-5"];
      expect(model.provider).toBe("anthropic");
      expect(model.contextWindow).toBe(200_000);
      expect(model.supportsTools).toBe(true);
      expect(model.supportsVision).toBe(true);
    });

    it("覆盖 Memory 参数", () => {
      const config = createConfig({
        memory: {
          maxResults: 20,
          minScore: 0.5,
          provider: "openai",
          model: "text-embedding-3-small",
        },
      });

      expect(config.memory.maxResults).toBe(20);
      expect(config.memory.minScore).toBe(0.5);
      expect(config.memory.provider).toBe("openai");
      expect(config.memory.model).toBe("text-embedding-3-small");
      // 子对象默认值保留
      expect(config.memory.fts.enabled).toBe(true);
    });

    it("返回的类型包含顶层所有属性", () => {
      const config = createConfig();
      expect(typeof config.agent).toBe("object");
      expect(typeof config.models).toBe("object");
      expect(typeof config.models.providers).toBe("object");
      expect(typeof config.models.catalog).toBe("object");
      expect(typeof config.memory).toBe("object");
      expect(typeof config.evolution).toBe("object");
      expect(typeof config.evolution.metacognition).toBe("object");
    });
  });

  // ─── Schema 校验 ─────────────────────────────
  describe("Schema 校验", () => {
    it("AgentConfigSchema 合法值通过", () => {
      const result = AgentConfigSchema.safeParse({
        defaultModel: "gpt-4o",
        maxRetries: 5,
      });
      expect(result.success).toBe(true);
    });

    it("AgentConfigSchema — thinkingLevel 非法值被拒绝", () => {
      const result = AgentConfigSchema.safeParse({
        thinkingLevel: "extreme",
      });
      expect(result.success).toBe(false);
    });

    it("AgentConfigSchema — maxRetries 不能为负", () => {
      const result = AgentConfigSchema.safeParse({ maxRetries: -1 });
      expect(result.success).toBe(false);
    });

    it("MemoryConfigSchema — minScore 超出范围被拒绝", () => {
      const result = MemoryConfigSchema.safeParse({ minScore: 1.5 });
      expect(result.success).toBe(false);
    });

    it("CoreAgentConfigSchema — 全空合法", () => {
      const result = CoreAgentConfigSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("CoreAgentConfigSchema — 完整嵌套合法", () => {
      const result = CoreAgentConfigSchema.safeParse({
        agent: { defaultModel: "claude-sonnet-4-5" },
        models: {
          catalog: {
            "claude-sonnet-4-5": {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
            },
          },
        },
        memory: { enabled: true },
        evolution: { enabled: false },
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── loadConfig ───────────────────────────────
  describe("loadConfig — 从文件加载", () => {
    it("无路径时自动加载项目根 config.json", async () => {
      const config = await loadConfig();
      // 项目根有 config.json → 应加载其内容而非 Zod 默认值
      expect(config.agent.defaultModel).toBe("deepseek-chat");
      expect(config.models.catalog["deepseek-chat"]).toBeDefined();
      expect(config.models.catalog["deepseek-reasoner"]).toBeDefined();
    });

    it("不存在的文件返回默认配置", async () => {
      const config = await loadConfig("/tmp/nonexistent-config.json");
      expect(config.agent.maxRetries).toBe(3);
    });
  });

  // ─── 类型覆盖 ─────────────────────────────────
  describe("类型导出", () => {
    it("z.infer 生成的类型可正常使用", () => {
      const config = createConfig({
        agent: { maxRetries: 10 },
        memory: { maxResults: 15 },
        evolution: { maxSkills: 100 },
      });

      // 验证 AgentConfig 类型字段
      const agent = config.agent;
      expect(agent.maxRetries).toBe(10);
      expect(agent.defaultModel).toBeTypeOf("string");

      // 验证 EvolutionConfig 类型字段
      const evolution = config.evolution;
      expect(evolution.maxSkills).toBe(100);
      expect(evolution.enabled).toBeTypeOf("boolean");

      // 验证 MetacognitionConfig 类型字段
      const meta = evolution.metacognition;
      expect(meta.reflectThreshold).toBe(0.7);
      expect(meta.enabled).toBeTypeOf("boolean");
    });
  });
});
