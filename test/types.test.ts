import { describe, it, expect } from "vitest";
import type {
  MessageRole,
  TextContent,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
  ThinkingContent,
  MessageContent,
  Message,
  Usage,
  StopReason,
  StreamEvent,
} from "../src/shared/types.js";

describe("共享类型定义", () => {
  describe("MessageContent — 联合类型构造", () => {
    it("构造 TextContent", () => {
      const c: TextContent = { type: "text", text: "hello" };
      expect(c.type).toBe("text");
      expect(c.text).toBe("hello");
    });

    it("构造 ImageContent", () => {
      const c: ImageContent = {
        type: "image",
        data: "base64...",
        mediaType: "image/png",
      };
      expect(c.type).toBe("image");
      expect(c.mediaType).toBe("image/png");
    });

    it("构造 ToolUseContent", () => {
      const c: ToolUseContent = {
        type: "tool_use",
        id: "call_1",
        name: "read_file",
        input: { path: "/tmp/test.txt" },
      };
      expect(c.id).toBe("call_1");
      expect(c.name).toBe("read_file");
      expect(c.input.path).toBe("/tmp/test.txt");
    });

    it("构造 ToolResultContent（含 isError）", () => {
      const ok: ToolResultContent = {
        type: "tool_result",
        toolUseId: "call_1",
        content: "file content",
      };
      expect(ok.isError).toBeUndefined();

      const err: ToolResultContent = {
        type: "tool_result",
        toolUseId: "call_2",
        content: "permission denied",
        isError: true,
      };
      expect(err.isError).toBe(true);
    });

    it("构造 ThinkingContent（含签名）", () => {
      const c: ThinkingContent = {
        type: "thinking",
        thinking: "Let me analyze...",
        thinkingSignature: "sig_abc",
      };
      expect(c.thinking).toBe("Let me analyze...");
      expect(c.thinkingSignature).toBe("sig_abc");
    });

    it("MessageContent 联合类型接受所有子类型", () => {
      // 编译时验证：这些赋值必须通过类型检查
      const items: MessageContent[] = [
        { type: "text", text: "hello" },
        { type: "image", data: "x", mediaType: "image/png" },
        { type: "tool_use", id: "1", name: "t", input: {} },
        { type: "tool_result", toolUseId: "1", content: "ok" },
        { type: "thinking", thinking: "hmm..." },
      ];
      expect(items).toHaveLength(5);
    });
  });

  describe("Message — 完整消息构造", () => {
    it("构造 user 消息", () => {
      const msg: Message = {
        role: "user",
        content: [{ type: "text", text: "你好" }],
      };
      expect(msg.role).toBe("user");
      expect(msg.content).toHaveLength(1);
    });

    it("构造 assistant 消息（含 tool_use）", () => {
      const msg: Message = {
        role: "assistant",
        content: [
          { type: "text", text: "我来读文件" },
          {
            type: "tool_use",
            id: "call_1",
            name: "read_file",
            input: { path: "/x" },
          },
        ],
      };
      expect(msg.role).toBe("assistant");
      expect(msg.content).toHaveLength(2);
    });

    it("构造 tool 消息（含 tool_result）", () => {
      const msg: Message = {
        role: "tool",
        content: [
          {
            type: "tool_result",
            toolUseId: "call_1",
            content: "file contents here",
          },
        ],
      };
      expect(msg.role).toBe("tool");
    });

    it("MessageRole 只接受三个值", () => {
      const roles: MessageRole[] = ["user", "assistant", "tool"];
      expect(roles).toHaveLength(3);
    });
  });

  describe("Usage — Token 用量", () => {
    it("完整 Usage", () => {
      const u: Usage = {
        inputTokens: 1500,
        outputTokens: 300,
        cacheReadTokens: 200,
        cacheWriteTokens: 100,
        totalTokens: 1800,
      };
      expect(u.totalTokens).toBe(1800);
    });

    it("最小 Usage（仅必填字段）", () => {
      const u: Usage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };
      expect(u.cacheReadTokens).toBeUndefined();
    });
  });

  describe("StopReason — 停止原因", () => {
    it("包含四种停止原因", () => {
      const reasons: StopReason[] = [
        "end_turn",
        "tool_use",
        "max_tokens",
        "stop_sequence",
      ];
      expect(reasons).toHaveLength(4);
    });
  });

  describe("StreamEvent — 流事件联合类型", () => {
    it("text_delta 事件", () => {
      const e: StreamEvent = { type: "text_delta", text: "Hello" };
      expect(e.type).toBe("text_delta");
    });

    it("tool_use 生命周期事件", () => {
      const start: StreamEvent = {
        type: "tool_use_start",
        id: "1",
        name: "bash",
      };
      expect(start.type).toBe("tool_use_start");

      const delta: StreamEvent = {
        type: "tool_use_delta",
        id: "1",
        input: '{"command":',
      };
      expect(delta.type).toBe("tool_use_delta");

      const end: StreamEvent = { type: "tool_use_end", id: "1" };
      expect(end.type).toBe("tool_use_end");
    });

    it("message_start 事件", () => {
      const e: StreamEvent = {
        type: "message_start",
        usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
      };
      expect(e.type).toBe("message_start");
      expect(e.usage?.inputTokens).toBe(10);
    });

    it("message_end 事件（含完整内容）", () => {
      const e: StreamEvent = {
        type: "message_end",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        content: [{ type: "text", text: "Done!" }],
        model: "claude-sonnet-4-5",
      };
      expect(e.type).toBe("message_end");
      expect(e.stopReason).toBe("end_turn");
      expect(e.model).toBe("claude-sonnet-4-5");
    });

    it("error 事件", () => {
      const e: StreamEvent = {
        type: "error",
        error: new Error("network error"),
      };
      expect(e.type).toBe("error");
      expect(e.error.message).toBe("network error");
    });
  });
});
