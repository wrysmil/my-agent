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
