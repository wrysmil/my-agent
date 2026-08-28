/**
 * my-agent Web 前端 — /api/events.host WebSocket 处理器 (M3)。
 *
 * 路由：WebSocket 升级路径 `/api/events.host`
 *
 * 职责：
 * - 推送 HostFrame（host/describe、host/session-added、host/session-removed 等）
 * - 会话增删变更通知（当 SessionStore 变化时广播）
 * - 心跳保持连接
 *
 * 协议：
 * - 帧格式：RFC 6455 JSON 文本帧
 * - 方向：服务端推送 HostFrame；客户端可订阅特定事件（未来扩展）
 * - 心跳：服务端每 30s 发 ping
 *
 * 认证：复用 HTTP session 认证。
 */

import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Logger } from "../../../shared/logger.js";
import type { SessionStore } from "../../../storage/session-store.js";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const HOST_HEARTBEAT_INTERVAL_MS = 30_000;

export const HOST_CAPABILITIES = ["approval", "streaming"] as const;
export type HostCapability = (typeof HOST_CAPABILITIES)[number];

// ─── HostFrame 类型（避免引用前端 api-protocol）────────────────────────────────

export interface HostDescribeFrame {
  kind: "host/describe";
  capabilities: string[];
  protocolVersion?: string;
}

export interface HostSessionAddedFrame {
  kind: "host/session-added";
  sessionId: string;
  label?: string;
}

export interface HostSessionRemovedFrame {
  kind: "host/session-removed";
  sessionId: string;
}

export interface HostSessionsSnapshotFrame {
  kind: "host/sessions-snapshot";
  sessions: Array<{ sessionId: string; label?: string }>;
}

export interface HostEventFrame {
  kind: "host/event";
  sessionId: string;
  event: string;
  data: Record<string, unknown>;
}

export type HostFrame =
  | HostDescribeFrame
  | HostSessionAddedFrame
  | HostSessionRemovedFrame
  | HostSessionsSnapshotFrame
  | HostEventFrame;

// ─── WebSocket 工厂 ───────────────────────────────────────────────────────────

/**
 * 为 `/api/events.host` 创建 WebSocketServer 的 handler。
 *
 * 用法（index.ts）：
 * ```ts
 * const hostWss = new WebSocketServer({ noServer: true });
 * hostWss.on("connection", createHostConnectionHandler({ sessionStore, logger }));
 * server.on("upgrade", (req, socket, head) => {
 *   const pathname = new URL(req.url, "http://localhost").pathname;
 *   if (pathname === "/api/events.host") {
 *     hostWss.handleUpgrade(req, socket, head, (ws) => {
 *       hostWss.emit("connection", ws, req);
 *     });
 *   }
 * });
 * ```
 */
export function createHostConnectionHandler(deps: {
  sessionStore: SessionStore;
  logger?: Logger;
}): (ws: WebSocket, req: IncomingMessage) => void {
  const { sessionStore, logger } = deps;

  return function handleHostConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteIp = req.socket.remoteAddress ?? "unknown";
    logger?.info(`[host] WS connected: ip=${remoteIp}`);

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    // ── 发送 HostFrame ───────────────────────────────────────────────────────
    const sendFrame = (frame: HostFrame): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(frame));
      } catch (err) {
        logger?.warn(`[host] sendFrame failed: ${err instanceof Error ? err.message : err}`);
      }
    };

    // ── 发送初始 host/describe ────────────────────────────────────────────────
    const sendDescribe = (protocolVersion?: string): void => {
      const frame: HostDescribeFrame = {
        kind: "host/describe",
        capabilities: [...HOST_CAPABILITIES],
        ...(protocolVersion ? { protocolVersion } : {}),
      };
      sendFrame(frame);
    };

    // ── 心跳定时器 ──────────────────────────────────────────────────────────
    const startHeartbeat = (): void => {
      heartbeatTimer = setInterval(() => {
        if (ws.readyState !== ws.OPEN) return;
        try {
          ws.ping();
        } catch {
          /* ignore */
        }
      }, HOST_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();
    };

    // ── 启动心跳并发送初始帧 ────────────────────────────────────────────────
    startHeartbeat();

    // 从 query 参数读取 protocolVersion（可选）
    const url = new URL(req.url ?? "/", "http://localhost");
    const protocolVersion = url.searchParams.get("protocolVersion") ?? undefined;
    sendDescribe(protocolVersion);

    // ── WebSocket 事件处理 ──────────────────────────────────────────────────
    ws.on("pong", () => {
      logger?.debug(`[host] pong received from ip=${remoteIp}`);
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (ws.readyState !== ws.OPEN) return;

      let raw: unknown;
      try {
        raw = JSON.parse(data.toString("utf-8"));
      } catch {
        // 忽略无效 JSON
        logger?.debug(`[host] failed to parse message: ${data.toString("utf-8").slice(0, 100)}`);
        return;
      }

      // 未来扩展：客户端可发送 host/subscribe 等
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const msg = raw as Record<string, unknown>;
        const type = String(msg["type"] ?? "");
        logger?.debug(`[host] client message type="${type}" (ignored in M3)`);
      }
    });

    ws.on("close", (code: number, reason: Buffer) => {
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      logger?.info(`[host] WS closed: ip=${remoteIp} code=${code} reason=${reason.toString()}`);
    });

    ws.on("error", (err: Error) => {
      logger?.error(`[host] WS error: ip=${remoteIp} err=${err.message}`);
    });
  };
}

// ─── 创建 / 注册 WebSocketServer ───────────────────────────────────────────────

/**
 * 创建 host WebSocketServer 并返回 upgrade handler。
 */
export function createHostWebSocketServer(deps: {
  sessionStore: SessionStore;
  logger?: Logger;
}): {
  wss: WebSocketServer;
  handleUpgrade: (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer) => void;
} {
  const { sessionStore, logger } = deps;

  const wss = new WebSocketServer({ noServer: true });
  const handler = createHostConnectionHandler(deps);
  wss.on("connection", handler);
  logger?.debug("[host] WebSocketServer created for /api/events.host");

  const handleUpgrade = (req: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  return { wss, handleUpgrade };
}

// ─── 广播工具（供 index.ts 或其他模块调用）─────────────────────────────────────

/**
 * 向所有连接的 host WebSocket 客户端广播 HostFrame。
 *
 * 用法示例：
 * ```ts
 * import { broadcastHostFrame } from "./ws/host-handler.js";
 * // 新建 session 后
 * broadcastHostFrame({ kind: "host/session-added", sessionId: "xxx" });
 * ```
 */
export function broadcastHostFrame(
  wss: WebSocketServer,
  frame: HostFrame,
): number {
  let sent = 0;
  wss.clients.forEach((client: WebSocket) => {
    if (client.readyState === client.OPEN) {
      try {
        client.send(JSON.stringify(frame));
        sent++;
      } catch {
        /* ignore */
      }
    }
  });
  return sent;
}
