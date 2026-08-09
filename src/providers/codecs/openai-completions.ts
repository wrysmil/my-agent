import type { ContentBlockCodec } from "./types.js";
import type { MessageContent, StopReason } from "../../shared/types.js";
import type { ApiProtocol, ModelCapabilities } from "../types.js";
import type { ToolDefinition } from "../base.js";
import { CapabilityUnsupportedError } from "../../shared/errors.js";

/**
 * OpenAI Chat Completions API codec。
 *
 * 负责将内部 MessageContent 块编码为 OpenAI 兼容的请求格式，
 * 以及将 OpenAI 兼容响应的 finish_reason 映射为内部 StopReason。
 *
 * deepseek.ts 等兼容 provider 可复⽤该 codec 的 outbound / buildTools / mapStopReason。
 */
export class OpenAiCompletionsCodec implements ContentBlockCodec {
  readonly api: ApiProtocol = "openai-completions";

  constructor(private readonly capabilities: ModelCapabilities) {}

  // ==========================================================
  // buildTools — ToolDefinition → OpenAI function 格式
  // ==========================================================

  buildTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  // ==========================================================
  // mapStopReason — finish_reason → StopReason
  // ==========================================================

  mapStopReason(reason: string | null | undefined): StopReason {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "content_filter":
        return "content_filter";
      case "stop":
        return "end_turn";
      default:
        return "end_turn";
    }
  }

  // ==========================================================
  // inbound — 非流式路径，暂不实现完整逻辑
  // ==========================================================

  inbound(_message: unknown): MessageContent[] {
    return [];
  }

  // ==========================================================
  // outbound — MessageContent → OpenAI 兼容消息格式
  // ==========================================================

  outbound(block: MessageContent): unknown {
    switch (block.type) {
      case "text":
        return {
          role: "user",
          content: block.text,
        };

      case "image":
        // 视觉守门：按 model capability 决定是否允许
        if (!this.capabilities.vision) {
          throw new CapabilityUnsupportedError(
            "vision not supported by this model",
            "vision",
            this.api,
          );
        }
        return {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${block.mediaType};base64,${block.data}`,
              },
            },
          ],
        };

      case "thinking":
        return {
          role: "assistant",
          content: null,
          reasoning_content: block.thinking,
        };

      case "tool_use":
        return {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            },
          ],
        };

      case "tool_result":
        return {
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        };

      default:
        return null;
    }
  }
}
