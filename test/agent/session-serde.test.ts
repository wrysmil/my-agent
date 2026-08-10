/**
 * Session 序列化（session-serde）单测 — P0 稳定 ID（id / runId）透传。
 *
 * 覆盖 P0 spec（2026-08-10-chat-session-stream-isolation）§ 4.1 稳定 ID 契约：
 * - messageToSerialized 传递 id / runId 字段到 JSONL 行；
 * - serializedToMessage 还原时保留 id / runId；
 * - 新 ID round-trip 完整（往返一致）；
 * - 旧 JSONL（缺 id / runId）兼容读取，不抛错且字段为 undefined。
 */

import { describe, it, expect } from "vitest";
import type { Message } from "../../src/shared/types.js";
import {
  isValidSerializedMessage,
  messageToSerialized,
  serializedToMessage,
  type SerializedMessage,
} from "../../src/agent/session-serde.js";

describe("session-serde — P0 id/runId 透传", () => {
  it("messageToSerialized 传递 id 和 runId 字段", () => {
    const msg: Message = {
      role: "assistant",
      content: [{ type: "text", text: "你好", id: "block-1" }],
      turnId: 5,
      id: "msg-assistant-1",
      runId: "run-abc",
    };

    const sm = messageToSerialized(msg);

    expect(sm.id).toBe("msg-assistant-1");
    expect(sm.runId).toBe("run-abc");
    expect(sm.role).toBe("assistant");
    expect(sm.content).toEqual(msg.content);
    expect(sm.turnId).toBe(5);
    // ts 仅用于审计 / 排序
    expect(typeof sm.ts).toBe("number");
  });

  it("serializedToMessage 保留 id 和 runId 字段", () => {
    const sm: SerializedMessage = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      turnId: 1,
      ts: 1234567890,
      id: "msg-user-1",
      runId: "run-1",
    };

    const msg = serializedToMessage(sm);

    expect(msg.id).toBe("msg-user-1");
    expect(msg.runId).toBe("run-1");
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual(sm.content);
    expect(msg.turnId).toBe(1);
    // ts 仅用于审计，反序列化时丢弃
    expect("ts" in msg).toBe(false);
  });

  it("新 ID round-trip 完整：messageToSerialized → serializedToMessage 往返一致", () => {
    const msg: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "answer", id: "block-a" },
        { type: "tool_result", toolUseId: "t1", content: "42", id: "result:t1" },
      ],
      turnId: 7,
      id: "msg-roundtrip",
      runId: "run-roundtrip",
    };

    const roundTripped = serializedToMessage(messageToSerialized(msg));

    expect(roundTripped).toEqual(msg);
    expect(roundTripped.id).toBe(msg.id);
    expect(roundTripped.runId).toBe(msg.runId);
  });

  it("旧 JSONL（缺 id / runId）反序列化兼容：字段保持 undefined", () => {
    const sm: SerializedMessage = {
      role: "assistant",
      content: [{ type: "text", text: "legacy" }],
      turnId: 2,
      ts: 0,
    };

    const msg = serializedToMessage(sm);

    expect(msg.id).toBeUndefined();
    expect(msg.runId).toBeUndefined();
    expect(msg.content).toEqual(sm.content);
  });

  it("isValidSerializedMessage 校验合法 / 非法行", () => {
    expect(isValidSerializedMessage({ role: "user", content: [] })).toBe(true);
    expect(
      isValidSerializedMessage({
        role: "assistant",
        content: [{ type: "text", text: "x" }],
        id: "m-1",
        runId: "r-1",
      }),
    ).toBe(true);
    expect(isValidSerializedMessage({ role: "system", content: [] })).toBe(false);
    expect(isValidSerializedMessage({ role: "user" })).toBe(false);
    expect(isValidSerializedMessage(null)).toBe(false);
  });
});
