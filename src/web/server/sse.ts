/**
 * my-agent Web 前端 — SSE 协议层（WU-02b / B3）。
 *
 * 来源：spec § 6.1 + contract § 4。
 *
 * 单一职责：
 * - 13 种 SSE event 名称 + payload 形态契约
 * - 序列化协议：每个 event = `id: <seq>\nevent: <name>\ndata: <json>\n\n`
 * - 心跳注释行：`: heartbeat\n\n`（防代理超时）
 * - 全局 `SseHub`：按 `streamId` 持有 `AbortController`，
 *   `/api/sessions/:id/messages/abort` 通过它联动 `runner.runStream({ signal })`
 * - 客户端 `Last-Event-ID` 去重：进程内 LRU（cap=100），防止重连重复 dispatch
 *
 * **不**负责：路由分发、Zod 校验、AgentRunner 适配（适配放在 `routes/messages.ts`）。
 */

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

// ============================================================
// SSE 事件名枚举（spec § 6.1 — 13 种）
// ============================================================

/**
 * 服务端→客户端 SSE 事件名枚举。
 *
 * 设计原则：与 Anthropic Messages API 流式事件对齐（前端可直接复用 EventSource 习惯）；
 * 同时承载 my-agent 专属事件（`aborted` / `usage` / `done` / `error` / `ping`）。
 */
export const SSE_EVENT_TYPES = [
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
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];

// ============================================================
// SseHub：streamId → AbortController 中心仓库
// ============================================================

/**
 * 一条 SSE 流关联的运行时状态。
 *
 * 设计：
 * - `controller` 用于 `/abort` 路由触发 `runner.runStream({ signal })` 中止；
 * - `cid` 用于 `listLiveStreamsForCid` 反查（in-flight 并发保护 § 3.4.6）；
 * - `closed` 标记避免 `abort()` 重复调用副作用。
 */
type LiveStream = {
  controller: AbortController;
  cid: string;
  closed: boolean;
};

/**
 * 进程内 SSE 流注册表。
 *
 * 全局单例（一个 Node 进程只有一个 HTTP server）—— 所有路由共享同一份
 * `_liveStreams` 视图，避免多 handler 之间状态不一致。
 */
export class SseHub {
  private readonly _map = new Map<string, LiveStream>();

  /** 注册一条新流，返回 streamId。 */
  register(cid: string): { streamId: string; controller: AbortController } {
    const streamId = randomUUID();
    const controller = new AbortController();
    this._map.set(streamId, { controller, cid, closed: false });
    return { streamId, controller };
  }

  /** 主动关闭流（路由结束时调用，幂等）。 */
  close(streamId: string): void {
    const entry = this._map.get(streamId);
    if (!entry) return;
    if (!entry.closed) {
      entry.closed = true;
      try {
        entry.controller.abort();
      } catch {
        /* ignore */
      }
    }
    this._map.delete(streamId);
  }

  /** 通过 streamId 触发 abort（给 /abort 路由调用）。 */
  abort(streamId: string): boolean {
    const entry = this._map.get(streamId);
    if (!entry) return false;
    if (entry.closed) return true;
    entry.closed = true;
    try {
      entry.controller.abort();
    } catch {
      /* ignore */
    }
    return true;
  }

  /** 返回某 cid 上所有在飞流 id（in-flight 并发保护）。已关闭/abort 的流不返回。 */
  listForCid(cid: string): string[] {
    const out: string[] = [];
    for (const [id, entry] of this._map) {
      if (entry.cid === cid && !entry.closed) out.push(id);
    }
    return out;
  }

  /** 当前在飞流数量（监控 / 调试用）。 */
  size(): number {
    return this._map.size;
  }

  /** 关闭所有在飞流（graceful shutdown）。 */
  closeAll(): void {
    for (const id of [...this._map.keys()]) this.close(id);
  }
}

/**
 * 进程级 SSE Hub 单例。
 *
 * 直接 `import { hub } from "./sse.js"` 即可；测试可通过 `_resetHub()` 清空。
 */
export const hub = new SseHub();

/** 测试钩子：清空 hub 全局状态（不会影响其他模块）。 */
export function _resetHub(): void {
  hub.closeAll();
}

// ============================================================
// SSE 响应头 + 心跳定时器
// ============================================================

/**
 * 给 `res` 设置 SSE 响应头并启动自动心跳。
 *
 * 调用后：
 * - `res.statusCode = 200`
 * - 响应头：`Content-Type: text/event-stream; charset=utf-8` / `Cache-Control: no-cache, no-transform` /
 *   `Connection: keep-alive` / `X-Accel-Buffering: no` / `X-Stream-Id: <streamId>`
 * - 每 `heartbeatMs` 写一条 `: heartbeat\n\n` 注释行
 * - 客户端断开（`res.on('close')`）→ 返回 `onClientGone` 让调用方停止写入并清理 hub
 *
 * **不会**自动写首条 `message_start` 事件；调用方需要自己用 `writeEvent` 写。
 */
export type SseResponseOptions = {
  streamId: string;
  heartbeatMs?: number;
  onClientGone?: () => void;
};

export type SseSession = {
  /** 当前已写入 seq；调用方每次 `writeEvent` 时自增 1。 */
  seq: number;
  /** 客户端是否已断开。 */
  clientGone: boolean;
};

export function sseResponse(
  res: ServerResponse,
  opts: SseResponseOptions,
): SseSession {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Stream-Id", opts.streamId);

  const session: SseSession = { seq: 0, clientGone: false };

  // 心跳：定时写注释行保活
  const heartbeat = setInterval(() => {
    if (session.clientGone) return;
    try {
      writeHeartbeat(res);
    } catch {
      session.clientGone = true;
      clearInterval(heartbeat);
    }
  }, heartbeatMs);
  // unref 让心跳不阻塞进程退出
  heartbeat.unref?.();

  // 客户端断开 → 标记并通知调用方
  res.on("close", () => {
    if (session.clientGone) return;
    session.clientGone = true;
    clearInterval(heartbeat);
    try {
      opts.onClientGone?.();
    } catch {
      /* ignore */
    }
  });

  return session;
}

// ============================================================
// SSE 事件序列化
// ============================================================

/**
 * 写一条 SSE 事件。
 *
 * 格式严格按 spec § 6.1：
 * ```
 * id: <seq>
 * event: <name>
 * data: <JSON 字符串>
 * <blank line>
 * ```
 *
 * `id` 缺失则省略该行（但保持换行序）。客户端仍可识别（部分客户端按 `event:` 触发）。
 *
 * 抛出任何 `res.write` 错误时让上层捕获并 abort 流。
 */
export type SseWriteEventInput = {
  /** 序列号；首条 `message_start` 写 0，递增。 */
  id?: number;
  /** 事件名（必须命中 SSE_EVENT_TYPES 之一） */
  event: SseEventType | string;
  /** data JSON（任意可序列化对象） */
  data: unknown;
};

export function writeEvent(
  res: ServerResponse,
  input: SseWriteEventInput,
): void {
  const lines: string[] = [];
  if (input.id !== undefined) lines.push(`id: ${input.id}`);
  lines.push(`event: ${input.event}`);
  lines.push(`data: ${JSON.stringify(input.data)}`);
  lines.push("");
  lines.push("");
  res.write(lines.join("\n"));
}

/**
 * 写一条 SSE 心跳注释行。
 *
 * 注释行以 `:` 开头，客户端 EventSource 不会触发任何事件（spec § 6.1），
 * 仅用于让中间代理（nginx / 企业网关）保持连接不超时。
 *
 * 文本固定为 `heartbeat`（带时间戳便于线上排查延迟）。
 */
export function writeHeartbeat(res: ServerResponse): void {
  res.write(`: heartbeat ${Date.now()}\n\n`);
}

// ============================================================
// Last-Event-ID 去重（进程内 LRU）
// ============================================================

/**
 * 进程内 LRU 去重表（cap=100）。
 *
 * 收到 `Last-Event-ID` 头时，< `maxSeq` 的 seq 直接跳过不渲染——避免客户端重连
 * 重复 dispatch。内存只有 100 条，远小于千万级事件的实际流，不会成 OOM。
 *
 * **不**持久化：进程重启后 LRU 清空（最多重复 dispatch 1 次流开头部分）。
 */
export class LastEventIdLru {
  private readonly _cap: number;
  private readonly _seen = new Set<number>();
  private readonly _order: number[] = [];

  constructor(cap = 100) {
    this._cap = cap;
  }

  /** 记录已处理 seq。`true` = 新增；`false` = 已存在（应跳过）。 */
  record(seq: number): boolean {
    if (this._seen.has(seq)) return false;
    this._seen.add(seq);
    this._order.push(seq);
    while (this._order.length > this._cap) {
      const evict = this._order.shift();
      if (evict !== undefined) this._seen.delete(evict);
    }
    return true;
  }

  /** 是否应跳过某 seq（已记录）。 */
  has(seq: number): boolean {
    return this._seen.has(seq);
  }

  size(): number {
    return this._seen.size;
  }

  /** 测试钩子：清空 LRU。 */
  reset(): void {
    this._seen.clear();
    this._order.length = 0;
  }
}

/**
 * 默认 LRU 实例（cap=100）。所有路由共享同一份；测试可通过 `_resetLru()` 清空。
 */
export const lastEventLru = new LastEventIdLru(100);

/** 测试钩子：清空默认 LRU。 */
export function _resetLru(): void {
  lastEventLru.reset();
}

/**
 * 给定请求头中的 `Last-Event-ID`，返回「客户端已确认的最大 seq」。
 *
 * 缺省 / 非法 → 返回 -1（视为客户端没收到过任何事件，全部需下发）。
 */
export function parseLastEventId(header: string | string[] | undefined): number {
  if (!header) return -1;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return -1;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return -1;
  return n;
}