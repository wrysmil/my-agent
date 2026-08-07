import { defineTool, type AgentTool } from "../tools/base.js";
import type { Actor } from "./actor.js";
import { genWorkerId } from "./actor.js";
import type { AgentRunner } from "../agent/runner.js";
import type { CoreAgentConfig } from "../config/schema.js";

/**
 * 构建调度工具集（仅注入主会话）。
 * 当前仅含 `run_worker`；S2 追加 `run_worker(to)` 命名分支。
 *
 * `config` 与 `getRunner` 由宿主注入：
 * - `config` — 子 Runner 与主 Runner 共享同一份核心配置（AgentRunner.config 是 private，
 *   无法从主 Runner 读取，必须由调用方持有并传入）。
 * - `getRunner` — 运行时懒取主 Runner，用于继承 ProviderRegistry。
 */
export function buildDispatchTools(opts: {
  getRunner: () => AgentRunner;
  config: CoreAgentConfig;
  cid: string;
  workingDir?: string;
  signal?: AbortSignal;
}): AgentTool[] {
  return [
    defineTool({
      name: "run_worker",
      executionMode: "parallel",
      description: [
        "Run a bounded sub-task and get its FULL result handed back to YOU (the commander) " +
          "within this same call, so you can read it, synthesise, and decide the next step — " +
          "the in-loop coordinator pattern.",
        "Use this for a sub-task you own: a bounded job whose output you will build on, " +
          "or heavy scanning whose bulk you do not want to keep in your own context.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Sub-task instruction, sent verbatim to the worker.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      async execute(input, ctx) {
        const task = String(input.task || "").trim();
        if (!task) return { content: "run_worker: `task` is required", isError: true };

        const workerActor: Actor = {
          kind: "worker",
          id: genWorkerId(),
          name: "Worker",
        };

        // 动态 import 打破循环依赖：
        // dispatch.ts 静态 import tools.ts 的 withoutDispatchTools（纯函数），
        // tools.ts 仅在此处动态 import dispatch.ts 的 runNestedDispatch。
        const { runNestedDispatch } = await import("./dispatch.js");
        const result = await runNestedDispatch({
          cid: opts.cid,
          actor: workerActor,
          task,
          parentSignal: ctx.signal ?? opts.signal,
          getRunner: opts.getRunner,
          config: opts.config,
          workingDir: ctx.workingDir ?? opts.workingDir,
        });

        return { content: result };
      },
    }),
  ];
}

/**
 * 从工具集中移除调度工具（worker / 命名 agent 使用此过滤后的列表）。
 *
 * 移除 `run_worker` 以及 S2 预留的命名调度工具名，防止子 Agent 递归调度。
 */
export function withoutDispatchTools(tools: AgentTool[]): AgentTool[] {
  const dispatchNames = new Set(["run_worker", "dispatch_to", "hand_off_to"]);
  return tools.filter((t) => !dispatchNames.has(t.name));
}
