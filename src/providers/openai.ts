import type { CompletionParams, CompletionResult } from "./base.js";
import { AbstractLLMProvider } from "./base.js";
import type { StreamEvent, Message, MessageContent } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";
import { OpenAiCompletionsCodec } from "./codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "./thinking/openai-completions.js";
import { createOpenAiCompatibleStream } from "./openai-compatible-stream.js";
import type { ModelCapabilities, ReasoningLevel } from "./types.js";

// ============================================================
// OpenAI 默认模型能力
// ============================================================

const OPENAI_DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: true,
  tool_use: true,
  thinking: true,
  json_mode: true,
  prompt_caching: true,
  streaming: true,
};

// ============================================================
// OpenAIProvider
// ============================================================

export class OpenAIProvider extends AbstractLLMProvider {
  readonly id = "openai";
  readonly name = "OpenAI";

  protected readonly codec: OpenAiCompletionsCodec;
  protected readonly thinkingAdapter: OpenAiCompletionsThinkingAdapter;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly orgId?: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    orgId?: string;
    capabilities?: Partial<ModelCapabilities>;
  }) {
    super();
    const caps: ModelCapabilities = {
      ...OPENAI_DEFAULT_CAPABILITIES,
      ...opts.capabilities,
    };
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.orgId = opts.orgId;
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
    // 流式解析委托给共享函数
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
      `OpenAI error: ${formatError(err)}`,
      "openai",
      undefined,
      err instanceof Error ? err : undefined,
    );
  }

  // ==========================================================
  // 流式 Completion（委托共享 OpenAI 兼容流）
  // ==========================================================

  stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    return createOpenAiCompatibleStream(
      params,
      (p) => this.buildRequestBody(p),
      this.baseUrl,
      this.headers(),
      this.codec,
      this.thinkingAdapter,
      "openai",
    );
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
    const thinking = this.thinkingAdapter.extractFromResponse(message);
    if (thinking) content.push(thinking);
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
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.orgId) {
      h["OpenAI-Organization"] = this.orgId;
    }
    return h;
  }

  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): unknown[] {
    // 复用 codec.outbound 的单块转换 + 按 role 组装
    const out: unknown[] = [];

    if (systemPrompt) {
      out.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "assistant") {
        let textContent = "";
        let reasoningContent = "";
        const toolCalls: unknown[] = [];

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
            toolCalls.push(...(converted.tool_calls as unknown[]));
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
        const converted = this.codec.outbound(block);
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
        `OpenAI network error: ${formatError(err)}`,
        "openai",
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

    let errorMsg = `OpenAI HTTP ${status}`;
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
    throw new ProviderError(errorMsg, "openai", status);
  }
}
