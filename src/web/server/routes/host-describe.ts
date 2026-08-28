/**
 * my-agent Web 前端 — /api/host.describe HTTP 端点 (M3)。
 *
 * 路由：POST /api/host.describe
 *
 * 用途：客户端通过 HTTP POST 获取 host 握手描述（协议版本、capabilities）。
 * WebSocket 握手时也会自动推送相同的 host/describe 帧。
 *
 * 请求：
 * ```json
 * { "protocolVersion": "1.0" }
 * ```
 *
 * 响应：
 * ```json
 * { "kind": "host/describe", "capabilities": ["approval", "streaming"], "protocolVersion": "1.0" }
 * ```
 *
 * 错误码：
 * - 400 INVALID_JSON    body 解析失败
 * - 422 VALIDATION_FAILED Zod schema 失败
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { readBodyJson, sendJsonError } from "../http-helpers.js";
import { HOST_CAPABILITIES } from "../ws/host-handler.js";

// ─── Request/Response 类型 ─────────────────────────────────────────────────────

const HostDescribeRequestSchema = {
  safeParse: (raw: unknown) => {
    if (raw === null || raw === undefined) {
      return { success: true, data: {} };
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { success: false, error: { message: "must be an object" } };
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj["protocolVersion"] !== "string" && obj["protocolVersion"] !== undefined) {
      return { success: false, error: { message: "protocolVersion must be a string" } };
    }
    return {
      success: true,
      data: { protocolVersion: obj["protocolVersion"] as string | undefined },
    };
  },
};

interface HostDescribeInput {
  protocolVersion?: string;
}

interface HostDescribeResponse {
  kind: "host/describe";
  capabilities: string[];
  protocolVersion?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * POST /api/host.describe
 *
 * 返回 host 握手描述帧（与 WebSocket 首帧格式一致）。
 */
export async function handleHostDescribe(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // 1) 读取 body
  let body: unknown;
  try {
    body = await readBodyJson<unknown>(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Bad request";
    if (msg.includes("PAYLOAD_TOO_LARGE")) {
      sendJsonError(res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
      return;
    }
    sendJsonError(res, 400, "INVALID_JSON", msg);
    return;
  }

  // 2) 校验 body
  const parsed = HostDescribeRequestSchema.safeParse(body);
  if (!parsed.success) {
    sendJsonError(res, 422, "VALIDATION_FAILED", parsed.error?.message ?? "Validation failed", {
      details: { field: "protocolVersion" },
    });
    return;
  }
  const input = parsed.data as HostDescribeInput;

  // 3) 构造响应
  const response: HostDescribeResponse = {
    kind: "host/describe",
    capabilities: [...HOST_CAPABILITIES],
    ...(input.protocolVersion ? { protocolVersion: input.protocolVersion } : {}),
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(response));
}

// ─── 路由注册 ────────────────────────────────────────────────────────────────

import { ROUTES } from "../router.js";
import type { Handler } from "../router.js";

/**
 * 把 POST /api/host.describe 注册到 ROUTES 表。
 */
export function registerHostDescribeRoute(): void {
  // 查找是否已存在
  for (const route of ROUTES) {
    if (route[0] === "POST" && route[1] === "/api/host.describe") {
      route[2] = handleHostDescribe;
      return;
    }
  }
  // 不存在则追加
  ROUTES.push(["POST", "/api/host.describe", handleHostDescribe as Handler, []]);
}
