---
artifact: contract
route: api-and-interface-design
created_at: 2026-08-07
status: draft
scope:
  plan: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md
  spec: .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md
---

# my-agent Web 前端 — 跨 WU 共享契约（API Contract v1）

> 本文是 GROUP-2 / GROUP-6 所有 WU 的 **L4 Contract 输入**（dispatch §0.5）。
> 来源 spec § 3（数据设计）+ § 3.4（API 契约）+ § 6.1（SSE 协议）。
> **路径：** `/Users/mima0000/Documents/学习-001/do-project/my-agent/.ai-runtime-artifacts/contracts/2026-08-07-web-frontend-api-contract.md`

## 1. 路由总表（server-side，spec § 3.1）

### 1.1 Provider 域

| 方法 | 路径 | handler | 入参类型 | 出参类型 | 错误码 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/providers` | `listProviders` | — | `{ providers: ProviderConfigEntry[], activeId: string }` | — |
| GET | `/api/providers/active` | `getActiveProvider` | — | `{ provider: ProviderConfigEntry }` | `PROVIDER_NOT_FOUND` |
| POST | `/api/providers` | `upsertProvider` | `ProviderUpsertSchema` | `{ provider: ProviderConfigEntry }` | `PROVIDER_DUPLICATE_ID`, `INVALID_JSON`, `VALIDATION_ERROR` |
| PUT | `/api/providers/:id` | `updateProvider` | `Partial<ProviderUpsertSchema>` | `{ provider: ProviderConfigEntry }` | `PROVIDER_NOT_FOUND`, `VALIDATION_ERROR` |
| POST | `/api/providers/:id/toggle` | `toggleProvider` | — | `{ enabled: boolean }` | `PROVIDER_NOT_FOUND` |
| DELETE | `/api/providers/:id` | `deleteProvider` | — | `{ ok: true }` | `PROVIDER_NOT_FOUND`, `PROVIDER_ACTIVE_NOT_DELETABLE` |
| PUT | `/api/providers/active` | `setActiveProvider` | `{ id: string }` | `{ ok: true }` | `PROVIDER_NOT_FOUND` |
| PATCH | `/api/providers/active/model` | `patchActiveModel` | `{ model: string }` | `{ provider: ProviderConfigEntry }` | `MODEL_NOT_FOUND` |

### 1.2 Session 域

| 方法 | 路径 | handler | 入参类型 | 出参类型 | 错误码 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/sessions` | `listSessions` | `ListSessionsQuerySchema` (query) | `{ sessions: SessionMeta[] }` | `VALIDATION_ERROR` |
| POST | `/api/sessions` | `createSession` | `{ kind?: SessionKind }` | `{ session: { id: string } }` | `VALIDATION_ERROR` |
| GET | `/api/sessions/:id/history` | `getHistory` | — | `{ messages: SerializedMessage[] }` | `SESSION_NOT_FOUND`, `SESSION_CORRUPT_FILE` |
| DELETE | `/api/sessions/:id` | `deleteSession` | — | `{ ok: true }` | `SESSION_NOT_FOUND` |
| POST | `/api/sessions/:cid/compact` | `compactSession` | `CompactRequestSchema` | `{ tokensBefore, tokensAfter, durationMs, summary? }` 或 `{ used, limit, ratio, willCompact: true }` | `CHAT_SESSION_BUSY`（429）, `INTERNAL` |

### 1.3 Chat 流

| 方法 | 路径 | handler | 入参类型 | 出参类型 | 错误码 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/sessions/:id/messages/stream` | `postMessageStream` | `{ text: string, systemPrompt?: string }` | **SSE** `text/event-stream`（每个事件含 `seq`） | `CHAT_SESSION_BUSY`（429）, `CHAT_RUNNER_ERROR` |
| POST | `/api/sessions/:id/messages/abort` | `abortMessage` | `{ streamId?: string }` | `{ ok: true }` | — |

### 1.4 Agent / Skill 域

| 方法 | 路径 | handler | 入参类型 | 出参类型 | 错误码 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/agents` | `listAgents` | — | `{ agents: AgentListItem[] }` | — |
| GET | `/api/agents/:id` | `getAgent` | — | `{ spec: AgentSpec }` | `AGENT_NOT_FOUND`, `AGENT_SPEC_INVALID_JSON` |
| GET | `/api/skills` | `listSkills` | — | `{ skills: SkillSpec[] }` | — |
| GET | `/api/skills/:id` | `getSkill` | — | `{ skill: { name, id, body } }` | `SKILL_NOT_FOUND` |

## 2. Zod Schema（server 端校验）

### 2.1 `validators/providers.ts`

```ts
import { z } from "zod";

export const ProviderUpsertSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, "id must be lowercase, start with letter, ≤32 chars"),
  name: z.string().min(1).max(64),
  type: z.literal("deepseek"),
  apiKey: z.string().max(256), // 允许空字符串（fallback env var）
  baseUrl: z.string().url().regex(/^https?:\/\//, "must start with http(s)://").refine(
    (s) => !s.endsWith("/"),
    "no trailing slash",
  ),
  defaultModel: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export const ProviderPatchSchema = ProviderUpsertSchema.partial();

export const PatchActiveModelSchema = z.object({
  model: z.string().min(1).max(64),
});
```

### 2.2 `validators/sessions.ts`

```ts
import { z } from "zod";

export const ListSessionsQuerySchema = z.object({
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const CreateSessionSchema = z.object({
  kind: z.enum(["gconv", "cli", "anon", "extract", "gworker"]).optional(),
});

export const CompactRequestSchema = z.object({
  confirm: z.boolean().optional(),
});

export const StreamMessageSchema = z.object({
  text: z.string().min(1).max(32_000),
  systemPrompt: z.string().max(8_000).optional(),
});
```

### 2.3 路径参数校验

```ts
import { assertPathSegment } from "../storage/paths.js";
// 所有 :id / :cid 在 handler 入口前必须 assertPathSegment(value, "id")（已存在 src/storage/paths.ts）
```

## 3. 统一响应壳（spec § 3.4.1）

```ts
// src/web/server/errors.ts
export type ApiErrorCode =
  // 通用
  | "INVALID_JSON"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL"
  // Provider
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DUPLICATE_ID"
  | "PROVIDER_INVALID_BASE_URL"
  | "PROVIDER_INVALID_TYPE"
  | "PROVIDER_API_KEY_EMPTY"
  | "PROVIDER_ACTIVE_NOT_DELETABLE"
  | "MODEL_NOT_FOUND"
  // Session
  | "SESSION_NOT_FOUND"
  | "SESSION_CORRUPT_FILE"
  // Chat
  | "CHAT_SESSION_BUSY"
  | "CHAT_ABORTED"
  | "CHAT_RUNNER_ERROR"
  | "CHAT_INVALID_EVENT"
  // Agent / Skill
  | "AGENT_NOT_FOUND"
  | "AGENT_SPEC_INVALID_JSON"
  | "SKILL_NOT_FOUND";

// HTTP status 映射
export const ERROR_STATUS_MAP: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PROVIDER_NOT_FOUND: 404,
  PROVIDER_DUPLICATE_ID: 409,
  PROVIDER_INVALID_BASE_URL: 422,
  PROVIDER_INVALID_TYPE: 422,
  PROVIDER_API_KEY_EMPTY: 422,
  PROVIDER_ACTIVE_NOT_DELETABLE: 409,
  MODEL_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  SESSION_CORRUPT_FILE: 500,
  CHAT_SESSION_BUSY: 429,
  CHAT_ABORTED: 200,           // abort 不算错误，是用户行为
  CHAT_RUNNER_ERROR: 500,
  CHAT_INVALID_EVENT: 500,
  AGENT_NOT_FOUND: 404,
  AGENT_SPEC_INVALID_JSON: 500,
  SKILL_NOT_FOUND: 404,
};

export class HttpError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: number = ERROR_STATUS_MAP[code],
    public readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? code);
  }

  toBody(requestId: string): ApiErrorBody {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiErrorBody = {
  ok: false;
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
};
```

**Middleware（必须串在所有 handler 前）：**

```ts
function errorMiddleware(handler: Handler): Handler {
  return async (req, res, params) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    try {
      await handler(req, res, params);
    } catch (err) {
      if (err instanceof HttpError) {
        res.statusCode = err.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(err.toBody(requestId)));
        return;
      }
      // 未知错误 → 500
      const body: ApiErrorBody = {
        ok: false,
        error: {
          code: "INTERNAL",
          message: err instanceof Error ? err.message : String(err),
          requestId,
        },
      };
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    }
  };
}

// payload 大小限制中间件（每个路由前）
const MAX_PAYLOAD_BYTES = 1_048_576; // 1 MiB
function limitPayload(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_BYTES) {
        reject(new HttpError("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
```

## 4. SSE 协议（spec § 6.1）

### 4.1 响应头

```
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
X-Stream-Id: <uuid>           ← 客户端 abort 通道
X-Request-Id: <uuid>
```

### 4.2 事件格式

```
event: <type>
id: <seq>          ← 递增整数，从 1 开始
data: <JSON 字符串>

```

> 每个事件占两行（一行 event / 一行 data）+ 一行 id + 一个空行 `\n\n`。
> `: ping <ts>` 注释行每 15s 一次（防代理超时），客户端忽略。

### 4.3 事件类型枚举（与 `AgentRunEvent` 对齐）

| event | data payload | 来源 |
| --- | --- | --- |
| `start` | `{ streamId: string, cid: string, seq: 0 }` | sse.ts 主动 |
| `text_delta` | `{ type: "text_delta", seq: N, text: string }` | runner |
| `tool_delta` | `{ type: "tool_delta", seq: N, name?: string, id: string, inputDelta: string }` | runner |
| `tool_start` | `{ type: "tool_start", seq: N, name: string, id: string, input: object }` | runner |
| `tool_progress` | `{ type: "tool_progress", seq: N, name, id, phase?, message, data? }` | runner |
| `tool_end` | `{ type: "tool_end", seq: N, name, id, result, isError?, errorCode?, durationMs? }` | runner |
| `compaction` | `{ type: "compaction", seq: N, tokensBefore, tokensAfter, summary?, usage?, durationMs? }` | runner（**当前实现不 yield**） |
| `context_status` | `{ type: "context_status", seq: N, phase, message, data? }` | runner（**当前实现不 yield**） |
| `retry` | `{ type: "retry", seq: N, attempt, reason, waitMs? }` | runner（**当前实现不 yield**） |
| `provider_fallback` | `{ type: "provider_fallback", seq: N, reason: "auth", providerId }` | runner（**当前实现不 yield**） |
| `done` | `{ ok: true, seq: N+1 }` | sse.ts（runner 终止后补） |
| `error` | `{ ok: false, seq: N+1, error: { code: "CHAT_RUNNER_ERROR", message } }` | sse.ts（catch 块） |

**客户端去重：** 解析 `id:` 行，≤ `seenMaxSeq` 则跳过。

### 4.4 SSE 写实现（sse.ts）

```ts
// src/web/server/sse.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentRunner } from "../../agent/runner.js";
import type { AgentRunParams, AgentRunEvent } from "../../agent/types.js";

export const _liveStreams = new Map<string, { controller: AbortController; cid: string }>();

export function abortStream(streamId: string): boolean {
  const entry = _liveStreams.get(streamId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

export function listLiveStreamsForCid(cid: string): string[] {
  return [..._liveStreams.entries()]
    .filter(([, { cid: c }]) => c === cid)
    .map(([id]) => id);
}

export async function streamAgentRun(
  res: ServerResponse,
  runner: AgentRunner,
  input: { message: string; systemPrompt?: string; cid: string; model?: string },
): Promise<void> {
  const streamId = randomUUID();
  res.setHeader("X-Stream-Id", streamId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let seq = 0;
  let clientGone = false;
  const controller = new AbortController();
  _liveStreams.set(streamId, { controller, cid: input.cid });

  const heartbeat = setInterval(() => {
    if (clientGone) return;
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch { clientGone = true; clearInterval(heartbeat); }
  }, 15_000);

  res.on("close", () => {
    clientGone = true;
    clearInterval(heartbeat);
    _liveStreams.delete(streamId);
  });

  try {
    res.write(`event: start\nid: 0\ndata: ${JSON.stringify({ streamId, cid: input.cid, seq: 0 })}\n\n`);

    const params: AgentRunParams = {
      message: input.message,
      systemPrompt: input.systemPrompt,
      model: input.model,
      signal: controller.signal,
    };

    for await (const ev of runner.runStream(params)) {
      if (clientGone) break;
      const wrapped = { seq: ++seq, ...ev };
      res.write(`event: ${ev.type}\nid: ${seq}\ndata: ${JSON.stringify(wrapped)}\n\n`);
      // flush 防 Node buffer
      const sock = (res as any).socket;
      if (sock && typeof sock.flush === "function") sock.flush();
      else if (typeof (res as any).flush === "function") (res as any).flush();
    }

    if (!clientGone) {
      res.write(`event: done\nid: ${++seq}\ndata: ${JSON.stringify({ ok: true, seq })}\n\n`);
    }
  } catch (err) {
    if (!clientGone) {
      const errBody = {
        seq: ++seq,
        ok: false,
        error: {
          code: "CHAT_RUNNER_ERROR" as const,
          message: err instanceof Error ? err.message : String(err),
        },
      };
      res.write(`event: error\nid: ${seq}\ndata: ${JSON.stringify(errBody)}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    _liveStreams.delete(streamId);
    try { res.end(); } catch { /* ignore */ }
  }
}
```

### 4.5 in-flight 并发保护

```ts
// 在 postMessageStream handler 中：
const liveIds = listLiveStreamsForCid(cid);
if (liveIds.length > 0) {
  throw new HttpError("CHAT_SESSION_BUSY", 429, {
    retryAfterMs: 1000, // 估算下次可用时间
  });
}
```

## 5. 共享 DTO（与 `src/agent/types.ts` 等已存在类型对齐）

```ts
// 从 src/storage/providers-store.ts 复用
import type { ProviderConfigEntry } from "../../storage/providers-store.js";

// 从 src/storage/session-store.ts 复用
import type { SessionKind } from "../../storage/session-store.js";

// 从 src/agent/session-serde.ts 复用
import type { SerializedMessage } from "../../agent/session-serde.js";

// 从 src/skills/loader.ts 复用
import type { SkillSpec } from "../../skills/loader.js";

// 从 src/agent/types.ts 复用（来自 spec § 7.1 B4 + B8）
export type AgentListItem = {
  id: string;
  source: "builtin" | "user";
  name: string;
  description_zh?: string;
  description_en?: string;
  skill_list?: string[];
};

export type AgentSpec = {
  id: string;
  name: string;
  description?: string;
  workflow?: string;       // 前 3 行摘要
  skill_list?: string[];
  source: "builtin" | "user";
  // ... 与 fixtures/orchestration/agents/ 一致
};

export type SessionMeta = {
  id: string;
  name: string;
  messageCount: number;
  lastTs: number;
  archived: boolean;
};

// B8 新增
export type CompactEstimate = {
  used: number;
  limit: number;
  ratio: number;
};

export type CompactResult = {
  tokensBefore: number;
  tokensAfter: number;
  durationMs: number;
  summary?: string;
};

// AgentRunner.compactNow 返回类型
export type CompactNowResult = CompactResult;
```

## 6. B8 — AgentRunner API 扩展

### 6.1 `AgentRunner.compactNow`

```ts
// src/agent/runner.ts 公开方法
class AgentRunner {
  /**
   * 手动触发上下文压缩。
   *
   * @param cid - session id（一个 runner 实例对应一个 session；目前只支持 self.session.sessionId）
   * @param opts.signal - AbortSignal 用于中止压缩
   * @returns tokensBefore/tokensAfter/durationMs/summary
   *
   * 同 cid 上有 in-flight 流时抛 `AlreadyCompactingError`。
   */
  async compactNow(
    cid: string,
    opts?: { signal?: AbortSignal },
  ): Promise<CompactNowResult> {
    // 实现要点：
    // 1. 检查 cid === this.session.sessionId（单会话 runner）
    // 2. 检查 cid 上无 in-flight 流（共享 _liveStreams 状态）
    // 3. 复用 prepareContextBeforeModelCall 的 compactContextInternal 逻辑
    // 4. 写 ctx 文件
    // 5. 返回 token 用量
  }
}

// 新增自定义错误
export class AlreadyCompactingError extends Error {
  constructor(public readonly cid: string) {
    super(`cid "${cid}" already has an in-flight compaction`);
    this.name = "AlreadyCompactingError";
  }
}
```

### 6.2 `Session.getTokenEstimate` + `PersistentSession` override

```ts
// src/agent/session.ts
class Session {
  /**
   * 估算当前上下文 token 用量。
   *
   * 内部用 `tokenizer.encode(getAllMessages())`（基于当前模型 registry 的 tokenizer）。
   */
  getTokenEstimate(): { used: number; limit: number; ratio: number } {
    // used = tokenizer.encode(getAllMessages()).length
    // limit = registry.getModel(model).contextWindow
    // ratio = used / limit
  }
}

// src/agent/persistent-session.ts
class PersistentSession extends Session {
  override getTokenEstimate() {
    // 复用父类；如需考虑 historyResources + completedTurns 可扩展
  }
}
```

### 6.3 cid-mutex（防 R-22 竞态）

```ts
// src/web/server/compact-mutex.ts
import { Mutex } from "async-mutex";

const compactMutexes = new Map<string, Mutex>();

export function withCompactLock<T>(cid: string, fn: () => Promise<T>): Promise<T> {
  let m = compactMutexes.get(cid);
  if (!m) {
    m = new Mutex();
    compactMutexes.set(cid, m);
  }
  return m.runExclusive(fn);
}
```

## 7. CSP 头（B1 落地）

```ts
// 在 src/web/server/index.ts 的 middleware 里
const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // 'unsafe-inline' 用于 style 属性（DOMPurify 等内联样式）
  "font-src https://fonts.gstatic.com data:",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

res.setHeader("Content-Security-Policy", CSP_HEADER);
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("X-Frame-Options", "DENY");
res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
```

**注意：** F0 主题切换**不**破 CSP（仅改 `<html data-theme>` + CSS 变量，不引入 inline style）。`'unsafe-inline'` 仅留给 DOMPurify 的 inline style 输出。

## 8. 静态文件服务

```ts
// src/web/server/index.ts — tryServeStatic
function tryServeStatic(req: IncomingMessage, res: ServerResponse): boolean {
  // 路径：/Users/mima0000/Documents/学习-001/do-project/my-agent/web/
  const webRoot = path.resolve(process.cwd(), "web");
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  // 路径防御（拒绝 ../ / 绝对路径）
  const resolved = path.resolve(webRoot, "." + pathname);
  if (!resolved.startsWith(webRoot)) return false;

  // 只允许白名单扩展
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) return false;

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return false;

  const mime = MIME[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", `${mime}; charset=utf-8`);
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(resolved).pipe(res);
  return true;
}

const ALLOWED_EXTS = new Set([".html", ".css", ".js", ".svg", ".ico", ".json", ".woff2", ".map"]);
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};
```

## 9. 路由分发（极简）

```ts
// src/web/server/index.ts
type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> | void;

const ROUTES: Array<[string, RegExp | string, Handler, string[]]> = [
  // Provider
  ["GET",    "/api/providers",                 (req, res) => listProviders(req, res), []],
  ["GET",    "/api/providers/active",          (req, res) => getActiveProvider(req, res), []],
  ["POST",   "/api/providers",                 (req, res, p) => upsertProvider(req, res), []],
  ["PUT",    /^\/api\/providers\/([^/]+)$/,    (req, res, p) => updateProvider(req, res, p), ["id"]],
  ["POST",   /^\/api\/providers\/([^/]+)\/toggle$/, (req, res, p) => toggleProvider(req, res, p), ["id"]],
  ["DELETE", /^\/api\/providers\/([^/]+)$/,    (req, res, p) => deleteProvider(req, res, p), ["id"]],
  ["PUT",    "/api/providers/active",          (req, res) => setActiveProvider(req, res), []],
  ["PATCH",  "/api/providers/active/model",    (req, res) => patchActiveModel(req, res), []],
  // Session
  ["GET",    "/api/sessions",                  (req, res) => listSessions(req, res), []],
  ["POST",   "/api/sessions",                  (req, res) => createSession(req, res), []],
  ["GET",    /^\/api\/sessions\/([^/]+)\/history$/, (req, res, p) => getHistory(req, res, p), ["id"]],
  ["DELETE", /^\/api\/providers\/([^/]+)$/,    (req, res, p) => deleteSession(req, res, p), ["id"]],
  ["POST",   /^\/api\/sessions\/([^/]+)\/compact$/, (req, res, p) => compactSession(req, res, p), ["cid"]],
  // Chat
  ["POST",   /^\/api\/sessions\/([^/]+)\/messages\/stream$/, (req, res, p) => postMessageStream(req, res, p), ["id"]],
  ["POST",   /^\/api\/sessions\/([^/]+)\/messages\/abort$/,  (req, res, p) => abortMessage(req, res, p), ["id"]],
  // Agent / Skill
  ["GET",    "/api/agents",                    (req, res) => listAgents(req, res), []],
  ["GET",    /^\/api\/agents\/([^/]+)$/,       (req, res, p) => getAgent(req, res, p), ["id"]],
  ["GET",    "/api/skills",                    (req, res) => listSkills(req, res), []],
  ["GET",    /^\/api\/skills\/([^/]+)$/,       (req, res, p) => getSkill(req, res, p), ["id"]],
];

function matchRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string>; names: string[] } | null {
  for (const [m, pattern, handler, names] of ROUTES) {
    if (m !== method) continue;
    if (typeof pattern === "string") {
      if (pattern === pathname) return { handler, params: {}, names };
      continue;
    }
    const match = pathname.match(pattern);
    if (match) {
      const params: Record<string, string> = {};
      names.forEach((name, i) => { params[name] = match[i + 1]; });
      return { handler, params, names };
    }
  }
  return null;
}
```

## 10. 静态字段（spec § 3.3 — 前端 localStorage）

| Key | 用途 | 默认值 |
| --- | --- | --- |
| `my-agent.lastView` | `{ view: string, cid?: string }` | `{ view: "main-menu" }` |
| `my-agent.apiBase` | `http://localhost:5173` | 同 |
| `my-agent.theme` | `dark` / `light` / `system` | `system` |
| `my-agent.sidebarWidth` | number | `260` |

> 主题 key 由 F0 `web/js/shared/theme.js` 启动时读；F18 `/theme` 命令通过 `CustomEvent('my-agent-theme-change')` 通知 F0 重设。

## 11. References

- spec § 3（数据设计）/ § 3.4（API 契约）/ § 6.1（SSE 协议）
- plan § 6（WU 拆解 Done criteria）
- [src/agent/types.ts:584-807](src/agent/types.ts#L584) AgentRunEvent 完整定义
- [src/storage/providers-store.ts](src/storage/providers-store.ts) ProviderConfigEntry
- [src/storage/session-store.ts:33](src/storage/session-store.ts#L33) SessionKind 枚举
- [src/storage/paths.ts](src/storage/paths.ts) assertPathSegment
- [src/agent/persistent-session.ts](src/agent/persistent-session.ts) getDisplayName / Session 父类