/**
 * my-agent Web 前端 — HTTP 服务器骨架（WU-01 / B1 + WU-02e 错误层接入）。
 *
 * 来源：spec § 6.1 / § 6.3 / § 6.6 + contract § 7 / § 8 / § 9。
 *
 * 本文件是**装配层**，把以下模块串成可启动的 HTTP server：
 * - `csp.ts`：CSP / Permissions-Policy / 安全头
 * - `static.ts`：静态文件中间件（白名单 + 路径防御）
 * - `router.ts`：21 个 API 路由占位（统一回 404 ROUTE_NOT_FOUND）
 * - `graceful-shutdown.ts`：SIGINT/SIGTERM 优雅退出
 * - `errors.ts`（WU-02e）：ApiErrorCode / ERROR_STATUS_MAP / ApiError /
 *   handleError —— 异常路径统一写响应（contract § 3）
 *
 * 本期**不做**（留给后续 WU）：
 * - 21 个业务 handler 真实实现（WU-02a/b/c，GROUP-2）
 * - SSE 适配器（WU-02b，sse.ts）
 * - Zod 校验 + PAYLOAD_TOO_LARGE（路由边界加入，handleError 已具备基础）
 *
 * @see .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
 */

import * as http from "node:http";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "../../shared/logger.js";
import type { ProvidersStore } from "../../storage/providers-store.js";
import type { SessionStore } from "../../storage/session-store.js";
import type { CoreAgentConfig } from "../../config/schema.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { AgentRunner } from "../../agent/runner.js";
import type { RunnerFactory } from "./routes/messages.js";

import { applySecurityHeaders } from "./csp.js";
import { matchRoute, ROUTES } from "./router.js";
import { tryServeStatic } from "./static.js";
import { handleError, ApiErrorCode, ApiError } from "./errors.js";
import { wireApiRoutes } from "./wire-routes.js";
import { createMuxWebSocketServer } from "./ws/mux-handler.js";
import { createHostWebSocketServer, broadcastHostFrame } from "./ws/host-handler.js";
import { registerHostDescribeRoute } from "./routes/host-describe.js";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

// ============================================================
// 公开类型
// ============================================================

/**
 * createServer 的依赖。
 *
 * **本期全 optional**：done criteria #2 明示"注入为 undefined 时不崩溃"。
 * 后续 WU 会按需收紧：
 * - logger：F0 起需要结构化日志（先 console 兜底）
 * - providersStore / sessionStore：WU-02a/b/c 起需要接 store
 */
export type CreateServerDeps = {
  logger?: Logger;
  providersStore?: ProvidersStore;
  sessionStore?: SessionStore;
  config?: CoreAgentConfig;
  providers?: ProviderRegistry;
  agentRunner?: AgentRunner;
  runnerFactory?: RunnerFactory;

  /** 监听端口（默认 4321；环境变量由 bin 入口注入） */
  port?: number;
  /** 监听主机（默认 `127.0.0.1`，仅本机） */
  host?: string;
  /** 静态资源根目录（默认 `<cwd>/web`） */
  webRoot?: string;
};

/**
 * Server 句柄：暴露端口 + 底层 http.Server + close()。
 *
 * 端口传 0 时返回系统分配的空闲端口（测试用）。
 */
export type WebServer = {
  readonly port: number;
  readonly raw: http.Server;
  /** WebSocketServer for /api/events.mux (may be undefined if deps not provided) */
  readonly muxWss?: WebSocketServer;
  /** WebSocketServer for /api/events.host (may be undefined if deps not provided) */
  readonly hostWss?: WebSocketServer;
  /** 优雅关闭（停止 accept + 关 keep-alive 空闲 socket） */
  close(): Promise<void>;
};

// ============================================================
// 兜底 logger（无依赖 / 无控制台噪音）
// ============================================================

/**
 * 静默 logger（默认 logger 缺省时使用）。
 * 实际服务入口会注入 src/shared/logger.ts 的实例。
 */
const SILENT_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn(msg, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    console.error(msg, ...args);
  },
  child: () => SILENT_LOGGER,
};

// ============================================================
// /healthz 响应
// ============================================================

const HEALTHZ_BODY = JSON.stringify({ status: "ok" });

// ============================================================
// ApiErrorBody（取自 errors.ts；不再在 index.ts 维护 —— 一次性迁移）
// ============================================================

// ============================================================
// createServer 工厂
// ============================================================

/**
 * 创建并启动 HTTP 服务器。
 *
 * - 异步返回 WebServer（含实际 port —— 传 0 时是系统分配值）
 * - 启动失败（端口占用等）会 reject
 * - 默认监听 `127.0.0.1`（仅本机；spec § 1.4 非目标：「不暴露到远程」）
 *
 * 路由分发顺序（每个请求一次）：
 *   1) `/healthz` → 200 JSON
 *   2) `/api/*`  → ROUTES 表匹配；命中执行 handler，未命中回 404
 *   3) 静态资源（GET/HEAD）→ tryServeStatic
 *   4) 兜底 → 404 ROUTE_NOT_FOUND
 *
 * @example
 *   const server = await createServer({ port: 0 });
 *   console.log(server.port); // 系统分配端口
 *   await server.close();
 */
export async function createServer(
  deps: CreateServerDeps = {},
): Promise<WebServer> {
  const log: Logger = deps.logger ?? SILENT_LOGGER;
  const port = deps.port ?? 4321;
  const host = deps.host ?? "127.0.0.1";
  const webRoot = path.resolve(
    deps.webRoot ?? path.join(process.cwd(), "web"),
  );

  // ── 接线：把 5 个 handler 模块接入 ROUTES 占位表 ──
  wireApiRoutes({
    providersStore: deps.providersStore,
    sessionStore: deps.sessionStore,
    config: deps.config,
    providers: deps.providers,
    agentRunner: deps.agentRunner,
    runnerFactory: deps.runnerFactory,
    logger: log,
  });

  // ── 注册 host-describe HTTP 端点 ──
  registerHostDescribeRoute();

  // ── 创建 WebSocket 服务器（M3）────────────────────────────────────────────
  let muxWss: WebSocketServer | undefined;
  let hostWss: WebSocketServer | undefined;

  if (deps.sessionStore && deps.runnerFactory) {
    // /api/events.mux
    const mux = createMuxWebSocketServer({
      sessionStore: deps.sessionStore,
      runnerFactory: deps.runnerFactory,
      logger: log,
    });
    muxWss = mux.wss;

    // /api/events.host
    const host = createHostWebSocketServer({
      sessionStore: deps.sessionStore,
      logger: log,
    });
    hostWss = host.wss;

    log.info(`[ws] WebSocket servers created (mux + host)`);
  }

  const server = http.createServer((req, res) => {
    const requestId = randomUUID();
    handleRequest(req, res, { webRoot, log, deps, requestId }).catch(
      (err: unknown) => {
        // 兜底：理论上 handleRequest 已经过 handleError（handleRequest 末尾
        // 调 handleError 写响应），仅在响应已发 / write 抛错的极端情况下
        // 走到这里 —— destroy 即可。
        if (res.headersSent || res.writableEnded) {
          res.destroy();
          return;
        }
        handleError(err, res, { requestId, logger: log });
      },
    );
  });

  // ── WebSocket Upgrade 处理（M3）────────────────────────────────────────────
  if (muxWss && hostWss) {
    const { handleUpgrade: handleMuxUpgrade } = createMuxWebSocketServer({
      sessionStore: deps.sessionStore!,
      runnerFactory: deps.runnerFactory!,
      logger: log,
    });
    const { handleUpgrade: handleHostUpgrade } = createHostWebSocketServer({
      sessionStore: deps.sessionStore!,
      logger: log,
    });

    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname === "/api/events.mux") {
        handleMuxUpgrade(req, socket as import("node:net").Socket, head);
      } else if (pathname === "/api/events.host") {
        handleHostUpgrade(req, socket as import("node:net").Socket, head);
      }
      // 其他路径的 upgrade 交给默认处理（不拦截）
    });
  }

  return new Promise<WebServer>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener("listening", onListening);
      reject(err);
    };

    const onListening = (): void => {
      server.removeListener("error", onError);
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      log.info(`🌐 服务器监听 → http://${host}:${actualPort}`);
      resolve({
        port: actualPort,
        raw: server,
        muxWss,
        hostWss,
        close: () => closeServer(server, muxWss, hostWss),
      });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

// ============================================================
// 单请求处理
// ============================================================

type HandleContext = {
  webRoot: string;
  log: Logger;
  deps: CreateServerDeps;
  /** 由 http.createServer 回调统一生成；同请求内 handleRequest 与 handleError 共享 */
  requestId: string;
};

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandleContext,
): Promise<void> {
  const startTime = Date.now();

  // 0) 基础信息
  const { requestId } = ctx;
  res.setHeader("X-Request-Id", requestId);
  applySecurityHeaders(res);

  // access log: 劫持 res.end 记录请求信息
  const origEnd = res.end.bind(res);
  res.end = function (
    this: ServerResponse,
    ...args: Parameters<ServerResponse["end"]>
  ): ServerResponse {
    const durationMs = Date.now() - startTime;
    const method = req.method ?? "GET";
    const pathname = (() => {
      try {
        return new URL(req.url ?? "/", "http://localhost").pathname;
      } catch {
        return req.url ?? "/";
      }
    })();
    const statusEmoji = res.statusCode >= 400 ? "⚠️" : "→";
    ctx.log.info(
      `${statusEmoji} ${method} ${pathname} → ${res.statusCode} (${durationMs}ms)`,
    );
    return origEnd(...args);
  } as ServerResponse["end"];

  const method = req.method ?? "GET";
  let pathname: string;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    handleError(
      new ApiError(
        ApiErrorCode.INVALID_JSON,
        `Bad URL: ${req.url ?? "/"}`,
      ),
      res,
      { requestId, logger: ctx.log },
    );
    return;
  }

  // 1) /healthz → 200 JSON
  if (pathname === "/healthz" && method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(HEALTHZ_BODY);
    return;
  }

  // 2) /api/* → ROUTES 占位表
  if (pathname.startsWith("/api/")) {
    const match = matchRoute(method, pathname);
    if (match) {
      try {
        await match.handler(req, res, match.params);
      } catch (err) {
        // 业务 handler 抛错：未发送则走 handleError；已发送则 destroy
        if (res.headersSent || res.writableEnded) {
          res.destroy();
          return;
        }
        handleError(err, res, { requestId, logger: ctx.log });
      }
      return;
    }
    // 未命中 → 404 NOT_FOUND（contract § 3: NOT_FOUND=404）
    handleError(
      new ApiError(
        ApiErrorCode.NOT_FOUND,
        `API 路由未注册: ${method} ${pathname}`,
      ),
      res,
      { requestId, logger: ctx.log },
    );
    return;
  }

  // 3) 静态资源（仅 GET / HEAD）
  if (method === "GET" || method === "HEAD") {
    if (tryServeStatic(req, res, ctx.webRoot)) return;
  }

  // 4) 兜底 404
  handleError(
    new ApiError(
      ApiErrorCode.NOT_FOUND,
      `资源未找到: ${method} ${pathname}`,
    ),
    res,
    { requestId, logger: ctx.log },
  );
}

// ============================================================
// 工具
// ============================================================

/**
 * 关闭 server：
 * 1) http.Server.close() —— 停止 accept + 等在途请求完成
 * 2) closeIdleConnections() —— 强关 keep-alive 空闲 socket
 *    （避免 close() 因 keep-alive 长连接而 hang 住）
 */
function closeServer(server: http.Server, muxWss?: WebSocketServer, hostWss?: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    // 关闭 WebSocket 服务器
    const closeWss = (wss: WebSocketServer | undefined): void => {
      if (!wss) return;
      wss.clients.forEach((client: WebSocket) => {
        try { client.close(1001, "server_shutdown"); } catch { /* ignore */ }
      });
      try { wss.close(); } catch { /* ignore */ }
    };
    closeWss(muxWss);
    closeWss(hostWss);

    server.close((err) => done(err));
    // Node ≥ 18.2：强关 keep-alive 空闲连接
    server.closeIdleConnections?.();
    // 5s 强退由 graceful-shutdown.ts 的 forceTimer 保证。
  });
}

// ============================================================
// 重导出（供后续 WU + bin 入口使用）
// ============================================================

export { installShutdownHandlers } from "./graceful-shutdown.js";
export type { InstallShutdownHandlersOptions } from "./graceful-shutdown.js";
export { ROUTES, matchRoute, isRoutedPath } from "./router.js";
export type { Handler, Route, RouteMatch } from "./router.js";
export { CSP_HEADER, PERMISSIONS_POLICY_HEADER } from "./csp.js";