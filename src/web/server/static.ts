/**
 * my-agent Web 前端 — 静态文件中间件（WU-01 / B1）。
 *
 * 来源：spec § 6.6 + contract § 8。
 *
 * 职责：
 * - 解析 URL pathname → 真实文件路径
 * - 路径穿越防御（`..` / 绝对路径 / NUL 字节）
 * - 扩展名白名单（denylist 反例：禁 .ts / .map / .env）
 * - mime-type 推断（含 `.html .css .js .svg .ico .json`）
 * - 流式 pipe 给响应（避免大文件全读内存）
 *
 * **不做**：目录列表、Range 请求、If-Modified-Since 协商（YAGNI）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// ============================================================
// 允许直出的扩展名（allowlist）
// ============================================================

/**
 * 白名单（done criteria + spec § 4.2 + React 构建产物扩展）。
 *
 * - `.html` / `.css` / `.js` / `.mjs` / `.svg` / `.ico` / `.json`：UI 必需
 * - `.woff2` / `.png`：字体与位图资源
 * - `.webmanifest`：PWA manifest
 * - `.map`：source map（调试用）
 *
 * 未命中 → `application/octet-stream`（强制下载）；
 * 同时被路径穿越检查通过后**仍**可能被调用，故**双重保险**。
 */
export const ALLOWED_EXTS: ReadonlySet<string> = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".svg",
  ".ico",
  ".json",
  ".woff2",
  ".png",
  ".webmanifest",
  ".map",
]);

/** mime-type 映射（缺失时回退 `application/octet-stream`）。 */
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** 需要附 `charset=utf-8` 的文本类型；其它直接用 mime（无 charset）。 */
const TEXT_EXTS: ReadonlySet<string> = new Set([
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".svg",
  ".json",
  ".webmanifest",
]);

// ============================================================
// 路径防御
// ============================================================

/**
 * 把请求 pathname 解析为 webRoot 内的绝对路径。
 *
 * 返回 `null` 表示「非法」（路径穿越 / 非法编码 / NUL 字节），
 * 调用方应跳过静态服务并回 404。
 */
export function resolveStaticPath(
  webRoot: string,
  pathname: string,
): string | null {
  // NUL 字节截断防御（部分老 Node 版本会截断，需提前拒）
  if (pathname.includes("\0")) return null;

  // 根路径 → index.html
  const target = pathname === "/" ? "/index.html" : pathname;

  const root = path.resolve(webRoot);
  const resolved = path.resolve(root, "." + target);

  // 必须在 root 之内（防止 ../ 与 软链逃逸）
  // 比较时使用 `path.sep` 避免 `webRootV2` 与 `webRoot` 前缀重合误判
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }

  return resolved;
}

// ============================================================
// 静态文件响应
// ============================================================

/**
 * 尝试以静态文件响应请求。
 *
 * @returns `true` 表示已接管响应（调用方不应再写），`false` 表示不匹配
 *          （调用方应继续走路由 / 404）。
 *
 * 调用前**必须**已调用 `applySecurityHeaders(res)`（csp.ts）。本函数
 * 不再重复设置 CSP / nosniff / DENY 等头，但会按需补：
 * - `Content-Type: <mime>; charset=utf-8`（文本类型）
 * - `Content-Type: <mime>`（二进制）
 * - `Cache-Control: no-cache`（无 hash 文件，开发期热重载）
 * - `Cache-Control: public, max-age=31536000, immutable`（含 hash 文件，长期缓存）
 * - `Permissions-Policy`（仅 .html 响应；与 done criteria #4 对齐）
 */
export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  webRoot: string,
): boolean {
  // 1. 解析 pathname（容忍合法百分号编码）
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    return false;
  }

  // 2. 路径防御
  const resolved = resolveStaticPath(webRoot, pathname);
  if (resolved === null) return false;

  // 3. 扩展名白名单
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return false;

  // 4. 文件存在性 + 是文件（不是目录）
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  // 5. 写响应头
  const mime = MIME[ext] ?? "application/octet-stream";
  res.setHeader(
    "Content-Type",
    TEXT_EXTS.has(ext) ? `${mime}; charset=utf-8` : mime,
  );

  // Cache-Control: 按文件名是否含 hash 二分
  // - 含 hash（如 index-a1b2c3d4.js）→ 长期缓存（内容不变）
  // - 不含 hash（如 index.html）→ no-cache（开发期热重载）
  const stem = path.basename(resolved, ext);
  const HASH_RE = /[.-][a-f0-9]{8,}$/;
  if (HASH_RE.test(stem)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }

  if (ext === ".html") {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
  }
  res.statusCode = 200;

  // 6. 流式发送
  if (req.method === "HEAD") {
    res.setHeader("Content-Length", String(stat.size));
    res.end();
    return true;
  }

  fs.createReadStream(resolved).pipe(res);
  return true;
}