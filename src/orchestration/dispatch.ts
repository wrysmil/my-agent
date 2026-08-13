import { Semaphore } from "async-mutex";
import type { Actor } from "./actor.js";
import { actorSessionId } from "./actor.js";
import type { AgentSpec } from "./agent-spec.js";
import {
  buildWorkerSystemPrompt,
  buildNamedAgentSystemPrompt,
} from "./workflow.js";
import { withoutDispatchTools } from "./tools.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import { Session } from "../agent/session.js";
import { AgentRunner } from "../agent/runner.js";
import type { AgentRunResult, AgentRunMeta } from "../agent/types.js";
import type { CoreAgentConfig } from "../config/schema.js";

// ============================================================
// WorkerProgressEvent — worker/agent 流式事件（透传给宿主 UI）
// ============================================================

export type WorkerProgressEvent =
  | { type: "text_delta"; actor: Actor; text: string }
  | { type: "tool_start"; actor: Actor; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; actor: Actor; name: string; result: string; isError: boolean }
  | { type: "agent_reply"; actor: Actor; text: string; isFinal: boolean }
  // ---- WU-01：子 Agent 实时气泡渲染事件 ----
  | { type: "dispatch_started"; actor: Actor; toolName: string; isFinal: boolean }
  | { type: "worker_step_start"; actor: Actor; kind: string; label: string; stepId: string }
  | { type: "worker_text_delta"; actor: Actor; text: string; stepId: string }
  | { type: "worker_step_end"; actor: Actor; stepId: string; summary: string; isError: boolean }
  | { type: "dispatch_done"; actor: Actor; toolName: string };

// ============================================================
// dispatchSlots — 嵌套调度并发上限
// ============================================================

const DISPATCH_CONCURRENCY = (() => {
  const raw = Number(process.env.MY_AGENT_MAX_DISPATCH_CONCURRENCY ?? "4");
  return Math.max(1, Math.trunc(raw) || 4);
})();
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
  agentSpec?: AgentSpec; // S2：命名 agent 规格
  /** 可选流式回调：设置后 worker 的 text_delta/tool_start/tool_end 会实时推送给宿主 UI */
  onWorkerEvent?: (ev: WorkerProgressEvent) => void;
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
  const systemPrompt = opts.agentSpec
    ? buildNamedAgentSystemPrompt(opts.agentSpec, opts.workingDir)
    : buildWorkerSystemPrompt({
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

    // 8. 执行子回合 — 双路径：
    //    - onWorkerEvent 存在 → 流式（runStream），实时转发事件给宿主 UI
    //    - onWorkerEvent 缺失 → 阻塞（run），仅返回最终结果（向后兼容）
    try {
      if (opts.onWorkerEvent) {
        // ---- 流式路径：转发 worker 事件给宿主 ----
        const preamble = `\n🐝 子Agent [${opts.actor.name}] 工作中...\n`;
        opts.onWorkerEvent({ type: "text_delta", actor: opts.actor, text: preamble });
        opts.onWorkerEvent({ type: "worker_text_delta", actor: opts.actor, text: preamble, stepId: "" });
        let lastText = "";
        let lastMeta: AgentRunMeta | undefined;
        // 步骤 id：按 actor 内递增，唯一标识 worker 的 thinking/tool 步骤
        let stepSeq = 0;
        let openStepId = "";

        for await (const ev of workerRunner.runStream({
          message: messageText,
          systemPrompt,
          signal: ac.signal,
          workingDir: opts.workingDir,
          requestMetadata: sessionId ? { sessionId } : undefined,
        })) {
          switch (ev.type) {
            case "text_delta":
              lastText += ev.text;
              opts.onWorkerEvent({ type: "text_delta", actor: opts.actor, text: ev.text });
              opts.onWorkerEvent({
                type: "worker_text_delta",
                actor: opts.actor,
                text: ev.text,
                stepId: openStepId,
              });
              break;
            case "tool_start":
              stepSeq += 1;
              openStepId = `step:${stepSeq}`;
              opts.onWorkerEvent({
                type: "worker_step_start",
                actor: opts.actor,
                kind: "tool",
                label: ev.name,
                stepId: openStepId,
              });
              opts.onWorkerEvent({
                type: "tool_start", actor: opts.actor,
                name: ev.name, input: (ev as any).input ?? {},
              });
              break;
            case "tool_end":
              opts.onWorkerEvent({
                type: "worker_step_end",
                actor: opts.actor,
                stepId: openStepId,
                summary: String((ev as any).result ?? ""),
                isError: !!(ev as any).isError,
              });
              openStepId = "";
              opts.onWorkerEvent({
                type: "tool_end", actor: opts.actor,
                name: (ev as any).name ?? "",
                result: String((ev as any).result ?? ""),
                isError: !!(ev as any).isError,
              });
              break;
            case "tool_delta":
              // tool_delta 不单独转发，由 tool_start/tool_end 成对处理
              break;
            case "done":
              lastMeta = ev.result.meta;
              break;
          }
        }

        // 流式路径的结果分类（从累积的 text 和 meta 构建）
        const actorName = escapeXml(opts.actor.name || opts.actor.id);
        if (ac.signal.aborted) {
          return buildWorkerErrorPayload(actorName, lastText || "Worker aborted.", true);
        }
        if (lastMeta?.error) {
          return buildWorkerErrorPayload(actorName, lastMeta.error.message);
        }
        return buildWorkerResultPayload(actorName, lastText);
      }

      // ---- 阻塞路径：传统方式（向后兼容） ----
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
    } catch (err) {
      // runner 异常（如 "stream ended without done"）统一归入 worker-error 信封
      const name = escapeXml(opts.actor.name || opts.actor.id);
      const msg = err instanceof Error ? err.message : String(err);
      return buildWorkerErrorPayload(name, msg);
    }

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
  const raw = text?.trim() || "(no textual reply)";
  const body = escapeXml(raw);
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

const WORKER_RESULT_RE = /<worker-result[^>]*>([\s\S]*?)<\/worker-result>/;
const WORKER_ERROR_RE = /<worker-error[^>]*>([\s\S]*?)<\/worker-error>/;

/**
 * 从 `<worker-result>` / `<worker-error>` XML 信封中取出纯文本内容并反转义 XML 实体。
 * 无信封时原样返回。
 */
export function unwrapWorkerPayload(result: string): string {
  const match = WORKER_RESULT_RE.exec(result) ?? WORKER_ERROR_RE.exec(result);
  if (!match) return result;
  return unescapeXml(match[1].trim());
}

/** 反转义 XML 实体。`&amp;` 必须最后替换，避免 `&amp;lt;` 被二次错误解码。 */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
