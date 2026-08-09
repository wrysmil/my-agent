import type { CompletionParams, CompletionResult } from "./base.js";
import { AbstractLLMProvider } from "./base.js";
import type { StreamEvent, Message, MessageContent } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";
import { AnthropicMessagesCodec } from "./codecs/anthropic-messages.js";
import { AnthropicMessagesThinkingAdapter } from "./thinking/anthropic-messages.js";
import type { ModelCapabilities, ReasoningLevel } from "./types.js";

// ============================================================
// Anthropic Messages API 类型
// ============================================================

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: unknown[];
};

type AnthropicSSEEvent =
  | { type: "message_start"; message: { id: string; model: string; usage: { input_tokens: number } } }
  | { type: "content_block_start"; index: number; content_block: AnthropicContentBlock }
  | { type: "content_block_delta"; index: number; delta: AnthropicContentBlockDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string | null; stop_sequence: string | null }; usage: { output_tokens: number } }
  | { type: "message_stop" }
  | { type: "ping" };

type AnthropicContentBlockDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "input_json_delta"; partial_json: string };

// ============================================================
// Anthropic 默认模型能力
// ============================================================

const ANTHROPIC_DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: true,
  tool_use: true,
  thinking: true,
  json_mode: true,
  prompt_caching: true,
  streaming: true,
};

// ============================================================
// AnthropicProvider
// ============================================================

export class AnthropicProvider extends AbstractLLMProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic";

  protected readonly codec: AnthropicMessagesCodec;
  protected readonly thinkingAdapter: AnthropicMessagesThinkingAdapter;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    capabilities?: Partial<ModelCapabilities>;
  }) {
    super();
    const caps: ModelCapabilities = {
      ...ANTHROPIC_DEFAULT_CAPABILITIES,
      ...opts.capabilities,
    };
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
    this.codec = new AnthropicMessagesCodec(caps);
    this.thinkingAdapter = new AnthropicMessagesThinkingAdapter();
  }

  // ==========================================================
  // AbstractLLMProvider 抽象方法覆写
  // ==========================================================

  protected buildRequestBody(params: CompletionParams): unknown {
    const { system, messages } = this.convertMessages(
      params.messages,
      params.systemPrompt,
    );
    const tools = this.codec.buildTools(params.tools ?? []);
    const thinkingFields = this.thinkingAdapter.extractFromRequest({
      level: (params.reasoning || "off") as ReasoningLevel,
    });

    return {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(thinkingFields as Record<string, unknown>),
      ...(params.stopSequences?.length
        ? { stop_sequences: params.stopSequences }
        : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.topP != null ? { top_p: params.topP } : {}),
      stream: true,
    };
  }

  protected async *parseStreamChunk(
    _chunk: string,
  ): AsyncIterable<StreamEvent> {
    // Stream 解析逻辑在覆写的 stream() 中完整实现
  }

  protected classifyError(err: unknown): Error {
    if (
      err instanceof AuthError ||
      err instanceof RateLimitError ||
      err instanceof ProviderError
    ) {
      return err;
    }
    return new ProviderError(
      `Anthropic error: ${formatError(err)}`,
      "anthropic",
      undefined,
      err instanceof Error ? err : undefined,
    );
  }

  // ==========================================================
  // 流式 Completion（Anthropic SSE event 格式）
  // ==========================================================

  async *stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    const body = this.buildRequestBody(params);
    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ProviderError("No response body from Anthropic", "anthropic");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    // 聚合状态
    let model = params.model;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let currentEvent = "";

    // Content block 聚合
    type AccumulatedBlock = {
      type: string;
      text: string;
      thinking: string;
      signature: string;
      toolId: string;
      toolName: string;
      toolInput: string;
      started: boolean;
    };
    const blocks = new Map<number, AccumulatedBlock>();

    function getBlock(index: number): AccumulatedBlock {
      let block = blocks.get(index);
      if (!block) {
        block = {
          type: "",
          text: "",
          thinking: "",
          signature: "",
          toolId: "",
          toolName: "",
          toolInput: "",
          started: false,
        };
        blocks.set(index, block);
      }
      return block;
    }

    try {
      yield { type: "message_start" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Anthropic SSE: 以 \n\n 分隔事件
        while (buffer.includes("\n\n")) {
          const idx = buffer.indexOf("\n\n");
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          // 解析 event: <type> 和 data: <json>
          let eventType = "";
          let eventData = "";
          for (const line of rawEvent.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6).trim();
            }
          }

          if (!eventData) continue;
          currentEvent = eventType || currentEvent;

          let parsed: AnthropicSSEEvent;
          try {
            parsed = JSON.parse(eventData);
          } catch {
            continue;
          }

          switch (parsed.type) {
            case "message_start": {
              model = parsed.message.model ?? model;
              inputTokens = parsed.message.usage?.input_tokens ?? 0;
              break;
            }

            case "content_block_start": {
              const blk = getBlock(parsed.index);
              blk.type = parsed.content_block.type;
              blk.started = true;

              switch (parsed.content_block.type) {
                case "text":
                  blk.text = parsed.content_block.text ?? "";
                  break;
                case "thinking":
                  blk.thinking = parsed.content_block.thinking ?? "";
                  blk.signature = parsed.content_block.signature ?? "";
                  break;
                case "tool_use":
                  blk.toolId = parsed.content_block.id ?? "";
                  blk.toolName = parsed.content_block.name ?? "";
                  blk.type = "tool_use";
                  yield {
                    type: "tool_use_start",
                    id: blk.toolId,
                    name: blk.toolName,
                  };
                  break;
              }
              break;
            }

            case "content_block_delta": {
              const blk = getBlock(parsed.index);
              switch (parsed.delta.type) {
                case "text_delta":
                  blk.text += parsed.delta.text;
                  yield { type: "text_delta", text: parsed.delta.text };
                  break;
                case "thinking_delta":
                  blk.thinking += parsed.delta.thinking;
                  yield {
                    type: "thinking_delta",
                    thinking: parsed.delta.thinking,
                  };
                  break;
                case "input_json_delta":
                  blk.toolInput += parsed.delta.partial_json;
                  yield {
                    type: "tool_use_delta",
                    id: blk.toolId,
                    input: parsed.delta.partial_json,
                  };
                  break;
              }
              break;
            }

            case "content_block_stop": {
              const blk = getBlock(parsed.index);
              if (blk.type === "tool_use") {
                yield { type: "tool_use_end", id: blk.toolId };
              }
              break;
            }

            case "message_delta": {
              stopReason = parsed.delta.stop_reason ?? stopReason;
              outputTokens = parsed.usage?.output_tokens ?? 0;
              break;
            }

            case "message_stop":
              break;

            case "ping":
              // no-op
              break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 构建 content
    const content: MessageContent[] = [];
    const sortedBlocks = [...blocks.entries()].sort(([a], [b]) => a - b);
    for (const [, blk] of sortedBlocks) {
      switch (blk.type) {
        case "text":
          if (blk.text) {
            content.push({ type: "text", text: blk.text });
          }
          break;
        case "thinking":
          if (blk.thinking) {
            content.push({
              type: "thinking",
              thinking: blk.thinking,
              thinkingSignature: blk.signature || undefined,
              api: "anthropic-messages",
            });
          }
          break;
        case "tool_use":
          if (blk.toolId) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(blk.toolInput);
            } catch {
              // 解析失败，使用空对象
            }
            content.push({
              type: "tool_use",
              id: blk.toolId,
              name: blk.toolName,
              input,
            });
          }
          break;
      }
    }

    const totalTokens = inputTokens + outputTokens;

    yield {
      type: "message_end",
      stopReason: this.codec.mapStopReason(stopReason),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
      content,
      model,
    };
  }

  // ==========================================================
  // 非流式 Completion
  // ==========================================================

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body = {
      ...(this.buildRequestBody(params) as Record<string, unknown>),
      stream: false,
    };
    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    const json = (await response.json()) as any;
    const content: MessageContent[] = [];

    for (const block of json.content ?? []) {
      const converted = this.codec.inbound(block);
      content.push(...converted);
    }

    return {
      content,
      stopReason: this.codec.mapStopReason(json.stop_reason),
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        totalTokens:
          (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      },
      model: json.model ?? params.model,
    };
  }

  // ==========================================================
  // 凭证验证
  // ==========================================================

  async validateAuth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // 即使是 4xx（非 401/403），只要不是 auth 错误就说明 key 能连通
      return resp.status !== 401 && resp.status !== 403;
    } catch {
      return false;
    }
  }

  // ==========================================================
  // 内部辅助
  // ==========================================================

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): { system?: string; messages: AnthropicMessage[] } {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      const blocks = msg.content
        .map((block) => this.codec.outbound(block))
        .filter(Boolean);

      if (blocks.length === 0) continue;

      // Anthropic: tool role 不存在，tool_result 嵌在 user 消息中
      const role = msg.role === "tool" ? "user" : (msg.role as "user" | "assistant");

      result.push({ role, content: blocks });
    }

    return { system: systemPrompt || undefined, messages: result };
  }

  private async fetchWithErrorHandling(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new ProviderError(
        `Anthropic network error: ${formatError(err)}`,
        "anthropic",
        undefined,
        err instanceof Error ? err : undefined,
      );
    }

    if (response.ok) return response;

    const status = response.status;
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }

    let errorMsg = `Anthropic HTTP ${status}`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error?.message) errorMsg = parsed.error.message;
    } catch {
      // use raw
    }

    if (status === 401 || status === 403) {
      throw new AuthError(errorMsg);
    }
    if (status === 429) {
      let retryAfterMs: number | undefined;
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const secs = Number(retryAfter);
        if (Number.isFinite(secs)) retryAfterMs = secs * 1000;
      }
      throw new RateLimitError(errorMsg, retryAfterMs);
    }
    throw new ProviderError(errorMsg, "anthropic", status);
  }
}
