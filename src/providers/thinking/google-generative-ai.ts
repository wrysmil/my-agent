import type { ThinkingContent } from "../../shared/types.js";
import type { ApiProtocol, ReasoningConfig } from "../types.js";
import type { ThinkingAdapter } from "./types.js";

/**
 * Google Gemini 的 ThinkingAdapter。
 *
 * Gemini 2.5 Flash Thinking 使用 thinkingConfig:
 * - 请求：{ thinkingConfig: { thinkingBudget: N } }
 * - 响应：parts 带 thought: true 标记，或独立 thought 字段
 * - 跨 api 回放：thought 文本作为普通 text 传给其他协议
 */
export class GoogleThinkingAdapter implements ThinkingAdapter {
  readonly api: ApiProtocol = "google-generative-ai";

  private static readonly BUDGET_MAP: Record<string, number> = {
    minimal: 1024,
    low: 4096,
    medium: 8192,
    high: 16384,
  };

  extractFromRequest(reasoning: ReasoningConfig): unknown {
    if (reasoning.level === "off") return {};
    const budget =
      GoogleThinkingAdapter.BUDGET_MAP[reasoning.level] ?? 8192;
    return {
      thinkingConfig: {
        thinkingBudget: Math.min(
          budget,
          reasoning.budgetTokens ?? budget,
        ),
      },
    };
  }

  extractFromResponse(message: unknown): ThinkingContent | null {
    if (!message) return null;
    const m = message as Record<string, unknown>;

    // Gemini 2.5: thinking content in parts with thought:true flag
    // or as standalone thought field in the response
    const thoughtText =
      typeof m.thought === "string"
        ? m.thought
        : m.thought === true && typeof m.text === "string"
          ? m.text
          : undefined;

    if (!thoughtText) return null;

    return {
      type: "thinking",
      thinking: thoughtText,
      api: "google-generative-ai",
    };
  }

  reconcileForReplay(
    prev: ThinkingContent,
    targetApi: ApiProtocol,
  ): ThinkingContent | null {
    // 同协议：原样保留
    if (targetApi === "google-generative-ai") return prev;

    // 转到其他协议：去掉 Gemini 特有的 thought 标记
    // thinking 文本转为普通 text（参考 Orkas 跨协议兼容模式）
    if (
      targetApi === "openai-completions" ||
      targetApi === "openai-responses" ||
      targetApi === "anthropic-messages"
    ) {
      return {
        type: "thinking",
        thinking: prev.thinking,
        api: targetApi,
      };
    }

    return null;
  }
}
