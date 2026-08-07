import { describe, it, expect, beforeEach, vi } from "vitest";
import { Semaphore } from "async-mutex";

// ============================================================
// 测试策略
//
// dispatch.ts 的 XML 辅助函数（escapeXml / buildWorkerTaskEnvelope /
// classifyWorkerOutcome / buildWorkerResultPayload / buildWorkerErrorPayload）
// 是模块私有且 src/ 已锁定（禁止修改导出）。因此这里通过 vi.mock 替换
// AgentRunner 模块，用真实的 runNestedDispatch 驱动整个回传协议：
// 任务信封、<worker-result> / <worker-error> / aborted 分类均可经黑盒断言。
// ============================================================

const state = vi.hoisted(() => ({
  /** 捕获 mock AgentRunner.run() 收到的参数 */
  runCalls: [] as Array<{
    message: string;
    systemPrompt?: string;
    workingDir?: string;
    signal?: AbortSignal;
    requestMetadata?: Record<string, unknown>;
  }>,
  /** 捕获 mock AgentRunner 构造参数（用于断言工具集隔离） */
  instances: [] as Array<{ opts: { config: unknown; providers: unknown; tools: unknown[]; session: unknown } }>,
  /** 预设 mock run() 的返回结果 */
  resultToReturn: { text: "", meta: {} } as {
    text: string;
    meta: { error?: { kind: string; message: string } };
  },
}));

vi.mock("../../src/agent/runner.js", () => {
  class FakeAgentRunner {
    opts: { config: unknown; providers: unknown; tools: unknown[]; session: unknown };
    constructor(opts: { config: unknown; providers: unknown; tools: unknown[]; session: unknown }) {
      this.opts = opts;
      state.instances.push({ opts });
    }
    getProviders() {
      return this.opts.providers;
    }
    getSession() {
      return this.opts.session;
    }
    async run(params: {
      message: string;
      systemPrompt?: string;
      workingDir?: string;
      signal?: AbortSignal;
      requestMetadata?: Record<string, unknown>;
    }) {
      state.runCalls.push(params);
      return state.resultToReturn;
    }
  }
  return { AgentRunner: FakeAgentRunner };
});

import { runNestedDispatch, dispatchSlots } from "../../src/orchestration/dispatch.js";
import { createConfig } from "../../src/config/loader.js";
import type { Actor } from "../../src/orchestration/actor.js";

const CID = "cid-01";
const workerActor: Actor = { kind: "worker", id: "w-t-01", name: "Worker" };

/** 统一的 runNestedDispatch 调用助手（注入假父 Runner，避免真实 LLM 调用） */
function runDispatch(opts: {
  task?: string;
  actor?: Actor;
  parentSignal?: AbortSignal;
  attachments?: string[];
} = {}): Promise<string> {
  const fakeParent = { getProviders: () => ({}) };
  return runNestedDispatch({
    cid: CID,
    actor: opts.actor ?? workerActor,
    task: opts.task ?? "test task",
    parentSignal: opts.parentSignal,
    attachments: opts.attachments,
    config: createConfig(),
    getRunner: () => fakeParent as any,
  });
}

describe("dispatch", () => {
  beforeEach(() => {
    state.runCalls.length = 0;
    state.instances.length = 0;
    state.resultToReturn = { text: "", meta: {} };
  });

  describe("dispatchSlots", () => {
    it("is a Semaphore", () => {
      expect(dispatchSlots).toBeInstanceOf(Semaphore);
    });

    it("默认并发上限 > 0", () => {
      expect(dispatchSlots.getValue()).toBeGreaterThan(0);
    });
  });

  describe("runNestedDispatch — 任务信封", () => {
    it("将任务封装为 <task> XML 信封，并转义 to 属性", async () => {
      const actor: Actor = { kind: "worker", id: 'w"&<>', name: "Worker" };
      await runDispatch({ actor, task: "count files" });

      expect(state.runCalls.length).toBe(1);
      const msg = state.runCalls[0].message;
      expect(msg).toContain('<task from="commander" to="w&quot;&amp;&lt;&gt;">');
      expect(msg).toContain("count files");
      expect(msg).toContain("</task>");
    });

    it("带 attachments 时附加 <attachments> 段落", async () => {
      await runDispatch({ attachments: ["a.txt", "<raw>"] });

      const msg = state.runCalls[0].message;
      expect(msg).toContain("<attachments>");
      expect(msg).toContain("  a.txt");
      expect(msg).toContain("  <raw>");
      expect(msg).toContain("</attachments>");
    });

    it("无 attachments 时不生成 <attachments> 段落", async () => {
      await runDispatch({ task: "plain" });

      const msg = state.runCalls[0].message;
      expect(msg).not.toContain("<attachments>");
    });
  });

  describe("runNestedDispatch — 回传协议", () => {
    it("正常结果 → <worker-result> 信封", async () => {
      state.resultToReturn = { text: "task done", meta: {} };

      const out = await runDispatch();
      expect(out).toBe('<worker-result from="Worker">\ntask done\n</worker-result>');
    });

    it("空文本 → (no textual reply)", async () => {
      state.resultToReturn = { text: "   ", meta: {} };

      const out = await runDispatch();
      expect(out).toContain("<worker-result");
      expect(out).toContain("(no textual reply)");
    });

    it("meta.error → <worker-error>（消息转义 XML 特殊字符）", async () => {
      state.resultToReturn = {
        text: "",
        meta: { error: { kind: "provider_error", message: 'boom <&"' } },
      };

      const out = await runDispatch();
      expect(out).toMatch(/^<worker-error from="Worker">/);
      expect(out).toContain("boom &lt;&amp;&quot;");
    });

    it("父 signal 中止 → <worker-error aborted=\"true\">", async () => {
      const ac = new AbortController();
      ac.abort();
      state.resultToReturn = { text: "partial", meta: {} };

      const out = await runDispatch({ parentSignal: ac.signal });
      expect(out).toMatch(/^<worker-error from="Worker" aborted="true">/);
      expect(out).toContain("partial");
    });

    it("worker 名称含特殊字符时 from 属性被转义", async () => {
      const actor: Actor = { kind: "worker", id: "w-01", name: 'Work<&er"' };
      state.resultToReturn = { text: "ok", meta: {} };

      const out = await runDispatch({ actor });
      expect(out).toMatch(/^<worker-result from="Work&lt;&amp;er&quot;">/);
    });
  });

  describe("runNestedDispatch — 工具集隔离", () => {
    it("worker 子 Runner 的工具集不含调度工具（防递归调度）", async () => {
      await runDispatch();

      expect(state.instances.length).toBe(1);
      const names = (state.instances[0].opts.tools as Array<{ name: string }>).map(
        (t) => t.name,
      );
      expect(names).not.toContain("run_worker");
      expect(names).not.toContain("dispatch_to");
      expect(names).not.toContain("hand_off_to");
      // 基础工具仍在
      expect(names).toContain("read_file");
      expect(names).toContain("bash");
    });

    it("子 Runner 继承父 Runner 的 ProviderRegistry", async () => {
      const registry = {};
      await runNestedDispatch({
        cid: CID,
        actor: workerActor,
        task: "t",
        config: createConfig(),
        getRunner: () => ({ getProviders: () => registry }) as any,
      });

      expect(state.instances[0].opts.providers).toBe(registry);
    });
  });
});
