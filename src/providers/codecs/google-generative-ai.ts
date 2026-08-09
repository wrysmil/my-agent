import type { ContentBlockCodec } from "./types.js";
import type { MessageContent, StopReason } from "../../shared/types.js";
import type { ApiProtocol, ModelCapabilities } from "../types.js";
import type { ToolDefinition } from "../base.js";
import { CapabilityUnsupportedError } from "../../shared/errors.js";
import type { ImageContent } from "../../shared/types.js";

/**
 * Google Generative AI (Gemini) codec。
 *
 * 与 OpenAI/Anthropic 的核心差异：
 * - 无 message role 概念，使用 contents[].role ("user"|"model"|"function")
 * - 系统指令：顶层 systemInstruction（非 messages 内）
 * - 图像：inlineData { mimeType, data }（非 image_url）
 * - 工具：functionDeclarations 数组（非 type:"function" 包装）
 * - 思考：thought 字段（Gemini 2.5 Flash Thinking）
 * - 工具结果：role="function" + functionResponse part
 */
export class GoogleGenerativeAiCodec implements ContentBlockCodec {
  readonly api: ApiProtocol = "google-generative-ai";

  constructor(private readonly capabilities: ModelCapabilities) {}

  // ==========================================================
  // buildTools — ToolDefinition → functionDeclarations 格式
  // ==========================================================

  buildTools(tools: ToolDefinition[]): unknown[] {
    if (tools.length === 0) return [];
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      },
    ];
  }

  // ==========================================================
  // mapStopReason — finishReason → StopReason
  // ==========================================================

  mapStopReason(reason: string | null | undefined): StopReason {
    switch (reason) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      case "SAFETY":
        return "safety";
      case "RECITATION":
        return "content_filter";
      case "MALFORMED_FUNCTION_CALL":
        return "end_turn";
      case "FINISH_REASON_UNSPECIFIED":
        return "end_turn";
      default:
        return "end_turn";
    }
  }

  // ==========================================================
  // inbound — Gemini content part → MessageContent[]
  // ==========================================================

  inbound(block: unknown): MessageContent[] {
    const b = block as Record<string, unknown> | null;
    if (!b) return [];

    // text part
    if (typeof b.text === "string") {
      const results: MessageContent[] = [];
      if (b.thought === true) {
        results.push({
          type: "thinking",
          thinking: b.text,
          api: "google-generative-ai",
        });
      } else {
        results.push({ type: "text", text: b.text });
      }
      return results;
    }

    // functionCall part
    if (b.functionCall && typeof b.functionCall === "object") {
      const fc = b.functionCall as Record<string, unknown>;
      const name = typeof fc.name === "string" ? fc.name : "";
      const args =
        fc.args && typeof fc.args === "object"
          ? (fc.args as Record<string, unknown>)
          : {};
      return [{ type: "tool_use", id: name, name, input: args }];
    }

    // functionResponse part
    if (b.functionResponse && typeof b.functionResponse === "object") {
      const fr = b.functionResponse as Record<string, unknown>;
      const toolUseId = typeof fr.name === "string" ? fr.name : "";
      const response =
        fr.response && typeof fr.response === "object"
          ? JSON.stringify(fr.response)
          : typeof fr.response === "string"
            ? fr.response
            : "";
      return [{ type: "tool_result", toolUseId, content: response }];
    }

    // inlineData (image)
    if (b.inlineData && typeof b.inlineData === "object") {
      const id = b.inlineData as Record<string, unknown>;
      if (typeof id.data === "string") {
        const mimeType = (typeof id.mimeType === "string"
          ? id.mimeType
          : "image/png") as ImageContent["mediaType"];
        return [{ type: "image", data: id.data, mediaType: mimeType }];
      }
    }

    return [];
  }

  // ==========================================================
  // outbound — MessageContent → Gemini part
  // ==========================================================

  outbound(block: MessageContent): unknown {
    switch (block.type) {
      case "text":
        return { text: block.text };

      case "image": {
        if (!this.capabilities.vision) {
          throw new CapabilityUnsupportedError(
            "vision not supported by this model",
            "vision",
            this.api,
          );
        }
        return {
          inlineData: {
            mimeType: block.mediaType,
            data: block.data,
          },
        };
      }

      case "thinking":
        return {
          text: block.thinking,
          thought: true,
        };

      case "tool_use":
        return {
          functionCall: {
            name: block.name,
            args: block.input,
          },
        };

      case "tool_result":
        return {
          functionResponse: {
            name: block.toolUseId,
            response: { content: block.content },
          },
        };

      default:
        return null;
    }
  }
}
