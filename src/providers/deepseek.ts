import type { LLMProvider, CompletionParams, ToolDefinition } from "./base.js";
import type { StreamEvent, Message, MessageContent, StopReason } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";

// ============================================================
// DeepSeek API 类型（OpenAI 兼容）
// ============================================================

type DeepSeekMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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

type DeepSeekToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
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
// DeepSeekProvider
// ============================================================

export class DeepSeekProvider implements LLMProvider {
  readonly id = "deepseek";
  readonly name = "DeepSeek";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.deepseek.com/v1";
  }

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
  // 流式 Completion
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
                  yield { type: "tool_use_delta", id: acc.id, input: tc.function.arguments };
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
      stopReason: this.mapStopReason(finishReason),
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
    const body = { ...this.buildRequestBody(params), stream: false };
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
      stopReason: this.mapStopReason(choice?.finish_reason),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
      model: json.model ?? params.model,
    };
  }

  // ==========================================================
  // 内部辅助
  // ==========================================================

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private buildRequestBody(params: CompletionParams) {
    const messages = this.convertMessages(params.messages, params.systemPrompt);
    const tools = this.convertTools(params.tools);

    return {
      model: params.model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.topP != null ? { top_p: params.topP } : {}),
      ...(params.stopSequences?.length
        ? { stop: params.stopSequences }
        : {}),
      stream: true,
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
      // 将同一 Message 的多个 content block 合并为一条 DeepSeek 消息
      const textBlocks = msg.content.filter((b) => b.type === "text");
      const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
      const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");
      const imageBlocks = msg.content.filter((b) => b.type === "image");

      // assistant 文本 + 工具调用合并为一条消息
      if (msg.role === "assistant") {
        const text = textBlocks.map((b) => (b as { text: string }).text).join("");
        const hasTools = toolUseBlocks.length > 0;

        out.push({
          role: "assistant",
          content: text || null,
          ...(hasTools
            ? {
                tool_calls: toolUseBlocks.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.input),
                  },
                })),
              }
            : {}),
        });
        continue;
      }

      // user 文本
      for (const block of textBlocks) {
        out.push({
          role: "user",
          content: (block as { text: string }).text,
        });
      }

      // tool 结果（每条 tool_result 独立一条 tool 消息）
      for (const block of toolResultBlocks) {
        out.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        });
      }

      // 图片 → DeepSeek vision 格式
      for (const block of imageBlocks) {
        out.push({
          role: "user",
          content: JSON.stringify([
            {
              type: "image_url",
              image_url: {
                url: `data:${(block as { mediaType: string }).mediaType};base64,${(block as { data: string }).data}`,
              },
            },
          ]),
        } as DeepSeekMessage);
      }
    }

    return out;
  }

  private convertTools(tools?: ToolDefinition[]): DeepSeekToolDef[] {
    if (!tools?.length) return [];
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private mapStopReason(finishReason: string | null | undefined): StopReason {
    switch (finishReason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "stop":
      default:
        return "end_turn";
    }
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
