import type { ContentBlockCodec } from "./types.js";
import type { MessageContent, StopReason } from "../../shared/types.js";
import type { ApiProtocol, ModelCapabilities } from "../types.js";
import type { ToolDefinition } from "../base.js";
import { CapabilityUnsupportedError } from "../../shared/errors.js";

/**
 * Anthropic Messages API codec。
 *
 * 负责将内部 MessageContent 块编码为 Anthropic content block 格式，
 * 以及将 Anthropic 响应的 stop_reason 映射为内部 StopReason。
 *
 * 与 OpenAI codec 的核心差异：
 * - Anthropic content block 不携带 role（role 在父消息层级）
 * - thinking block 有 signature 字段，必须在后续轮次原样回传
 * - tool_result 嵌在 user 消息内（Anthropic 没有独立 tool role）
 * - 工具定义为 {name, description, input_schema}（无 type:"function" 包装）
 */
export class AnthropicMessagesCodec implements ContentBlockCodec {
  readonly api: ApiProtocol = "anthropic-messages";

  constructor(private readonly capabilities: ModelCapabilities) {}

  // ==========================================================
  // buildTools — ToolDefinition → Anthropic 工具格式
  // ==========================================================

  buildTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  // ==========================================================
  // mapStopReason — stop_reason → StopReason
  // ==========================================================

  mapStopReason(reason: string | null | undefined): StopReason {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      case "tool_use":
        return "tool_use";
      default:
        return "end_turn";
    }
  }

  // ==========================================================
  // inbound — Anthropic content block → MessageContent[]
  // ==========================================================

  inbound(block: unknown): MessageContent[] {
    const b = block as Record<string, unknown> | null;
    if (!b || typeof b.type !== "string") return [];

    switch (b.type) {
      case "text":
        if (typeof b.text === "string") {
          return [{ type: "text", text: b.text }];
        }
        return [];

      case "image": {
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const mediaType = (typeof source.media_type === "string"
            ? source.media_type
            : "image/png") as ImageContent["mediaType"];
          return [{ type: "image", data: source.data, mediaType }];
        }
        return [];
      }

      case "thinking":
        if (typeof b.thinking === "string") {
          return [
            {
              type: "thinking",
              thinking: b.thinking,
              thinkingSignature:
                typeof b.signature === "string" ? b.signature : undefined,
              api: "anthropic-messages",
            },
          ];
        }
        return [];

      case "tool_use": {
        const id = typeof b.id === "string" ? b.id : "";
        const name = typeof b.name === "string" ? b.name : "";
        const input =
          b.input && typeof b.input === "object"
            ? (b.input as Record<string, unknown>)
            : {};
        if (!id || !name) return [];
        return [{ type: "tool_use", id, name, input }];
      }

      case "tool_result": {
        const toolUseId =
          typeof b.tool_use_id === "string" ? b.tool_use_id : "";
        const content = typeof b.content === "string" ? b.content : "";
        if (!toolUseId) return [];
        return [{ type: "tool_result", toolUseId, content }];
      }

      default:
        return [];
    }
  }

  // ==========================================================
  // outbound — MessageContent → Anthropic content block
  // ==========================================================

  outbound(block: MessageContent): unknown {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };

      case "image": {
        // 视觉守门
        if (!this.capabilities.vision) {
          throw new CapabilityUnsupportedError(
            "vision not supported by this model",
            "vision",
            this.api,
          );
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: block.mediaType,
            data: block.data,
          },
        };
      }

      case "thinking":
        // Anthropic thinking block: 必须保留 signature 用于后续轮次回传
        return {
          type: "thinking",
          thinking: block.thinking,
          signature: block.thinkingSignature ?? "",
        };

      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        };

      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
          ...(block.isError ? { is_error: true } : {}),
        };

      default:
        return null;
    }
  }
}

// 导入 ImageContent 的 mediaType（仅用于 inbound 类型标注）
import type { ImageContent } from "../../shared/types.js";
