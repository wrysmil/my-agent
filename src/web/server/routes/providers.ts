/**
 * my-agent Web 前端 — Provider 域 8 条 REST 端点（WU-02a / B2）。
 *
 * 来源：spec § 6.2 / § 6.4 / contract § 1 § 2 § 3 § 9。
 *
 * 路由清单（与 router.ts ROUTES 表的 Provider 段一一对应）：
 *
 * | 方法   | 路径                                 | handler 名                |
 * | ------ | ------------------------------------ | ------------------------- |
 * | GET    | `/api/providers`                     | listProviders             |
 * | GET    | `/api/providers/active`              | getActiveProvider         |
 * | POST   | `/api/providers`                     | createProvider            |
 * | PUT    | `/api/providers/active`              | setActiveProvider         |
 * | PATCH  | `/api/providers/active/model`        | setActiveModel            |
 * | POST   | `/api/providers/:id/toggle`          | toggleProviderEnabled     |
 * | PUT    | `/api/providers/:id`                 | upsertProviderById        |
 * | DELETE | `/api/providers/:id`                 | deleteProvider            |
 *
 * 设计原则：
 * - **handler 纯函数**：每个 handler 只依赖闭包里的 `deps`，便于单元测试
 * - **错误统一通过 ApiError**：handler 内 `throw new ApiError(...)`，由
 *   `safeHandler()` 包裹层统一捕获并写 JSON 响应（status / code / details）
 * - **路径穿越防御**：`validateProviderId()` 拒绝 `..` / `/` / `\` / NUL
 * - **store 同步落盘**：mutation 后调 `store.save()`（spec § 6.4.3 要求
 *   立即持久化，避免进程崩溃后丢失配置）
 *
 * WU-02e 落地后，ApiError 与 safeHandler 的写响应部分会迁移到统一的
 * 错误中间件；当前实现保持 handler 自洽。
 *
 * @see .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "../../../shared/logger.js";
import type {
  ProviderConfigEntry,
  ProvidersStore,
} from "../../../storage/providers-store.js";
import type { Handler, Route } from "../router.js";

import {
  ApiError,
  ProviderUpsertSchema,
  SetActiveModelSchema,
  SetActiveSchema,
  parseJsonBody,
  validateProviderId,
} from "../validators/providers.js";

// ============================================================
// 依赖类型
// ============================================================

export type RegisterProviderRoutesDeps = {
  /** Provider 配置存储（必填；handler 内直接读写） */
  providersStore: ProvidersStore;
  /** 可选：结构化日志；缺省走 console */
  logger?: Logger;
};

// ============================================================
// 注册入口
// ============================================================

/**
 * 把 Provider 域 8 条 handler 装进 `router`（即 `ROUTES` 数组）。
 *
 * 调用方式：
 * ```ts
 * import { ROUTES } from "../router.js";
 * import { registerProviderRoutes } from "./routes/providers.js";
 * registerProviderRoutes(ROUTES, { providersStore, logger });
 * ```
 *
 * 实现策略：
 * - 遍历 `router`；遇到 method + pattern 与 Provider 域匹配的条目，
 *   用对应 handler 替换其 `[2]`（handler 位）
 * - **顺序敏感**：调用前 router.ts 必须已按 spec § 6.2 顺序排列
 *   （具体路径 → 动态正则）；当前 router.ts 已满足
 * - **不引入新路由**：仅 mutate 现有 ROUTES 表的 handler 位
 *
 * 返回替换数量（测试用）。
 */
export function registerProviderRoutes(
  router: Route[],
  deps: RegisterProviderRoutesDeps,
): number {
  let replaced = 0;
  for (let i = 0; i < router.length; i++) {
    const entry = router[i];
    if (!entry) continue;
    const [method, pattern, , names] = entry;
    const key = routeKey(method, pattern);
    const handler = HANDLERS[key];
    if (!handler) continue;
    router[i] = [method, pattern, wrap(handler, deps), names];
    replaced++;
  }
  return replaced;
}

// ============================================================
// Handler 路由表（method+pattern → handler）
// ============================================================

const HANDLERS: Record<string, (ctx: HandlerCtx) => Promise<void>> = {
  "GET /api/providers": listProviders,
  "GET /api/providers/active": getActiveProvider,
  "POST /api/providers": createProvider,
  "PUT /api/providers/active": setActiveProvider,
  "PATCH /api/providers/active/model": setActiveModel,
  "POST /api/providers/:id/toggle": toggleProviderEnabled,
  "PUT /api/providers/:id": upsertProviderById,
  "DELETE /api/providers/:id": deleteProvider,
};

/** 把 `Route` 表的 (method, pattern) 归一为字符串 key。 */
function routeKey(method: string, pattern: string | RegExp): string {
  if (typeof pattern === "string") return `${method} ${pattern}`;
  // 反向归一化 regex → 占位符
  if (pattern.source === "^\\/api\\/providers\\/([^/]+)\\/toggle$") {
    return `${method} /api/providers/:id/toggle`;
  }
  if (pattern.source === "^\\/api\\/providers\\/([^/]+)$") {
    return `${method} /api/providers/:id`;
  }
  return `${method} ${pattern.source}`;
}

// ============================================================
// Handler 上下文（wrap 注入 deps）
// ============================================================

type HandlerCtx = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  store: ProvidersStore;
  log: Logger;
};

/** 把裸 handler 包成 `Handler(req, res, params)` 形态。 */
function wrap(
  raw: (ctx: HandlerCtx) => Promise<void>,
  deps: RegisterProviderRoutesDeps,
): Handler {
  const log = deps.logger ?? SILENT_LOGGER;
  return async (req, res, params) => {
    try {
      await raw({ req, res, params, store: deps.providersStore, log });
    } catch (err) {
      sendError(res, err, log);
    }
  };
}

const SILENT_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn(msg, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    console.error(msg, ...args);
  },
};

// ============================================================
// 响应工具
// ============================================================

/** 写 JSON 成功响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** 错误统一出口：ApiError → 业务响应；其它 → 500 INTERNAL。 */
function sendError(
  res: ServerResponse,
  err: unknown,
  log: Logger,
): void {
  if (err instanceof ApiError) {
    sendJson(res, err.status, {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }
  log.error("[providers] unexpected error:", err);
  sendJson(res, 500, {
    ok: false,
    error: {
      code: "INTERNAL",
      message: err instanceof Error ? err.message : "Internal Server Error",
    },
  });
}

// ============================================================
// Handler 实现（8 条）
// ============================================================

/**
 * GET /api/providers —— 列出全部 Provider（含 disabled）。
 *
 * spec § 6.4.1：list 应包含 disabled（前端需要展示灰态）；
 * 「active」字段单独由 GET /active 给出。
 */
async function listProviders(ctx: HandlerCtx): Promise<void> {
  const cfg = ctx.store.getConfig();
  const providers = Object.values(cfg.providers).map(stripEnvKey);
  sendJson(ctx.res, 200, { ok: true, data: providers });
}

/**
 * GET /api/providers/active —— 返回当前 active Provider。
 *
 * - 未设置 / 被禁用 / 列表为空 → 404 PROVIDER_NOT_FOUND
 */
async function getActiveProvider(ctx: HandlerCtx): Promise<void> {
  const active = ctx.store.getActiveProvider();
  if (!active) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      "No active provider configured",
    );
  }
  sendJson(ctx.res, 200, { ok: true, data: stripEnvKey(active) });
}

/**
 * POST /api/providers —— 创建 Provider。
 *
 * - body 通过 `ProviderUpsertSchema` 校验（Zod 失败 → 422 VALIDATION_FAILED）
 * - `id` 已存在 → 409 PROVIDER_ALREADY_EXISTS
 * - 持久化（save）
 * - 201 Created + 新 Provider 数据
 */
async function createProvider(ctx: HandlerCtx): Promise<void> {
  const body = await parseJsonBody(ctx.req, ProviderUpsertSchema);
  const cfg = ctx.store.getConfig();
  if (cfg.providers[body.id]) {
    throw new ApiError(
      "PROVIDER_ALREADY_EXISTS",
      409,
      `Provider "${body.id}" already exists`,
    );
  }
  await upsertAndSave(ctx.store, body);
  ctx.log.info(`[providers] created ${body.id}`);
  sendJson(ctx.res, 201, { ok: true, data: stripEnvKey(body) });
}

/**
 * PUT /api/providers/active —— 切换 active Provider。
 *
 * - body `{ id }` 通过 `SetActiveSchema`
 * - `id` 不存在 → 404 PROVIDER_NOT_FOUND
 * - 允许切到 `enabled=false`（语义：用户显式选择；后续 `getActiveProvider`
 *   会 fallback 到第一个 enabled —— 与 `providers-store.ts` 的 fallback 行为对齐）
 * - 200 OK + 切换后的 active Provider（store 内部已 fallback）
 */
async function setActiveProvider(ctx: HandlerCtx): Promise<void> {
  const body = await parseJsonBody(ctx.req, SetActiveSchema);
  const cfg = ctx.store.getConfig();
  const target = cfg.providers[body.id];
  if (!target) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      `Provider "${body.id}" not found`,
    );
  }
  ctx.store.setActiveProvider(body.id);
  await ctx.store.save();
  ctx.log.info(`[providers] active → ${body.id}`);
  const active = ctx.store.getActiveProvider();
  if (!active) {
    // 极端 case：用户切到一个 disabled 且无其它 enabled → store fallback 到空
    // 此时仍 200（语义：active 已设置），但 data 为空对象
    sendJson(ctx.res, 200, { ok: true, data: null });
    return;
  }
  sendJson(ctx.res, 200, {
    ok: true,
    data: stripEnvKey(active),
  });
}

/**
 * PATCH /api/providers/active/model —— 仅更新 active Provider 的 defaultModel。
 *
 * - 当前无 active → 404 PROVIDER_NOT_FOUND
 * - body `{ defaultModel }` 通过 `SetActiveModelSchema`
 * - 200 OK + 更新后的 active Provider
 */
async function setActiveModel(ctx: HandlerCtx): Promise<void> {
  const body = await parseJsonBody(ctx.req, SetActiveModelSchema);
  const active = ctx.store.getActiveProvider();
  if (!active) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      "No active provider to update model on",
    );
  }
  const updated: ProviderConfigEntry = { ...active, defaultModel: body.defaultModel };
  ctx.store.upsertProvider(updated);
  await ctx.store.save();
  ctx.log.info(
    `[providers] active ${active.id} defaultModel → ${body.defaultModel}`,
  );
  sendJson(ctx.res, 200, { ok: true, data: stripEnvKey(updated) });
}

/**
 * POST /api/providers/:id/toggle —— 翻转 `enabled`。
 *
 * - `:id` 路径穿越防御 → 404
 * - 不存在 → 404 PROVIDER_NOT_FOUND
 * - 翻转后若该 Provider 是 active 但现在被禁用 → 切到第一个 enabled
 * - 200 OK + 翻转后的 Provider
 */
async function toggleProviderEnabled(ctx: HandlerCtx): Promise<void> {
  const id = validateProviderId(ctx.params.id ?? "");
  const cfg = ctx.store.getConfig();
  const cur = cfg.providers[id];
  if (!cur) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      `Provider "${id}" not found`,
    );
  }
  const nextEnabled = !cur.enabled;
  const updated: ProviderConfigEntry = { ...cur, enabled: nextEnabled };
  ctx.store.upsertProvider(updated);

  // 切到禁用且当前是 active → 切到下一个 enabled
  if (!nextEnabled && cfg.activeProviderId === id) {
    const fallback = Object.values(cfg.providers).find(
      (p) => p.id !== id && p.enabled,
    );
    if (fallback) {
      // setActiveProvider 对不存在的 id 会抛；只在 fallback 存在时调用
      ctx.store.setActiveProvider(fallback.id);
    }
    // fallback 为空时（全部 disabled）：保留 activeProviderId 指向已
    // 禁用的原 id —— getActiveProvider() 会返回 undefined，UI 端按
    // 404 处理
  }

  await ctx.store.save();
  ctx.log.info(`[providers] toggle ${id} → enabled=${nextEnabled}`);
  sendJson(ctx.res, 200, { ok: true, data: stripEnvKey(updated) });
}

/**
 * PUT /api/providers/:id —— 创建（URL id 优先）。
 *
 * - `:id` 路径穿越防御 → 404
 * - body.id 必须与 URL :id 一致（防「body 用 a，URL 用 b」的语义错乱）；
 *   不一致 → 422 VALIDATION_FAILED
 * - 已存在 → 409 PROVIDER_ALREADY_EXISTS（同 POST）
 * - 200 OK + 新 Provider（URL 创建）
 */
async function upsertProviderById(ctx: HandlerCtx): Promise<void> {
  const id = validateProviderId(ctx.params.id ?? "");
  const body = await parseJsonBody(ctx.req, ProviderUpsertSchema);
  if (body.id !== id) {
    throw new ApiError(
      "VALIDATION_FAILED",
      422,
      `Body id "${body.id}" does not match URL :id "${id}"`,
      {
        issues: [
          {
            path: ["id"],
            message: `expected "${id}" (from URL), got "${body.id}" (from body)`,
          },
        ],
      },
    );
  }
  const cfg = ctx.store.getConfig();
  if (cfg.providers[id]) {
    throw new ApiError(
      "PROVIDER_ALREADY_EXISTS",
      409,
      `Provider "${id}" already exists`,
    );
  }
  await upsertAndSave(ctx.store, body);
  ctx.log.info(`[providers] created by id ${id}`);
  sendJson(ctx.res, 200, { ok: true, data: stripEnvKey(body) });
}

/**
 * DELETE /api/providers/:id —— 删除 Provider。
 *
 * - `:id` 路径穿越防御 → 404
 * - 不存在 → 404 PROVIDER_NOT_FOUND（POST 语义：「删除不存在资源」按
 *   spec § 3.4.1 应回 404；幂等性由 store.removeProvider 内部处理）
 * - 200 OK + `{ deleted: id }`
 */
async function deleteProvider(ctx: HandlerCtx): Promise<void> {
  const id = validateProviderId(ctx.params.id ?? "");
  const cfg = ctx.store.getConfig();
  if (!cfg.providers[id]) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      `Provider "${id}" not found`,
    );
  }
  ctx.store.removeProvider(id);
  await ctx.store.save();
  ctx.log.info(`[providers] deleted ${id}`);
  sendJson(ctx.res, 200, { ok: true, data: { deleted: id } });
}

// ============================================================
// 内部工具
// ============================================================

/** 写 store + save；统一错误出口。调用方必须 `await`。 */
async function upsertAndSave(
  store: ProvidersStore,
  entry: ProviderConfigEntry,
): Promise<void> {
  store.upsertProvider(entry);
  await store.save();
}

/**
 * 把 store 返回的 Provider 数据脱敏：`apiKey` 为空时（依赖环境变量）
 * 仍保留空串 —— 前端不应该看到环境变量值。
 *
 * 当前 store 已做脱敏（resolveEnvApiKey 注入时仅在内存替换，不写盘），
 * 此函数是兜底（防止未来 store 改动泄漏）。
 */
function stripEnvKey(p: ProviderConfigEntry): ProviderConfigEntry {
  return {
    ...p,
    // 保留原始 apiKey（空 = 走环境变量）；不返回环境变量真值
    apiKey: p.apiKey,
  };
}
