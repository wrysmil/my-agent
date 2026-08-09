import type { CompletionParams } from "./base.js";
import { AbstractLLMProvider } from "./base.js";
import type { StreamEvent } from "../shared/types.js";
import { ProviderError, formatError } from "../shared/errors.js";
import { OpenAiCompletionsCodec } from "./codecs/openai-completions.js";
import { OpenAiCompletionsThinkingAdapter } from "./thinking/openai-completions.js";
import { createOpenAiCompatibleStream, convertOpenAiCompatibleMessages } from "./openai-compatible-stream.js";
import type { ModelCapabilities } from "./types.js";

const DEFAULT_CAPS: ModelCapabilities = {
  vision: true, tool_use: true, thinking: true,
  json_mode: true, prompt_caching: false, streaming: true,
};

export class QwenProvider extends AbstractLLMProvider {
  readonly id = "qwen";
  readonly name = "Qwen (通义千问)";
  protected readonly codec: OpenAiCompletionsCodec;
  protected readonly thinkingAdapter = new OpenAiCompletionsThinkingAdapter();
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string; capabilities?: Partial<ModelCapabilities> }) {
    super();
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://dashscope.aliyuncs.com/compatible-mode/v1";
    this.codec = new OpenAiCompletionsCodec({ ...DEFAULT_CAPS, ...opts.capabilities });
  }

  protected buildRequestBody(params: CompletionParams): unknown {
    const tools = this.codec.buildTools(params.tools ?? []);
    return {
      model: params.model,
      messages: convertOpenAiCompatibleMessages(params.messages, params.systemPrompt, this.codec),
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.topP != null ? { top_p: params.topP } : {}),
      ...(params.stopSequences?.length ? { stop: params.stopSequences } : {}),
      stream: true,
    };
  }

  protected async *parseStreamChunk(_chunk: string): AsyncIterable<StreamEvent> {}
  protected classifyError(err: unknown): Error {
    return err instanceof ProviderError ? err : new ProviderError(`Qwen error: ${formatError(err)}`, "qwen");
  }

  stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    return createOpenAiCompatibleStream(params, (p) => this.buildRequestBody(p), this.baseUrl, this.headers(), this.codec, this.thinkingAdapter, "qwen");
  }

  async validateAuth(): Promise<boolean> {
    try { return (await fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(10_000) })).ok; } catch { return false; }
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }
}
