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
import { randomUUID } from "node:crypto";
import type { CoreAgentConfig } from "../../../config/schema.js";
import type { ProviderRegistry } from "../../../providers/registry.js";
import type { SessionStore } from "../../../storage/session-store.js";
import type { AgentRunParams, AgentRunResult } from "../../../agent/types.js";
import type { StreamEvent, Usage, MessageContent } from "../../../shared/types.js";
import type { PersistentSession } from "../../../agent/persistent-session.js";
import type { Logger } from "../../../shared/logger.js";

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
  logger?: Logger;
}): void {
  const { sessionStore, runnerFactory, logger } = deps;

  replaceHandlerRegex(
    ROUTES,
    "POST",
    /^\/api\/sessions\/([^/]+)\/messages\/stream$/,
    (req, res, params) =>
      postMessageStream(req, res, sessionStore, runnerFactory, params["id"] ?? "", logger),
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
  logger?: Logger,
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

  // 3) P0 并发保护：同 session 已有非终态 run → 409
  if (hub.hasActiveRun(sessionId)) {
    sendJsonError(res, 409, "RUN_ALREADY_ACTIVE", `Session "${sessionId}" already has an active run`);
    return;
  }

  const userContent = [{ type: "text" as const, text: body.text }];
  const userIdentity = body.clientMessageId === undefined
    ? { status: "available" as const }
    : session.checkUserTurnIdentity(body.clientMessageId, userContent);
  if (userIdentity.status === "conflict") {
    sendJsonError(
      res,
      409,
      "CLIENT_MESSAGE_ID_CONFLICT",
      `clientMessageId "${body.clientMessageId}" is already bound to a different payload`,
    );
    return;
  }
  const completedDuplicateAssistant = userIdentity.status === "duplicate"
    ? session.getCompletedTurnFinalAssistant(userIdentity.turnId)
    : undefined;

  // 4) P0 使用客户端传来的 runId（前后端对齐）；缺省时服务端自生成
  const runId = body.runId ?? randomUUID();
  const assistantMessageId = completedDuplicateAssistant?.id ?? randomUUID();

  // 5) 注册 hub 流（生成 streamId + AbortController）
  const { streamId, controller } = hub.register(sessionId, runId);

  // SSE stream 开始日志：仅记录长度与匿名运行标识，不记录用户正文
  const sseStartTime = Date.now();
  logger?.info("💬 对话开始", {
    sessionId,
    runId,
    streamId,
    messageLength: body.text.length,
    model: body.model,
  });

  // 6) 读取 Last-Event-ID
  const lastEventId = parseLastEventId(req.headers["last-event-id"]);

  // 7) 起 SSE 响应
  const sse = sseResponse(res, {
    streamId,
    onClientGone: () => hub.close(streamId),
  });

  // P0: 每个物理 SSE frame 唯一 seq（不再用 sse.seq 的共享递增）
  let frameSeq = 0;
  const nextSeq = (): number => { frameSeq += 1; return frameSeq; };

  /** 写一条带 P0 envelope 的 SSE 事件 */
  const emit = (event: string, data: Record<string, unknown>) => {
    const seq = nextSeq();
    writeEvent(res, {
      id: seq,
      event,
      data: {
        sessionId,
        runId,
        streamId,
        seq,
        event,
        data,
      },
    });
  };

  try {
    if (completedDuplicateAssistant !== undefined) {
      emit("done", {
        ok: true,
        streamId,
        runId,
        persistedRevision: session.getAllMessages().length,
        messageId: assistantMessageId,
        deduplicated: true,
      });
      return;
    }

    // 7a) 首条 message_start（含 runId/streamId/messageId）
    emit("message_start", {
      type: "message_start",
      message: {
        id: assistantMessageId,
        role: "assistant",
        stream_id: streamId,
        run_id: runId,
        cid: sessionId,
      },
    });

    // 7b) 适配 AgentRunner.runStream → SSE events（带 envelope）
    let aborted = false;
    let terminalError:
      | { code: "AUTH_ERROR" | "CHAT_RUNNER_ERROR"; message: string }
      | undefined;
    let terminalMessageId: string = assistantMessageId;
    let sourceTerminalReceived = false;
    let nextBlockIndex = 0;
    const openTextBlocks = new Set<number>();

    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    try {
      const runner = runnerFactory({ session });

      const params: AgentRunParams = {
        message: body.text,
        runId,
        clientMessageId: body.clientMessageId ?? randomUUID(),
        assistantMessageId,
        ...(body.systemPrompt !== undefined
          ? { systemPrompt: body.systemPrompt }
          : {}),
        ...(body.model !== undefined
          ? { model: body.model }
          : {}),
        ...(body.thinkingLevel !== undefined
          ? { thinkingLevel: body.thinkingLevel }
          : {}),
        signal: controller.signal,
      };

      const isReconnect = lastEventId >= 0;

      for await (const ev of runner.runStream(params)) {
        if (sse.clientGone) break;
        if (aborted) break;
        // P0: Last-Event-ID 去重（按 frameSeq）
        if (isReconnect && frameSeq <= lastEventId) continue;
        if (isReconnect) {
          if (lastEventLru.has(frameSeq + 1)) continue;
          lastEventLru.record(frameSeq + 1);
        }

        if (ev.type === "done") {
          sourceTerminalReceived = true;
          const doneEvent = ev as typeof ev & {
            messageId?: string;
            result?: { meta?: { error?: { kind?: string; message: string } } };
          };
          terminalMessageId = doneEvent.messageId ?? terminalMessageId;
          const error = doneEvent.result?.meta?.error;
          if (error) {
            terminalError = {
              code: error.kind === "auth" ? "AUTH_ERROR" : "CHAT_RUNNER_ERROR",
              message: error.message,
            };
            emit("error", { ok: false, error: terminalError });
          }
          break;
        }

        await adaptStreamEventWithEnvelope(
          res, ev, emit, () => nextBlockIndex++, openTextBlocks,
        );

        if (ev.type === "error") {
          sourceTerminalReceived = true;
          terminalError = {
            code: "CHAT_RUNNER_ERROR",
            message: ev.error instanceof Error ? ev.error.message : String(ev.error),
          };
          break;
        }
      }
      if (
        !sse.clientGone &&
        !aborted &&
        !sourceTerminalReceived &&
        terminalError === undefined
      ) {
        terminalError = {
          code: "CHAT_RUNNER_ERROR",
          message: "Runner stream ended without a terminal event",
        };
        emit("error", { ok: false, error: terminalError });
      }
    } catch (err) {
      if (!sse.clientGone && !aborted) {
        terminalError = {
          code: "CHAT_RUNNER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        };
        emit("error", {
          ok: false,
          error: terminalError,
        });
      }
    }

    // 7c) 终止事件（携带 persistedRevision + messageId）
    if (!sse.clientGone) {
      const revision = (session as PersistentSession).getAllMessages?.().length ?? 0;

      if (aborted) {
        emit("aborted", {
          ok: false, streamId, runId, reason: "client_abort",
          persistedRevision: revision,
        });
      } else if (terminalError === undefined) {
        emit("done", {
          ok: true, streamId, runId,
          persistedRevision: revision,
          messageId: terminalMessageId,
        });
      }
    }
  } finally {
    const sseDuration = Date.now() - sseStartTime;
    logger?.info(`💬 对话结束 [${sessionId}] run:${runId} 耗时:${sseDuration}ms`, { sessionId, runId, streamId, durationMs: sseDuration });
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

  // 3) 找目标（优先 runId → streamId → 全 cid 兜底）
  let targetStreamId: string | undefined = input.streamId;
  const targetRunId: string | undefined = input.runId;

  if (!targetStreamId && !targetRunId) {
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

  // 4) abort：优先 runId → streamId
  let ok: boolean;
  if (targetRunId) {
    ok = hub.abortByRunId(sessionId, targetRunId);
  } else {
    ok = hub.abort(targetStreamId!, sessionId);
  }
  if (!ok) {
    sendJsonError(res, 404, "STREAM_NOT_FOUND", `Stream not found`);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, data: { aborted: [targetRunId ?? targetStreamId] } }));
}

// ============================================================
// P0 StreamEvent → SSE event 适配器（含 envelope）
// ============================================================

/**
 * P0 版适配器：与 `adaptStreamEvent` 逻辑相同，但通过 `emit` 回调统一封 envelope。
 *
 * `emit(event, data)` 自动包装 { sessionId, runId, streamId, seq, event, data }。
 */
async function adaptStreamEventWithEnvelope(
  res: ServerResponse,
  ev: StreamEvent,
  emit: (event: string, data: Record<string, unknown>) => void,
  allocBlockIndex: () => number,
  openTextBlocks: Set<number>,
): Promise<void> {
  switch (ev.type) {
    case "message_start": {
      if (ev.usage) {
        emit("usage", { type: "usage", usage: normalizeUsage(ev.usage) });
      }
      return;
    }

    case "message_end": {
      for (const idx of openTextBlocks) {
        emit("content_block_stop", { type: "content_block_stop", index: idx });
      }
      openTextBlocks.clear();
      emit("message_delta", {
        type: "message_delta",
        stop_reason: ev.stopReason,
        ...(ev.model !== undefined ? { model: ev.model } : {}),
      });
      emit("message_stop", { type: "message_stop", stop_reason: ev.stopReason });
      if (ev.usage) {
        emit("usage", { type: "usage", usage: normalizeUsage(ev.usage) });
      }
      return;
    }

    case "error": {
      emit("error", {
        ok: false,
        error: {
          code: "CHAT_RUNNER_ERROR",
          message: ev.error instanceof Error ? ev.error.message : String(ev.error),
        },
      });
      return;
    }

    case "text_delta": {
      let idx: number;
      if (openTextBlocks.size === 0) {
        idx = allocBlockIndex();
        openTextBlocks.add(idx);
        emit("content_block_start", {
          type: "content_block_start",
          index: idx,
          content_block: { type: "text", text: "" },
        });
      } else {
        idx = openTextBlocks.values().next().value as number;
      }
      emit("content_block_delta", {
        type: "content_block_delta",
        index: idx,
        delta: { type: "text_delta", text: ev.text },
      });
      return;
    }

    case "thinking_delta": {
      emit("thinking_delta", {
        type: "thinking_delta",
        thinking: ev.thinking,
      });
      return;
    }

    case "tool_use_start": {
      const idx = allocBlockIndex();
      emit("tool_use", {
        type: "tool_use",
        id: ev.id,
        name: ev.name,
        input: {},
        index: idx,
      });
      return;
    }

    case "tool_use_delta": {
      emit("tool_use", {
        type: "tool_use",
        id: ev.id,
        input: ev.input,
        partial: true,
      });
      return;
    }

    case "tool_use_end": {
      return; // 防御性代码，不做 SSE 写入
    }

    case "tool_delta": {
      emit("tool_use", {
        type: "tool_use",
        id: ev.id,
        ...(ev.name ? { name: ev.name } : {}),
        input: ev.inputDelta,
        partial: true,
      });
      return;
    }

    case "tool_start": {
      const idx = allocBlockIndex();
      emit("tool_use", {
        type: "tool_use",
        id: ev.id,
        name: ev.name,
        input: ev.input,
        index: idx,
        ...(ev.actorName !== undefined ? { actor_name: ev.actorName } : {}),
        ...(ev.actorKind !== undefined ? { actor_kind: ev.actorKind } : {}),
      });
      emit("tool_progress", {
        type: "tool_progress",
        tool_id: ev.id,
        tool_name: ev.name,
        phase: "start",
        message: `执行工具: ${ev.name}`,
      });
      return;
    }

    case "tool_progress": {
      emit("tool_progress", {
        type: "tool_progress",
        tool_id: ev.id,
        tool_name: ev.name,
        phase: ev.phase ?? "progress",
        message: ev.message,
        ...(ev.data ? { data: ev.data } : {}),
      });
      return;
    }

    case "tool_end": {
      emit("tool_result", {
        type: "tool_result",
        tool_use_id: ev.id,
        tool_name: ev.name,
        content: ev.result,
        is_error: ev.isError ?? false,
        ...(ev.durationMs !== undefined ? { duration_ms: ev.durationMs } : {}),
        ...(ev.actorName !== undefined ? { actor_name: ev.actorName } : {}),
        ...(ev.actorKind !== undefined ? { actor_kind: ev.actorKind } : {}),
      });
      return;
    }

    case "agent_message": {
      emit("agent_message", {
        type: "agent_message",
        actorId: ev.actorId,
        actorName: ev.actorName,
        actorKind: ev.actorKind,
        text: ev.text,
        isFinal: ev.isFinal,
      });
      return;
    }

    case "dispatch_started": {
      emit("dispatch_started", {
        type: "dispatch_started",
        actorId: ev.actorId,
        actorName: ev.actorName,
        toolName: ev.toolName,
        toolId: ev.toolId,
        isFinal: ev.isFinal,
      });
      return;
    }

    case "worker_step_start": {
      emit("worker_step_start", {
        type: "worker_step_start",
        actorId: ev.actorId,
        kind: ev.kind,
        label: ev.label,
        stepId: ev.stepId,
      });
      return;
    }

    case "worker_text_delta": {
      emit("worker_text_delta", {
        type: "worker_text_delta",
        actorId: ev.actorId,
        text: ev.text,
        stepId: ev.stepId,
      });
      return;
    }

    case "worker_step_end": {
      emit("worker_step_end", {
        type: "worker_step_end",
        actorId: ev.actorId,
        stepId: ev.stepId,
        summary: ev.summary,
        isError: ev.isError,
      });
      return;
    }

    case "dispatch_done": {
      emit("dispatch_done", {
        type: "dispatch_done",
        actorId: ev.actorId,
        toolName: ev.toolName,
      });
      return;
    }

    case "compaction": {
      emit("compaction", {
        type: "compaction",
        tokens_before: ev.tokensBefore,
        tokens_after: ev.tokensAfter,
        ...(ev.summary ? { summary: ev.summary } : {}),
        ...(ev.durationMs !== undefined ? { duration_ms: ev.durationMs } : {}),
      });
      return;
    }

    case "context_status": {
      emit("context_status", {
        type: "context_status",
        phase: ev.phase,
        message: ev.message,
        ...(ev.data ? { data: ev.data } : {}),
      });
      return;
    }

    case "retry": {
      emit("retry", {
        type: "retry",
        attempt: ev.attempt,
        reason: ev.reason,
        ...(ev.waitMs !== undefined ? { wait_ms: ev.waitMs } : {}),
      });
      return;
    }

    case "provider_fallback": {
      emit("provider_fallback", {
        type: "provider_fallback",
        reason: ev.reason,
        provider_id: ev.providerId,
      });
      return;
    }

    case "done": {
      const doneEv = ev as unknown as {
        type: "done";
        result?: { meta?: { error?: { kind?: string; message: string } } };
      };
      if (doneEv.result?.meta?.error) {
        emit("error", {
          ok: false,
          error: {
            code:
              doneEv.result.meta.error.kind === "auth"
                ? "AUTH_ERROR"
                : "CHAT_RUNNER_ERROR",
            message: doneEv.result.meta.error.message,
          },
        });
      } else {
        emit("done", { ok: true });
      }
      return;
    }

    default: {
      emit("ping", { type: "ping", ts: Date.now() });
      return;
    }
  }
}

// ============================================================
// StreamEvent → SSE event 适配器（旧版，保留用于测试兼容）
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
    // ==========================================================
    // 生命周期
    // ==========================================================
    case "message_start": {
      if (ev.usage) {
        writeEvent(res, {
          id: sse.seq,
          event: "usage",
          data: { type: "usage", usage: normalizeUsage(ev.usage) },
        });
      }
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

      writeEvent(res, {
        id: sse.seq,
        event: "message_delta",
        data: {
          type: "message_delta",
          stop_reason: ev.stopReason,
          ...(ev.model !== undefined ? { model: ev.model } : {}),
        },
      });

      writeEvent(res, {
        id: sse.seq,
        event: "message_stop",
        data: { type: "message_stop", stop_reason: ev.stopReason },
      });

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

    // ==========================================================
    // 文本 + 思考流
    // ==========================================================
    case "text_delta": {
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

    case "thinking_delta": {
      writeEvent(res, {
        id: sse.seq,
        event: "thinking_delta",
        data: {
          type: "thinking_delta",
          thinking: ev.thinking,
        },
      });
      return;
    }

    // ==========================================================
    // Provider 层工具调用（tool_use_start / tool_use_delta / tool_use_end）
    // ==========================================================
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
      // Provider 层工具参数流结束。Runner 不 yield 此事件（仅 break），
      // 故此处为防御性代码。不做任何 SSE 写入——工具调用的完成由后续
      // tool_start（非 partial tool_use）标记，结果由 tool_end 发送。
      return;
    }

    // ==========================================================
    // Runner 层工具执行（tool_delta / tool_start / tool_progress / tool_end）
    // 这些来自 AgentRunEvent，Runner 直接 yield 给 SSE 适配器
    // ==========================================================
    case "tool_delta": {
      // 工具参数流式增量 —— 发送 tool_use delta 事件
      writeEvent(res, {
        id: sse.seq,
        event: "tool_use",
        data: {
          type: "tool_use",
          id: ev.id,
          ...(ev.name ? { name: ev.name } : {}),
          input: ev.inputDelta,
          partial: true,
        },
      });
      return;
    }

    case "tool_start": {
      // 工具开始执行（参数已完整）
      const idx = allocBlockIndex();
      writeEvent(res, {
        id: sse.seq,
        event: "tool_use",
        data: {
          type: "tool_use",
          id: ev.id,
          name: ev.name,
          input: ev.input,
          index: idx,
        },
      });
      // 同时发一个 progress 事件告知前端工具执行开始
      writeEvent(res, {
        id: sse.seq,
        event: "tool_progress",
        data: {
          type: "tool_progress",
          tool_id: ev.id,
          tool_name: ev.name,
          phase: "start",
          message: `执行工具: ${ev.name}`,
        },
      });
      return;
    }

    case "tool_progress": {
      writeEvent(res, {
        id: sse.seq,
        event: "tool_progress",
        data: {
          type: "tool_progress",
          tool_id: ev.id,
          tool_name: ev.name,
          phase: ev.phase ?? "progress",
          message: ev.message,
          ...(ev.data ? { data: ev.data } : {}),
        },
      });
      return;
    }

    case "tool_end": {
      writeEvent(res, {
        id: sse.seq,
        event: "tool_result",
        data: {
          type: "tool_result",
          tool_use_id: ev.id,
          tool_name: ev.name,
          content: ev.result,
          is_error: ev.isError ?? false,
          ...(ev.durationMs !== undefined ? { duration_ms: ev.durationMs } : {}),
        },
      });
      return;
    }

    // ==========================================================
    // 上下文管理 & 重试 & 回退
    // ==========================================================
    case "compaction": {
      writeEvent(res, {
        id: sse.seq,
        event: "compaction",
        data: {
          type: "compaction",
          tokens_before: ev.tokensBefore,
          tokens_after: ev.tokensAfter,
          ...(ev.summary ? { summary: ev.summary } : {}),
          ...(ev.durationMs !== undefined ? { duration_ms: ev.durationMs } : {}),
        },
      });
      return;
    }

    case "context_status": {
      writeEvent(res, {
        id: sse.seq,
        event: "context_status",
        data: {
          type: "context_status",
          phase: ev.phase,
          message: ev.message,
          ...(ev.data ? { data: ev.data } : {}),
        },
      });
      return;
    }

    case "retry": {
      writeEvent(res, {
        id: sse.seq,
        event: "retry",
        data: {
          type: "retry",
          attempt: ev.attempt,
          reason: ev.reason,
          ...(ev.waitMs !== undefined ? { wait_ms: ev.waitMs } : {}),
        },
      });
      return;
    }

    case "provider_fallback": {
      writeEvent(res, {
        id: sse.seq,
        event: "provider_fallback",
        data: {
          type: "provider_fallback",
          reason: ev.reason,
          provider_id: ev.providerId,
        },
      });
      return;
    }

    // ==========================================================
    // 终止
    // ==========================================================
    case "done": {
      const doneEv = ev as unknown as {
        type: "done";
        result?: { meta?: { error?: { kind?: string; message: string } } };
      };
      if (doneEv.result?.meta?.error) {
        writeEvent(res, {
          id: sse.seq,
          event: "error",
          data: {
            ok: false,
            error: {
              code:
                doneEv.result.meta.error.kind === "auth"
                  ? "AUTH_ERROR"
                  : "CHAT_RUNNER_ERROR",
              message: doneEv.result.meta.error.message,
            },
          },
        });
      } else {
        writeEvent(res, {
          id: sse.seq,
          event: "done",
          data: { ok: true },
        });
      }
      return;
    }

    default: {
      // 未知事件：发 ping 兜底，保持连接活跃
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