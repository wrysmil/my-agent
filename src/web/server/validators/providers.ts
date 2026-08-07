/**
 * my-agent Web 前端 — Provider 域 Zod 校验（WU-02a / B2）。
 *
 * 来源：spec § 6.2 / contract § 2 § 3。
 *
 * 单一职责：定义 Provider 域 8 条路由所需的 4 个 Zod schema 与
 * 配套的 `ApiError` 错误类（GROUP-7 / WU-02e 会把 ApiError 抽到
 * `errors.ts` 并统一中间件；本期先就地定义）。
 *
 * @see .ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md
 */

import type { IncomingMessage } from "node:http";
import { z } from "zod";

// ============================================================
// ApiError（本地 stub；WU-02e 落地后迁移到 errors.ts）
// ============================================================

/**
 * 业务错误基类 —— GROUP-2 handler `throw new ApiError(...)`，
 * 由路由层 `sendError()` 统一转 JSON 响应。
 *
 * 字段语义：
 * - `code`   ApiErrorCode 字符串（如 `PROVIDER_NOT_FOUND`）
 * - `status` HTTP 状态码（如 404）
 * - `message` 给前端的可读消息
 * - `details` 可选；Zod 校验失败时附 `details.issues` 数组
 *
 * WU-02e 落地后此类型会被同名类型替换；handler 调用方式不变。
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;
  constructor(
    code: string,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ============================================================
// Zod schemas（4 个）
// ============================================================

/**
 * 通用 Provider upsert 请求体。
 *
 * POST `/api/providers` 和 PUT `/api/providers/:id` 共用：
 * - `id` 必须存在且 ≤ 64 字符
 * - `type` 当前仅支持 `"deepseek"`（union 收紧留给后续接入新 provider）
 * - `apiKey` 允许空字符串（运行时从 `DEEPSEEK_API_KEY` 环境变量 fallback；
 *   spec § 6.4.3）
 * - `baseUrl` 必须是合法 URL
 * - `defaultModel` 非空
 * - `enabled` boolean
 *
 * `.strict()`：拒绝未知字段，防止「前端 typo 多传字段导致后端静默忽略」。
 */
export const ProviderUpsertSchema = z
  .object({
    id: z.string().min(1, "id is required").max(64),
    name: z.string().min(1, "name is required").max(128),
    type: z.literal("deepseek"),
    apiKey: z.string(),
    baseUrl: z.string().url("baseUrl must be a valid URL"),
    defaultModel: z.string().min(1, "defaultModel is required").max(128),
    enabled: z.boolean(),
  })
  .strict();

/**
 * `PUT /api/providers/active` 请求体：仅 `{ id }`。
 */
export const SetActiveSchema = z
  .object({
    id: z.string().min(1, "id is required").max(64),
  })
  .strict();

/**
 * `PATCH /api/providers/active/model` 请求体：仅 `{ defaultModel }`。
 */
export const SetActiveModelSchema = z
  .object({
    defaultModel: z
      .string()
      .min(1, "defaultModel is required")
      .max(128),
  })
  .strict();

/**
 * URL `:id` 参数（`:id/toggle` / `:id` PUT / `:id` DELETE）。
 *
 * 限定字符集 `[a-zA-Z0-9_-]{1,64}`：
 * - 阻止路径穿越字符（`..` / `/` / `\` / NUL）
 * - 阻止空字符串与超长输入
 *
 * 不通过则由调用方决定回 404（路径穿越）或 422（普通参数错）。
 */
export const ProviderIdParamSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "provider id must match [a-zA-Z0-9_-]{1,64}",
  );

// ============================================================
// 工具：读 body + 校验
// ============================================================

/** 允许的 Content-Type 白名单（done criteria #5 422 details 配套）。 */
const JSON_CONTENT_TYPES = [
  "application/json",
  "application/json; charset=utf-8",
  "text/json",
];

/**
 * 读取请求体并按 schema 校验。失败统一抛 `ApiError(VALIDATION_FAILED, 422, ...)`，
 * `details` 字段附 Zod issue 数组（spec § 3.4 错误格式）。
 *
 * Content-Type 必须是 application/json；否则回 415 PAYLOAD_TOO_LARGE 不在
 * 本期范围，回 400 INVALID_REQUEST。
 */
export async function parseJsonBody<T>(
  req: IncomingMessage,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await readBody(req);
  if (raw.length === 0) {
    throw new ApiError(
      "VALIDATION_FAILED",
      422,
      "Request body is empty",
      { issues: [{ path: [], message: "body must be a JSON object" }] },
    );
  }

  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (
    ct &&
    !JSON_CONTENT_TYPES.some((allowed) => ct.startsWith(allowed))
  ) {
    throw new ApiError(
      "INVALID_REQUEST",
      400,
      `Unsupported Content-Type: ${ct}`,
      { issues: [{ path: ["content-type"], message: "expected application/json" }] },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ApiError(
      "VALIDATION_FAILED",
      422,
      "Request body is not valid JSON",
      {
        issues: [
          {
            path: [],
            message:
              err instanceof Error ? err.message : "JSON parse error",
          },
        ],
      },
    );
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      422,
      "Request body failed schema validation",
      { issues: result.error.issues },
    );
  }
  return result.data;
}

/**
 * 读 IncomingMessage 整个 body。Node 默认无 body，需要手动拼接 data chunk。
 *
 * 上限 1MB（防 DoS）；超出抛 413。
 */
const MAX_BODY_BYTES = 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<string>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(
          new ApiError(
            "PAYLOAD_TOO_LARGE",
            413,
            `Request body exceeds ${MAX_BODY_BYTES} bytes`,
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", (err) => reject(err));
  });
}

/**
 * 校验 URL `:id` 参数。不通过抛 ApiError。
 *
 * - 路径穿越（`..` / `/` / `\` / NUL / 编码形式 `%2F` `%5C` 等） → 404
 *   PROVIDER_NOT_FOUND（不暴露细节 —— Done criteria #6 要求「必须 404」）
 * - 普通格式错（超长 / 非法字符） → 422 VALIDATION_FAILED
 *
 * 设计：URL.pathname 默认保留 `%2F` 编码（不解码为 `/`），所以直接走
 * 字符集正则会把它当作「普通字符」漏过 —— 必须先显式拒绝所有
 * 百分号编码形式的危险字符。
 */
export function validateProviderId(id: string): string {
  // 1. 路径穿越防御（Done criteria #6）—— 所有已知穿越形式都判 404
  if (
    !id ||
    id.includes("..") ||
    /[\/\\\0]/.test(id) ||
    // 百分号编码形式（大小写不敏感）
    /%2f/i.test(id) ||
    /%5c/i.test(id) ||
    /%00/i.test(id)
  ) {
    throw new ApiError(
      "PROVIDER_NOT_FOUND",
      404,
      `Provider id is invalid or escapes sandbox: ${JSON.stringify(id)}`,
    );
  }
  // 2. 严格字符集校验
  const parsed = ProviderIdParamSchema.safeParse(id);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_FAILED",
      422,
      "Provider id failed schema validation",
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}
