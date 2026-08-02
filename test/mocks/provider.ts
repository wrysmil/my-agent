import type { LLMProvider, CompletionParams, CompletionResult } from "../../src/providers/base.js";
import type { StreamEvent, StopReason, MessageContent } from "../../src/shared/types.js";
import { defineTool } from "../../src/tools/base.js";

/**
 * 可编程的 Mock LLM Provider，用于 AgentRunner 单元测试。
 *
 * 通过 program() 方法预设一系列响应（文本或工具调用），
 * 每次 stream() 调用按顺序消费这些预设响应。
 */

export type MockResponse =
  | { kind: "text"; text: string; stopReason?: StopReason }
  | {
      kind: "tool_calls";
      calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
      text?: string;
      stopReason?: StopReason;
    }
  | { kind: "error"; error: Error };

export type StreamRecord = {
  params: CompletionParams;
  response: MockResponse;
};

export class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly name = "Mock Provider";

  private responses: MockResponse[] = [];
  private _streams: StreamRecord[] = [];
  private _completeCalls: CompletionParams[] = [];
  private _authResult = true;

  /** 预设一系列响应。每次 stream() 调用消耗一个。 */
  program(...responses: MockResponse[]): this {
    this.responses.push(...responses);
    return this;
  }

  /** 获取所有已记录的 stream 调用参数。 */
  get streams(): readonly StreamRecord[] {
    return this._streams;
  }

  /** 获取所有已记录的 complete 调用参数。 */
  get completeCalls(): readonly CompletionParams[] {
    return this._completeCalls;
  }

  /** 清除所有预设和记录。 */
  reset(): void {
    this.responses = [];
    this._streams = [];
    this._completeCalls = [];
    this._authResult = true;
  }

  /** 设置 validateAuth 的返回值。 */
  setAuthResult(result: boolean): void {
    this._authResult = result;
  }

  // ---- LLMProvider 接口实现 ----

  async validateAuth(): Promise<boolean> {
    return this._authResult;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    this._completeCalls.push(params);

    const resp = this.responses.shift();
    if (!resp) {
      return {
        content: [{ type: "text", text: "" }],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: params.model,
      };
    }

    return this.responseToResult(resp, params.model);
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    const resp = this.responses.shift();

    if (!resp) {
      // 无预设 → 返回空文本
      yield { type: "message_start", usage: { inputTokens: 0, outputTokens: 0 } };
      yield {
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        content: [{ type: "text", text: "" }],
        model: params.model,
      };
      this._streams.push({ params, response: { kind: "text", text: "" } });
      return;
    }

    this._streams.push({ params, response: resp });

    if (resp.kind === "error") {
      yield { type: "error", error: resp.error };
      return;
    }

    yield { type: "message_start", usage: { inputTokens: 100, outputTokens: 0 } };

    // 文本部分
    const text = "text" in resp && resp.text ? resp.text : "";
    if (text) {
      // 分块发送文本以模拟流式输出
      const chunks = splitTextIntoChunks(text, 20);
      for (const chunk of chunks) {
        yield { type: "text_delta", text: chunk };
      }
    }

    // 工具调用部分
    const toolCalls = resp.kind === "tool_calls" ? resp.calls : [];
    const content: MessageContent[] = [];

    if (text) {
      content.push({ type: "text", text });
    }

    for (const tc of toolCalls) {
      yield { type: "tool_use_start", id: tc.id, name: tc.name };
      yield { type: "tool_use_delta", id: tc.id, input: JSON.stringify(tc.input) };
      yield { type: "tool_use_end", id: tc.id };
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }

    const outputTokens = Math.ceil((text.length + JSON.stringify(toolCalls).length) / 3.5);

    yield {
      type: "message_end",
      stopReason: resp.kind === "tool_calls"
        ? (resp.stopReason ?? "tool_use")
        : (resp.stopReason ?? "end_turn"),
      usage: { inputTokens: 100, outputTokens, totalTokens: 100 + outputTokens },
      content,
      model: params.model,
    };
  }

  // ---- 内部辅助 ----

  private responseToResult(resp: MockResponse, model: string): CompletionResult {
    if (resp.kind === "error") {
      return {
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model,
      };
    }

    const content: MessageContent[] = [];
    if (resp.kind === "text" && resp.text) {
      content.push({ type: "text", text: resp.text });
    }
    if (resp.kind === "tool_calls") {
      if (resp.text) content.push({ type: "text", text: resp.text });
      for (const tc of resp.calls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
    }

    return {
      content,
      stopReason: resp.stopReason ?? (resp.kind === "tool_calls" ? "tool_use" : "end_turn"),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      model,
    };
  }
}

/** 将文本按最大长度分块 */
function splitTextIntoChunks(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + maxLen));
    offset += maxLen;
  }
  return chunks.length > 0 ? chunks : [text];
}

/**
 * 创建模拟工具定义的辅助函数。
 */
export function mockToolDef(opts: {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  executionMode?: "sequential" | "parallel";
  execute?: (input: Record<string, unknown>) => Promise<{ content: string; isError?: boolean; endTurn?: boolean }>;
}) {
  return defineTool({
    name: opts.name,
    description: opts.description ?? `Mock tool: ${opts.name}`,
    inputSchema: opts.inputSchema ?? { type: "object", properties: {} },
    executionMode: opts.executionMode,
    execute: opts.execute ?? (async () => ({ content: `mock ${opts.name} result` })),
  });
}
