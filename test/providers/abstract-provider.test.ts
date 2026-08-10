import { describe, it, expect } from "vitest";
import { AbstractLLMProvider } from "../../src/providers/base.js";
import type { CompletionParams, StreamEvent } from "../../src/providers/base.js";

// ============================================================
// TestProvider — 最小 concrete subclass，只用于测试 AbstractLLMProvider
// ============================================================
class TestProvider extends AbstractLLMProvider {
  readonly id = "test";
  readonly name = "Test Provider";

  protected buildRequestBody(_params: CompletionParams): unknown {
    return {};
  }

  protected async *parseStreamChunk(_chunk: string): AsyncIterable<StreamEvent> {
    // 空实现：测试中不调用
  }

  protected classifyError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamEvent> {
    // 检查 signal 注入
    params.signal?.throwIfAborted();

    yield { type: "message_start" };

    // 检查 signal 注入（stream 过程中）
    params.signal?.throwIfAborted();

    yield {
      type: "message_end",
      stopReason: "end_turn",
      content: [{ type: "text", text: "hello from test provider" }],
    };
  }
}

// ============================================================
// 测试套件
// ============================================================
describe("AbstractLLMProvider", () => {
  const provider = new TestProvider();

  it("stream 应产出 message_start 和 message_end", async () => {
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({ model: "test-model", messages: [] })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message_start" });
    expect(events[1].type).toBe("message_end");
  });

  it("message_end 应包含 content 字段", async () => {
    const events: StreamEvent[] = [];
    for await (const event of provider.stream({ model: "test-model", messages: [] })) {
      events.push(event);
    }

    const endEvent = events[1];
    expect(endEvent.type).toBe("message_end");
    if (endEvent.type === "message_end") {
      expect(endEvent.stopReason).toBe("end_turn");
      expect(endEvent.content).toBeDefined();
      expect(endEvent.content).toEqual([
        { type: "text", text: "hello from test provider" },
      ]);
    }
  });

  it("signal 注入：aborted signal 应抛出 AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = provider.stream({
      model: "test-model",
      messages: [],
      signal: controller.signal,
    });

    await expect(async () => {
      for await (const _event of stream) {
        // 不应到达这里
      }
    }).rejects.toThrow();
  });

  it("validateAuth 应默认返回 false", async () => {
    const result = await provider.validateAuth();
    expect(result).toBe(false);
  });

  it("cancel 应为可选方法（不在原型上直接检测，但实例应能被调用者安全检查）", () => {
    // cancel 是可选方法，未实现时 undefined
    expect(provider.cancel).toBeUndefined();
  });
});
