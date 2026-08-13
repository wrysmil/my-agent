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
  /** 稳定 block ID（P0+）。服务端生成 UUID；旧数据派生为 `{messageId}:{blockIndex}`。 */
  id?: string;
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
  /** 稳定 block ID（P0+）。格式为 `result:{toolUseId}`。 */
  id?: string;
};

/** 推理模型的 chain-of-thought。必须在下一轮原样回传。 */
export type ThinkingContent = {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  /** 标识思考内容来源的 Provider API 形态。 */
  api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai" | "custom";
  /** 稳定 block ID（P0+）。服务端生成 UUID；旧数据派生为 `{messageId}:{blockIndex}`。 */
  id?: string;
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
  /** UI 轮次身份。由 Session 分配，从面向 provider 的投影中剥离。 */
  turnId?: number;
  /** 稳定消息 ID（P0+）。服务端生成 UUID；旧数据派生为 `legacy:{sha256}`。 */
  id?: string;
  /** 所属 run ID（P0+）。同一次发送的 user + assistant 消息共享。 */
  runId?: string;
  /**
   * 压缩后仅用于保留 clientMessageId 与原始 payload 的身份锚点。
   * 身份锚点继续参与幂等校验，但不会投影给 provider 或计入上下文 token。
   */
  compactionIdentityAnchor?: boolean;
};

// ============================================================
// Token 用量
// ============================================================
export type Usage = {
  inputTokens: number;
  outputTokens: number;
  /** 推理模型产生的思考 token 数（部分 provider 单独上报）。 */
  reasoningTokens?: number;
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
  | "stop_sequence"
  | "content_filter"
  | "refusal"
  | "safety";

// ============================================================
// 流式事件（Provider → Runner 的事件流）
// ============================================================
export type StreamEvent =
  // ---- 文本流 ----
  | { type: "text_delta"; text: string }
  // ---- 思考流（extended thinking） ----
  | { type: "thinking_delta"; thinking: string }
  // ---- 工具调用流（Provider 层） ----
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string }
  // ---- 工具执行事件（Runner 层：AgentRunEvent 直接映射） ----
  | { type: "tool_start"; name: string; id: string; input: unknown; actorName?: string; actorKind?: string }
  | { type: "tool_delta"; name?: string; id: string; inputDelta: string; inputBytes?: number }
  | { type: "tool_progress"; name: string; id: string; phase?: string; message: string; data?: Record<string, unknown> }
  | { type: "tool_end"; name: string; id: string; result: string; isError?: boolean; durationMs?: number; actorName?: string; actorKind?: string }
  // ---- 上下文管理 ----
  | { type: "compaction"; tokensBefore: number; tokensAfter: number; summary?: string; durationMs?: number }
  | { type: "context_status"; phase: string; message: string; data?: Record<string, unknown> }
  | { type: "retry"; attempt: number; reason: string; waitMs?: number }
  | { type: "provider_fallback"; reason: string; providerId: string }
  // ---- 生命周期 ----
  | { type: "message_start"; usage?: Partial<Usage> }
  | {
      type: "message_end";
      stopReason: StopReason;
      usage?: Partial<Usage>;
      content?: MessageContent[];
      model?: string;
    }
  // ---- 思考完成 ----
  | { type: "thinking_complete"; text: string; durationMs: number }
  // ---- 子 Agent 消息 ----
  | {
      type: "agent_message";
      actorId: string;
      actorName: string;
      actorKind: string;
      text: string;
      isFinal: boolean;
    }
  // ---- 子 Agent 派发 / worker 步骤（实时气泡渲染）----
  | {
      type: "dispatch_started";
      actorId: string;
      actorName: string;
      toolName: string;
      toolId: string;
      isFinal: boolean;
    }
  | { type: "worker_step_start"; actorId: string; kind: string; label: string; stepId: string }
  | { type: "worker_text_delta"; actorId: string; text: string; stepId: string }
  | { type: "worker_step_end"; actorId: string; stepId: string; summary: string; isError: boolean }
  | { type: "dispatch_done"; actorId: string; toolName: string }
  // ---- 终止 ----
  | { type: "done"; result?: unknown }
  | { type: "error"; error: Error };
