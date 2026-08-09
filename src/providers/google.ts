import type { CompletionParams, CompletionResult } from "./base.js";
import { AbstractLLMProvider } from "./base.js";
import type { StreamEvent, Message, MessageContent } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";
import { GoogleGenerativeAiCodec } from "./codecs/google-generative-ai.js";
import { GoogleThinkingAdapter } from "./thinking/google-generative-ai.js";
import type { ModelCapabilities, ReasoningLevel } from "./types.js";

// ============================================================
// Google Gemini API 类型
// ============================================================

type GeminiPart = Record<string, unknown>;

type GeminiContent = {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
};

type GeminiStreamChunk = {
  candidates?: Array<{
    content?: {
      role: string;
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

// ============================================================
// Google 默认模型能力
// ============================================================

const GOOGLE_DEFAULT_CAPABILITIES: ModelCapabilities = {
  vision: true,
  tool_use: true,
  thinking: true,
  json_mode: true,
  prompt_caching: false,
  streaming: true,
};

// ============================================================
// GoogleProvider
// ============================================================

export class GoogleProvider extends AbstractLLMProvider {
  readonly id = "google";
  readonly name = "Google";

  protected readonly codec: GoogleGenerativeAiCodec;
  protected readonly thinkingAdapter: GoogleThinkingAdapter;

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    capabilities?: Partial<ModelCapabilities>;
  }) {
    super();
    const caps: ModelCapabilities = {
      ...GOOGLE_DEFAULT_CAPABILITIES,
      ...opts.capabilities,
    };
    this.apiKey = opts.apiKey;
    this.baseUrl =
      opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.codec = new GoogleGenerativeAiCodec(caps);
    this.thinkingAdapter = new GoogleThinkingAdapter();
  }

  // ==========================================================
  // AbstractLLMProvider 抽象方法覆写
  // ==========================================================

  protected buildRequestBody(params: CompletionParams): unknown {
    const { systemInstruction, contents } = this.convertMessages(
      params.messages,
      params.systemPrompt,
    );
    const tools = this.codec.buildTools(params.tools ?? []);
    const thinkingFields = this.thinkingAdapter.extractFromRequest({
      level: (params.reasoning || "off") as ReasoningLevel,
    });

    return {
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      ...(tools.length > 0 ? { tools } : {}),
      generationConfig: {
        ...(params.maxTokens ? { maxOutputTokens: params.maxTokens } : {}),
        ...(params.temperature != null
          ? { temperature: params.temperature }
          : {}),
        ...(params.topP != null ? { topP: params.topP } : {}),
        ...(params.stopSequences?.length
          ? { stopSequences: params.stopSequences }
          : {}),
      },
      ...(thinkingFields as Record<string, unknown>),
    };
  }

  protected async *parseStreamChunk(
    _chunk: string,
  ): AsyncIterable<StreamEvent> {
    // 流式解析在 stream() 中完整实现
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
      `Google error: ${formatError(err)}`,
      "google",
      undefined,
      err instanceof Error ? err : undefined,
    );
  }

  // ==========================================================
  // 流式 Completion（Gemini SSE 格式：每个 chunk 是完整累积响应）
  // ==========================================================

  async *stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    const body = this.buildRequestBody(params);
    const model = params.model;

    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new ProviderError("No response body from Google", "google");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    // Gemini 流式：每个 chunk 是完整累积 → 需要 diff
    let lastText = "";
    let lastThought = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | null = null;
    const seenFunctionCalls = new Set<string>();
    const toolUseAccumulators = new Map<
      string,
      { name: string; args: Record<string, unknown> }
    >();
    const thinkingParts: string[] = [];

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
          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate?.content?.parts) continue;

          finishReason = candidate.finishReason ?? finishReason;

          // 累积文本（每个 chunk 包含 full text → 计算 diff）
          let chunkText = "";
          for (const part of candidate.content.parts) {
            if (typeof part.text === "string") {
              if (part.thought === true) {
                // Thinking part (Gemini 2.5 Flash Thinking)
                const thoughtDelta = part.text.slice(lastThought.length);
                if (thoughtDelta) {
                  lastThought = part.text;
                  thinkingParts.push(thoughtDelta);
                  yield { type: "thinking_delta", thinking: thoughtDelta };
                }
              } else {
                chunkText += part.text;
              }
            }

            if (part.functionCall) {
              const fc = part.functionCall as Record<string, unknown>;
              const name = (fc.name as string) ?? "";
              const key = `${name}_${JSON.stringify(fc.args)}`;
              if (!seenFunctionCalls.has(key)) {
                seenFunctionCalls.add(key);
                const id = `gc_${name}_${seenFunctionCalls.size}`;
                yield { type: "tool_use_start", id, name };
                toolUseAccumulators.set(id, {
                  name,
                  args: (fc.args as Record<string, unknown>) ?? {},
                });
                yield { type: "tool_use_end", id };
              }
            }
          }

          // 文本 diff
          if (chunkText.length > lastText.length) {
            const delta = chunkText.slice(lastText.length);
            lastText = chunkText;
            yield { type: "text_delta", text: delta };
          }

          // usage
          if (chunk.usageMetadata) {
            inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens =
              chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // 构建 content
    const content: MessageContent[] = [];
    const joinedThinking = thinkingParts.join("");
    if (joinedThinking) {
      content.push({
        type: "thinking",
        thinking: joinedThinking,
        api: "google-generative-ai",
      });
    }
    if (lastText) {
      content.push({ type: "text", text: lastText });
    }
    for (const [id, acc] of toolUseAccumulators) {
      content.push({
        type: "tool_use",
        id,
        name: acc.name,
        input: acc.args,
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
      model: params.model,
    };
  }

  // ==========================================================
  // 非流式 Completion
  // ==========================================================

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body = this.buildRequestBody(params);
    const response = await this.fetchWithErrorHandling(
      `${this.baseUrl}/models/${params.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    const json = (await response.json()) as GeminiStreamChunk;
    const candidate = json.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    const content: MessageContent[] = [];
    for (const part of parts) {
      const converted = this.codec.inbound(part);
      content.push(...converted);
    }

    return {
      content,
      stopReason: this.codec.mapStopReason(candidate?.finishReason),
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
      },
      model: params.model,
    };
  }

  // ==========================================================
  // 凭证验证
  // ==========================================================

  async validateAuth(): Promise<boolean> {
    try {
      const resp = await fetch(
        `${this.baseUrl}/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ==========================================================
  // 内部辅助
  // ==========================================================

  private convertMessages(
    messages: Message[],
    systemPrompt?: string,
  ): {
    systemInstruction?: { parts: GeminiPart[] };
    contents: GeminiContent[];
  } {
    const result: GeminiContent[] = [];
    // 按 role 分组，连续同 role 的合并
    for (const msg of messages) {
      const parts: GeminiPart[] = [];
      for (const block of msg.content) {
        const converted = this.codec.outbound(block);
        if (converted) parts.push(converted as GeminiPart);
      }
      if (parts.length === 0) continue;

      // Gemini 不支持独立的 "tool" role；tool_result → "function" role
      const role =
        msg.role === "assistant"
          ? "model"
          : msg.role === "tool"
            ? "function"
            : (msg.role as "user" | "model" | "function");

      result.push({ role, parts });
    }

    const systemInstruction = systemPrompt
      ? { parts: [{ text: systemPrompt }] }
      : undefined;

    return { systemInstruction, contents: result };
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
        `Google network error: ${formatError(err)}`,
        "google",
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

    let errorMsg = `Google HTTP ${status}`;
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
    throw new ProviderError(errorMsg, "google", status);
  }
}
