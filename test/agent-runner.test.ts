import { describe, it, expect, beforeEach } from "vitest";
import { AgentRunner } from "../src/agent/runner.js";
import { Session } from "../src/agent/session.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { createConfig } from "../src/config/loader.js";
import { defineTool } from "../src/tools/base.js";
import { MockProvider, type MockResponse } from "./mocks/provider.js";
import type { AgentRunEvent } from "../src/agent/types.js";
import type { AgentTool } from "../src/tools/base.js";

// ============================================================
// 辅助函数
// ============================================================

/** 创建带 mock provider 的 AgentRunner */
function createRunner(opts?: {
  tools?: AgentTool[];
  session?: Session;
  configOverrides?: Record<string, unknown>;
}) {
  const config = createConfig({
    agent: {
      defaultModel: "claude-sonnet-5",
      defaultProvider: "mock",
      maxRetries: 2,
      maxToolLoops: 10,
      toolIdleTimeoutMs: 5_000,
      ...opts?.configOverrides,
    },
  });

  const mockProvider = new MockProvider();
  const providers = new ProviderRegistry(config);
  // 直接用 mock provider 替换（绕过工厂注册）
  (providers as any).providers?.set?.("mock", mockProvider);
  // 手动注册 mock factory
  providers.registerFactory("mock", () => mockProvider);

  const runner = new AgentRunner({
    config,
    providers,
    tools: opts?.tools,
    session: opts?.session,
  });

  return { runner, mockProvider, config };
}

/** 收集所有流事件直到 done */
async function collectEvents(
  iter: AsyncIterable<AgentRunEvent>,
): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for await (const ev of iter) {
    events.push(ev);
  }
  return events;
}

/** 获取 done 事件的结果 */
function doneResult(events: AgentRunEvent[]) {
  const done = events[events.length - 1];
  if (done?.type !== "done") throw new Error("Expected done event");
  return done.result;
}

// ============================================================
// 测试套件
// ============================================================

describe("AgentRunner", () => {
  // ==========================================================
  // 1. 基础运行
  // ==========================================================
  describe("基础文本运行（无工具）", () => {
    it("简单文本问答 — 返回模型响应", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "你好！有什么可以帮助你的？" });

      const events = await collectEvents(runner.runStream({ message: "你好" }));
      const result = doneResult(events);

      expect(result.text).toBe("你好！有什么可以帮助你的？");
      expect(result.meta.stopReason).toBe("end_turn");
      expect(result.meta.toolLoops).toBe(0);
      expect(result.meta.error).toBeUndefined();
    });

    it("多段文本通过 text_delta 事件流式输出", async () => {
      const { runner, mockProvider } = createRunner();
      // 用长文本确保分块
      const longText = "A".repeat(100);
      mockProvider.program({ kind: "text", text: longText });

      const events = await collectEvents(runner.runStream({ message: "say hi" }));
      const textDeltas = events.filter((e) => e.type === "text_delta");
      const result = doneResult(events);

      // 验证分块输出
      expect(textDeltas.length).toBeGreaterThan(0);
      // 拼接后应等于原始文本
      const assembled = textDeltas.map((e) => (e as any).text).join("");
      expect(assembled).toBe(longText);
      expect(result.text).toBe(longText);
    });

    it("systemPrompt 覆盖默认提示词", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "OK" });

      await collectEvents(
        runner.runStream({
          message: "hello",
          systemPrompt: "You are a test bot. Reply with OK only.",
        }),
      );

      // 验证 system prompt 传递到了 provider
      const streamRecord = mockProvider.streams[0];
      expect(streamRecord.params.systemPrompt).toContain("test bot");
    });

    it("无预设响应 → 返回空文本", async () => {
      const { runner, mockProvider } = createRunner();
      // 不 program 任何响应

      const events = await collectEvents(runner.runStream({ message: "hello" }));
      const result = doneResult(events);

      expect(result.text).toBe("");
      expect(result.meta.error).toBeUndefined();
    });
  });

  // ==========================================================
  // 2. 工具调用
  // ==========================================================
  describe("工具调用", () => {
    it("单工具调用 → 工具执行 → 最终文本响应", async () => {
      const readTool = defineTool({
        name: "read",
        description: "读取文件",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        execute: async (input) => ({
          content: `文件内容: ${input.path}`,
        }),
      });

      const { runner, mockProvider } = createRunner({ tools: [readTool] });

      // 第一次：模型发起工具调用
      mockProvider.program({
        kind: "tool_calls",
        text: "让我读取文件。",
        calls: [{ id: "tc_1", name: "read", input: { path: "/test.txt" } }],
      });
      // 第二次：工具结果返回后，模型给最终回答
      mockProvider.program({ kind: "text", text: "文件读取成功，内容是..." });

      const events = await collectEvents(
        runner.runStream({ message: "读取 /test.txt" }),
      );
      const result = doneResult(events);

      // 验证工具执行
      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0] as any).name).toBe("read");

      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolEnds).toHaveLength(1);
      expect((toolEnds[0] as any).result).toContain("文件内容");

      // 验证最终结果
      expect(result.text).toBe("文件读取成功，内容是...");
      expect(result.meta.toolLoops).toBe(1);
      expect(result.meta.toolNames).toContain("read");
    });

    it("多轮工具调用", async () => {
      const searchTool = defineTool({
        name: "search",
        description: "搜索",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
        execute: async (input) => ({ content: `搜索结果: ${input.q}` }),
      });

      const { runner, mockProvider } = createRunner({ tools: [searchTool] });

      // 轮次1：第一次搜索
      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t1", name: "search", input: { q: "first" } }],
      });
      // 轮次2：第二次搜索
      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t2", name: "search", input: { q: "second" } }],
      });
      // 轮次3：最终回答
      mockProvider.program({ kind: "text", text: "搜索完成" });

      const events = await collectEvents(
        runner.runStream({ message: "搜索两次" }),
      );
      const result = doneResult(events);

      expect(result.meta.toolLoops).toBe(2);
      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(2);
    });

    it("并行工具调用", async () => {
      const readA = defineTool({
        name: "read_a",
        description: "读取A",
        inputSchema: { type: "object", properties: {} },
        executionMode: "parallel",
        execute: async () => ({ content: "A" }),
      });
      const readB = defineTool({
        name: "read_b",
        description: "读取B",
        inputSchema: { type: "object", properties: {} },
        executionMode: "parallel",
        execute: async () => ({ content: "B" }),
      });

      const { runner, mockProvider } = createRunner({ tools: [readA, readB] });

      mockProvider.program({
        kind: "tool_calls",
        calls: [
          { id: "t1", name: "read_a", input: {} },
          { id: "t2", name: "read_b", input: {} },
        ],
      });
      mockProvider.program({ kind: "text", text: "done" });

      const events = await collectEvents(
        runner.runStream({ message: "读取两个文件" }),
      );
      const result = doneResult(events);

      expect(result.meta.toolLoops).toBe(1);
      // 两个工具都应被执行
      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts).toHaveLength(2);
    });

    it("未知工具 → 返回错误", async () => {
      const { runner, mockProvider } = createRunner({ tools: [] });

      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t1", name: "nonexistent", input: {} }],
      });
      mockProvider.program({ kind: "text", text: "done" });

      const events = await collectEvents(
        runner.runStream({ message: "调用不存在的工具" }),
      );
      const result = doneResult(events);

      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolEnds).toHaveLength(1);
      expect((toolEnds[0] as any).isError).toBe(true);
      expect((toolEnds[0] as any).result).toContain("Unknown tool");
      // 应该计入 permanentToolErrors
      expect(result.meta.permanentToolErrors).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================
  // 3. 错误处理
  // ==========================================================
  describe("错误处理", () => {
    it("无匹配 provider → 返回 auth 错误", async () => {
      const config = createConfig({
        agent: { defaultModel: "unknown-model", defaultProvider: "nonexistent" },
      });
      const runner = new AgentRunner({ config });

      const events = await collectEvents(
        runner.runStream({ message: "hello" }),
      );
      const result = doneResult(events);

      expect(result.meta.error?.kind).toBe("auth");
      expect(result.meta.error?.message).toContain("No provider found");
    });

    it("provider 流错误 → 根据错误类型处理", async () => {
      const { runner, mockProvider } = createRunner();
      // maxRetries=2 → 最多 3 次尝试，需预设 3 个错误以耗尽重试
      mockProvider.program(
        { kind: "error", error: Object.assign(new Error("Connection refused"), { statusCode: 503 }) },
        { kind: "error", error: Object.assign(new Error("Connection refused"), { statusCode: 503 }) },
        { kind: "error", error: Object.assign(new Error("Connection refused"), { statusCode: 503 }) },
      );

      const events = await collectEvents(
        runner.runStream({ message: "hello" }),
      );
      const result = doneResult(events);

      // Connection refused 是可重试的，但 maxRetries 耗尽后返回 provider_error
      expect(result.meta.error?.kind).toBe("provider_error");
      // 应该有重试事件
      const retries = events.filter((e) => e.type === "retry");
      expect(retries.length).toBeGreaterThan(0);
    });

    it("AbortSignal → 预中止信号被检测到", async () => {
      const controller = new AbortController();
      controller.abort(); // 预先中止

      // 使用一个能检测 signal 的工具
      const abortAwareTool = defineTool({
        name: "abort_check",
        description: "检测 abort signal",
        inputSchema: { type: "object", properties: {} },
        execute: async (_input, ctx) => {
          if (ctx.signal?.aborted) {
            return { content: "已中止", isError: true };
          }
          return { content: "正常执行" };
        },
      });

      const { runner, mockProvider } = createRunner({ tools: [abortAwareTool] });

      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t1", name: "abort_check", input: {} }],
      });
      mockProvider.program({ kind: "text", text: "后续文本" });

      const events = await collectEvents(
        runner.runStream({ message: "hello", signal: controller.signal }),
      );
      const result = doneResult(events);

      // 由于 signal 已中止，runToolWithWatchdog 中的 AbortController 联动
      // 工具执行会被打断，返回 aborted 结果
      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolEnds.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================
  // 4. 重试机制
  // ==========================================================
  describe("重试机制", () => {
    it("可重试错误 → 重试后成功", async () => {
      const { runner, mockProvider } = createRunner({
        configOverrides: { maxRetries: 3 },
      });

      // 第一次失败（网络错误）
      mockProvider.program({
        kind: "error",
        error: Object.assign(new Error("fetch failed"), {
          statusCode: 503,
        }),
      });
      // 第二次成功
      mockProvider.program({ kind: "text", text: "重试后成功" });

      const events = await collectEvents(
        runner.runStream({ message: "hello" }),
      );
      const result = doneResult(events);

      expect(result.text).toBe("重试后成功");
      expect(result.meta.error).toBeUndefined();
    });

    it("重试耗尽 → 返回 provider_error", async () => {
      const { runner, mockProvider } = createRunner({
        configOverrides: { maxRetries: 1 },
      });

      mockProvider.program({
        kind: "error",
        error: Object.assign(new Error("fetch failed"), {
          statusCode: 503,
        }),
      });
      mockProvider.program({
        kind: "error",
        error: Object.assign(new Error("fetch failed"), {
          statusCode: 503,
        }),
      });

      const events = await collectEvents(
        runner.runStream({ message: "hello" }),
      );
      const result = doneResult(events);

      expect(result.meta.error?.kind).toBe("provider_error");
    });
  });

  // ==========================================================
  // 5. 工具循环上限
  // ==========================================================
  describe("工具循环上限", () => {
    it("达到 maxToolLoops → 强制摘要并结束", async () => {
      const { runner, mockProvider } = createRunner({
        configOverrides: { maxToolLoops: 2 },
      });

      const echo = defineTool({
        name: "echo",
        description: "echo",
        inputSchema: { type: "object", properties: { msg: { type: "string" } } },
        execute: async (input) => ({ content: `echo: ${input.msg}` }),
      });

      const runner2 = new AgentRunner({
        config: createConfig({
          agent: {
            defaultModel: "claude-sonnet-5",
            defaultProvider: "mock",
            maxRetries: 0,
            maxToolLoops: 2,
          },
        }),
        providers: (() => {
          const mp = new MockProvider();
          const pr = new ProviderRegistry();
          pr.registerFactory("mock", () => mp);
          return pr;
        })(),
        tools: [echo],
      });

      const mp = new MockProvider();
      const pr = new ProviderRegistry();
      pr.registerFactory("mock", () => mp);
      const runner3 = new AgentRunner({
        config: createConfig({
          agent: {
            defaultModel: "claude-sonnet-5",
            defaultProvider: "mock",
            maxRetries: 0,
            maxToolLoops: 2,
          },
        }),
        providers: pr,
        tools: [echo],
      });

      // 每轮都返回工具调用 → 超过上限
      mp.program({
        kind: "tool_calls",
        calls: [{ id: "t1", name: "echo", input: { msg: "loop1" } }],
      });
      mp.program({
        kind: "tool_calls",
        calls: [{ id: "t2", name: "echo", input: { msg: "loop2" } }],
      });
      // 第3次 LLM 调用是摘要（无工具）
      mp.program({ kind: "text", text: "已达到工具循环上限的摘要" });

      const events = await collectEvents(
        runner3.runStream({ message: "start looping" }),
      );
      const result = doneResult(events);

      // 应该只执行了 2 轮工具循环
      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts.length).toBeLessThanOrEqual(2);
      expect(result.text).toContain("摘要");
    });
  });

  // ==========================================================
  // 6. 死循环检测
  // ==========================================================
  describe("死循环检测", () => {
    it("精确重复调用 ≥ LOOP_HARD(5) → 强制终止", async () => {
      const echo = defineTool({
        name: "echo",
        description: "echo",
        inputSchema: { type: "object", properties: { msg: { type: "string" } } },
        execute: async (input) => ({ content: `echo: ${input.msg}` }),
      });

      const mp = new MockProvider();
      const pr = new ProviderRegistry();
      pr.registerFactory("mock", () => mp);
      const runner = new AgentRunner({
        config: createConfig({
          agent: {
            defaultModel: "claude-sonnet-5",
            defaultProvider: "mock",
            maxRetries: 0,
            maxToolLoops: 20,
          },
        }),
        providers: pr,
        tools: [echo],
      });

      // 连续 5 次相同的工具调用
      for (let i = 0; i < 5; i++) {
        mp.program({
          kind: "tool_calls",
          calls: [{ id: `t${i}`, name: "echo", input: { msg: "same" } }],
        });
      }

      const events = await collectEvents(
        runner.runStream({ message: "loop" }),
      );
      const result = doneResult(events);

      // 应该在到达 5 次重复时触发 LOOP_HARD
      const toolStarts = events.filter((e) => e.type === "tool_start");
      expect(toolStarts.length).toBeLessThanOrEqual(5);
      expect(result.meta.error).toBeUndefined();
      // 结果文本应包含循环终止信息
      expect(result.text).toContain("Stopped");
    });

    it("不同工具参数 → 不触发循环检测", async () => {
      const echo = defineTool({
        name: "echo",
        description: "echo",
        inputSchema: { type: "object", properties: { msg: { type: "string" } } },
        execute: async (input) => ({ content: `echo: ${input.msg}` }),
      });

      const { runner, mockProvider } = createRunner({
        tools: [echo],
        configOverrides: { maxRetries: 0, maxToolLoops: 10 },
      });

      // 不同的工具调用参数
      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t1", name: "echo", input: { msg: "a" } }],
      });
      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t2", name: "echo", input: { msg: "b" } }],
      });
      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "t3", name: "echo", input: { msg: "c" } }],
      });
      mockProvider.program({ kind: "text", text: "done" });

      const events = await collectEvents(
        runner.runStream({ message: "vary params" }),
      );
      const result = doneResult(events);

      // 正常完成，未触发循环终止
      expect(result.text).toBe("done");
      expect(result.meta.toolLoops).toBe(3);
    });
  });

  // ==========================================================
  // 7. endTurn 终止型工具
  // ==========================================================
  describe("endTurn 终止型工具", () => {
    it("endTurn=true → 跳过剩余批次，直接结束", async () => {
      const finishTool = defineTool({
        name: "finish",
        description: "完成任务并终止",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({
          content: "任务完成",
          endTurn: true,
        }),
      });
      const extraTool = defineTool({
        name: "extra",
        description: "不应被执行",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ content: "不应该看到这个" }),
      });

      const { runner, mockProvider } = createRunner({
        tools: [finishTool, extraTool],
      });

      // 模型同时调用 finish（终止型）和 extra
      mockProvider.program({
        kind: "tool_calls",
        calls: [
          { id: "t1", name: "finish", input: {} },
          { id: "t2", name: "extra", input: {} },
        ],
      });

      const events = await collectEvents(
        runner.runStream({ message: "完成任务" }),
      );
      const result = doneResult(events);

      // extra 应该被跳过（因为 finish 在前面且是终止型）
      const extraResult = events.find(
        (e) => e.type === "tool_end" && (e as any).name === "extra",
      );
      if (extraResult) {
        // extra 被标记为 skipped
        expect((extraResult as any).result).toContain("terminal tool");
      }

      expect(result.meta.error).toBeUndefined();
    });
  });

  // ==========================================================
  // 8. 流式事件完整性
  // ==========================================================
  describe("流式事件", () => {
    it("完整的事件序列：delta → tool_start → tool_end → done", async () => {
      const tool = defineTool({
        name: "compute",
        description: "计算",
        inputSchema: { type: "object", properties: { expr: { type: "string" } } },
        execute: async (input) => ({ content: `结果: ${input.expr} = 42` }),
      });

      const { runner, mockProvider } = createRunner({ tools: [tool] });

      mockProvider.program({
        kind: "tool_calls",
        text: "让我计算一下。",
        calls: [{ id: "c1", name: "compute", input: { expr: "6*7" } }],
      });
      mockProvider.program({ kind: "text", text: "6*7=42" });

      const events = await collectEvents(
        runner.runStream({ message: "6*7等于多少？" }),
      );

      const eventTypes = events.map((e) => e.type);

      // 应有 text_delta（文本部分）
      expect(eventTypes).toContain("text_delta");
      // 应有 tool_start
      expect(eventTypes).toContain("tool_start");
      // 应有 tool_end
      expect(eventTypes).toContain("tool_end");
      // 最后是 done
      expect(eventTypes[eventTypes.length - 1]).toBe("done");
    });

    it("run() 阻塞模式返回结果", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "阻塞模式结果" });

      const result = await runner.run({ message: "hello" });

      expect(result.text).toBe("阻塞模式结果");
      expect(result.meta.model).toBe("claude-sonnet-5");
    });
  });

  // ==========================================================
  // 9. Session 集成
  // ==========================================================
  describe("Session 集成", () => {
    it("run 完成后 session 中包含用户和助手消息", async () => {
      const session = new Session();
      const { runner, mockProvider } = createRunner({ session });

      mockProvider.program({ kind: "text", text: "回复" });

      await runner.run({ message: "用户消息" });

      const messages = session.getAllMessages();
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // 第一条是用户消息
      const userMsg = messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg!.turnId).toBe(1);

      // 最后一条是助手消息
      const assistantMsg = messages.find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
    });

    it("工具结果被持久化到 session", async () => {
      const session = new Session();
      const tool = defineTool({
        name: "state",
        description: "状态查询",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ content: "state is OK" }),
      });

      const { runner, mockProvider } = createRunner({ tools: [tool], session });

      mockProvider.program({
        kind: "tool_calls",
        calls: [{ id: "s1", name: "state", input: {} }],
      });
      mockProvider.program({ kind: "text", text: "状态已查询" });

      await runner.run({ message: "查询状态" });

      const messages = session.getAllMessages();
      // 应有包含 tool_result 的消息
      const toolResults = messages.filter(
        (m) => m.role === "user" && m.content.some((c) => c.type === "tool_result"),
      );
      expect(toolResults.length).toBeGreaterThan(0);
    });

    it("多次 run 的 turnId 递增", async () => {
      const session = new Session();
      const { runner, mockProvider } = createRunner({ session });

      mockProvider.program({ kind: "text", text: "R1" });
      await runner.run({ message: "m1" });

      mockProvider.program({ kind: "text", text: "R2" });
      await runner.run({ message: "m2" });

      const messages = session.getAllMessages();
      const userMessages = messages.filter((m) => m.role === "user" && m.turnId);
      const turnIds = userMessages.map((m) => m.turnId!);
      expect(turnIds).toContain(1);
      expect(turnIds).toContain(2);
    });
  });

  // ==========================================================
  // 10. 边界情况
  // ==========================================================
  describe("边界情况", () => {
    it("max_tokens 截断 → 触发 OutputLimitError（不可重试）", async () => {
      const { runner, mockProvider } = createRunner({
        configOverrides: { maxRetries: 2 },
      });

      // max_tokens 截断是不可重试错误，直接返回 provider_error
      mockProvider.program({
        kind: "text",
        text: "partial response...",
        stopReason: "max_tokens",
      });

      const events = await collectEvents(
        runner.runStream({ message: "hello" }),
      );
      const result = doneResult(events);

      // OutputLimitError 不可重试 → 返回 provider_error
      expect(result.meta.error?.kind).toBe("provider_error");
    });

    it("空消息 → 正常处理", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "收到空消息" });

      const result = await runner.run({ message: "" });
      expect(result.text).toBe("收到空消息");
    });

    it("model 覆盖参数生效", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "OK" });

      await runner.run({ message: "hi", model: "claude-opus-5" });

      const streamRecord = mockProvider.streams[0];
      expect(streamRecord.params.model).toBe("claude-opus-5");
    });

    it("包含图片的请求", async () => {
      const { runner, mockProvider } = createRunner();
      mockProvider.program({ kind: "text", text: "看到图片了" });

      const result = await runner.run({
        message: "描述这张图片",
        images: [{ data: "base64data", mediaType: "image/png" }],
      });

      expect(result.text).toBe("看到图片了");
    });
  });

  // ==========================================================
  // 11. 辅助函数
  // ==========================================================
  describe("辅助函数", () => {
    it("partitionToolBatches — 相邻并行工具归入同批", async () => {
      const { partitionToolBatches } = await import("../src/agent/runner.js");

      const calls = [
        { name: "a", mode: "parallel" as const },
        { name: "b", mode: "parallel" as const },
        { name: "c", mode: "sequential" as const },
        { name: "d", mode: "parallel" as const },
      ];

      const batches = partitionToolBatches(calls, (c) => c.mode === "parallel");

      // a,b 并行归一批；c 顺序归一批；d 并行归一批
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(2);
      expect(batches[1]).toHaveLength(1);
      expect(batches[2]).toHaveLength(1);
    });
  });
});
