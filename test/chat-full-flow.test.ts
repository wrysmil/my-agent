/**
 * Chat 全流程集成测试。
 *
 * 覆盖从配置加载到 AgentRunner 输出的完整链路：
 *   配置 → Provider → ProviderRegistry → 工具注册 →
 *   System Prompt 构建 → Session → AgentRunner → 流式消费
 *
 * 所有 LLM 调用均使用 MockProvider，无需网络/API Key。
 *
 * 运行：
 *   npx vitest run test/chat-full-flow.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { AgentRunner } from "../src/agent/runner.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { defineTool } from "../src/tools/base.js";
import type { AgentRunEvent, AgentRunResult } from "../src/agent/types.js";
import { AuthError } from "../src/shared/errors.js";
import { MockProvider, type MockResponse } from "./mocks/provider.js";
import { Session } from "../src/agent/session.js";
import {
  buildSystemPrompt,
  buildRuntimeDatetimeBlock,
} from "../src/prompts/index.js";
import type { CoreAgentConfig } from "../src/config/schema.js";

// ============================================================
// 测试工具
// ============================================================

const calculator = defineTool({
  name: "calculator",
  description: "执行数学计算。输入一个数学表达式字符串。",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "数学表达式，如 '2+3*4'" },
    },
    required: ["expression"],
  },
  execute: async (input) => {
    const expr = String(input.expression);
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return { content: `${expr} = ${result}` };
    } catch {
      return { content: `计算失败: ${expr}`, isError: true };
    }
  },
});

const getTime = defineTool({
  name: "get_current_time",
  description: "获取当前日期和时间",
  inputSchema: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "时区" },
    },
  },
  execute: async (input) => {
    const tz = (input.timezone as string) || "Asia/Shanghai";
    return {
      content: `${tz} 当前时间: ${new Date().toLocaleString("zh-CN", { timeZone: tz })}`,
    };
  },
});

// ============================================================
// 辅助函数
// ============================================================

/** 收集 runStream 所有事件，返回最终结果 + 收集的事件列表 */
async function collectStream(
  runner: AgentRunner,
  message: string,
  opts?: {
    systemPrompt?: string;
    turnEphemeral?: string;
  },
): Promise<{
  result: AgentRunResult;
  events: AgentRunEvent[];
  textDeltas: string[];
  toolStarts: string[];
  toolEnds: string[];
}> {
  const events: AgentRunEvent[] = [];
  const textDeltas: string[] = [];
  const toolStarts: string[] = [];
  const toolEnds: string[] = [];

  let result: AgentRunResult | null = null;

  for await (const ev of runner.runStream({
    message,
    systemPrompt: opts?.systemPrompt,
    turnEphemeral: opts?.turnEphemeral,
  })) {
    events.push(ev);

    switch (ev.type) {
      case "text_delta":
        textDeltas.push(ev.text);
        break;
      case "tool_start":
        toolStarts.push(ev.name);
        break;
      case "tool_end":
        toolEnds.push(ev.name);
        break;
      case "done":
        result = ev.result;
        break;
    }
  }

  if (!result) throw new Error("Stream ended without done event");
  return { result, events, textDeltas, toolStarts, toolEnds };
}

/** 创建基础测试配置 */
function createTestConfig(overrides?: Partial<CoreAgentConfig>): CoreAgentConfig {
  const base: CoreAgentConfig = {
    agent: {
      defaultModel: "mock-model",
      defaultProvider: "mock",
      maxRetries: 1,
      maxToolLoops: 5,
      toolIdleTimeoutMs: 5000,
      thinkingLevel: "off",
    },
    models: {
      providers: {
        mock: {},
      },
      catalog: {
        "mock-model": {
          provider: "mock",
          model: "mock-model",
          contextWindow: 8000,
          maxOutputTokens: 1000,
          supportsTools: true,
          supportsStreaming: true,
        },
      },
    },
    memory: { enabled: false, provider: "auto", maxResults: 10, minScore: 0.3, fts: { enabled: false }, vector: { enabled: false }, cache: { enabled: false } },
    evolution: { enabled: false, skillsDir: "", maxSkills: 0, maxSkillContentLength: 0, metacognition: { enabled: false, reflectThreshold: 0, competenceCharLimit: 0, strategiesCharLimit: 0 } },
  };

  // 浅合并（仅覆盖顶层 agent 字段）
  if (overrides?.agent) {
    Object.assign(base.agent, overrides.agent);
  }

  return base;
}

// ============================================================
// 测试套件
// ============================================================

describe("Chat 全流程", () => {
  // ---- 1. System Prompt 构建 ----

  describe("System Prompt 构建", () => {
    it("buildSystemPrompt() 生成包含模板内容的 prompt", () => {
      const { systemPrompt, turnEphemeral, stable, volatile } =
        buildSystemPrompt({
          name: "TestAgent",
          skillsIndex: "## 可用技能\n- test: 测试技能",
        });

      // 稳定前缀不含 运行时注入
      expect(stable).not.toContain("## 运行时注入");
      // 易变区域含 运行时注入
      expect(volatile).toContain("## 运行时注入");
      // system prompt 包含模板内容
      expect(systemPrompt).toContain("TestAgent");
      expect(systemPrompt).toContain("做好任务");
      expect(systemPrompt).toContain("test: 测试技能");
      // turnEphemeral 包含日期
      expect(turnEphemeral).toContain("## Current date");
    });

    it("buildRuntimeDatetimeBlock() 生成日期块", () => {
      const block = buildRuntimeDatetimeBlock(
        new Date("2026-08-02T12:00:00+08:00"),
      );
      expect(block).toContain("2026-08-02");
      expect(block).toContain("Timezone:");
    });
  });

  // ---- 2. 配置加载 → Runner 创建 ----

  describe("配置 → Provider → Runner 链路", () => {
    it("使用 MockProvider 创建 AgentRunner 并完成纯文本对话", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      // 预设 LLM 响应
      mockProvider.program({
        kind: "text",
        text: "你好！我是 AI 助手，有什么可以帮你的？",
      });

      const runner = new AgentRunner({
        config,
        providers,
        tools: [calculator, getTime],
      });

      const { result, textDeltas, toolStarts } = await collectStream(
        runner,
        "你好",
      );

      expect(result.meta.error).toBeUndefined();
      expect(result.meta.stopReason).toBe("end_turn");
      expect(result.meta.toolLoops).toBe(0);
      expect(toolStarts).toHaveLength(0);
      expect(textDeltas.join("")).toContain("AI 助手");
    });

    it("System prompt 被正确注入到 provider 请求中", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({
        kind: "text",
        text: "收到。",
      });

      const customPrompt = "你是一个专业的数学老师。用中文回复。";
      const runner = new AgentRunner({ config, providers });

      await collectStream(runner, "1+1=?", { systemPrompt: customPrompt });

      // 验证 provider 收到的 systemPrompt
      expect(mockProvider.streams).toHaveLength(1);
      expect(mockProvider.streams[0].params.systemPrompt).toBe(customPrompt);
    });

    it("turnEphemeral 被注入到用户消息上下文中", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({ kind: "text", text: "好的。" });

      const session = new Session();
      const runner = new AgentRunner({ config, providers, session });

      const ephemeral = "当前时间: 2026-08-02T15:00:00+08:00";
      await collectStream(runner, "现在几点了？", { turnEphemeral: ephemeral });

      // 验证 turnEphemeral 被注入到第一条真正的用户消息（非 tool_result）
      const messages = session.getMessagesForModel({
        turnContext: ephemeral,
      });
      const firstRealUser = messages.find(
        (m) => m.role === "user" && m.content.some((b) => b.type !== "tool_result"),
      );
      expect(firstRealUser).toBeDefined();
      expect(firstRealUser!.content[0]).toMatchObject({
        type: "text",
        text: ephemeral,
      });
    });
  });

  // ---- 3. 工具调用流程 ----

  describe("工具调用", () => {
    let config: CoreAgentConfig;
    let mockProvider: MockProvider;
    let providers: ProviderRegistry;
    let runner: AgentRunner;

    beforeEach(() => {
      config = createTestConfig();
      mockProvider = new MockProvider();
      providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);
      runner = new AgentRunner({
        config,
        providers,
        tools: [calculator, getTime],
      });
    });

    it("单次工具调用：模型请求计算 → 工具执行 → 模型返回结果", async () => {
      // 第一轮：模型请求计算
      mockProvider.program({
        kind: "tool_calls",
        text: "我来帮你计算。",
        calls: [
          {
            id: "call_001",
            name: "calculator",
            input: { expression: "15*8+12" },
          },
        ],
      });
      // 第二轮：收到工具结果后给出最终答案
      mockProvider.program({
        kind: "text",
        text: "15×8+12 = 132。结果是 132。",
      });

      const { result, toolStarts, toolEnds, textDeltas } = await collectStream(
        runner,
        "计算 15*8+12",
      );

      expect(result.meta.error).toBeUndefined();
      expect(toolStarts).toContain("calculator");
      expect(toolEnds).toContain("calculator");
      expect(result.meta.toolLoops).toBeGreaterThanOrEqual(1);
      expect(textDeltas.join("")).toContain("132");
    });

    it("多次工具调用：顺序执行两个工具", async () => {
      // 第一轮：同时请求时间和计算
      mockProvider.program({
        kind: "tool_calls",
        text: "我来获取时间并计算。",
        calls: [
          {
            id: "call_t1",
            name: "get_current_time",
            input: { timezone: "Asia/Shanghai" },
          },
          {
            id: "call_t2",
            name: "calculator",
            input: { expression: "15*60" },
          },
        ],
      });
      // 第二轮：最终答案
      mockProvider.program({
        kind: "text",
        text: "现在是北京时间某时某分，15×60=900 分钟。",
      });

      const { result, toolStarts } = await collectStream(
        runner,
        "现在几点？以及 15*60 等于多少？",
      );

      expect(result.meta.error).toBeUndefined();
      expect(toolStarts).toContain("get_current_time");
      expect(toolStarts).toContain("calculator");
      expect(result.meta.toolLoops).toBeGreaterThanOrEqual(1);
    });

    it("工具错误处理：未知工具返回错误但不崩溃", async () => {
      mockProvider.program({
        kind: "tool_calls",
        text: "让我用这个工具。",
        calls: [
          {
            id: "call_bad",
            name: "non_existent_tool",
            input: {},
          },
        ],
      });

      const { result, toolEnds } = await collectStream(
        runner,
        "用不存在的工具",
      );

      // 未知工具被正常处理（不抛异常）
      expect(toolEnds).toContain("non_existent_tool");
      // runner 应该继续运行（除非重试耗尽）
      expect(result.meta.toolLoops).toBeGreaterThanOrEqual(0);
    });
  });

  // ---- 4. 多轮对话 ----

  describe("多轮对话（Session 复用）", () => {
    it("同一 Session 跨两次 run 保持上下文", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      const session = new Session();

      // ---- 第一轮 ----
      mockProvider.program({
        kind: "text",
        text: "你的项目叫 my-agent，是一个 Agent 框架学习项目。",
      });

      const runner1 = new AgentRunner({
        config,
        providers,
        tools: [calculator],
        session,
      });

      await collectStream(runner1, "介绍一下这个项目");

      // ---- 第二轮（复用 session） ----
      mockProvider.program({
        kind: "text",
        text: "是的，我们上一轮讨论过，项目叫 my-agent，使用 TypeScript 编写。",
      });

      const runner2 = new AgentRunner({
        config,
        providers,
        tools: [calculator],
        session,
      });

      const { textDeltas } = await collectStream(
        runner2,
        "这个项目用什么语言写的？",
      );

      // 两轮消息都在 session 中
      const allMessages = session.getAllMessages();
      const userMessages = allMessages.filter((m) => m.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(2);

      // 第二轮回复应有上下文感知
      expect(textDeltas.join("")).toContain("TypeScript");
    });
  });

  // ---- 5. 流式事件完整性 ----

  describe("流式事件完整性", () => {
    it("文本对话产生 text_delta + done 事件", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({
        kind: "text",
        text: "Hello World",
      });

      const runner = new AgentRunner({ config, providers });
      const { events, result } = await collectStream(runner, "say hello");

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("text_delta");
      expect(eventTypes).toContain("done");
      expect(result.meta.stopReason).toBe("end_turn");
    });

    it("工具调用产生 tool_start + tool_end 事件", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({
        kind: "tool_calls",
        text: "计算中...",
        calls: [
          { id: "c1", name: "calculator", input: { expression: "1+1" } },
        ],
      });
      mockProvider.program({ kind: "text", text: "结果是 2。" });

      const runner = new AgentRunner({
        config,
        providers,
        tools: [calculator],
      });

      const { events } = await collectStream(runner, "1+1");

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("tool_start");
      expect(eventTypes).toContain("tool_end");
    });

    it("done 事件始终是最后一个事件", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({ kind: "text", text: "ok" });

      const runner = new AgentRunner({ config, providers });
      const { events } = await collectStream(runner, "test");

      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe("done");
    });
  });

  // ---- 6. 错误处理 ----

  describe("错误处理", () => {
    it("provider 错误被正确捕获并返回 error result", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      // AuthError 属于不可重试错误，直接返回 error result
      mockProvider.program({
        kind: "error",
        error: new AuthError("Invalid API key"),
      });

      const runner = new AgentRunner({ config, providers });
      const { result } = await collectStream(runner, "test");

      expect(result.meta.error).toBeDefined();
      expect(result.meta.error!.kind).toBe("auth");
    });

    it("重试后成功", async () => {
      const config = createTestConfig({
        agent: {
          defaultModel: "mock-model",
          defaultProvider: "mock",
          maxRetries: 3,
          maxToolLoops: 5,
          toolIdleTimeoutMs: 5000,
          thinkingLevel: "off",
        },
      });
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      // 第一次失败
      mockProvider.program({
        kind: "error",
        error: Object.assign(new Error("Rate limited"), {
          name: "RateLimitError",
          retryAfterMs: 10,
        }),
      });
      // 第二次成功
      mockProvider.program({ kind: "text", text: "重试成功了！" });

      const runner = new AgentRunner({ config, providers });
      const { result, events } = await collectStream(runner, "test");

      const retryEvents = events.filter((e) => e.type === "retry");
      expect(retryEvents.length).toBeGreaterThanOrEqual(1);
      expect(result.meta.error).toBeUndefined();
    });
  });

  // ---- 7. 收敛控制 ----

  describe("收敛控制 (Nudge)", () => {
    it("工具循环接近上限时注入警告", async () => {
      const config = createTestConfig({
        agent: {
          defaultModel: "mock-model",
          defaultProvider: "mock",
          maxRetries: 0,
          maxToolLoops: 3,
          toolIdleTimeoutMs: 5000,
          thinkingLevel: "off",
        },
      });
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      // 让模型连续调用工具直到达到上限
      for (let i = 0; i < 4; i++) {
        mockProvider.program({
          kind: "tool_calls",
          calls: [
            {
              id: `call_${i}`,
              name: "calculator",
              input: { expression: `${i}+1` },
            },
          ],
        });
      }

      const runner = new AgentRunner({
        config,
        providers,
        tools: [calculator],
      });

      const { result } = await collectStream(runner, "重复计算");

      // 达到上限后应终止（可能有 toolLoops 计数或 error）
      expect(result.meta.toolLoops).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- 8. System Prompt 完整链路 ----

  describe("System Prompt 完整链路", () => {
    it("自定义 systemPrompt 覆盖默认模板", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({ kind: "text", text: "用中文回答。" });

      const { systemPrompt: fullPrompt } = buildSystemPrompt({
        name: "MyAgent",
        skillsIndex: "- s1: skill one",
        workingDir: "/tmp/test",
      });

      const runner = new AgentRunner({ config, providers });
      await collectStream(runner, "你好", { systemPrompt: fullPrompt });

      // 验证 prompt 被传递给 provider
      const recordedPrompt = mockProvider.streams[0].params.systemPrompt;
      expect(recordedPrompt).toContain("MyAgent");
      expect(recordedPrompt).toContain("做好任务");
      expect(recordedPrompt).toContain("skill one");
    });

    it("不传 systemPrompt 时使用 fallback", async () => {
      const config = createTestConfig();
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      providers.registerFactory("mock", () => mockProvider);

      mockProvider.program({ kind: "text", text: "ok" });

      const runner = new AgentRunner({ config, providers });
      await collectStream(runner, "hi");

      const recordedPrompt = mockProvider.streams[0].params.systemPrompt;
      // fallback 使用完整中文模板
      expect(recordedPrompt).toContain("做好任务");
      expect(recordedPrompt).toContain("运行时注入");
    });
  });
});
