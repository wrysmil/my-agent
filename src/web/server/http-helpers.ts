/**
 * my-agent Web 前端 — 共享 HTTP 工具函数（WU-02b / B3）。
 *
 * 职责：
 * - 读取请求体（JSON 解析 + 大小限制 + 错误码映射）
 * - 写入统一格式的 JSON 错误响应
 *
 * 设计原则：
 * - 错误响应**总是**带 `requestId`（来自 `X-Request-Id` 头，由 `index.ts` 中间件注入）
 * - 422 `VALIDATION_FAILED` 携带 `details`（字段级错误回填）
 * - 400 `INVALID_JSON` 不携带 details（避免泄漏解析器内部）
 * - 413 `PAYLOAD_TOO_LARGE`（1 MiB 上限，与 contract § 3 一致）
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

// ============================================================
// 常量
// ============================================================

/** 请求体最大字节数：1 MiB（contract § 3.5）。 */
export const MAX_PAYLOAD_BYTES = 1_048_576;

/** 错误码 → HTTP 状态码（本地最小子集；WU-02e 会迁到 errors.ts 并补全）。 */
export const ERROR_STATUS_MAP: Record<string, number> = {
  INVALID_JSON: 400,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  SESSION_CORRUPT_FILE: 500,
  SESSION_ALREADY_EXISTS: 409,
  VALIDATION_FAILED: 422,
  STREAM_NOT_FOUND: 404,
  STREAM_ALREADY_RUNNING: 409,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
};

// ============================================================
// 请求体读取
// ============================================================

/**
 * 读取完整 JSON 请求体。
 *
 * - 大小超过 1 MiB → 抛 `Error("PAYLOAD_TOO_LARGE")`（路由层 catch 后映射为 413）
 * - body 为空或解析失败 → 抛 `Error("INVALID_JSON")`
 * - body 不为对象（数组 / 字符串 / null） → 抛 `Error("INVALID_JSON")`
 *
 * @returns 已 parse 的对象；调用方继续走 Zod 校验。
 */
export async function readBodyJson<T = unknown>(
  req: IncomingMessage,
): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_PAYLOAD_BYTES) {
      // 必须 destroy 以防客户端继续写
      req.destroy();
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buf);
  }

  if (size === 0) {
    // body 为空 —— 视为空对象（POST /api/sessions 的 body 可选）
    return {} as T;
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `INVALID_JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_JSON: body must be a JSON object");
  }

  return parsed as T;
}

// ============================================================
// 错误响应
// ============================================================

export type SendJsonErrorOptions = {
  /** 字段级错误详情（VALIDATION_FAILED 等场景） */
  details?: Record<string, unknown>;
};

/**
 * 写一条统一形态的 JSON 错误响应。
 *
 * ```json
 * {
 *   "ok": false,
 *   "error": {
 *     "code": "VALIDATION_FAILED",
 *     "message": "Invalid request body",
 *     "requestId": "<uuid>"
 *   }
 * }
 * ```
 *
 * 如 `res` 已发送过 header（`headersSent === true`）则**不**重发——调用方应自行 destroy。
 */
export function sendJsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  opts: SendJsonErrorOptions = {},
): void {
  if (res.headersSent || res.writableEnded) {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
    return;
  }

  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // 提取已有 requestId（index.ts 中间件已设 X-Request-Id）
  const requestId =
    (res.getHeader("X-Request-Id") as string | undefined) ?? randomUUID();

  const body: {
    ok: false;
    error: {
      code: string;
      message: string;
      requestId: string;
      details?: Record<string, unknown>;
    };
  } = {
    ok: false,
    error: {
      code,
      message,
      requestId,
      ...(opts.details ? { details: opts.details } : {}),
    },
  };

  res.end(JSON.stringify(body));
}

// ============================================================
// 成功响应
// ============================================================

/**
 * 写一条统一形态的 JSON 成功响应。
 *
 * ```json
 * { "ok": true, "data": ... }
 * ```
 */
export function sendJsonOk(res: ServerResponse, data: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, data }));
}