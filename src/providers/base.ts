import type { Message, StreamEvent, StopReason, Usage } from "../shared/types.js";

// ============================================================
// ToolDefinition — LLM function calling 的工具定义
// ============================================================
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// ============================================================
// CompletionParams — LLM completion 请求的参数
// ============================================================
export type CompletionParams = {
  model: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  /** 用于取消的中止信号。 */
  signal?: AbortSignal;
  /** Thinking/reasoning 级别。 */
  reasoning?: "off" | "minimal" | "low" | "medium" | "high";
  /** prompt-cache TTL 策略。 */
  cacheRetention?: "none" | "short" | "long";
  /** 用作 prompt_cache_key 的稳定标识符。 */
  sessionId?: string;
  /** 供 provider 适配器使用的宿主私有元数据。 */
  requestMetadata?: Record<string, unknown>;
};

// ============================================================
// CompletionResult — 非流式 completion 结果
// ============================================================
export type CompletionResult = {
  content: Message["content"];
  stopReason: StopReason;
  usage: Usage;
  model: string;
};

// ============================================================
// LLMProvider — 抽象 LLM provider 接口
// ============================================================
export interface LLMProvider {
  readonly id: string;
  readonly name: string;

  /** 创建流式 completion。产出 StreamEvent 项。 */
  stream(params: CompletionParams): AsyncIterable<StreamEvent>;

  /** 创建非流式 completion。 */
  complete?(params: CompletionParams): Promise<CompletionResult>;

  /** 测试该 provider 的凭证是否有效。 */
  validateAuth(): Promise<boolean>;
}

// ============================================================
// ProviderFactory — Provider 工厂函数
// ============================================================
export type ProviderFactory = (config: {
  apiKey?: string;
  baseUrl?: string;
}) => LLMProvider;
