import { defineTool, type AgentTool, type ToolResult } from "../tools/base.js";
import type { Actor } from "./actor.js";
import { genWorkerId } from "./actor.js";
import type { AgentRunner } from "../agent/runner.js";
import type { CoreAgentConfig } from "../config/schema.js";
import type { AgentSpec } from "./agent-spec.js";
import type { WorkerProgressEvent } from "./dispatch.js";

// ============================================================
// 内部：执行一次子调度（run_worker / dispatch_to / hand_off_to 共用）
// ============================================================

async function _executeDispatch(input: Record<string, unknown>, opts: {
  getRunner: () => AgentRunner;
  config: CoreAgentConfig;
  cid: string;
  workingDir?: string;
  signal?: AbortSignal;
  onWorkerEvent?: (ev: WorkerProgressEvent) => void;
}): Promise<{ actor: Actor; result: string; agentSpec?: AgentSpec }> {
  const task = String(input.task || "").trim();

  const toRaw = String(input.to || "").trim();

  if (toRaw) {
    const { loadAgentSpec } = await import("./agent-spec.js");
    const spec = await loadAgentSpec(toRaw);
    if (!spec) {
      throw new Error(`unknown agent "${toRaw}"`);
    }
    if (toRaw === "commander" || toRaw === "user") {
      throw new Error(`target must be an agent, not "${toRaw}"`);
    }

    const actor: Actor = { kind: "agent", id: spec.agent_id, name: spec.name };
    const { runNestedDispatch } = await import("./dispatch.js");
    const result = await runNestedDispatch({
      cid: opts.cid,
      actor,
      task,
      parentSignal: opts.signal,
      getRunner: opts.getRunner,
      config: opts.config,
      workingDir: opts.workingDir,
      agentSpec: spec,
      onWorkerEvent: opts.onWorkerEvent,
    });
    return { actor, result, agentSpec: spec };
  }

  // 匿名 worker
  const actor: Actor = { kind: "worker", id: genWorkerId(), name: "Worker" };
  const { runNestedDispatch } = await import("./dispatch.js");
  const result = await runNestedDispatch({
    cid: opts.cid,
    actor,
    task,
    parentSignal: opts.signal,
    getRunner: opts.getRunner,
    config: opts.config,
    workingDir: opts.workingDir,
    onWorkerEvent: opts.onWorkerEvent,
  });
  return { actor, result };
}

// ============================================================
// 构建三个调度工具
// ============================================================

/**
 * 构建调度工具集（仅注入主会话）。
 *
 * 三个独立工具：
 * - `run_worker` — 匿名/命名 worker，结果**私密**交回指挥官，指挥官继续综合
 * - `dispatch_to` — agent 发可见回复，完整结果也回指挥官，指挥官必须还有下一步
 * - `hand_off_to` — 把控制权交给 agent，答案直接输出（endTurn），回合结束
 */
export function buildDispatchTools(opts: {
  getRunner: () => AgentRunner;
  config: CoreAgentConfig;
  cid: string;
  workingDir?: string;
  signal?: AbortSignal;
  /** 可选流式回调：设置后 worker 的实时输出会推送给宿主 UI */
  onWorkerEvent?: (ev: WorkerProgressEvent) => void;
}): AgentTool[] {

  // 三个工具共享的参数 schema（task + to）
  const sharedInputSchema = {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description: "Sub-task instruction, sent verbatim to the worker/agent.",
      },
      to: {
        type: "string",
        description:
          "Optional agent_id to target a named agent (with agent.json spec). " +
          "Omit for anonymous worker.",
      },
    },
    required: ["task"],
    additionalProperties: false,
  };

  // ---- run_worker：私密结果，指挥官继续 ----

  const runWorker = defineTool({
    name: "run_worker",
    executionMode: "parallel",
    description: [
      "Spawn an ephemeral worker/agent to complete ONE bounded sub-task. " +
        "The FULL result is handed back to YOU (the commander) privately — " +
        "the user does NOT see it. You read it, synthesise, and decide the next step.",
      "Use when: you need a sub-task done whose output you will build on " +
        "(heavy scanning, code generation, research).",
      "Omit `to` for an anonymous worker; pass `to` with an agent_id " +
        "(e.g. \"coder\", \"reviewer\", \"explorer\") to use a named agent.",
    ].join(" "),
    inputSchema: sharedInputSchema,
    async execute(input, ctx): Promise<ToolResult> {
      const task = String(input.task || "").trim();
      if (!task) return { content: "run_worker: `task` is required", isError: true };

      try {
        const { result } = await _executeDispatch(input, {
          ...opts,
          signal: ctx.signal ?? opts.signal,
          workingDir: ctx.workingDir ?? opts.workingDir,
          onWorkerEvent: opts.onWorkerEvent,
        });
        return { content: result };
      } catch (err) {
        return { content: `run_worker: ${(err as Error).message}`, isError: true };
      }
    },
  });

  // ---- dispatch_to：可见结果，指挥官继续 ----

  const dispatchTo = defineTool({
    name: "dispatch_to",
    executionMode: "sequential", // 可见消息不适合并行乱序
    description: [
      "Send a task to a named agent whose reply IS visible to the user " +
        "(shown as an agent bubble). The full result also comes back to YOU " +
        "(the commander) so you can read it and decide the next step.",
      "Use when: you want the user to see what the agent produced, " +
        "but YOU still own the conversation and will build on it.",
      "Requires `to` (agent_id). Unlike run_worker, the output is public.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Sub-task instruction for the agent.",
        },
        to: {
          type: "string",
          description: "REQUIRED agent_id to target a named agent.",
        },
      },
      required: ["task", "to"],
      additionalProperties: false,
    },
    async execute(input, ctx): Promise<ToolResult> {
      const task = String(input.task || "").trim();
      if (!task) return { content: "dispatch_to: `task` is required", isError: true };

      try {
        const { actor, result } = await _executeDispatch(input, {
          ...opts,
          signal: ctx.signal ?? opts.signal,
          workingDir: ctx.workingDir ?? opts.workingDir,
          onWorkerEvent: opts.onWorkerEvent,
        });

        // 可见消息：用 [agent] 标记区分，指挥官继续
        const name = actor.name || actor.id;
        const label = `\n## 💬 ${name} 说：\n\n`;
        return { content: `${label}${result}` };
      } catch (err) {
        return { content: `dispatch_to: ${(err as Error).message}`, isError: true };
      }
    },
  });

  // ---- hand_off_to：交出控制权，回合结束 ----

  const handOffTo = defineTool({
    name: "hand_off_to",
    executionMode: "sequential", // 结束回合，不适合并行
    description: [
      "Hand off control to a named agent. The agent's reply is shown directly " +
        "to the user as the FINAL answer — YOU (the commander) do NOT continue " +
        "after this. The turn ends.",
      "Use when: the user's request is fully satisfied by delegating to a " +
        "specialist, and no further synthesis is needed.",
      "Requires `to` (agent_id). This is a terminal tool — the turn ends after it.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The complete request to delegate to the agent.",
        },
        to: {
          type: "string",
          description: "REQUIRED agent_id to hand off to.",
        },
      },
      required: ["task", "to"],
      additionalProperties: false,
    },
    async execute(input, ctx): Promise<ToolResult> {
      const task = String(input.task || "").trim();
      if (!task) return { content: "hand_off_to: `task` is required", isError: true };

      try {
        const { actor, result } = await _executeDispatch(input, {
          ...opts,
          signal: ctx.signal ?? opts.signal,
          workingDir: ctx.workingDir ?? opts.workingDir,
          onWorkerEvent: opts.onWorkerEvent,
        });

        // 交出控制权：结果直接输出，endTurn 终止回合
        const name = actor.name || actor.id;
        const label = `\n## 🎯 ${name} 回答：\n\n`;
        return { content: `${label}${result}`, endTurn: true };
      } catch (err) {
        return { content: `hand_off_to: ${(err as Error).message}`, isError: true };
      }
    },
  });

  return [runWorker, dispatchTo, handOffTo];
}

// ============================================================
// 工具过滤
// ============================================================

/**
 * 从工具集中移除调度工具（worker/命名 agent 使用此过滤后的列表）。
 */
export function withoutDispatchTools(tools: AgentTool[]): AgentTool[] {
  const dispatchNames = new Set(["run_worker", "dispatch_to", "hand_off_to"]);
  return tools.filter((t) => !dispatchNames.has(t.name));
}
