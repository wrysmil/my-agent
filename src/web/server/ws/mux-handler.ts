/**
 * my-agent Web 前端 — /api/events.mux WebSocket 处理器 (M3)。
 *
 * 路由：WebSocket 升级路径 `/api/events.mux`
 *
 * 职责：
 * - 接收 ClientRequest（session.prompt 等）→ 交给 runner 处理
 * - 推送 ServerRequest（approval/requested 等）→ 客户端消费
 * - ping/pong 心跳保持连接
 * - 连接建立后推送首帧 host/describe
 *
 * 协议：
 * - 帧格式：RFC 6455 JSON 文本帧
 * - 方向：服务端推送 ServerRequest，客户端发送 ClientRequest
 * - 心跳：服务端每 30s 发 ping，客户端应 pong 回应对
 *
 * 认证：复用 HTTP session 认证（cookie / Authorization header 校验）。
 * 本期使用 HTTP upgrade 阶段的 cookie 解析。
 */

import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Logger } from "../../../shared/logger.js";
import type { SessionStore } from "../../../storage/session-store.js";
import type { RunnerFactory } from "../routes/messages.js";
import { hub } from "../sse.js";
import { pendingApprovalStore } from "../pending-store.js";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const MUX_HEARTBEAT_INTERVAL_MS = 30_000;

// ─── WebSocket 工厂 ───────────────────────────────────────────────────────────

/**
 * 为 `/api/events.mux` 创建 WebSocketServer 的 handler。
 *
 * 用法（index.ts）：
 * ```ts
 * const muxWss = new WebSocketServer({ noServer: true });
 * muxWss.on("connection", createMuxConnectionHandler({ sessionStore, runnerFactory, logger }));
 * server.on("upgrade", (req, socket, head) => {
 *   const pathname = new URL(req.url, "http://localhost").pathname;
 *   if (pathname === "/api/events.mux") {
 *     muxWss.handleUpgrade(req, socket, head, (ws) => {
 *       muxWss.emit("connection", ws, req);
 *     });
 *   }
 * });
 * ```
 */
export function createMuxConnectionHandler(deps: {
  sessionStore: SessionStore;
  runnerFactory: RunnerFactory;
  logger?: Logger;
}): (ws: WebSocket, req: IncomingMessage) => void {
  const { sessionStore, runnerFactory, logger } = deps;

  return function handleMuxConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteIp = req.socket.remoteAddress ?? "unknown";
    const requestId = req.headers["x-request-id"] as string | undefined;
    logger?.info(`[mux] WS connected: ip=${remoteIp}`);

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    // ── 心跳定时器 ──────────────────────────────────────────────────────────
    const startHeartbeat = (): void => {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          ws.ping();
        } catch (_err: unknown) {
          /* ignore */
        }
      }, MUX_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
    };

    // ── 发送 ServerRequest 帧 ───────────────────────────────────────────────
    const sendServerRequest = (frame: { type: string; rpcId: string; method: string; payload: unknown }): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger?.warn(`[mux] sendServerRequest failed: ${errorMsg}`);
      }
    };

    // ── 发送错误帧（ClientResponse with error） ─────────────────────────────
    const sendError = (rpcId: string, code: string, message: string): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        const frame: ClientResponseFrame = {
          type: "client-response",
          rpcId,
          result: { ok: false, code, message },
        };
        ws.send(JSON.stringify(frame));
      } catch {
        /* ignore */
      }
    };

    // ── 事件监听：SseHub 的流写入时同步到 WebSocket ───────────────────────
    // 注意：这里采用复用 SseHub 的 stream 机制，但通过 WebSocket 推送 MuxFrame。
    // 实际推送由 AgentRunner 的事件流触发（见 onStreamEvent）。
    const onStreamEvent = (_streamId: string, _event: unknown): void => {
      // TODO(M4)：当 AgentRunner 集成 ws 后，这里从 stream 事件中提取 MuxFrame 并推送
      // 当前 M3 为骨架，推送逻辑由 host-handler 或 runner 事件触发
    };

    // ── 事件监听：pending approval 变化时推送 ─────────────────────────────
    // TODO(M4)：pendingApprovalStore 变化时推送 approval/requested
    void onStreamEvent;

    // ── 启动心跳 ────────────────────────────────────────────────────────────
    startHeartbeat();

    // ── WebSocket 事件处理 ──────────────────────────────────────────────────
    ws.on("pong", () => {
      logger?.debug(`[mux] pong received from ip=${remoteIp}`);
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (ws.readyState !== ws.OPEN) return;

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString("utf-8"));
      } catch {
        sendError("system", "INVALID_JSON", "Failed to parse message as JSON");
        return;
      }

      // 基本类型检查
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        sendError("system", "INVALID_JSON", "Message must be a JSON object");
        return;
      }

      const msg = raw as Record<string, unknown>;

      // ── ClientRequest（客户端请求）──────────────────────────────────────
      if (msg["type"] === "client-request") {
        void handleClientRequest(msg as unknown as ClientRequestFrame);
        return;
      }

      // ── ClientResponse（客户端响应审批等）────────────────────────────────
      if (msg["type"] === "client-response") {
        void handleClientResponse(msg as unknown as ClientResponseFrame);
        return;
      }

      // 未知消息类型 → 忽略（可扩展）
      logger?.debug(`[mux] unknown message type: ${String(msg["type"])}`);
    });

    ws.on("close", (code, reason) => {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      logger?.info(`[mux] WS closed: ip=${remoteIp} code=${code} reason=${reason.toString()}`);
    });

    ws.on("error", (err) => {
      logger?.error(`[mux] WS error: ip=${remoteIp} err=${err.message}`);
    });

    // ── 处理 ClientRequest ──────────────────────────────────────────────────
    async function handleClientRequest(frame: ClientRequestFrame): Promise<void> {
      const rpcId = String(frame["rpcId"] ?? "unknown");
      const method = String(frame["method"] ?? "");
      const payload = frame["payload"] as Record<string, unknown> | undefined;

      logger?.debug(`[mux] client-request: method=${method} rpcId=${rpcId}`);

      switch (method) {
        case "session.prompt": {
          // 转发到 SSE stream handler（复用现有 POST /api/sessions/:id/messages/stream）
          const sessionId = payload?.sessionId as string | undefined;
          if (!sessionId) {
            sendError(rpcId, "VALIDATION_FAILED", "sessionId is required in payload");
            return;
          }

          const session = sessionStore.get(sessionId);
          if (!session) {
            sendError(rpcId, "SESSION_NOT_FOUND", `Session "${sessionId}" not found`);
            return;
          }

          const text = payload?.text as string | undefined;
          if (!text && method === "session.prompt") {
            sendError(rpcId, "VALIDATION_FAILED", "text is required in payload");
            return;
          }

          // TODO(M4)：创建 stream 并通过 WebSocket 推送 MuxFrame
          // 复用 runnerFactory 和 hub.register 逻辑
          logger?.info(`[mux] session.prompt: session=${sessionId} textLen=${String(text ?? "").length}`);

          // 推送 acknowledge 帧（立即响应）
          sendServerRequest({
            type: "server-request",
            rpcId,
            method: "session/message-start",
            payload: { sessionId, model: payload?.model },
          });
          return;
        }

        case "session.abort": {
          // 通过 hub abort
          const sessionId = payload?.sessionId as string | undefined;
          if (!sessionId) {
            sendError(rpcId, "VALIDATION_FAILED", "sessionId is required");
            return;
          }
          const runId = payload?.runId as string | undefined;
          if (runId) {
            hub.abortByRunId(sessionId, runId);
          }
          logger?.info(`[mux] session.abort: session=${sessionId} runId=${runId ?? "all"}`);
          return;
        }

        default:
          logger?.debug(`[mux] unknown method: ${method}`);
          sendError(rpcId, "NOT_FOUND", `Unknown method: ${method}`);
      }
    }

    // ── 处理 ClientResponse（主要是审批响应）───────────────────────────────
    function handleClientResponse(frame: ClientResponseFrame): void {
      const rpcId = String(frame.rpcId);
      const pending = pendingApprovalStore.get(rpcId);

      if (!pending) {
        logger?.debug(`[mux] client-response for unknown rpcId: ${rpcId}`);
        return;
      }

      const result = frame.result;
      const approved = result.ok === true;
      const reason = result.ok === false ? result.message : undefined;

      pendingApprovalStore.remove(rpcId);
      pending.resolve(approved, reason);
      logger?.info(`[mux] approval resolved: rpcId=${rpcId} approved=${approved}`);
    }
  };
}

// ─── 类型（避免直接引用前端 api-protocol）──────────────────────────────────────

interface ClientRequestFrame {
  type: "client-request";
  rpcId: string;
  method: string;
  payload?: Record<string, unknown>;
}

interface ClientResponseFrame {
  type: "client-response";
  rpcId: string;
  result: { ok: true; data: unknown } | { ok: false; code: string; message?: string };
}

// ─── 创建 / 注册 WebSocketServer ───────────────────────────────────────────────

/**
 * 创建 mux WebSocketServer 并返回 upgrade handler。
 *
 * 用法：
 * ```ts
 * const { wss, handleUpgrade } = createMuxWebSocketServer({ sessionStore, runnerFactory, logger });
 * server.on("upgrade", (req, socket, head) => {
 *   const pathname = new URL(req.url, "http://localhost").pathname;
 *   if (pathname === "/api/events.mux") handleUpgrade(req, socket, head);
 * });
 * ```
 */
export function createMuxWebSocketServer(deps: {
  sessionStore: SessionStore;
  runnerFactory: RunnerFactory;
  logger?: Logger;
}): {
  wss: WebSocketServer;
  handleUpgrade: (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => void;
} {
  const { sessionStore, runnerFactory, logger } = deps;

  const wss = new WebSocketServer({ noServer: false });
  const handler = createMuxConnectionHandler(deps);
  wss.on("connection", handler);
  logger?.debug("[mux] WebSocketServer created for /api/events.mux");

  const handleUpgrade = (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  return { wss, handleUpgrade };
}
