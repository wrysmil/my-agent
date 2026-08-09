import type { ThinkingContent } from "../../shared/types.js";
import type { ApiProtocol, ReasoningConfig } from "../types.js";
import type { ThinkingAdapter } from "./types.js";

/**
 * Anthropic Messages API 的 ThinkingAdapter。
 *
 * Anthropic extended thinking 使用 thinking content block + signature：
 * - 请求：`{ thinking: { type: "enabled", budget_tokens: N } }`
 * - 响应：thinking block 带有 signature，后续轮次必须原样回传
 * - 跨 api 回放：signature 只在 anthropic-messages 协议内有效
 *
 * Orkas pi-provider.ts 参考：signature 通过 JSON.parse 试探跨协议兼容性。
 */
export class AnthropicMessagesThinkingAdapter implements ThinkingAdapter {
  readonly api: ApiProtocol = "anthropic-messages";

  /** ReasoningLevel → budget_tokens 映射 */
  private static readonly BUDGET_MAP: Record<string, number> = {
    minimal: 1024,
    low: 4096,
    medium: 8192,
    high: 16000,
  };

  extractFromRequest(reasoning: ReasoningConfig): unknown {
    if (reasoning.level === "off") return {};
    const budgetTokens =
      AnthropicMessagesThinkingAdapter.BUDGET_MAP[reasoning.level] ?? 4096;
    return {
      thinking: {
        type: "enabled",
        budget_tokens: Math.min(
          budgetTokens,
          reasoning.budgetTokens ?? budgetTokens,
        ),
      },
    };
  }

  extractFromResponse(message: unknown): ThinkingContent | null {
    if (!message) return null;
    const m = message as Record<string, unknown>;
    if (m.type !== "thinking") return null;

    const thinking =
      typeof m.thinking === "string" ? m.thinking : undefined;
    if (!thinking) return null;

    return {
      type: "thinking",
      thinking,
      thinkingSignature:
        typeof m.signature === "string" ? m.signature : undefined,
      api: "anthropic-messages",
    };
  }

  reconcileForReplay(
    prev: ThinkingContent,
    targetApi: ApiProtocol,
  ): ThinkingContent | null {
    // 同协议：保留原始签名
    if (targetApi === "anthropic-messages") return prev;

    // 转到 OpenAI 协议：去掉 Anthropic 签名（OpenAI 不认识）
    if (
      targetApi === "openai-completions" ||
      targetApi === "openai-responses"
    ) {
      // 尝试 JSON.parse 试探 thinkingSignature 是否可编码为 JSON 字符串
      // 参考 Orkas pi-provider.ts:141-173 模式
      if (prev.thinkingSignature) {
        try {
          JSON.parse(prev.thinkingSignature);
        } catch {
          // signature 不是有效 JSON，OpenAI 无法处理 → 丢弃
        }
      }
      // 去掉 signature，只保留 reasoning content
      return {
        type: "thinking",
        thinking: prev.thinking,
        thinkingSignature: prev.thinkingSignature,
        api: targetApi,
      };
    }

    // 不支持的协议
    return null;
  }
}
