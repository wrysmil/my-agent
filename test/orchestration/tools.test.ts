import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDispatchTools, withoutDispatchTools } from "../../src/orchestration/tools.js";
import { BUILTIN_TOOLS } from "../../src/tools/builtin.js";
import { AgentRunner } from "../../src/agent/runner.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { createConfig } from "../../src/config/loader.js";
import { _resetDataRoot } from "../../src/storage/paths.js";
import { MockProvider } from "../mocks/provider.js";

// ============================================================
// 纯函数：withoutDispatchTools
// ============================================================

describe("tools", () => {
  describe("withoutDispatchTools", () => {
    it("filters out run_worker", () => {
      const names = withoutDispatchTools(BUILTIN_TOOLS).map((t) => t.name);
      expect(names).not.toContain("run_worker");
    });

    it("filters out dispatch_to", () => {
      const names = withoutDispatchTools(BUILTIN_TOOLS).map((t) => t.name);
      expect(names).not.toContain("dispatch_to");
    });

    it("filters out hand_off_to", () => {
      const names = withoutDispatchTools(BUILTIN_TOOLS).map((t) => t.name);
      expect(names).not.toContain("hand_off_to");
    });

    it("preserves all builtin tools", () => {
      const result = withoutDispatchTools(BUILTIN_TOOLS);
      expect(result.length).toBe(BUILTIN_TOOLS.length); // 内置工具不含调度工具
    });
  });

  // ============================================================
  // 集成验证：buildDispatchTools → AgentRunner.addTool
  //
  // 目标：确认 GROUP-1/GROUP-2 产物（buildDispatchTools / runNestedDispatch）
  // 可通过公开的 addTool() 注入 AgentRunner，且无需修改 Runner 核心。
  // 端到端跑通一次真实 run：父会话调 run_worker → 子会话/子 Runner 执行 →
  // 以 <worker-result> 信封交回 → 父会话继续推理。
  // ============================================================

  describe("buildDispatchTools → AgentRunner.addTool 集成", () => {
    function createRunnerWithMock() {
      const config = createConfig({
        agent: {
          defaultModel: "claude-sonnet-5",
          defaultProvider: "mock",
          maxRetries: 0,
          maxToolLoops: 10,
          toolIdleTimeoutMs: 5_000,
        },
      });
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      // 直接用 mock provider 替换（绕过工厂注册）
      (providers as any).providers?.set?.("mock", mockProvider);
      providers.registerFactory("mock", () => mockProvider);
      const runner = new AgentRunner({
        config,
        providers,
        tools: [...BUILTIN_TOOLS],
      });
      return { runner, mockProvider, config };
    }

    /** 从任意形状的 message.content（string 或 MessageContent[]）提取纯文本 */
    function textFromMessage(m: { content: unknown }): string {
      if (typeof m.content === "string") return m.content;
      return (Array.isArray(m.content) ? m.content : [])
        .map((c: unknown) => {
          if (!c) return "";
          const block = c as { type?: string; text?: string; content?: string };
          if (block.type === "text") return block.text ?? "";
          if (block.type === "tool_result") return block.content ?? "";
          return "";
        })
        .join("");
    }

    it("buildDispatchTools 返回 run_worker 工具", () => {
      const { runner, config } = createRunnerWithMock();
      const tools = buildDispatchTools({
        getRunner: () => runner,
        config,
        cid: "cid-test",
      });
      expect(tools.map((t) => t.name)).toEqual(["run_worker"]);
      expect(tools[0].description).toContain("coordinator");
    });

    it("addTool 后 run_worker 可端到端执行并回传结果", async () => {
      const { runner, mockProvider, config } = createRunnerWithMock();

      // 注入调度工具（模拟宿主装配主会话）
      const dispatchTools = buildDispatchTools({
        getRunner: () => runner,
        config,
        cid: "cid-test",
      });
      for (const tool of dispatchTools) {
        runner.addTool(tool);
      }

      // 预设响应序列：
      //  1. 父会话首轮 → 调用 run_worker
      //  2. 子会话（worker）→ 产出 "worker done"
      //  3. 父会话次轮 → 产出最终回答
      mockProvider.program(
        {
          kind: "tool_calls",
          calls: [
            { id: "call-1", name: "run_worker", input: { task: "count files in cwd" } },
          ],
        },
        { kind: "text", text: "worker done" },
        { kind: "text", text: "final answer: 3 files" },
      );

      const result = await runner.run({ message: "go" });

      expect(result.text).toBe("final answer: 3 files");

      // 3 次 LLM 调用：父(工具调用) → worker → 父(最终)
      expect(mockProvider.streams.length).toBe(3);

      // 证明 addTool 生效：父会话首轮的工具定义含 run_worker
      const parentFirstTools = mockProvider.streams[0].params.tools?.map((t) => t.name) ?? [];
      expect(parentFirstTools).toContain("run_worker");

      // 证明子 Runner 工具集不含调度工具（withoutDispatchTools 集成，防递归调度）
      const workerTools = mockProvider.streams[1].params.tools?.map((t) => t.name) ?? [];
      expect(workerTools).not.toContain("run_worker");
      expect(workerTools).not.toContain("dispatch_to");
      expect(workerTools).not.toContain("hand_off_to");
      expect(workerTools.length).toBe(BUILTIN_TOOLS.length);

      // 子会话收到的消息是 <task> 任务信封
      const workerText = mockProvider.streams[1].params.messages.map(textFromMessage).join("\n");
      expect(workerText).toContain('<task from="commander"');
      expect(workerText).toContain("count files in cwd");

      // 回传协议：父会话次轮的上下文中含 <worker-result> 信封
      const parentFinalText = mockProvider.streams[2].params.messages
        .map(textFromMessage)
        .join("\n");
      expect(parentFinalText).toContain("<worker-result from=\"Worker\">");
      expect(parentFinalText).toContain("worker done");
    });

    it("addTool 覆盖同名工具", () => {
      const { runner, config } = createRunnerWithMock();
      const [tool] = buildDispatchTools({ getRunner: () => runner, config, cid: "cid-test" });
      runner.addTool(tool);
      // 再次 addTool 同名工具 → 覆盖不抛错（Map.set 语义）
      runner.addTool(tool);
      expect(runner.getSession()).toBeDefined();
      expect(runner.getProviders()).toBeDefined();
    });
  });

  // ============================================================
  // S2：run_worker(to) 命名 agent 参数边界
  //
  // 将 MY_AGENT_HOME 指向 fixtures/orchestration（其下含 agents/{id}/agent.json），
  // 使 run_worker 的命名分支能读到真实 agent 规格。断言仅验证 isError / 信封，
  // 不依赖真实 LLM（成功路径由 MockProvider 预设一次响应）。
  // ============================================================

  describe("buildDispatchTools run_worker with 'to' param", () => {
    const fixturesHome = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../fixtures/orchestration",
    );
    const savedHome = process.env.MY_AGENT_HOME;

    function createRunnerWithMock() {
      const config = createConfig({
        agent: {
          defaultModel: "claude-sonnet-5",
          defaultProvider: "mock",
          maxRetries: 0,
          maxToolLoops: 10,
          toolIdleTimeoutMs: 5_000,
        },
      });
      const mockProvider = new MockProvider();
      const providers = new ProviderRegistry(config);
      // 直接用 mock provider 替换（绕过工厂注册）
      (providers as any).providers?.set?.("mock", mockProvider);
      providers.registerFactory("mock", () => mockProvider);
      const runner = new AgentRunner({
        config,
        providers,
        tools: [...BUILTIN_TOOLS],
      });
      return { runner, mockProvider, config };
    }

    async function buildRunWorker() {
      const { runner, config } = createRunnerWithMock();
      const [tool] = buildDispatchTools({
        getRunner: () => runner,
        config,
        cid: "cid-to-test",
      });
      return tool;
    }

    afterEach(() => {
      if (savedHome === undefined) delete process.env.MY_AGENT_HOME;
      else process.env.MY_AGENT_HOME = savedHome;
      _resetDataRoot();
    });

    it("rejects commander as target", async () => {
      // 指向 fixtures（含 commander/agent.json），使其走「目标必须是 agent」守卫分支
      process.env.MY_AGENT_HOME = fixturesHome;
      _resetDataRoot();

      const tool = await buildRunWorker();
      const result = await tool.execute(
        { task: "count files", to: "commander" },
        { state: {} },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain("target must be an agent");
      expect(result.content).toContain("commander");
    });

    it("rejects unknown agent", async () => {
      process.env.MY_AGENT_HOME = fixturesHome;
      _resetDataRoot();

      const tool = await buildRunWorker();
      const result = await tool.execute(
        { task: "count files", to: "nonexistent_agent_12345" },
        { state: {} },
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain("unknown agent");
      expect(result.content).toContain("nonexistent_agent_12345");
    });

    it("routes to a named agent and returns its result", async () => {
      process.env.MY_AGENT_HOME = fixturesHome;
      _resetDataRoot();

      const { runner, mockProvider, config } = createRunnerWithMock();
      const [tool] = buildDispatchTools({
        getRunner: () => runner,
        config,
        cid: "cid-to-test",
      });

      // 子 Runner（命名 agent）消费一次响应
      mockProvider.program({ kind: "text", text: "counted 3 files" });

      const result = await tool.execute(
        { task: "count files", to: "coder" },
        { state: {} },
      );

      expect(result.isError).toBeUndefined();
      // 命名 agent 身份进入 <worker-result from="..."> 信封
      expect(result.content).toContain("<worker-result from=\"Coder\">");
      expect(result.content).toContain("counted 3 files");
    });
  });
});
