/**
 * Chat 消息结构化内容块类型定义。
 *
 * 替代旧的 `ChatMessage = { role, text }` 简单模型，
 * 支持 text / thinking / tool_call / tool_result 等多种块类型。
 */

// ============================================================
// ContentBlock 基类型
// ============================================================

export type BlockStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface ContentBlock {
  id: string;
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result';
  status: BlockStatus;
  /** 服务端生成的稳定 block ID（P0+）。 */
  blockId?: string;
}

// ============================================================
// 具体块类型
// ============================================================

export interface TextBlock extends ContentBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock extends ContentBlock {
  type: 'thinking';
  thinking: string;
  /** 是否折叠（用户可切换） */
  collapsed: boolean;
}

export interface ToolCallBlock extends ContentBlock {
  type: 'tool_call';
  toolId: string;
  toolName: string;
  /** 流式累积的参数 JSON 字符串 */
  inputRaw: string;
  /** 参数完整时解析的对象 */
  input?: Record<string, unknown>;
}

export interface ToolResultBlock extends ContentBlock {
  type: 'tool_result';
  toolCallId: string;
  toolName: string;
  /** 工具输出内容 */
  content: string;
  isError: boolean;
  /** 执行耗时（毫秒） */
  durationMs?: number;
}

// ============================================================
// 消息
// ============================================================

export type Block = TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock;

export type ChatStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'reconnecting'
  | 'done'
  | 'error'
  | 'aborted';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** 结构化内容块（替代 text 字段） */
  blocks: Block[];
  /** 用户消息保留 text 快捷字段 */
  text?: string;
  /** 浏览器生成的用户消息 UUID（P0+）。同一次重试必须复用。 */
  clientMessageId?: string;
  /** 服务端生成的稳定消息 ID（P0+）。 */
  messageId?: string;
  /** 所属 run ID（P0+）。同一次发送的 user + assistant 消息共享。 */
  runId?: string;
  /**
   * 本地 overlay 等待 history 收敛的最低 revision。
   * 即使 session 级索引因 TTL/cap 淘汰，也用于阻止旧 history 覆盖当前内容。
   */
  pendingPersistenceRevision?: number;
  /** 流式过程中的状态提示 */
  streamState?: 'thinking' | 'generating' | 'tool_executing' | 'done';
  /** 当前活动的工具调用计数 */
  activeToolCount?: number;
  /** 流开始时间戳（用于计时器） */
  streamStartTime?: number;
  /** token 用量 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ChatOptions {
  model?: string;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}

// ============================================================
// SSE 事件数据类型
// ============================================================

export interface SseMessageStartData {
  type: 'message_start';
  message: {
    id: string;
    role: string;
    stream_id: string;
    cid: string;
    seq: number;
  };
}

export interface SseContentBlockStartData {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
  };
}

export interface SseContentBlockDeltaData {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
}

export interface SseThinkingDeltaData {
  type: 'thinking_delta';
  thinking: string;
}

export interface SseToolUseData {
  type: 'tool_use';
  id: string;
  name?: string;
  input: unknown;
  index?: number;
  partial?: boolean;
}

export interface SseToolResultData {
  type: 'tool_result';
  tool_use_id: string;
  tool_name?: string;
  content: string;
  is_error: boolean;
  duration_ms?: number;
}

export interface SseToolProgressData {
  type: 'tool_progress';
  tool_id: string;
  tool_name: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SseCompactionData {
  type: 'compaction';
  tokens_before: number;
  tokens_after: number;
  summary?: string;
  duration_ms?: number;
}

export interface SseContextStatusData {
  type: 'context_status';
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SseRetryData {
  type: 'retry';
  attempt: number;
  reason: string;
  wait_ms?: number;
}

export interface SseProviderFallbackData {
  type: 'provider_fallback';
  reason: string;
  provider_id: string;
}

export interface SseMessageDeltaData {
  type: 'message_delta';
  stop_reason: string;
  model?: string;
}

export interface SseMessageStopData {
  type: 'message_stop';
  stop_reason: string;
}

export interface SseUsageData {
  type: 'usage';
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface SseDoneData {
  ok: boolean;
  streamId?: string;
  runId?: string;
  messageId?: string;
  persistedRevision?: number;
  deduplicated?: boolean;
}

export interface SseErrorData {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export interface SsePingData {
  type: 'ping';
  ts: number;
}

export type SseEventData =
  | SseMessageStartData
  | SseContentBlockStartData
  | SseContentBlockDeltaData
  | SseThinkingDeltaData
  | SseToolUseData
  | SseToolResultData
  | SseToolProgressData
  | SseCompactionData
  | SseContextStatusData
  | SseRetryData
  | SseProviderFallbackData
  | SseMessageDeltaData
  | SseMessageStopData
  | SseUsageData
  | SseDoneData
  | SseErrorData
  | SsePingData
  | Record<string, unknown>;

// ============================================================
// P0 ChatStreamEnvelope — 所有 SSE 事件的统一外层
// ============================================================

/**
 * SSE 事件统一 envelope（P0+）。
 *
 * 每条 SSE 事件从 P0 开始均携带此结构，用于前端按 (sessionId, runId) 做身份校验和 seq 去重。
 */
export interface ChatStreamEnvelope {
  /** 数据属于哪个会话 */
  sessionId: string;
  /** 属于该会话的哪次发送 */
  runId: string;
  /** 本次 SSE 连接的 UUID（P0 首次连接时创建；P1 重连会创建新 streamId） */
  streamId: string;
  /** run 内每个物理 SSE frame 的唯一严格递增序号 */
  seq: number;
  /** SSE 事件名 */
  event: string;
  /** 事件载荷 */
  data: Record<string, unknown>;
}

// ============================================================
// SessionHistoryResponse — history API 返回格式（P0+）
// ============================================================

export interface SessionHistoryResponse {
  sessionId: string;
  /** 当前 JSONL 有效记录数；每成功 append 一条递增 */
  revision: number;
  messages: ChatMessage[];
}
