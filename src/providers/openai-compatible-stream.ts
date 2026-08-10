/**
 * OpenAI 兼容协议的共享流式处理逻辑。
 *
 * DeepSeekProvider、OpenAIProvider 等使用 openai-completions 协议的
 * provider 共享此 SSE 解析 + 聚合逻辑，避免重复 ~300 行代码。
 *
 * 参考 Orkas pi-provider.ts 模式：协议层抽象为可复用函数而非基类方法。
 */
import type { CompletionParams } from "./base.js";
import type { StreamEvent, MessageContent, Message } from "../shared/types.js";
import { AuthError, RateLimitError, ProviderError, formatError } from "../shared/errors.js";
import type { OpenAiCompletionsCodec } from "./codecs/openai-completions.js";
import type { OpenAiCompletionsThinkingAdapter } from "./thinking/openai-completions.js";

// ============================================================
// convertOpenAiCompatibleMessages — 共享的消息转换逻辑
// ============================================================

/**
 * 将内部 Message 列表转换为 OpenAI 兼容的消息数组。
 * 所有使用 openai-completions 协议的 provider 共享此逻辑，
 * 避免在每个 provider 中重复 ~40 行 convertMessages。
 */
export function convertOpenAiCompatibleMessages(
  messages: Message[],
  systemPrompt: string | undefined,
  codec: OpenAiCompletionsCodec,
): unknown[] {
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
        const converted = codec.outbound(block) as Record<
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

    // user / tool 消息
    for (const block of msg.content) {
      const converted = codec.outbound(block);
      if (!converted) continue;
      out.push(converted);
    }
  }

  return out;
}

type DeepSeekCompatibleChunk = {
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

export async function* createOpenAiCompatibleStream(
  params: CompletionParams,
  buildRequestBody: (params: CompletionParams) => unknown,
  baseUrl: string,
  headers: Record<string, string>,
  codec: OpenAiCompletionsCodec,
  thinkingAdapter: OpenAiCompletionsThinkingAdapter,
  providerId: string,
): AsyncIterable<StreamEvent> {
  const body = buildRequestBody(params);
  const response = await fetchWithErrorHandling(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.signal,
    },
    providerId,
  );

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProviderError("No response body from provider", providerId);
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

        let chunk: DeepSeekCompatibleChunk;
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

        // usage
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
      // ignore
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
    stopReason: codec.mapStopReason(finishReason),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens,
    },
    content,
    model,
  };
}

async function fetchWithErrorHandling(
  url: string,
  init: RequestInit,
  providerId: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new ProviderError(
      `${providerId} network error: ${formatError(err)}`,
      providerId,
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

  let errorMsg = `${providerId} HTTP ${status}`;
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
  throw new ProviderError(errorMsg, providerId, status);
}
