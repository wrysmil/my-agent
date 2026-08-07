/**
 * my-agent Web 前端 — Session 域 5 条 REST 接口（WU-02b / B3）。
 *
 * 来源：contract § 1.2 + spec § 3.1.2。
 *
 * 路由：
 * - `GET    /api/sessions`              list — 列出全部会话（按 cid 排序）
 * - `POST   /api/sessions`              create — 新建（auto cid / 默认 model / active provider）
 * - `GET    /api/sessions/:id/history`  history — 完整消息历史（serialized）
 * - `DELETE /api/sessions/:id`          delete — 删（文件 + 缓存）
 * - `POST   /api/sessions/:cid/compact` compact — 占位 501 NOT_IMPLEMENTED（待 WU-06a）
 *
 * 错误码（见 contract § 3）：
 * - 400 `INVALID_JSON`           body 解析失败
 * - 404 `SESSION_NOT_FOUND`      id 不存在（history / delete / compact）
 * - 409 `SESSION_ALREADY_EXISTS` POST 重复 cid（实际罕见：cid 是 server 生成的；但允许 client 传 cid 时要拒绝）
 * - 422 `VALIDATION_FAILED`      Zod schema 失败
 * - 501 `NOT_IMPLEMENTED`        /compact 端点占位
 *
 * 设计：
 * - 入口前 `assertPathSegment(id)` —— spec § 6.6 路径防御
 * - 入口前 `Schema.safeParse` —— spec § 3.4.3 边界校验
 * - 5 条路由共享 `installSessionRoutes({ sessionStore })`，通过 closure 注入
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { assertPathSegment } from "../../../storage/paths.js";
import { SessionStore } from "../../../storage/session-store.js";
import { ROUTES } from "../router.js";
import type { Handler, Route } from "../router.js";
import { SerializedMessage } from "../../../agent/session-serde.js";
import { messageToSerialized } from "../../../agent/session-serde.js";
import { readBodyJson, sendJsonError } from "../http-helpers.js";
import {
  CreateSessionSchema,
  ListSessionsQuerySchema,
  type CreateSessionInput,
  type ListSessionsQuery,
} from "../validators/sessions.js";

// ============================================================
// DTO
// ============================================================

/**
 * SessionMeta —— 列表 / 侧边栏展示用的会话元数据。
 *
 * 字段与 contract § 5 SessionMeta 对齐；`name` 来自首条 user 消息摘要。
 */
export type SessionMeta = {
  id: string;
  name: string;
  messageCount: number;
  lastTs: number;
  archived: boolean;
};

// ============================================================
// 安装路由（闭包注入 SessionStore）
// ============================================================

/**
 * 把 Session 域 5 条路由的占位 handler 替换成真实实现。
 *
 * 必须**在** `createServer()` 之前调用一次，否则请求会落到 WU-01 的
 * `routeNotFoundPlaceholder`（404 ROUTE_NOT_FOUND）。
 *
 * 同一进程多次调用是幂等的（直接覆盖 ROUTES[i][2]）。
 */
export function installSessionRoutes(deps: {
  sessionStore: SessionStore;
}): void {
  const { sessionStore } = deps;

  // 路由模式 → handler 映射（手写避免正则匹配）
  replaceHandler(ROUTES, "GET", "/api/sessions", (_req, res) =>
    listSessions(_req, res, sessionStore),
  );
  replaceHandler(ROUTES, "POST", "/api/sessions", (_req, res) =>
    createSession(_req, res, sessionStore),
  );
  replaceHandlerRegex(
    ROUTES,
    "GET",
    /^\/api\/sessions\/([^/]+)\/history$/,
    (_req, res, params) =>
      getHistory(_req, res, sessionStore, params["id"] ?? ""),
  );
  replaceHandlerRegex(ROUTES, "DELETE", /^\/api\/sessions\/([^/]+)$/, (_req, res, params) =>
    deleteSession(_req, res, sessionStore, params["id"] ?? ""),
  );
  replaceHandlerRegex(ROUTES, "POST", /^\/api\/sessions\/([^/]+)\/compact$/, (_req, res, params) =>
    compactSession(_req, res, sessionStore, params["cid"] ?? ""),
  );
}

function replaceHandler(
  routes: Route[],
  method: string,
  pattern: string,
  handler: Handler,
): void {
  for (const route of routes) {
    if (route[0] === method && route[1] === pattern) {
      route[2] = handler;
      return;
    }
  }
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
    // 比较 RegExp source（不同 RegExp 对象不能 ===）
    if (existing.source === pattern.source && existing.flags === pattern.flags) {
      route[2] = handler;
      return;
    }
  }
}

// ============================================================
// Handlers
// ============================================================

/**
 * GET /api/sessions
 *
 * 支持 query（Zod 校验失败 → 422 VALIDATION_FAILED）：
 * - `archived` boolean
 * - `limit`    1-200（默认 50）
 * - `offset`   ≥ 0（默认 0）
 */
async function listSessions(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
): Promise<void> {
  // 1) 解析 query
  const url = new URL(req.url ?? "/", "http://localhost");
  const rawQuery = Object.fromEntries(url.searchParams.entries());
  const parsed = ListSessionsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid query parameters", {
      details: parsed.error.flatten(),
    });
    return;
  }
  const query: ListSessionsQuery = parsed.data;
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  // 2) 拉全部
  const all = sessionStore.list();

  // 3) archived 过滤：当前实现无 archived 字段（待 v2 引入）；此处恒 false
  const filtered = query.archived === true ? [] : all;

  // 4) 分页 + 元数据（name + messageCount + lastTs）
  const slice = filtered.slice(offset, offset + limit);
  const metas: SessionMeta[] = slice.map(({ id, name }) => {
    const session = sessionStore.get(id);
    if (!session) {
      return {
        id,
        name,
        messageCount: 0,
        lastTs: 0,
        archived: false,
      };
    }
    try {
      const messages = session.getAllMessages();
      const lastMsg = messages[messages.length - 1];
      const lastTs = lastMsg?.turnId ? lastMsg.turnId : 0;
      return {
        id,
        name,
        messageCount: messages.length,
        lastTs,
        archived: false,
      };
    } catch {
      return { id, name, messageCount: 0, lastTs: 0, archived: false };
    }
  });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        sessions: metas,
        total: filtered.length,
        limit,
        offset,
      },
    }),
  );
}

/**
 * POST /api/sessions
 *
 * body：
 * ```
 * { kind?: "gconv" | "cli" | "anon" | "extract" | "gworker" }
 * ```
 *
 * 重复 cid 处理：当前 `SessionStore.create()` 自动生成 cid，client **不能**
 * 传 id；如果未来允许 client 传 id，加 409 `SESSION_ALREADY_EXISTS` 分支。
 */
async function createSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
): Promise<void> {
  const body = await readBodyJson<unknown>(req).catch((err: unknown) => {
    sendJsonError(
      res,
      400,
      "INVALID_JSON",
      err instanceof Error ? err.message : "Invalid JSON",
    );
    return null;
  });
  if (body === null) return;

  const parsed = CreateSessionSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid request body", {
      details: parsed.error.flatten(),
    });
    return;
  }
  const input: CreateSessionInput = parsed.data;

  const session = sessionStore.create(input.kind ?? "gconv");
  res.statusCode = 201;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        session: {
          id: session.sessionId,
          kind: input.kind ?? "gconv",
        },
      },
    }),
  );
}

/**
 * GET /api/sessions/:id/history
 *
 * 返回完整消息历史（serialized —— 字段 snake_case 便于跨端传输）。
 *
 * 404 SESSION_NOT_FOUND：id 不存在 / 文件损坏无法读取。
 */
async function getHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  id: string,
): Promise<void> {
  let safeId: string;
  try {
    safeId = assertPathSegment(id, "id");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${id}" not found`);
    return;
  }

  const session = sessionStore.get(safeId);
  if (!session) {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${safeId}" not found`);
    return;
  }

  let messages: SerializedMessage[];
  try {
    const raw = session.getAllMessages();
    messages = raw.map(messageToSerialized);
  } catch (err) {
    sendJsonError(
      res,
      500,
      "SESSION_CORRUPT_FILE",
      err instanceof Error ? err.message : "Failed to read messages",
    );
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, data: { messages } }));
}

/**
 * DELETE /api/sessions/:id
 *
 * 204 No Content —— 幂等：不存在也回 204（spec § 3.4.7）。
 *
 * **不**回 200 JSON；204 是 REST 惯例（DELETE 无 body）。
 */
async function deleteSession(
  _req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  id: string,
): Promise<void> {
  let safeId: string;
  try {
    safeId = assertPathSegment(id, "id");
  } catch {
    // 幂等：路径非法也视为已删
    res.statusCode = 204;
    res.end();
    return;
  }

  const existed = sessionStore.delete(safeId);

  // spec § 3.4.7：DELETE 幂等 —— 不存在也回 204
  res.statusCode = 204;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (existed) {
    res.end();
  } else {
    // 仍 204（spec § 3.4.7 幂等保证），但允许回 JSON ok 形态（前端可读）
    res.end();
  }
}

/**
 * POST /api/sessions/:cid/compact
 *
 * **本期占位**：WU-06a 才接 AgentRunner.compactNow()。直接回 501。
 */
async function compactSession(
  _req: IncomingMessage,
  res: ServerResponse,
  _sessionStore: SessionStore,
  cid: string,
): Promise<void> {
  try {
    assertPathSegment(cid, "cid");
  } catch {
    sendJsonError(res, 501, "NOT_IMPLEMENTED", "compact not implemented yet", {
      details: { cid },
    });
    return;
  }

  sendJsonError(
    res,
    501,
    "NOT_IMPLEMENTED",
    "/api/sessions/:cid/compact is not implemented in this build (WU-06a)",
    { details: { cid } },
  );
}