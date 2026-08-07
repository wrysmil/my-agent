/**
 * my-agent Web 前端 — 路由占位（WU-01 / B1）。
 *
 * 来源：spec § 6.2 + contract § 9。
 *
 * **本期不做**：21 个业务路由的具体实现。
 * 留待后续 WU（WU-02a/b/c/e，GROUP-2）填充真实 handler。
 *
 * 本期行为：
 * - `ROUTES` 表保留全部 21 个路由条目（顺序即匹配优先级；
 *   静态路径必须在动态正则之前）。
 * - 命中的占位 handler 返回 404 `ApiError { code: "ROUTE_NOT_FOUND" }`。
 * - 未命中的路径由调用方（index.ts）统一回 404 ROUTE_NOT_FOUND。
 *
 * `ROUTES` 数组**对外导出**，供 GROUP-2 直接 mutate / 替换实现。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ============================================================
// 类型
// ============================================================

/**
 * 路由 handler 签名（最小可用形态）。
 *
 * 后续 WU（WU-02e）会扩为 `(req, res, params, ctx) => ...`，其中 `ctx`
 * 含 providersStore / sessionStore / logger / requestId / body。本期
 * 不注入 ctx：占位 handler 只回 404，不读 body。
 */
export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
) => Promise<void> | void;

/**
 * 路由表条目：[方法, 路径或正则, handler, 正则捕获组对应的参数名]。
 *
 * - `pattern` 为 string 时按等值匹配（exact match）
 * - `pattern` 为 RegExp 时按正则匹配；`names[i]` 对应 `match[i+1]`
 *
 * 顺序敏感：第一个匹配项胜出，故具体路径须排在动态正则之前。
 */
export type Route = [string, string | RegExp, Handler, string[]];

export type RouteMatch = {
  handler: Handler;
  params: Record<string, string>;
};

// ============================================================
// 21 个路由占位（spec § 6.2 + contract § 9）
// ============================================================

/**
 * 占位 handler：所有路由在本期统一返回 404 `ROUTE_NOT_FOUND`。
 *
 * 不用 501（NOT_IMPLEMENTED）的原因是：spec § 3.4.1 把 404 作为
 * 「资源不存在 / 路径不存在」的标准语义；501 在 contract 中并未注册。
 * 前端 / 监控告警按 404 + ROUTE_NOT_FOUND 即可识别「该路由尚未落地」。
 */
function routeNotFoundPlaceholder(
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route is registered but not implemented in this build",
      },
    }),
  );
}

/**
 * 全部 21 个 API 路由的占位表。
 *
 * 顺序按 spec § 6.2 / contract § 9：具体静态路径 → 动态正则。
 * 替换实现时直接 mutate `ROUTES[i][2]`（handler 位）或整表替换。
 */
export const ROUTES: Route[] = [
  // ---- Provider 域（WU-02a 落地） ----
  ["GET", "/api/providers", routeNotFoundPlaceholder, []],
  ["GET", "/api/providers/active", routeNotFoundPlaceholder, []],
  ["POST", "/api/providers", routeNotFoundPlaceholder, []],
  ["PUT", "/api/providers/active", routeNotFoundPlaceholder, []],
  ["PATCH", "/api/providers/active/model", routeNotFoundPlaceholder, []],
  [
    "POST",
    /^\/api\/providers\/([^/]+)\/toggle$/,
    routeNotFoundPlaceholder,
    ["id"],
  ],
  ["PUT", /^\/api\/providers\/([^/]+)$/, routeNotFoundPlaceholder, ["id"]],
  ["DELETE", /^\/api\/providers\/([^/]+)$/, routeNotFoundPlaceholder, ["id"]],

  // ---- Session 域（WU-02b 落地） ----
  ["GET", "/api/sessions", routeNotFoundPlaceholder, []],
  ["POST", "/api/sessions", routeNotFoundPlaceholder, []],
  [
    "GET",
    /^\/api\/sessions\/([^/]+)\/history$/,
    routeNotFoundPlaceholder,
    ["id"],
  ],
  ["DELETE", /^\/api\/sessions\/([^/]+)$/, routeNotFoundPlaceholder, ["id"]],
  [
    "POST",
    /^\/api\/sessions\/([^/]+)\/compact$/,
    routeNotFoundPlaceholder,
    ["cid"],
  ],

  // ---- Chat 流（WU-02b 落地，含 SSE） ----
  [
    "POST",
    /^\/api\/sessions\/([^/]+)\/messages\/stream$/,
    routeNotFoundPlaceholder,
    ["id"],
  ],
  [
    "POST",
    /^\/api\/sessions\/([^/]+)\/messages\/abort$/,
    routeNotFoundPlaceholder,
    ["id"],
  ],

  // ---- Agent / Skill 域（WU-02c 落地） ----
  ["GET", "/api/agents", routeNotFoundPlaceholder, []],
  ["GET", /^\/api\/agents\/([^/]+)$/, routeNotFoundPlaceholder, ["id"]],
  ["GET", "/api/skills", routeNotFoundPlaceholder, []],
  ["GET", /^\/api\/skills\/([^/]+)$/, routeNotFoundPlaceholder, ["id"]],
];

// ============================================================
// 匹配
// ============================================================

/**
 * 按方法 + 路径匹配路由。**未命中返回 null**（由调用方决定回 404 / 405）。
 *
 * @param method  HTTP 方法（如 `GET` / `POST`），大小写敏感。
 *                Node `IncomingMessage.method` 默认大写。
 * @param pathname  URL pathname（已 `decodeURIComponent`）。
 */
export function matchRoute(
  method: string,
  pathname: string,
  routes: Route[] = ROUTES,
): RouteMatch | null {
  for (const [m, pattern, handler, names] of routes) {
    if (m !== method) continue;
    if (typeof pattern === "string") {
      if (pattern === pathname) return { handler, params: {} };
      continue;
    }
    const matched = pathname.match(pattern);
    if (matched) {
      const params: Record<string, string> = {};
      names.forEach((name, i) => {
        params[name] = matched[i + 1] ?? "";
      });
      return { handler, params };
    }
  }
  return null;
}

/**
 * 路径是否在路由表内（忽略方法）。用于区分：
 * - 「路径完全未知」→ 404 ROUTE_NOT_FOUND
 * - 「路径存在但方法不允许」→ 405 METHOD_NOT_ALLOWED
 *
 * 本期不区分（全部回 404），保留接口给 WU-02e 接入错误中间件时使用。
 */
export function isRoutedPath(
  pathname: string,
  routes: Route[] = ROUTES,
): boolean {
  return routes.some(([, pattern]) =>
    typeof pattern === "string" ? pattern === pathname : pattern.test(pathname),
  );
}