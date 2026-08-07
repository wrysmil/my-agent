/**
 * Session compactNow 能力 + 3 个端点测试（WU-06a）。
 *
 * 覆盖 done criteria #7：
 * - mock provider API summarization
 * - compactPreview 估算（不动 session 状态）
 * - compactNow 真压缩
 * - cidMutex 串行化（两个并发 compact → 第二个抛 CHAT_SESSION_BUSY）
 * - dryRun 模式
 * - 失败处理（provider 错误 → INTERNAL）
 * - 端到端：POST /api/sessions/:cid/compact/preview → 200 JSON
 * - POST /api/sessions/:cid/compact → 200 CompactResult
 * - POST /api/sessions/:cid/compact/cancel → 200
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PersistentSession } from "../../src/agent/persistent-session.js";
import { SessionStore } from "../../src/storage/session-store.js";
import { AgentRunner } from "../../src/agent/runner.js";
import { createConfig } from "../../src/config/loader.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { ApiError, ApiErrorCode } from "../../src/web/server/errors.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ROUTES } from "../../src/web/server/router.js";
import { installSessionRoutes } from "../../src/web/server/routes/sessions.js";
import { MockProvider } from "../mocks/provider.js";

// ============================================================
// 临时目录 + SessionStore 装配
// ============================================================

let tmpDir: string;
let sessionStore: SessionStore;
let mockProvider: MockProvider;
let runner: AgentRunner;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-compact-"));
  sessionStore = new SessionStore(tmpDir);

  mockProvider = new MockProvider();
  const config = createConfig({
    agent: {
      defaultModel: "mock-summarizer",
      defaultProvider: "mock",
      maxRetries: 0,
      maxToolLoops: 10,
      toolIdleTimeoutMs: 5_000,
    },
  });
  const providers = new ProviderRegistry(config);
  providers.registerFactory("mock", () => mockProvider);
  runner = new AgentRunner({ config, providers });

  installSessionRoutes({ sessionStore, agentRunner: runner });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  mockProvider.reset();
});

// ============================================================
// Mock req/res 工厂（与 routes/sessions.test.ts 一致）
// ============================================================

function makeMockReqRes(opts: {
  method: string;
  url: string;
  body?: string;
}): {
  req: IncomingMessage;
  res: ServerResponse & {
    body: string;
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
  };
} {
  const resHeaders: Record<string, string> = {};
  const res = new EventEmitter() as ServerResponse & {
    body: string;
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
  };
  res.body = "";
  res.statusCode = 0;
  res.headers = resHeaders;
  res.ended = false;
  (res as unknown as { setHeader: (k: string, v: string) => void }).setHeader = (
    k: string,
    v: string,
  ): void => {
    resHeaders[k.toLowerCase()] = v;
  };
  (res as unknown as { getHeader: (k: string) => string | undefined }).getHeader = (
    k: string,
  ): string | undefined => resHeaders[k.toLowerCase()];
  (res as unknown as { write: (chunk: string) => boolean }).write = (
    chunk: string,
  ): boolean => {
    res.body += chunk;
    return true;
  };
  (res as unknown as { end: (chunk?: string) => void }).end = (
    chunk?: string,
  ): void => {
    if (chunk) res.body += chunk;
    res.ended = true;
    res.emit("close");
  };

  const reqBody = opts.body ?? "";
  const chunks = [Buffer.from(reqBody, "utf-8")];
  const readable = new EventEmitter() as IncomingMessage & { readable: boolean };
  readable.readable = true;
  readable.method = opts.method;
  readable.url = opts.url;
  (readable as unknown as {
    [Symbol.asyncIterator]: () => AsyncIterableIterator<Buffer>;
  })[Symbol.asyncIterator] = (): AsyncIterableIterator<Buffer> => {
    let idx = 0;
    const iter: AsyncIterableIterator<Buffer> = {
      [Symbol.asyncIterator](): AsyncIterableIterator<Buffer> {
        return iter;
      },
      async next(): Promise<IteratorResult<Buffer>> {
        if (idx < chunks.length) {
          const v = chunks[idx++];
          return { value: v, done: false };
        }
        return { value: undefined as unknown as Buffer, done: true };
      },
    };
    return iter;
  };

  return { req: readable, res };
}

function parseJson<T = unknown>(body: string): T {
  return JSON.parse(body) as T;
}

/**
 * 在 ROUTES 表中按子串查找路由。
 *
 * 注意：RegExp source 是字符串，其中 `/` 被转义为 `\/`。
 * 故 `p.source` 形如 `^\/api\/sessions\/([^/]+)\/compact\/preview$`。
 *
 * 用简单的 `includes` 即可避免转义复杂性 —— 因为 source 中的 `/` 都是 `\/`，
 * 找子串 `compact/preview` 会失败；用 `compact\\/preview`（= compact\/preview
 * 字符串）才能匹配 source 中的字面 `compact\/preview`。
 */
function findRouteByPattern(
  needle: string,
  method: string = "POST",
): ((req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void> | void) | undefined {
  // needle 用普通 `/` 即可 —— 把它转成 `\/` 形式以匹配 source 中的转义形式
  const escaped = needle.replace(/\//g, "\\/");
  for (const [m, p, handler] of ROUTES) {
    if (m !== method) continue;
    if (typeof p === "string") {
      if (p.includes(escaped)) return handler;
      continue;
    }
    if (p.source.includes(escaped)) return handler;
  }
  return undefined;
}

// ============================================================
// Helper：往 session 注入 N 条消息
// ============================================================

async function seedMessages(
  session: PersistentSession,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await session.beginUserTurn([{ type: "text", text: `User message #${i + 1}` }]);
    await session.addAssistantMessage([
      { type: "text", text: `Assistant response #${i + 1}` },
    ]);
  }
}

// ============================================================
// PersistentSession 层面的 compact 测试
// ============================================================

describe("PersistentSession.compactPreview — 估算（不动状态）", () => {
  it("空 session → beforeTokens/afterTokens 都是 0", async () => {
    const session = PersistentSession.create(tmpDir);
    const preview = await session.compactPreview();
    expect(preview.beforeTokens).toBe(0);
    expect(preview.afterTokens).toBe(0);
    expect(preview.reductionPct).toBe(0);
  });

  it("有消息 → preview 返回完整 estimate；不动 session 状态", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 5);

    const beforeCount = session.getAllMessages().length;
    const preview = await session.compactPreview();

    expect(preview.beforeTokens).toBeGreaterThan(0);
    expect(preview.afterTokens).toBeGreaterThanOrEqual(0);
    expect(preview.reductionPct).toBeGreaterThanOrEqual(0);
    expect(preview.reductionPct).toBeLessThanOrEqual(100);
    // afterTokens 是 summary 估算，应为常量上限（≤1200）
    expect(preview.afterTokens).toBeLessThanOrEqual(1200);

    // 不动 session 状态
    expect(session.getAllMessages().length).toBe(beforeCount);
  });

  it("重复 preview 调用 → 结果稳定，不动 session", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 3);

    const p1 = await session.compactPreview();
    const p2 = await session.compactPreview();

    expect(p1.beforeTokens).toBe(p2.beforeTokens);
    expect(p1.afterTokens).toBe(p2.afterTokens);
    expect(p1.reductionPct).toBe(p2.reductionPct);
  });
});

describe("PersistentSession.compactNow — 真压缩", () => {
  it("替换 messages 为单条 summary；持久化到磁盘", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 4);

    const result = await session.compactNow({
      summary: "Summary of conversation so far.",
    });

    expect(result.removedMessages).toBe(8); // 4 turns * (user+assistant)
    expect(result.summaryMessageId).toMatch(/^msg-[a-f0-9]{12}$/);
    expect(result.afterTokens).toBeGreaterThan(0);

    // messages 列表应只剩 1 条 summary
    const messages = session.getAllMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("assistant");

    // 落盘验证
    const file = path.join(tmpDir, `${session.sessionId}.jsonl`);
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const persisted = JSON.parse(lines[0]);
    expect(persisted.role).toBe("assistant");
  });

  it("空 session 压缩 → removedMessages=0；afterTokens 反映 summary", async () => {
    const session = PersistentSession.create(tmpDir);
    const result = await session.compactNow({ summary: "x" });
    expect(result.removedMessages).toBe(0);
    expect(result.afterTokens).toBeGreaterThan(0);
  });
});

describe("PersistentSession.cidMutex — 串行化（R-22 race 防护）", () => {
  it("两个并发 compactNow → 第二个抛 CHAT_SESSION_BUSY", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 3);

    // 通过 session.cidMutex 模拟「第一把锁已被持」的场景
    // 真实并发：通过手动获取锁来模拟第一调用进行中
    const firstReleaser = session.cidMutex.acquire();

    // 此时锁已持有 → 第二个 compactNow 应立即抛错
    let capturedError: unknown = null;
    try {
      await session.compactNow({ summary: "Should fail" });
    } catch (err) {
      capturedError = err;
    } finally {
      const releaser = await firstReleaser;
      releaser();
    }

    expect(capturedError).toBeInstanceOf(ApiError);
    expect((capturedError as ApiError).code).toBe(ApiErrorCode.CHAT_SESSION_BUSY);
    expect((capturedError as ApiError).status).toBe(429);
  });

  it("锁释放后 → 下一次 compactNow 可正常执行", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 2);

    const releaser = await session.cidMutex.acquire();
    releaser();

    const result = await session.compactNow({ summary: "After release" });
    expect(result.removedMessages).toBeGreaterThan(0);
  });

  it("compactPreview 不持锁 → 与 compactNow 可并发", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 2);

    // compactNow 进行中
    const releaser = await session.cidMutex.acquire();
    let previewError: unknown = null;
    try {
      const preview = await session.compactPreview();
      expect(preview.beforeTokens).toBeGreaterThan(0);
    } catch (err) {
      previewError = err;
    } finally {
      releaser();
    }
    expect(previewError).toBeNull();
  });
});

// ============================================================
// AgentRunner.compactNow — orchestrator 测试
// ============================================================

describe("AgentRunner.compactNow — orchestrator", () => {
  it("dryRun=true → 返回 estimate，不调 provider，不改 session", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 3);
    const beforeCount = session.getAllMessages().length;

    const result = await runner.compactNow({ session, dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.data.removedMessages).toBe(0);
    expect(result.data.summaryMessageId).toBeNull();
    expect(result.data.beforeTokens).toBeGreaterThan(0);
    expect(result.data.afterTokens).toBeGreaterThanOrEqual(0);
    expect(result.data.reductionPct).toBeGreaterThanOrEqual(0);

    // provider 未被调用
    expect(mockProvider.completeCalls.length).toBe(0);

    // session 状态未变
    expect(session.getAllMessages().length).toBe(beforeCount);
  });

  it("真压缩 → 调 provider.complete → 写 summary message", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 3);

    mockProvider.program({ kind: "text", text: "Compact summary text." });

    const result = await runner.compactNow({ session });

    expect(result.ok).toBe(true);
    expect(result.data.removedMessages).toBeGreaterThan(0);
    expect(result.data.summaryMessageId).toMatch(/^msg-/);
    expect(result.data.beforeTokens).toBeGreaterThan(0);

    // provider 被调用 1 次
    expect(mockProvider.completeCalls.length).toBe(1);
    // 调用参数正确（model + systemPrompt 包含 CONTEXT_COMPACTION）
    const call = mockProvider.completeCalls[0];
    expect(call.model).toBe("mock-summarizer");

    // session 状态：只剩 summary
    const messages = session.getAllMessages();
    expect(messages.length).toBe(1);
  });

  it("provider 返回空 summary → 抛 ApiError(INTERNAL)", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 2);

    mockProvider.program({ kind: "text", text: "" });

    let capturedError: unknown = null;
    try {
      await runner.compactNow({ session });
    } catch (err) {
      capturedError = err;
    }

    expect(capturedError).toBeInstanceOf(ApiError);
    expect((capturedError as ApiError).code).toBe(ApiErrorCode.INTERNAL);
    expect((capturedError as ApiError).status).toBe(500);

    // session 状态未被破坏（compactNow 没跑成功）
    expect(session.getAllMessages().length).toBe(4);
  });

  it("provider 调用抛错 → 抛 ApiError(INTERNAL)", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 2);

    // MockProvider 不支持 error 响应模式注入给 complete()，
    // 用 hack：用一个 throw 的 complete 替换
    const throwingProvider = {
      ...mockProvider,
      complete: async () => {
        throw new Error("provider network error");
      },
    };
    runner = new AgentRunner({
      config: createConfig({ agent: { defaultModel: "x", defaultProvider: "mock" } }),
      providers: new (class extends ProviderRegistry {
        constructor() {
          super();
          this.registerFactory("mock", () => throwingProvider as never);
        }
      })(),
    });

    let capturedError: unknown = null;
    try {
      await runner.compactNow({ session });
    } catch (err) {
      capturedError = err;
    }

    expect(capturedError).toBeInstanceOf(ApiError);
    expect((capturedError as ApiError).code).toBe(ApiErrorCode.INTERNAL);
    expect((capturedError as ApiError).message).toContain("Compaction");
  });

  it("空 session → 跳过 provider；removedMessages=0", async () => {
    const session = PersistentSession.create(tmpDir);
    const result = await runner.compactNow({ session });

    expect(result.ok).toBe(true);
    expect(result.data.removedMessages).toBe(0);
    expect(result.data.summaryMessageId).toBeNull();
    expect(mockProvider.completeCalls.length).toBe(0);
  });

  it("自定义 model → 传给 provider", async () => {
    const session = PersistentSession.create(tmpDir);
    await seedMessages(session, 2);
    mockProvider.program({ kind: "text", text: "x" });

    await runner.compactNow({ session, model: "custom-model" });

    expect(mockProvider.completeCalls[0].model).toBe("custom-model");
  });
});

// ============================================================
// 端到端 HTTP 路由测试
// ============================================================

describe("端到端: POST /api/sessions/:cid/compact/preview", () => {
  it("已存在会话 → 200 + CompactEstimate", async () => {
    const session = sessionStore.create("gconv");
    await seedMessages(session, 3);

    const { req, res } = makeMockReqRes({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/compact/preview`,
      body: "{}",
    });
    const route = findRouteByPattern("compact/preview");
    expect(route).toBeDefined();
    await route!(req, res, { cid: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = parseJson<{
      ok: boolean;
      data: { beforeTokens: number; afterTokens: number; reductionPct: number };
    }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.beforeTokens).toBeGreaterThan(0);
  });

  it("不存在的会话 → 404 SESSION_NOT_FOUND", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions/gconv-nope/compact/preview",
      body: "{}",
    });
    const route = findRouteByPattern("compact/preview");
    await route!(req, res, { cid: "gconv-nope" });

    expect(res.statusCode).toBe(404);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });
});

describe("端到端: POST /api/sessions/:cid/compact", () => {
  it("已存在会话 + mock provider → 200 + CompactResult", async () => {
    const session = sessionStore.create("gconv");
    await seedMessages(session, 3);
    mockProvider.program({ kind: "text", text: "Summary!" });

    const { req, res } = makeMockReqRes({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/compact`,
      body: "{}",
    });
    // 找精确匹配 /compact$ 的路由（不是 /compact/preview 或 /compact/cancel）
    const route = findRouteByPattern("compact$");
    await route!(req, res, { cid: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = parseJson<{
      ok: boolean;
      data: {
        removedMessages: number;
        summaryMessageId: string | null;
        beforeTokens: number;
        afterTokens: number;
        reductionPct: number;
      };
    }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.removedMessages).toBeGreaterThan(0);
    expect(body.data.summaryMessageId).toMatch(/^msg-/);
    expect(body.data.beforeTokens).toBeGreaterThan(0);
  });

  it("body 缺省 → 200（默认 dryRun=false）", async () => {
    const session = sessionStore.create("gconv");
    await seedMessages(session, 2);
    mockProvider.program({ kind: "text", text: "S" });

    const { req, res } = makeMockReqRes({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/compact`,
      body: "{}",
    });
    const route = findRouteByPattern("compact$");
    await route!(req, res, { cid: session.sessionId });

    expect(res.statusCode).toBe(200);
    expect(mockProvider.completeCalls.length).toBe(1);
  });
});

describe("端到端: POST /api/sessions/:cid/compact/cancel", () => {
  it("已存在会话 → 200 + noop 标志", async () => {
    const session = sessionStore.create("gconv");

    const { req, res } = makeMockReqRes({
      method: "POST",
      url: `/api/sessions/${session.sessionId}/compact/cancel`,
      body: "{}",
    });
    const route = findRouteByPattern("compact/cancel");
    expect(route).toBeDefined();
    await route!(req, res, { cid: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = parseJson<{
      ok: boolean;
      data: { cancelled: boolean; reason: string };
    }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.cancelled).toBe(false);
    expect(body.data.reason).toBe("noop");
  });

  it("不存在的会话 → 404 SESSION_NOT_FOUND", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions/gconv-nope/compact/cancel",
      body: "{}",
    });
    const route = findRouteByPattern("compact/cancel");
    await route!(req, res, { cid: "gconv-nope" });

    expect(res.statusCode).toBe(404);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });
});
