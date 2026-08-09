import type { CompletionParams } from "./base.js";
import { AbstractLLMProvider } from "./base.js";
import type { StreamEvent, Message, MessageContent, StopReason } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";
import { OpenAiCompletionsCodec } from "./codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "./thinking/openai-completions.js";
import type { ModelCapabilities, ReasoningLevel } from "./types.js";

// ============================================================
// DeepSeek API 类型（OpenAI 兼容）
// ============================================================

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string;
  tool_calls?: DeepSeekToolCall[];
  tool_call_id?: string;
  name?: string;
};

type DeepSeekToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type DeepSeekStreamChunk = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ============================================================
// DeepSeek 默认模型能力
// ============================================================

const DEEPSEEK_DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: false,
  tool_use: true,
  thinking: true,
  json_mode: true,
  prompt_caching: false,
  streaming: true,
};

// ============================================================
// DeepSeekProvider
// ============================================================

export class DeepSeekProvider extends AbstractLLMProvider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";

  protected readonly codec: OpenAiCompletionsCodec;
  protected readonly thinkingAdapter: OpenAiCompletionsThinkingAdapter;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    capabilities?: Partial<ModelCapabilities>;
  }) {
    super();
    const caps: ModelCapabilities = {
      ...DEEPSEEK_DEFAULT_CAPABILITIES,
      ...opts.capabilities,
    };
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.deepseek.com/v1";
    this.codec = new OpenAiCompletionsCodec(caps);
    this.thinkingAdapter = new OpenAiCompletionsThinkingAdapter();
  }

  // ==========================================================
  // AbstractLLMProvider 抽象方法覆写
  // ==========================================================

  protected buildRequestBody(params: CompletionParams): unknown {
    const messages = this.convertMessages(params.messages, params.systemPrompt);
    const tools = this.codec.buildTools(params.tools ?? []);
    const thinkingFields = this.thinkingAdapter.extractFromRequest({
      level: (params.reasoning || "off") as ReasoningLevel,
    });
    const thinkingEnabled = params.reasoning && params.reasoning !== "off";

    return {
      model: params.model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      // thinking 模式下 temperature/top_p 无效，不发送
      ...(!thinkingEnabled && params.temperature != null
        ? { temperature: params.temperature }
        : {}),
      ...(!thinkingEnabled && params.topP != null
        ? { top_p: params.topP }
        : {}),
      ...(params.stopSequences?.length
        ? { stop: params.stopSequences }
        : {}),
      ...(thinkingFields as Record<string, unknown>),
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
      `DeepSeek error: ${formatError(err)}`,
      "deepseek",
      undefined,
      err instanceof Error ? err : undefined,
    );
  }

  // ==========================================================
  // 流式 Completion（完整覆写，保留原有 SSE buffer 分割逻辑）
  // ==========================================================

  async *stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    const body = this.buildRequestBody(params);
    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/chat/completions`,
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
      throw new ProviderError("No response body from DeepSeek", "deepseek");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    // 聚合状态
    let model = params.model;
    let finishReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolCallAccumulators = new Map<
      number,
      { id: string; name: string; args: string }
    >();

    try {
      yield { type: "message_start" };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") break;

          let chunk: DeepSeekStreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          model = chunk.model ?? model;

          for (const choice of chunk.choices) {
            const delta = choice.delta;

            // 思考/推理 delta（extended thinking）
            if (delta.reasoning_content) {
              thinkingParts.push(delta.reasoning_content);
              yield { type: "thinking_delta", thinking: delta.reasoning_content };
            }

            // 文本 delta
            if (delta.content) {
              textParts.push(delta.content);
              yield { type: "text_delta", text: delta.content };
            }

            // 工具调用 delta
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const acc = toolCallAccumulators.get(tc.index) ?? {
                  id: "",
                  name: "",
                  args: "",
                };

                if (tc.id) {
                  acc.id = tc.id;
                  yield { type: "tool_use_start", id: tc.id, name: "" };
                }
                if (tc.function?.name) {
                  acc.name = tc.function.name;
                }
                if (tc.function?.arguments) {
                  acc.args += tc.function.arguments;
                  yield {
                    type: "tool_use_delta",
                    id: acc.id,
                    input: tc.function.arguments,
                  };
                }

                toolCallAccumulators.set(tc.index, acc);
              }
            }

            finishReason = choice.finish_reason ?? finishReason;
          }

          // usage（DeepSeek 在最后一个 chunk 中返回）
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens;
            outputTokens = chunk.usage.completion_tokens;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 结束所有聚合中的工具调用
    for (const [, acc] of toolCallAccumulators) {
      yield { type: "tool_use_end", id: acc.id };
    }

    // 构建 content
    const content: MessageContent[] = [];
    const joinedThinking = thinkingParts.join("");
    if (joinedThinking) {
      content.push({ type: "thinking", thinking: joinedThinking });
    }
    const joinedText = textParts.join("");
    if (joinedText) {
      content.push({ type: "text", text: joinedText });
    }
    for (const [, acc] of toolCallAccumulators) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(acc.args);
      } catch {
        // 解析失败，使用空对象
      }
      content.push({
        type: "tool_use",
        id: acc.id,
        name: acc.name,
        input,
      });
    }

    const totalTokens = inputTokens + outputTokens;

    yield {
      type: "message_end",
      stopReason: this.codec.mapStopReason(finishReason),
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

  async complete(params: CompletionParams): Promise<{
    content: MessageContent[];
    stopReason: StopReason;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    model: string;
  }> {
    const body = { ...(this.buildRequestBody(params) as Record<string, unknown>), stream: false };
    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/chat/completions`,
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
    const choice = json.choices?.[0];
    const message = choice?.message ?? {};

    const content: MessageContent[] = [];
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // ignore
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return {
      content,
      stopReason: this.codec.mapStopReason(choice?.finish_reason),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.totalTokens ?? 0,
      },
      model: json.model ?? params.model,
    };
  }

  // ==========================================================
  // 凭证验证
  // ==========================================================

  async validateAuth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ==========================================================
  // 内部辅助
  // ==========================================================

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): DeepSeekMessage[] {
    const out: DeepSeekMessage[] = [];

    if (systemPrompt) {
      out.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "assistant") {
        // 将同一 Message 的多个 content block 合并为一条 assistant 消息
        let textContent = "";
        let reasoningContent = "";
        const toolCalls: DeepSeekToolCall[] = [];

        for (const block of msg.content) {
          const converted = this.codec.outbound(block) as Record<
            string,
            unknown
          > | null;
          if (!converted) continue;

          if (typeof converted.content === "string") {
            textContent += converted.content;
          }
          if (typeof converted.reasoning_content === "string") {
            reasoningContent += converted.reasoning_content;
          }
          if (Array.isArray(converted.tool_calls)) {
            toolCalls.push(...(converted.tool_calls as DeepSeekToolCall[]));
          }
        }

        out.push({
          role: "assistant",
          content: textContent || null,
          ...(reasoningContent
            ? { reasoning_content: reasoningContent }
            : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
        continue;
      }

      // user / tool 消息：每个 block 通过 codec.outbound 转换后直接推入
      for (const block of msg.content) {
        const converted = this.codec.outbound(block) as DeepSeekMessage | null;
        if (!converted) continue;
        out.push(converted);
      }
    }

    return out;
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
        `DeepSeek network error: ${formatError(err)}`,
        "deepseek",
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

    let errorMsg = `DeepSeek HTTP ${status}`;
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
    throw new ProviderError(errorMsg, "deepseek", status);
  }
}
