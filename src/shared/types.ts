// ============================================================
// 消息角色
// ============================================================
export type MessageRole = "user" | "assistant" | "tool";

// ============================================================
// 消息内容块 —— 5 种子类型
// ============================================================

/** LLM 输出的纯文本。 */
export type TextContent = {
  type: "text";
  text: string;
};

/** 视觉模型的图像输入。 */
export type ImageContent = {
  type: "image";
  data: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

/** LLM 发出的 function-call 指令。 */
export type ToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** 工具执行后返回给 LLM 的结果。 */
export type ToolResultContent = {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
};

/** 推理模型的 chain-of-thought。必须在下一轮原样回传。 */
export type ThinkingContent = {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
};

/** 所有内容块的联合类型。 */
export type MessageContent =
  | TextContent
  | ImageContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

// ============================================================
// 消息
// ============================================================
export type Message = {
  role: MessageRole;
  content: MessageContent[];
};

// ============================================================
// Token 用量
// ============================================================
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
};

// ============================================================
// 停止原因
// ============================================================
export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence";

// ============================================================
// 流式事件（Provider → Runner 的事件流）
// ============================================================
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string }
  | { type: "message_start"; usage?: Partial<Usage> }
  | {
      type: "message_end";
      stopReason: StopReason;
      usage?: Partial<Usage>;
      content?: MessageContent[];
      model?: string;
    }
  | { type: "error"; error: Error };
