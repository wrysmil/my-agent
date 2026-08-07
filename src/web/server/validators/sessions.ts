/**
 * my-agent Web 前端 — Session / Chat 流请求体 Zod schemas（WU-02b / B3）。
 *
 * 来源：contract § 2.2。
 *
 * 边界校验规则：
 * - `text` ≥ 1 字符、≤ 32_000（防 payload 爆炸）
 * - `systemPrompt` ≤ 8_000（避免单轮上下文塞满）
 * - `kind` 限定为已知 5 种（新增合法值时旧客户端 ignore，见 spec § 3.4.4）
 * - `limit` 1-200、`offset` ≥ 0（list 默认 50/0）
 * - `streamId` UUID v1-5 形态（防止误传普通字符串；abort 不存在 streamId → STREAM_NOT_FOUND）
 */

import { z } from "zod";

// ============================================================
// Session domain
// ============================================================

/**
 * `GET /api/sessions` query string。
 *
 * 数字字段用 `z.coerce.number()` —— 浏览器可能发字符串"50"而非 number。
 */
export const ListSessionsQuerySchema = z.object({
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;

/**
 * `POST /api/sessions` body。
 *
 * `kind` 限定为 storage 层已知的 5 种枚举（src/storage/session-store.ts:33）；
 * 留 optional 是因为大多数客户端不需要显式指定（默认 `gconv`）。
 */
export const CreateSessionSchema = z.object({
  kind: z.enum(["gconv", "cli", "anon", "extract", "gworker"]).optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

// ============================================================
// Chat stream domain
// ============================================================

/**
 * `POST /api/sessions/:id/messages/stream` body。
 *
 * - `text` 必填（≥ 1 字符）
 * - `systemPrompt` 可选（覆盖默认 prompt；与 runner.ts AgentRunParams 一致）
 */
export const StreamMessageSchema = z.object({
  text: z.string().min(1).max(32_000),
  systemPrompt: z.string().max(8_000).optional(),
});

export type StreamMessageInput = z.infer<typeof StreamMessageSchema>;

/**
 * `POST /api/sessions/:id/messages/abort` body。
 *
 * `streamId` 必须是 UUID（v1-v5）。缺省时退化为「abort 该 cid 上所有在飞流」
 * —— 这与 SSE `X-Stream-Id` 头部携带的 UUID 是同一份。
 *
 * 用 UUID 形态约束（而非 `z.string().min(1)`）保证：
 * - 拒绝空字符串 / 路径穿越（`/`, `\`, `..`）
 * - 拒绝非 UUID 形式注入（如超长字符串撑爆 hub map key）
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AbortStreamSchema = z.object({
  streamId: z
    .string()
    .regex(UUID_RE, "streamId must be a UUID")
    .optional(),
});

export type AbortStreamInput = z.infer<typeof AbortStreamSchema>;