import type { ThinkingContent } from "../../shared/types.js";
import type { ApiProtocol, ReasoningConfig } from "../types.js";
import type { ThinkingAdapter } from "./types.js";

export class OpenAiCompletionsThinkingAdapter implements ThinkingAdapter {
  readonly api = "openai-completions" as const;

  extractFromRequest(reasoning: ReasoningConfig): unknown {
    if (reasoning.level === "off") return {};
    return { thinking: { type: "enabled" }, reasoning_effort: reasoning.level };
  }

  extractFromResponse(message: unknown): ThinkingContent | null {
    if (!message) return null;
    const m = message as Record<string, unknown>;
    const reasoning =
      typeof m.reasoning_content === "string" ? m.reasoning_content : undefined;
    if (!reasoning) return null;
    return {
      type: "thinking",
      thinking: reasoning,
      thinkingSignature: "reasoning_content",
      api: "openai-completions",
    };
  }

  reconcileForReplay(
    prev: ThinkingContent,
    targetApi: ApiProtocol,
  ): ThinkingContent | null {
    if (targetApi === "openai-completions") return prev;
    if (targetApi === "openai-responses") {
      if (!prev.thinkingSignature) return null;
      try {
        JSON.parse(prev.thinkingSignature);
        return { ...prev, api: "openai-responses" };
      } catch {
        return null;
      }
    }
    return null;
  }
}
