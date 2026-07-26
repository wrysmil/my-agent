import { describe, it, expect } from "vitest";
import { defineTool, toToolDefinition, type AgentTool, type ToolContext, type ToolResult } from "../src/tools/base.js";

describe("工具定义抽象", () => {
  // ─── defineTool 工厂 ──────────────────────────
  describe("defineTool — 工具工厂", () => {
    it("创建基本工具", () => {
      const tool = defineTool({
        name: "read_file",
        description: "读取文件内容",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径" },
          },
          required: ["path"],
        },
        execute: async (input) => {
          return { content: `模拟读取: ${input.path}` };
        },
      });

      expect(tool.name).toBe("read_file");
      expect(tool.description).toBe("读取文件内容");
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    });

    it("默认 executionMode 为 undefined（sequential）", () => {
      const tool = defineTool({
        name: "write_file",
        description: "写文件",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ content: "ok" }),
      });

      expect(tool.executionMode).toBeUndefined();
    });

    it("可指定 executionMode 为 parallel", () => {
      const tool = defineTool({
        name: "search",
        description: "搜索",
        inputSchema: { type: "object", properties: {} },
        executionMode: "parallel",
        execute: async () => ({ content: "results" }),
      });

      expect(tool.executionMode).toBe("parallel");
    });
  });

  // ─── 工具执行 ─────────────────────────────────
  describe("工具执行", () => {
    it("execute 接收 input 和 ctx", async () => {
      const received: { input: unknown; ctx: ToolContext } = {
        input: null,
        ctx: { state: {} },
      };

      const tool = defineTool({
        name: "test",
        description: "test",
        inputSchema: {},
        execute: async (input, ctx) => {
          received.input = input;
          received.ctx = ctx;
          return { content: "done" };
        },
      });

      const ctx: ToolContext = { state: { sessionId: "abc" } };
      const result = await tool.execute({ key: "value" }, ctx);

      expect(received.input).toEqual({ key: "value" });
      expect(received.ctx.state).toEqual({ sessionId: "abc" });
      expect(result.content).toBe("done");
    });

    it("execute 返回成功结果", async () => {
      const tool = defineTool({
        name: "get_time",
        description: "获取当前时间",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ content: "2025-01-01T00:00:00Z" }),
      });

      const result = await tool.execute({}, { state: {} });
      expect(result.content).toBe("2025-01-01T00:00:00Z");
      expect(result.isError).toBeUndefined();
    });

    it("execute 返回错误结果（isError: true）", async () => {
      const tool = defineTool({
        name: "risky",
        description: "可能出错",
        inputSchema: {},
        execute: async () => ({
          content: "permission denied",
          isError: true,
        }),
      });

      const result = await tool.execute({}, { state: {} });
      expect(result.isError).toBe(true);
    });

    it("execute 可访问 workingDir", async () => {
      let capturedWd: string | undefined;

      const tool = defineTool({
        name: "pwd",
        description: "打印工作目录",
        inputSchema: {},
        execute: async (_, ctx) => {
          capturedWd = ctx.workingDir;
          return { content: ctx.workingDir ?? "none" };
        },
      });

      await tool.execute({}, { state: {}, workingDir: "/home/user/project" });
      expect(capturedWd).toBe("/home/user/project");
    });

    it("execute 可检测 AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort(); // 立即中止

      const tool = defineTool({
        name: "long_task",
        description: "长任务",
        inputSchema: {},
        execute: async (_, ctx) => {
          if (ctx.signal?.aborted) {
            return { content: "aborted", isError: true };
          }
          return { content: "completed" };
        },
      });

      const result = await tool.execute(
        {},
        { state: {}, signal: controller.signal },
      );
      expect(result.content).toBe("aborted");
      expect(result.isError).toBe(true);
    });
  });

  // ─── toToolDefinition ─────────────────────────
  describe("toToolDefinition — 格式转换", () => {
    it("生成 Provider 兼容的 ToolDefinition", () => {
      const tool = defineTool({
        name: "bash",
        description: "执行  shell  命令",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
        execute: async () => ({ content: "ok" }),
      });

      const def = toToolDefinition(tool);
      expect(def.name).toBe("bash");
      // 空白被压缩
      expect(def.description).toBe("执行 shell 命令");
      expect(def.inputSchema.required).toEqual(["command"]);
    });

    it("多行空白被规范化为单空格", () => {
      const tool = defineTool({
        name: "test",
        description: "line1\n  line2   line3",
        inputSchema: {},
        execute: async () => ({ content: "ok" }),
      });

      const def = toToolDefinition(tool);
      expect(def.description).toBe("line1 line2 line3");
    });
  });

  // ─── AgentTool 接口 ───────────────────────────
  describe("AgentTool — 接口兼容性", () => {
    it("实现 AgentTool 接口的对象可赋值", () => {
      const tool: AgentTool = {
        name: "custom",
        description: "custom tool",
        inputSchema: {},
        execute: async () => ({ content: "ok" }),
      };

      expect(tool.name).toBe("custom");
    });
  });

  // ─── ToolContext.state 跨调用持久化 ────────────
  describe("ToolContext.state — 跨调用状态", () => {
    it("state 在多次工具调用间持久化", async () => {
      const sharedState: Record<string, unknown> = {};

      const writer = defineTool({
        name: "write_state",
        description: "write",
        inputSchema: { properties: { key: { type: "string" }, value: {} } },
        execute: async (input, ctx) => {
          ctx.state[input.key as string] = input.value;
          return { content: "written" };
        },
      });

      const reader = defineTool({
        name: "read_state",
        description: "read",
        inputSchema: { properties: { key: { type: "string" } } },
        execute: async (input, ctx) => {
          return { content: String(ctx.state[input.key as string] ?? "null") };
        },
      });

      const ctx: ToolContext = { state: sharedState };

      await writer.execute({ key: "counter", value: 42 }, ctx);
      const result = await reader.execute({ key: "counter" }, ctx);

      expect(result.content).toBe("42");
    });
  });
});
