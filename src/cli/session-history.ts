/**
 * 历史会话渲染（chat.ts 恢复会话时展示历史内容）。
 *
 * 从 Session 的消息列表中提取「纯对话」轮次（user 文本 → assistant 文本），
 * 过滤 tool_use / tool_result / thinking 等内部块，按最近优先截断展示。
 */

import type { Session } from "../agent/session.js";
import type { Message, MessageContent } from "../shared/types.js";

export interface SessionHistoryOptions {
  /** 最多展示的轮数（更早的省略并提示）。默认 6。 */
  maxTurns?: number;
  /** 单条消息正文最大字符数（超过截断）。默认 200。 */
  maxTextLength?: number;
}

/** 提取消息中的纯文本（跳过 tool_use / tool_result / thinking / image 块） */
function extractText(msg: Message): string {
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("").trim();
}

/** 截断长文本（保留首尾，中段用 …） */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(-half)}`;
}

/**
 * 渲染历史会话为可打印文本。
 *
 * @param session — Session / PersistentSession 实例（从 getAllMessages() 读取）
 * @param opts — 展示轮数与截断上限
 * @returns 渲染文本；无对话消息时返回空串
 */
export function renderSessionHistory(
  session: Session,
  opts: SessionHistoryOptions = {},
): string {
  const { maxTurns = 6, maxTextLength = 200 } = opts;

  // 提取对话轮次：user 文本开新轮，assistant 文本挂在当前轮
  const turns: { user: string; assistant: string }[] = [];
  for (const msg of session.getAllMessages()) {
    const text = extractText(msg);
    if (!text) continue;
    if (msg.role === "user") {
      turns.push({ user: text, assistant: "" });
    } else if (msg.role === "assistant") {
      if (turns.length > 0) turns[turns.length - 1].assistant = text;
    }
  }

  if (turns.length === 0) return "";

  const total = turns.length;
  const shown = turns.slice(-maxTurns);
  const lines: string[] = [];
  lines.push("──────────────── 历史会话 ────────────────");
  if (total > maxTurns) {
    lines.push(`（共 ${total} 轮，显示最近 ${maxTurns} 轮，更早的已省略）`);
  }

  for (const t of shown) {
    if (t.user) {
      for (const line of t.user.split("\n")) {
        lines.push(`👤 ${truncate(line, maxTextLength)}`);
      }
    }
    if (t.assistant) {
      for (const line of t.assistant.split("\n")) {
        lines.push(`🤖 ${truncate(line, maxTextLength)}`);
      }
    }
    lines.push("");
  }

  lines.push("──────────────────────────────────────────");
  return lines.join("\n");
}
