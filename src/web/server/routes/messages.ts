/**
 * my-agent Web 前端 — Chat 流 2 条 SSE 端点（WU-02b / B3）。
 *
 * 来源：spec § 3.1.3 + § 6.1 + contract § 1.3 / § 4。
 *
 * 路由：
 * - `POST /api/sessions/:id/messages/stream`  SSE 流（13 event 完整协议）
 * - `POST /api/sessions/:id/messages/abort`   取消当前流（X-Stream-Id 协议）
 *
 * 设计要点：
 * - 每条流一个 `AgentRunner` 实例（与 chat.ts 同模式 —— runner.runStream 是一次性 AsyncIterable）
 * - 通过 `SseHub` 维护 streamId → AbortController 映射
 * - 同 cid 并发保护：第二条 stream → 429 `STREAM_ALREADY_RUNNING`
 * - `StreamEvent`（src/shared/types.ts）适配为 spec § 6.1 13 种事件
 *
 * 适配表（src/shared/types.ts StreamEvent → spec § 6.1）：
 * - `message_start`  → `message_start`           { message: { id, role, usage } }
 * - `text_delta`     → `content_block_start`     { type: "text", index: 0 }
 *                       → `content_block_delta`    { type: "text_delta", text, index: 0 }
 *                       → `content_block_stop`     { index: 0 }
 * - `tool_use_start` → `tool_use`                { id, name, input: {} }
 * - `tool_use_delta` → `tool_use`                { id, name, input: <partial json> }
 * - `tool_use_end`   → `tool_result`             { tool_use_id, content, is_error }
 * - `message_end`    → `message_delta`           { stop_reason, usage }
 *                       → `message_stop`           { stop_reason }
 *                       → `usage`                  { usage }
 * - `error`          → `error`                   { error: { code, message } }
 * - 终止             → `done`                    { ok: true }
 * - 客户端断开 / abort → `aborted`                { streamId }
 *
 * 不直接依赖 `src/agent/runner.ts` 的具体实现 —— 通过 `runnerFactory`
 * 注入一个返回 `{ runStream: async function* () {...} }` 的最小接口，
 * 让测试可以传入 mock runner。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreAgentConfig } from "../../../config/schema.js";
import type { ProviderRegistry } from "../../../providers/registry.js";
import type { SessionStore } from "../../../storage/session-store.js";
import type { AgentRunParams, AgentRunResult } from "../../../agent/types.js";
import type { StreamEvent, Usage, MessageContent } from "../../../shared/types.js";
import type { PersistentSession } from "../../../agent/persistent-session.js";

import { assertPathSegment } from "../../../storage/paths.js";
import { ROUTES } from "../router.js";
import type { Handler, Route } from "../router.js";
import { readBodyJson, sendJsonError } from "../http-helpers.js";
import { AbortStreamSchema, StreamMessageSchema, type AbortStreamInput, type StreamMessageInput } from "../validators/sessions.js";
import {
  SSE_EVENT_TYPES,
  type SseEventType,
  hub,
  lastEventLru,
  parseLastEventId,
  sseResponse,
  writeEvent,
  type SseSession,
} from "../sse.js";

// ============================================================
// Runner factory interface（测试可注入）
// ============================================================

/**
 * Runner factory 的最小契约。
 *
 * 真实实现（bin/my-agent-web.ts 装配层）会构造 `AgentRunner` 并复用 session；
 * 测试则可以传入一个返回 `{ runStream: () => asyncIterable }` 的对象。
 */
export type RunnerLike = {
  runStream(params: AgentRunParams): AsyncIterable<StreamEvent>;
};

export type RunnerFactory = (input: {
  session: PersistentSession;
}) => RunnerLike;

// ============================================================
// 安装路由（闭包注入 SessionStore + RunnerFactory）
// ============================================================

/**
 * 把 Chat 流 2 条路由的占位 handler 替换成真实实现。
 *
 * 必须在 `createServer()` 之前调用一次。
 */
export function installMessageRoutes(deps: {
  sessionStore: SessionStore;
  config: CoreAgentConfig;
  providers: ProviderRegistry;
  runnerFactory: RunnerFactory;
}): void {
  const { sessionStore, runnerFactory } = deps;

  replaceHandlerRegex(
    ROUTES,
    "POST",
    /^\/api\/sessions\/([^/]+)\/messages\/stream$/,
    (req, res, params) =>
      postMessageStream(req, res, sessionStore, runnerFactory, params["id"] ?? ""),
  );

  replaceHandlerRegex(
    ROUTES,
    "POST",
    /^\/api\/sessions\/([^/]+)\/messages\/abort$/,
    (req, res, params) =>
      abortMessage(req, res, sessionStore, params["id"] ?? ""),
  );
}

function replaceHandlerRegex(
  routes: Route[],
  method: string,
  pattern: RegExp,
  handler: Handler,
): void {
  for (const route of routes) {
    if (route[0] !== method) continue;
    const existing = route[1];
    if (typeof existing === "string") continue;
    if (existing.source === pattern.source && existing.flags === pattern.flags) {
      route[2] = handler;
      return;
    }
  }
}

// ============================================================
// POST /api/sessions/:id/messages/stream
// ============================================================

async function postMessageStream(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  runnerFactory: RunnerFactory,
  rawId: string,
): Promise<void> {
  // 1) 路径防御 + 加载 session
  let sessionId: string;
  try {
    sessionId = assertPathSegment(rawId, "id");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${rawId}" not found`);
    return;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${sessionId}" not found`);
    return;
  }

  // 2) 读取 + 校验 body
  let body: StreamMessageInput;
  try {
    const raw = await readBodyJson<unknown>(req);
    const parsed = StreamMessageSchema.safeParse(raw);
    if (!parsed.success) {
      sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid request body", {
        details: parsed.error.flatten(),
      });
      return;
    }
    body = parsed.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bad request";
    if (msg.includes("PAYLOAD_TOO_LARGE")) {
      sendJsonError(res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
      return;
    }
    sendJsonError(res, 400, "INVALID_JSON", msg);
    return;
  }

  // 3) 并发保护：同 cid 上已有流 → 409 STREAM_ALREADY_RUNNING
  const liveIds = hub.listForCid(sessionId);
  if (liveIds.length > 0) {
    sendJsonError(
      res,
      409,
      "STREAM_ALREADY_RUNNING",
      `Session "${sessionId}" already has ${liveIds.length} in-flight stream(s)`,
      { details: { streamIds: liveIds } },
    );
    return;
  }

  // 4) 注册 hub 流（生成 streamId + AbortController）
  const { streamId, controller } = hub.register(sessionId);

  // 5) 读取 Last-Event-ID（spec § 6.1：客户端重连去重）
  const lastEventId = parseLastEventId(req.headers["last-event-id"]);

  // 6) 起 SSE 响应
  const sse = sseResponse(res, {
    streamId,
    onClientGone: () => hub.close(streamId),
  });

  try {
    // 6a) 首条 message_start（spec § 6.1 — 13 event 之首）
    sse.seq = sse.seq + 1;
    writeEvent(res, {
      id: sse.seq,
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: streamId,
          role: "assistant",
          stream_id: streamId,
          cid: sessionId,
          seq: 0,
        },
      },
    });

    // 6b) 适配 AgentRunner.runStream → 13 种 SSE event
    let aborted = false;
    let endedNormally = false;
    let nextBlockIndex = 0;
    const openTextBlocks = new Set<number>();

    // 注册 abort 回调：当 controller.abort() 被调用时标记
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    try {
      const runner = runnerFactory({ session });

      // 构造 runner params
      const params: AgentRunParams = {
        message: body.text,
        ...(body.systemPrompt !== undefined
          ? { systemPrompt: body.systemPrompt }
          : {}),
        signal: controller.signal,
      };

      for await (const ev of runner.runStream(params)) {
        if (sse.clientGone) break;
        // Last-Event-ID 去重：如果客户端声明已收到 ≥ seq，跳过
        if (sse.seq <= lastEventId) continue;

        // 候选 seq：先递增；LRU 检查候选 seq（避免与上一轮写入的 seq 冲突）
        sse.seq = sse.seq + 1;
        if (lastEventLru.has(sse.seq)) continue;
        lastEventLru.record(sse.seq);

        await adaptStreamEvent(res, ev, sse, () => nextBlockIndex++, openTextBlocks);

        if (ev.type === "message_end" || ev.type === "error") {
          // 终止类事件：不再 yield 后续
          if (ev.type === "message_end") endedNormally = true;
          break;
        }
      }
    } catch (err) {
      // runner 抛错 → 发 error 事件
      if (!sse.clientGone) {
        sse.seq = sse.seq + 1;
        writeEvent(res, {
          id: sse.seq,
          event: "error",
          data: {
            ok: false,
            error: {
              code: "CHAT_RUNNER_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          },
        });
      }
    }

    // 6c) 终止事件
    if (!sse.clientGone) {
      if (aborted) {
        sse.seq = sse.seq + 1;
        writeEvent(res, {
          id: sse.seq,
          event: "aborted",
          data: { ok: false, streamId, reason: "client_abort" },
        });
      } else if (!endedNormally) {
        // 流异常断开（runner 没正常终止）→ 发 done + 标记
        sse.seq = sse.seq + 1;
        writeEvent(res, {
          id: sse.seq,
          event: "done",
          data: { ok: true, streamId },
        });
      } else {
        // 正常 message_end：补 done 事件
        sse.seq = sse.seq + 1;
        writeEvent(res, {
          id: sse.seq,
          event: "done",
          data: { ok: true, streamId },
        });
      }
    }
  } finally {
    hub.close(streamId);
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}

// ============================================================
// POST /api/sessions/:id/messages/abort
// ============================================================

async function abortMessage(
  req: IncomingMessage,
  res: ServerResponse,
  _sessionStore: SessionStore,
  rawId: string,
): Promise<void> {
  // 1) 路径防御
  let sessionId: string;
  try {
    sessionId = assertPathSegment(rawId, "id");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${rawId}" not found`);
    return;
  }

  // 2) 读 body（可选）
  let input: AbortStreamInput = {};
  try {
    const raw = await readBodyJson<unknown>(req);
    const parsed = AbortStreamSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid abort request body", {
        details: parsed.error.flatten(),
      });
      return;
    }
    input = parsed.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bad request";
    if (msg.includes("PAYLOAD_TOO_LARGE")) {
      sendJsonError(res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
      return;
    }
    // 空 body 时 input 仍为 {}，可继续
    input = {};
  }

  // 3) 找目标 streamId
  let targetStreamId: string | undefined = input.streamId;
  if (!targetStreamId) {
    // 退化：abort 该 cid 上**所有**在飞流（兜底）
    const liveIds = hub.listForCid(sessionId);
    if (liveIds.length === 0) {
      sendJsonError(res, 404, "STREAM_NOT_FOUND", `No in-flight stream for session "${sessionId}"`);
      return;
    }
    for (const id of liveIds) hub.abort(id);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, data: { aborted: liveIds } }));
    return;
  }

  // 4) abort 指定 streamId
  const ok = hub.abort(targetStreamId);
  if (!ok) {
    sendJsonError(res, 404, "STREAM_NOT_FOUND", `Stream "${targetStreamId}" not found`);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, data: { aborted: [targetStreamId] } }));
}

// ============================================================
// StreamEvent → SSE event 适配器
// ============================================================

/**
 * 把一条 `StreamEvent`（src/shared/types.ts）适配成一组 SSE 事件写入 `res`。
 *
 * 约定：
 * - 调用前 `sse.seq` 已自增；写入时使用当前 seq
 * - 同一 stream 上递增 `nextBlockIndex` 分配 content block 索引
 * - 文本块首尾包 `content_block_start` / `content_block_stop`
 *
 * 测试可导出此函数直接验证映射正确性。
 */
export async function adaptStreamEvent(
  res: ServerResponse,
  ev: StreamEvent,
  sse: SseSession,
  allocBlockIndex: () => number,
  openTextBlocks: Set<number>,
): Promise<void> {
  switch (ev.type) {
    case "message_start": {
      // 已在 postMessageStream 写过 message_start，此处不再重复（除非 usage 增量）
      if (ev.usage) {
        writeEvent(res, {
          id: sse.seq,
          event: "usage",
          data: { type: "usage", usage: normalizeUsage(ev.usage) },
        });
      }
      return;
    }

    case "text_delta": {
      // 首个 text_delta：先开 content_block_start
      let idx: number;
      if (openTextBlocks.size === 0) {
        idx = allocBlockIndex();
        openTextBlocks.add(idx);
        writeEvent(res, {
          id: sse.seq,
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: idx,
            content_block: { type: "text", text: "" },
          },
        });
      } else {
        idx = openTextBlocks.values().next().value as number;
      }
      writeEvent(res, {
        id: sse.seq,
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: idx,
          delta: { type: "text_delta", text: ev.text },
        },
      });
      return;
    }

    case "tool_use_start": {
      const idx = allocBlockIndex();
      writeEvent(res, {
        id: sse.seq,
        event: "tool_use",
        data: {
          type: "tool_use",
          id: ev.id,
          name: ev.name,
          input: {},
          index: idx,
        },
      });
      return;
    }

    case "tool_use_delta": {
      // 单条事件：partial JSON 输入
      writeEvent(res, {
        id: sse.seq,
        event: "tool_use",
        data: {
          type: "tool_use",
          id: ev.id,
          input: ev.input,
          partial: true,
        },
      });
      return;
    }

    case "tool_use_end": {
      writeEvent(res, {
        id: sse.seq,
        event: "tool_result",
        data: {
          type: "tool_result",
          tool_use_id: ev.id,
          content: "",
          is_error: false,
        },
      });
      return;
    }

    case "message_end": {
      // 关闭所有打开的 text block
      for (const idx of openTextBlocks) {
        writeEvent(res, {
          id: sse.seq,
          event: "content_block_stop",
          data: { type: "content_block_stop", index: idx },
        });
      }
      openTextBlocks.clear();

      // message_delta（含 stop_reason）
      writeEvent(res, {
        id: sse.seq,
        event: "message_delta",
        data: {
          type: "message_delta",
          stop_reason: ev.stopReason,
          ...(ev.model !== undefined ? { model: ev.model } : {}),
        },
      });

      // message_stop（终止）
      writeEvent(res, {
        id: sse.seq,
        event: "message_stop",
        data: { type: "message_stop", stop_reason: ev.stopReason },
      });

      // usage（如果有）
      if (ev.usage) {
        writeEvent(res, {
          id: sse.seq,
          event: "usage",
          data: { type: "usage", usage: normalizeUsage(ev.usage) },
        });
      }
      return;
    }

    case "error": {
      writeEvent(res, {
        id: sse.seq,
        event: "error",
        data: {
          ok: false,
          error: {
            code: "CHAT_RUNNER_ERROR",
            message: ev.error instanceof Error ? ev.error.message : String(ev.error),
          },
        },
      });
      return;
    }

    default: {
      // 未知事件：忽略（不写入 → 客户端不会 dispatch）
      // 但保留一个 ping 兜底，确保连接还活着
      writeEvent(res, {
        id: sse.seq,
        event: "ping",
        data: { type: "ping", ts: Date.now() },
      });
      return;
    }
  }
}

function normalizeUsage(partial: Partial<Usage>): Usage {
  const inputTokens = partial.inputTokens ?? 0;
  const outputTokens = partial.outputTokens ?? 0;
  const total =
    partial.totalTokens ??
    inputTokens + outputTokens + (partial.cacheReadTokens ?? 0) + (partial.cacheWriteTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    ...(partial.cacheReadTokens !== undefined ? { cacheReadTokens: partial.cacheReadTokens } : {}),
    ...(partial.cacheWriteTokens !== undefined ? { cacheWriteTokens: partial.cacheWriteTokens } : {}),
    totalTokens: total,
  };
}

// ============================================================
// 导出（便利测试）
// ============================================================

/** 列出全部 13 种事件名（spec § 6.1）。 */
export const SSE_EVENT_TYPE_LIST: readonly SseEventType[] = SSE_EVENT_TYPES;

/** 重新导出 SseHub 便于测试断言。 */
export { hub as sseHub } from "../sse.js";

// 占位：声明 AgentRunResult / MessageContent 用法（避免 tree-shake 报错）
void (0 as unknown as AgentRunResult);
void (0 as unknown as MessageContent);