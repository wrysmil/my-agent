/**
 * my-agent Web 前端 — SSE 协议层单测（WU-02b / B3）。
 *
 * 覆盖 spec § 6.1 + contract § 4：
 * ① sseResponse 设置正确响应头 + X-Stream-Id
 * ② writeEvent 序列化为 `id: <seq>\nevent: <name>\ndata: <json>\n\n`
 * ③ writeHeartbeat 写 `: heartbeat\n\n` 注释行
 * ④ SseHub register / abort / close / listForCid 全生命周期
 * ⑤ LastEventIdLru cap=100 时驱逐最早 seq
 * ⑥ SSE_EVENT_TYPES 13 种类型断言
 * ⑦ Last-Event-ID 解析：缺省 / 非法 / 正常
 * ⑧ 自动 heartbeat 定时器 + client disconnect → onClientGone 回调
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

import {
  SSE_EVENT_TYPES,
  SseHub,
  LastEventIdLru,
  _resetHub,
  _resetLru,
  hub,
  lastEventLru,
  parseLastEventId,
  sseResponse,
  writeEvent,
  writeHeartbeat,
} from "./sse.js";

// ============================================================
// 共享 mock
// ============================================================

function makeMockRes(): ServerResponse & {
  headers: Record<string, string>;
  statusCode: number;
  body: string;
  ended: boolean;
} {
  const headers: Record<string, string> = {};
  const res = new EventEmitter() as ServerResponse & {
    headers: Record<string, string>;
    statusCode: number;
    body: string;
    ended: boolean;
  };
  res.headers = headers;
  res.statusCode = 0;
  res.body = "";
  res.ended = false;

  (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader = (
    k: string,
    v: string,
  ): void => {
    headers[k.toLowerCase()] = v;
  };
  (res as unknown as { getHeader: (k: string) => string | undefined }).getHeader = (
    k: string,
  ): string | undefined => headers[k.toLowerCase()];
  (res as unknown as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ): boolean => {
    res.body += chunk;
    return true;
  };
  (res as unknown as { end: () => void }).end = (): void => {
    res.ended = true;
    res.emit("close");
  };
  return res;
}

// ============================================================
// ① writeEvent 序列化
// ============================================================

describe("writeEvent — SSE 事件序列化", () => {
  it("严格按 `id / event / data` + 空行输出", () => {
    const res = makeMockRes();
    writeEvent(res, {
      id: 1,
      event: "message_start",
      data: { type: "message_start", seq: 1 },
    });

    expect(res.body).toBe(
      `id: 1\nevent: message_start\ndata: ${JSON.stringify({ type: "message_start", seq: 1 })}\n\n`,
    );
  });

  it("缺 id 时省略 id 行（保留换行序）", () => {
    const res = makeMockRes();
    writeEvent(res, { event: "ping", data: { ts: 123 } });

    expect(res.body).toBe(
      `event: ping\ndata: ${JSON.stringify({ ts: 123 })}\n\n`,
    );
  });

  it("data 为对象时按 JSON.stringify 序列化", () => {
    const res = makeMockRes();
    writeEvent(res, { id: 5, event: "content_block_delta", data: { x: "y" } });

    expect(res.body).toContain(`event: content_block_delta`);
    expect(res.body).toContain(`data: {"x":"y"}`);
    expect(res.body.endsWith("\n\n")).toBe(true);
  });
});

// ============================================================
// ② writeHeartbeat
// ============================================================

describe("writeHeartbeat — 注释行心跳", () => {
  it("输出 `: heartbeat <ts>\\n\\n` 形态", () => {
    const res = makeMockRes();
    const before = Date.now();
    writeHeartbeat(res);
    const after = Date.now();

    expect(res.body.startsWith(": heartbeat ")).toBe(true);
    expect(res.body.endsWith("\n\n")).toBe(true);

    // 解析时间戳
    const m = res.body.match(/: heartbeat (\d+)/);
    expect(m).not.toBeNull();
    const ts = Number(m![1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ============================================================
// ③ sseResponse — 响应头 + 自动 heartbeat + client disconnect
// ============================================================

describe("sseResponse — 响应头 + 心跳 + 断开回调", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("设置 7 项 SSE 响应头 + X-Stream-Id", () => {
    const res = makeMockRes();
    sseResponse(res, { streamId: "stream-123" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers["connection"]).toBe("keep-alive");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["x-stream-id"]).toBe("stream-123");
  });

  it("heartbeatMs=100 时到点自动写 `: heartbeat` 注释行", () => {
    const res = makeMockRes();
    sseResponse(res, { streamId: "s1", heartbeatMs: 100 });

    // 初始无 body
    expect(res.body).toBe("");

    // 推进 100ms → 触发 1 次心跳
    vi.advanceTimersByTime(100);
    expect(res.body).toMatch(/^: heartbeat \d+\n\n$/);

    // 再推进 100ms → 又 1 次
    vi.advanceTimersByTime(100);
    const heartbeats = res.body.match(/^: heartbeat/gm);
    expect(heartbeats?.length).toBe(2);
  });

  it("client disconnect → 调用 onClientGone + 后续心跳不再写", () => {
    const res = makeMockRes();
    const onClientGone = vi.fn();
    sseResponse(res, { streamId: "s2", heartbeatMs: 100, onClientGone });

    // 模拟客户端断开
    res.emit("close");

    expect(onClientGone).toHaveBeenCalledTimes(1);

    // 心跳停写
    vi.advanceTimersByTime(500);
    const heartbeats = res.body.match(/^: heartbeat/gm);
    expect(heartbeats).toBeNull();
  });
});

// ============================================================
// ④ SseHub — register / abort / close / listForCid
// ============================================================

describe("SseHub — 流生命周期管理", () => {
  beforeEach(() => {
    _resetHub();
  });

  it("register 返回 streamId + AbortController，且 size +1", () => {
    const h = new SseHub();
    expect(h.size()).toBe(0);

    const { streamId, controller } = h.register("cid-a");
    expect(typeof streamId).toBe("string");
    expect(controller).toBeInstanceOf(AbortController);
    expect(h.size()).toBe(1);
    expect(h.listForCid("cid-a")).toEqual([streamId]);
  });

  it("abort 触发 controller.abort + 返回 true", () => {
    const h = new SseHub();
    const { streamId, controller } = h.register("cid-b");
    const abortSpy = vi.spyOn(controller, "abort");

    const ok = h.abort(streamId);
    expect(ok).toBe(true);
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it("abort 不存在的 streamId 返回 false", () => {
    const h = new SseHub();
    expect(h.abort("non-existent")).toBe(false);
  });

  it("close 幂等：重复调用不抛错且不重复 abort", () => {
    const h = new SseHub();
    const { streamId, controller } = h.register("cid-c");
    const abortSpy = vi.spyOn(controller, "abort");

    h.close(streamId);
    h.close(streamId);
    h.close(streamId);

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(h.size()).toBe(0);
  });

  it("listForCid 仅返回同 cid 的流", () => {
    const h = new SseHub();
    const { streamId: id1 } = h.register("cid-x");
    const { streamId: id2 } = h.register("cid-x");
    const { streamId: id3 } = h.register("cid-y");

    const xIds = h.listForCid("cid-x");
    expect(xIds.sort()).toEqual([id1, id2].sort());

    const yIds = h.listForCid("cid-y");
    expect(yIds).toEqual([id3]);
  });

  it("closeAll 一次性关掉所有流", () => {
    const h = new SseHub();
    h.register("cid-1");
    h.register("cid-2");
    expect(h.size()).toBe(2);

    h.closeAll();
    expect(h.size()).toBe(0);
  });

  it("全局 hub 单例可独立 reset", () => {
    expect(hub.size()).toBe(0);
    hub.register("cid-global");
    expect(hub.size()).toBe(1);
    _resetHub();
    expect(hub.size()).toBe(0);
  });
});

// ============================================================
// ④b SseHub — P0 runId 关联（register runId / hasActiveRun / abortByRunId）
// ============================================================

describe("SseHub — P0 runId 关联", () => {
  beforeEach(() => {
    _resetHub();
  });

  it("register 支持可选的 runId 参数，缺省时以 streamId 作为有效 runId", () => {
    const h = new SseHub();
    // 显式 runId
    const { streamId: s1 } = h.register("cid-a", "run-1");
    expect(h.getByRunId("run-1")?.runId).toBe("run-1");
    expect(h.listForCid("cid-a")).toEqual([s1]);

    // 缺省 runId → 使用 streamId 兜底（P0 兼容旧调用）
    const { streamId: s2 } = h.register("cid-b");
    expect(h.getByRunId(s2)).toBeDefined();
    expect(h.size()).toBe(2);
  });

  it("hasActiveRun 正确检测同 cid 的活跃 run", () => {
    const h = new SseHub();
    expect(h.hasActiveRun("cid-x")).toBe(false);

    const { streamId } = h.register("cid-x", "run-2");
    expect(h.hasActiveRun("cid-x")).toBe(true);
    // 其他 cid 不受影响
    expect(h.hasActiveRun("cid-y")).toBe(false);

    // 关闭后不再视为活跃
    h.close(streamId);
    expect(h.hasActiveRun("cid-x")).toBe(false);
  });

  it("abortByRunId 按 runId 精确中止对应流并返回 true", () => {
    const h = new SseHub();
    const { controller } = h.register("cid-y", "run-3");
    const abortSpy = vi.spyOn(controller, "abort");

    expect(h.abortByRunId("run-3")).toBe(true);
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(h.size()).toBe(0);
    expect(h.hasActiveRun("cid-y")).toBe(false);

    // 幂等：重复 abort 返回 false
    expect(h.abortByRunId("run-3")).toBe(false);
  });

  it("abortByRunId 对不存在的 runId 返回 false", () => {
    const h = new SseHub();
    expect(h.abortByRunId("no-such-run")).toBe(false);
  });

  it("abortByRunId 只中止目标 run，不影响同 cid 其他流", () => {
    const h = new SseHub();
    const { streamId: keepId } = h.register("cid-z", "run-a");
    h.register("cid-z", "run-b");

    expect(h.abortByRunId("run-b")).toBe(true);
    // run-a 仍在飞
    expect(h.listForCid("cid-z")).toEqual([keepId]);
    expect(h.hasActiveRun("cid-z")).toBe(true);
  });
});

// ============================================================
// ⑤ LastEventIdLru — cap=100 驱逐策略
// ============================================================

describe("LastEventIdLru — 容量控制", () => {
  it("record 返回 true（新）/ false（已存在）", () => {
    const lru = new LastEventIdLru(10);
    expect(lru.record(1)).toBe(true);
    expect(lru.record(1)).toBe(false);
    expect(lru.has(1)).toBe(true);
  });

  it("cap=3 时插入 4 条后最早被驱逐", () => {
    const lru = new LastEventIdLru(3);
    lru.record(1);
    lru.record(2);
    lru.record(3);
    lru.record(4); // 1 被驱逐

    expect(lru.has(1)).toBe(false);
    expect(lru.has(2)).toBe(true);
    expect(lru.has(3)).toBe(true);
    expect(lru.has(4)).toBe(true);
    expect(lru.size()).toBe(3);
  });

  it("reset 清空所有记录", () => {
    const lru = new LastEventIdLru();
    lru.record(1);
    lru.record(2);
    lru.reset();
    expect(lru.size()).toBe(0);
    expect(lru.has(1)).toBe(false);
  });

  it("全局 lastEventLru 单例可独立 reset", () => {
    lastEventLru.record(1);
    expect(lastEventLru.has(1)).toBe(true);
    _resetLru();
    expect(lastEventLru.has(1)).toBe(false);
  });
});

// ============================================================
// ⑥ parseLastEventId
// ============================================================

describe("parseLastEventId — 头部解析", () => {
  it("缺省返回 -1", () => {
    expect(parseLastEventId(undefined)).toBe(-1);
  });

  it("空字符串返回 -1", () => {
    expect(parseLastEventId("")).toBe(-1);
  });

  it("非法字符串返回 -1", () => {
    expect(parseLastEventId("not-a-number")).toBe(-1);
    expect(parseLastEventId("-5")).toBe(-1);
  });

  it("正常数字返回 n", () => {
    expect(parseLastEventId("42")).toBe(42);
  });

  it("数组取首元素", () => {
    expect(parseLastEventId(["7", "8"])).toBe(7);
  });
});

// ============================================================
// ⑦ SSE_EVENT_TYPES — 13 种事件类型断言
// ============================================================

describe("SSE_EVENT_TYPES — 13 种事件（spec § 6.1）", () => {
  it("exactly 13 event types", () => {
    expect(SSE_EVENT_TYPES.length).toBe(13);
  });

  it("包含 spec § 6.1 全部 13 种名称", () => {
    const required = [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
      "tool_use",
      "tool_result",
      "error",
      "done",
      "aborted",
      "usage",
      "ping",
    ];
    for (const t of required) {
      expect(SSE_EVENT_TYPES).toContain(t);
    }
  });

  it("无重复值", () => {
    const set = new Set(SSE_EVENT_TYPES);
    expect(set.size).toBe(SSE_EVENT_TYPES.length);
  });
});