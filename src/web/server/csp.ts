/**
 * my-agent Web 前端 — CSP 与安全响应头（WU-01 / B1）。
 *
 * 来源：spec § 6.1 + contract § 7。
 *
 * 单一职责：定义 Content-Security-Policy / Permissions-Policy
 * 头字符串与配套安全头（X-Content-Type-Options / X-Frame-Options /
 * Referrer-Policy），并提供「应用安全头」的工具函数。
 *
 * 留待后续 WU：本文件**不**关心路由匹配 / 静态资源 / 业务 handler；
 * 它只关心 HTTP 响应头。
 */

import type { ServerResponse } from "node:http";

// ============================================================
// CSP（Content-Security-Policy）
// ============================================================

/**
 * CSP 头字符串，严格按 spec § 6.1 拼装。
 *
 * 关键策略：
 * - `default-src 'self'`：默认只允许同源（最严基线）
 * - `script-src 'self'`：**不**允许 inline script（防止 XSS）
 * - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`：
 *   'unsafe-inline' 仅留给 DOMPurify 输出（后续 F11 用），F0 主题切换
 *   不引入 inline style（只改 `<html data-theme>` + CSS 变量）
 * - `font-src https://fonts.gstatic.com data:`：Google Fonts
 * - `img-src 'self' data:`：data: 给 inline SVG / base64 占位
 * - `object-src 'none'` / `frame-ancestors 'none'`：禁用 embed / iframe 嵌套
 * - `base-uri 'self'` / `form-action 'self'`：防 `<base>` 劫持 + 表单外发
 */
export const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Permissions-Policy 头：禁用 camera / microphone / geolocation。
 * 仅给 HTML 响应（与 spec § 6.1 + done criteria #4 一致）。
 */
export const PERMISSIONS_POLICY_HEADER =
  "camera=(), microphone=(), geolocation=()";

// ============================================================
// 工具
// ============================================================

export type ApplySecurityHeadersOptions = {
  /**
   * 当前响应是 text/html 时设 true，会附加 Permissions-Policy 头。
   * 其它类型（JSON / SVG / CSS / JS / 二进制）不附加，避免无谓泄漏。
   */
  html?: boolean;
};

/**
 * 给响应套上安全头。**总是**先于业务逻辑调用，避免业务写完 body 后
 * setHeader 抛 "Cannot set headers after they are sent"。
 *
 * 调用前**不要**调用过 `res.writeHead()` / `res.end()` / `res.write()`。
 */
export function applySecurityHeaders(
  res: ServerResponse,
  opts: ApplySecurityHeadersOptions = {},
): void {
  res.setHeader("Content-Security-Policy", CSP_HEADER);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (opts.html) {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY_HEADER);
  }
}