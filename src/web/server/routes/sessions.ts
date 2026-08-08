/**
 * my-agent Web 前端 — Session 域 7 条 REST 接口（WU-02b / B3 + WU-06a）。
 *
 * 来源：contract § 1.2 + spec § 3.1.2 + spec § 6.5 (R-22 compact 串行化)。
 *
 * 路由：
 * - `GET    /api/sessions`                        list — 列出全部会话（按 cid 排序）
 * - `POST   /api/sessions`                        create — 新建（auto cid / 默认 model / active provider）
 * - `GET    /api/sessions/:id/history`            history — 完整消息历史（serialized）
 * - `DELETE /api/sessions/:id`                    delete — 删（文件 + 缓存）
 * - `POST   /api/sessions/:cid/compact/preview`   preview — 估算压缩效果（不动状态）
 * - `POST   /api/sessions/:cid/compact`           compact — 实际压缩（替换为 summary）
 * - `POST   /api/sessions/:cid/compact/cancel`    cancel — noop（保留端点供前端调用）
 *
 * 错误码（见 contract § 3）：
 * - 400 `INVALID_JSON`           body 解析失败
 * - 404 `SESSION_NOT_FOUND`      id 不存在（history / delete / compact*）
 * - 409 `SESSION_ALREADY_EXISTS` POST 重复 cid
 * - 422 `VALIDATION_FAILED`      Zod schema 失败
 * - 429 `CHAT_SESSION_BUSY`      同 cid 上有压缩在飞（contract § 6.5 R-22）
 * - 500 `INTERNAL`               provider 调用失败 / 空 summary
 *
 * 设计：
 * - 入口前 `assertPathSegment(id)` —— spec § 6.6 路径防御
 * - 入口前 `Schema.safeParse` —— spec § 3.4.3 边界校验
 * - 7 条路由共享 `installSessionRoutes({ sessionStore, agentRunner })`，通过 closure 注入
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
  CompactPreviewSchema,
  CompactRequestSchema,
  CompactCancelSchema,
  type CreateSessionInput,
  type ListSessionsQuery,
} from "../validators/sessions.js";
import { AgentRunner } from "../../../agent/runner.js";

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
 * 把 Session 域 7 条路由的占位 handler 替换成真实实现。
 *
 * 必须**在** `createServer()` 之前调用一次，否则请求会落到 WU-01 的
 * `routeNotFoundPlaceholder`（404 ROUTE_NOT_FOUND）。
 *
 * 同一进程多次调用是幂等的（直接覆盖 ROUTES[i][2]）。
 *
 * **WU-06a 增量：** `agentRunner` 用于 compact 端点；旧版本不传时
 * 压缩端点回 500 INTERNAL（向后兼容旧 bin 入口；本期 web 必传）。
 */
export function installSessionRoutes(deps: {
  sessionStore: SessionStore;
  agentRunner?: AgentRunner;
}): void {
  const { sessionStore, agentRunner } = deps;

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
  // WU-06a：3 条 compact 路由 —— preview/cancel 是新注册，compact 是替换占位
  registerRoute(
    ROUTES,
    "POST",
    /^\/api\/sessions\/([^/]+)\/compact\/preview$/,
    (_req, res, params) =>
      compactPreviewSession(_req, res, sessionStore, agentRunner, params["cid"] ?? ""),
    ["cid"],
  );
  registerRoute(
    ROUTES,
    "POST",
    /^\/api\/sessions\/([^/]+)\/compact\/cancel$/,
    (_req, res, params) =>
      compactCancelSession(_req, res, sessionStore, params["cid"] ?? ""),
    ["cid"],
  );
  replaceHandlerRegex(ROUTES, "POST", /^\/api\/sessions\/([^/]+)\/compact$/, (_req, res, params) =>
    compactSession(_req, res, sessionStore, agentRunner, params["cid"] ?? ""),
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

/**
 * 注册一条新路由（如果 ROUTES 表中尚未存在）。
 *
 * 用于 WU-06a 新增的 `/compact/preview` 与 `/compact/cancel` —— 这两条
 * 路由在 router.ts 的占位表中不存在，需在 installSessionRoutes 时补登。
 *
 * **顺序敏感：** 更具体的路径（preview/cancel）排在通用 `/compact$` 之前，
 * 避免被通用正则先匹配走。
 */
function registerRoute(
  routes: Route[],
  method: string,
  pattern: RegExp,
  handler: Handler,
  names: string[],
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
  routes.push([method, pattern, handler, names]);
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
 * POST /api/sessions/:cid/compact/preview
 *
 * 返回压缩估算（`CompactEstimate`）。**不动 session 状态**。
 *
 * 响应：
 * ```json
 * { "ok": true, "data": { "beforeTokens": N, "afterTokens": N, "reductionPct": N } }
 * ```
 */
async function compactPreviewSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  agentRunner: AgentRunner | undefined,
  cid: string,
): Promise<void> {
  let safeId: string;
  try {
    safeId = assertPathSegment(cid, "cid");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${cid}" not found`);
    return;
  }

  const session = sessionStore.get(safeId);
  if (!session) {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${safeId}" not found`);
    return;
  }

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

  const parsed = CompactPreviewSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid request body", {
      details: parsed.error.flatten(),
    });
    return;
  }

  // preview 走 AgentRunner.compactNow({ dryRun: true }) 以保证与真实压缩
  // 使用同一份 token 估算逻辑（contract § B8）
  if (!agentRunner) {
    sendJsonError(
      res,
      500,
      "INTERNAL",
      "agentRunner not configured; compact preview unavailable",
    );
    return;
  }

  try {
    const result = await agentRunner.compactNow({
      session,
      dryRun: parsed.data.dryRun ?? true,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
  } catch (err) {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    sendJsonError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Compact preview failed",
      { details: { cid: safeId } },
    );
  }
}

/**
 * POST /api/sessions/:cid/compact/cancel
 *
 * **noop 端点**：cidMutex 串行化下没有 cancel 语义（要么在跑、要么没在跑）。
 * 保留端点供前端调用契约对齐（spec § 6.5）。
 *
 * body 用 `CompactCancelSchema` 校验（即便只是 noop），保证前端调用形态一致。
 *
 * 响应：`{ ok: true, data: { cancelled: false, reason: "noop" } }`（200）
 */
async function compactCancelSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  cid: string,
): Promise<void> {
  let safeId: string;
  try {
    safeId = assertPathSegment(cid, "cid");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${cid}" not found`);
    return;
  }

  // session 必须存在（否则回 404 与其他端点对齐；即便 cancel 是 noop）
  const session = sessionStore.get(safeId);
  if (!session) {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${safeId}" not found`);
    return;
  }

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

  const parsed = CompactCancelSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid request body", {
      details: parsed.error.flatten(),
    });
    return;
  }

  // noop：cidMutex 串行化下无 cancel 语义
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: true,
      data: {
        cancelled: false,
        reason: "noop",
        message: "cidMutex serializes compaction; no cancel semantics in this build",
        ...(parsed.data.reason ? { clientReason: parsed.data.reason } : {}),
      },
    }),
  );
}

/**
 * POST /api/sessions/:cid/compact
 *
 * 实际压缩：取消息 → provider 摘要 → 替换为单条 summary message。
 * 完整流程见 `AgentRunner.compactNow()` 注释。
 *
 * 错误码（contract § 3）：
 * - 400 INVALID_JSON            body 解析失败
 * - 404 SESSION_NOT_FOUND       cid 不存在
 * - 422 VALIDATION_FAILED       Zod schema 失败
 * - 429 CHAT_SESSION_BUSY       同 cid 上有压缩在飞（spec § 6.5 R-22）
 * - 500 INTERNAL                provider 不可用 / 调用失败 / 返回空 summary
 */
async function compactSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionStore: SessionStore,
  agentRunner: AgentRunner | undefined,
  cid: string,
): Promise<void> {
  let safeId: string;
  try {
    safeId = assertPathSegment(cid, "cid");
  } catch {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${cid}" not found`);
    return;
  }

  const session = sessionStore.get(safeId);
  if (!session) {
    sendJsonError(res, 404, "SESSION_NOT_FOUND", `Session "${safeId}" not found`);
    return;
  }

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

  const parsed = CompactRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid request body", {
      details: parsed.error.flatten(),
    });
    return;
  }

  if (!agentRunner) {
    sendJsonError(
      res,
      500,
      "INTERNAL",
      "agentRunner not configured; compact unavailable",
    );
    return;
  }

  try {
    const result = await agentRunner.compactNow({
      session,
      dryRun: parsed.data.dryRun ?? false,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(result));
  } catch (err) {
    if (res.headersSent || res.writableEnded) {
      res.destroy();
      return;
    }
    sendJsonError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Compact failed",
      { details: { cid: safeId } },
    );
  }
}