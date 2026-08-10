import { describe, it, expect } from "vitest";
import type {
  ContentBlockCodec,
  IncomingBlock,
  OutgoingBlock,
} from "../../src/providers/codecs/types.js";
import type { MessageContent, StopReason } from "../../src/shared/types.js";
import type { ApiProtocol } from "../../src/providers/types.js";
import type { ToolDefinition } from "../../src/providers/base.js";

// ============================================================
// 类型契约测试 —— 验证 ContentBlockCodec 成员签名正确
// 注意：这些测试在运行时全部 trivially pass；
//       真正价值是编译期类型检查（vitest 编译 TS 时即校验）。
// ============================================================

describe("ContentBlockCodec — 类型契约", () => {
  describe("inbound 签名", () => {
    it("应接受 IncomingBlock (unknown) 并返回 MessageContent[]", () => {
      const fn: ContentBlockCodec["inbound"] = (message) => {
        // IncomingBlock = unknown → message 类型是 unknown
        // 返回 MessageContent[]
        void message;
        return [];
      };
      const result: MessageContent[] = fn("任意提供商输入");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("outbound 签名", () => {
    it("应接受 MessageContent 并返回 OutgoingBlock | null", () => {
      const fn: ContentBlockCodec["outbound"] = (block) => {
        // block 类型必须是 MessageContent
        void block;
        return null;
      };
      const result: OutgoingBlock | null = fn({ type: "text", text: "hello" });
      expect(result).toBeNull();
    });
  });

  describe("buildTools 签名", () => {
    it("应接受 ToolDefinition[] 并返回 unknown", () => {
      const fn: ContentBlockCodec["buildTools"] = (tools) => {
        void tools;
        return {};
      };
      const tools: ToolDefinition[] = [
        { name: "weather", description: "Get weather", inputSchema: {} },
      ];
      const result: unknown = fn(tools);
      expect(typeof result).toBe("object");
    });
  });

  describe("mapStopReason 签名", () => {
    it("应接受 string | null | undefined 并返回 StopReason", () => {
      const fn: ContentBlockCodec["mapStopReason"] = (reason) => {
        void reason;
        return "end_turn" satisfies StopReason;
      };
      const result: StopReason = fn("tool_use");
      expect(result).toBe("end_turn");
    });
  });

  describe("完整接口实现", () => {
    it("应满足 ContentBlockCodec 全部 5 个成员", () => {
      const codec: ContentBlockCodec = {
        api: "anthropic-messages" satisfies ApiProtocol,
        inbound(_message: IncomingBlock): MessageContent[] {
          return [];
        },
        outbound(_block: MessageContent): OutgoingBlock | null {
          return null;
        },
        buildTools(_tools: ToolDefinition[]): unknown {
          return [];
        },
        mapStopReason(reason: string | null | undefined): StopReason {
          void reason;
          return "end_turn" satisfies StopReason;
        },
      };

      expect(codec.api).toBe("anthropic-messages");
      expect(codec.inbound("test")).toEqual([]);
      expect(codec.outbound({ type: "text", text: "" })).toBeNull();
      expect(codec.buildTools([])).toEqual([]);
      expect(codec.mapStopReason(null)).toBe("end_turn");
    });
  });
});
