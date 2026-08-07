import { Semaphore } from "async-mutex";
import type { Actor } from "./actor.js";
import { actorSessionId } from "./actor.js";
import { buildWorkerSystemPrompt } from "./workflow.js";
import { withoutDispatchTools } from "./tools.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import { Session } from "../agent/session.js";
import { AgentRunner } from "../agent/runner.js";
import type { AgentRunResult } from "../agent/types.js";
import type { CoreAgentConfig } from "../config/schema.js";

// ============================================================
// dispatchSlots — 嵌套调度并发上限
// ============================================================

const DISPATCH_CONCURRENCY = Number(
  process.env.MY_AGENT_MAX_DISPATCH_CONCURRENCY ?? "4",
);
export const dispatchSlots = new Semaphore(DISPATCH_CONCURRENCY);

// ============================================================
// runNestedDispatch
// ============================================================

/**
 * 执行一次嵌套子调度：在独立子 session + 子 Runner 中运行一个
 * 匿名 worker，并把结果以 `<worker-result>` / `<worker-error>` XML
 * 信封交回调用方（指挥官）。
 *
 * 要点：
 * - **abort 级联**：子 AbortController 链接父 signal，父级中止时子回合随之取消。
 * - **并发边界**：通过 `dispatchSlots` Semaphore 限制同时运行的嵌套调度数。
 * - **配置继承**：子 Runner 复用主 Runner 的 ProviderRegistry 与宿主传入的
 *   `config`（AgentRunner.config 为 private，必须由调用方持有并传入）。
 */
export async function runNestedDispatch(opts: {
  cid: string;
  actor: Actor;
  task: string;
  config: CoreAgentConfig;
  parentSignal?: AbortSignal;
  getRunner: () => AgentRunner;
  workingDir?: string;
  attachments?: string[];
}): Promise<string> {
  // 1. abort 级联
  const ac = new AbortController();
  const abortHandler = () => ac.abort();
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) ac.abort();
    else opts.parentSignal.addEventListener("abort", abortHandler, { once: true });
  }

  // 2. 构建 session id（宿主侧追踪；S2 持久化 worker 会话时使用）
  const sessionId = actorSessionId(opts.cid, opts.actor);

  // 3. 构建 system prompt
  const systemPrompt = buildWorkerSystemPrompt({
    name: opts.actor.name || "Worker",
    workingDir: opts.workingDir,
  });

  // 4. 准备工具集（基础工具 - 调度工具）
  const workerTools = withoutDispatchTools(BUILTIN_TOOLS);

  // 5. 组装 task 信封
  const messageText = buildWorkerTaskEnvelope(opts.actor, opts.task, opts.attachments);

  // 6. 并发边界：dispatchSlots
  const [, release] = await dispatchSlots.acquire();
  try {
    // 7. 创建子 session + runner + 执行
    const workerSession = new Session();
    const parentRunner = opts.getRunner();
    const providers = parentRunner.getProviders();

    const workerRunner = new AgentRunner({
      config: opts.config,
      providers,
      tools: workerTools,
      session: workerSession,
    });

    // 8. 执行子回合
    const result: AgentRunResult = await workerRunner.run({
      message: messageText,
      systemPrompt,
      signal: ac.signal,
      workingDir: opts.workingDir,
      // 宿主私有元数据（不进入模型上下文），用于追踪本次嵌套调度
      requestMetadata: sessionId ? { sessionId } : undefined,
    });

    // 9. 分类结果
    return classifyWorkerOutcome(opts.actor, result, ac.signal.aborted);

  } finally {
    opts.parentSignal?.removeEventListener("abort", abortHandler);
    release();
  }
}

// ============================================================
// 辅助
// ============================================================

function buildWorkerTaskEnvelope(
  actor: Actor,
  task: string,
  attachments?: string[],
): string {
  const lines = [
    `<task from="commander" to="${escapeXml(actor.id)}">`,
    task,
    `</task>`,
  ];
  if (attachments?.length) {
    lines.push(
      "",
      "<attachments>",
      ...attachments.map((a) => `  ${a}`),
      "</attachments>",
    );
  }
  return lines.join("\n");
}

/**
 * 将 worker 回合结果分类为三种输出：
 * - abort → `<worker-error aborted="true">`
 * - 运行时错误 → `<worker-error>`
 * - 成功 → `<worker-result>`
 */
function classifyWorkerOutcome(
  actor: Actor,
  result: AgentRunResult,
  aborted: boolean,
): string {
  const name = escapeXml(actor.name || actor.id);

  if (aborted) {
    return buildWorkerErrorPayload(name, result.text || "Worker aborted.", true);
  }

  if (result.meta?.error) {
    return buildWorkerErrorPayload(name, result.meta.error.message);
  }

  return buildWorkerResultPayload(name, result.text);
}

function buildWorkerResultPayload(name: string, text: string): string {
  const body = text?.trim() || "(no textual reply)";
  return `<worker-result from="${name}">\n${body}\n</worker-result>`;
}

function buildWorkerErrorPayload(
  name: string,
  message: string,
  aborted = false,
): string {
  const abortedAttr = aborted ? ' aborted="true"' : "";
  const body = escapeXml(message || "Worker failed without an error message.");
  return `<worker-error from="${name}"${abortedAttr}>\n${body}\n</worker-error>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
