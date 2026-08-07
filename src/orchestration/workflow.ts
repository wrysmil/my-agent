import {
  buildSystemPrompt,
  buildDefaultSystemPrompt,
} from "../prompts/system-prompt-builder.js";
import type { AgentSpec } from "./agent-spec.js";

/**
 * 匿名 worker 的分步程序（注入 system prompt）。
 *
 * 四条规则：
 * 1. 边界约束 — 完成一件事，是手不是脑
 * 2. 无用户 — 不提问、不表单、自己做假设
 * 3. 结果完整 — verbatim 交回指挥官
 * 4. 大工件落文件 — 防撑爆父上下文
 */
export const WORKER_WORKFLOW = [
  "You are an ephemeral worker spun up by the commander to complete ONE bounded sub-task — " +
    "you are the commander's hands, not an independent specialist.",

  "The task is in the incoming message. Do it end to end using your available tools " +
    "(files, shell, web, search, etc.).",

  "There is no user in this turn: never ask a question, request input, or emit a form — " +
    "if something is ambiguous, make the most reasonable assumption and state it in your result.",

  "Your reply is handed back to the commander verbatim (not shown to anyone else), " +
    "so return the COMPLETE result it needs to act on. Put large artifacts in files and " +
    "reference their paths; keep the reply itself focused on the result and any pointers.",
].join(" ");

export function buildWorkerSystemPrompt(params: {
  name?: string;
  workingDir?: string;
}): string {
  // 复用 buildDefaultSystemPrompt 的 fallback 模板
  const base = buildDefaultSystemPrompt(
    "Always respond in Chinese. Use Chinese for all explanations and communications.",
  );
  return [
    base,
    "",
    "## Worker constraints",
    WORKER_WORKFLOW,
  ].join("\n");
}

/**
 * 命名 agent 的 system prompt。
 *
 * 使用完整模板体系（buildSystemPrompt）+ 注入 agent.json 的 workflow 字段。
 * 与匿名 worker 不同，命名 agent 有独立身份、可自定义分步程序。
 */
export function buildNamedAgentSystemPrompt(
  spec: AgentSpec,
  workingDir?: string,
): string {
  const assembly = buildSystemPrompt({
    name: spec.name,
    workingDir,
  });

  const workflowBlock = spec.workflow
    ? `\n\n## Workflow\n\n${spec.workflow}`
    : "\n\n## Workflow\n\n(not provided)";

  return assembly.systemPrompt + workflowBlock;
}
