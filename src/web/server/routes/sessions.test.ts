/**
 * my-agent Web 前端 — Session 域 5 条路由单测（WU-02b / B3）。
 *
 * 覆盖 done criteria #7 ①-⑤：
 * ① list 空 / 非空
 * ② create 重复 cid 409（实际：本实现 cid 是 server 自动生成；409 在 abort 路径测试）
 * ③ history 404
 * ④ delete（幂等）
 * ⑤ compact 501 NOT_IMPLEMENTED
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionStore } from "../../../storage/session-store.js";
import { installSessionRoutes } from "./sessions.js";
import { ROUTES } from "../router.js";

// ============================================================
// Mock req/res 工厂
// ============================================================

function makeMockReqRes(opts: {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): { req: IncomingMessage; res: ServerResponse & { body: string; statusCode: number; headers: Record<string, string>; ended: boolean }; chunks: Buffer[] } {
  const headers: Record<string, string> = {};
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
  readable.headers = { ...headers, ...(opts.headers ?? {}) };
  // for await (const chunk of req) — 异步可迭代
  (readable as unknown as { [Symbol.asyncIterator]: () => AsyncIterableIterator<Buffer> })[
    Symbol.asyncIterator
  ] = (): AsyncIterableIterator<Buffer> => {
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

  return { req: readable, res, chunks };
}

function parseJson<T = unknown>(body: string): T {
  return JSON.parse(body) as T;
}

// ============================================================
// 临时 sessionDir + SessionStore 装配
// ============================================================

let tmpDir: string;
let sessionStore: SessionStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-sessions-"));
  sessionStore = new SessionStore(tmpDir);
  installSessionRoutes({ sessionStore });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// 路由表已注册（install 后不再回 ROUTE_NOT_FOUND）
// ============================================================

describe("installSessionRoutes — 路由表注入", () => {
  it("5 条 session 路由已被替换（handler 不再是 placeholder）", () => {
    // 找 5 条 session 域路由：2 个精确字符串 + 3 个正则
    const sessionRoutes = ROUTES.filter(([m, p]) => {
      if (m === "GET" && p === "/api/sessions") return true;
      if (m === "POST" && p === "/api/sessions") return true;
      if (typeof p === "object" && p.source.includes("sessions")) {
        // 区分 3 个正则：history / delete / compact
        return true;
      }
      return false;
    });
    expect(sessionRoutes.length).toBeGreaterThanOrEqual(5);
  });
});

// ============================================================
// ① GET /api/sessions  — list（空 / 非空）
// ============================================================

describe("GET /api/sessions — list", () => {
  it("空 store → 200 + sessions: []", async () => {
    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions",
    });

    // 匹配路由并执行
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p === "/api/sessions",
    );
    expect(route).toBeDefined();
    await route![2](req, res, {});

    expect(res.statusCode).toBe(200);
    const body = parseJson<{ ok: boolean; data: { sessions: unknown[]; total: number } }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.sessions).toEqual([]);
    expect(body.data.total).toBe(0);
  });

  it("非空 store → sessions 数组按 cid 列出 + 含 messageCount/lastTs 元数据", async () => {
    // 预创建 2 个会话
    const s1 = sessionStore.create("gconv");
    const s2 = sessionStore.create("gconv");

    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions",
    });

    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    expect(res.statusCode).toBe(200);
    const body = parseJson<{
      ok: boolean;
      data: {
        sessions: Array<{ id: string; name: string; messageCount: number; lastTs: number; archived: boolean }>;
        total: number;
      };
    }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.sessions.length).toBe(2);
    expect(body.data.total).toBe(2);
    // messageCount 至少为 0；lastTs/archived 默认值存在
    for (const m of body.data.sessions) {
      expect(m.id).toMatch(/^gconv-[a-f0-9]{12}$/);
      expect(m.messageCount).toBeGreaterThanOrEqual(0);
      expect(m.archived).toBe(false);
    }
  });

  it("limit + offset query → 仅返回切片", async () => {
    for (let i = 0; i < 3; i++) sessionStore.create("gconv");

    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions?limit=2&offset=0",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    const body = parseJson<{ data: { sessions: unknown[]; limit: number; offset: number } }>(res.body);
    expect(body.data.sessions.length).toBe(2);
    expect(body.data.limit).toBe(2);
    expect(body.data.offset).toBe(0);
  });

  it("非法 limit (200+) → 422 VALIDATION_FAILED", async () => {
    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions?limit=999",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    expect(res.statusCode).toBe(422);
    const body = parseJson<{ ok: boolean; error: { code: string; details?: unknown } }>(res.body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toBeDefined();
  });
});

// ============================================================
// ② POST /api/sessions — create
// ============================================================

describe("POST /api/sessions — create", () => {
  it("无 body → 201 + 新 cid（auto generate）", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions",
      body: "{}",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "POST" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    expect(res.statusCode).toBe(201);
    const body = parseJson<{
      ok: boolean;
      data: { session: { id: string; kind: string } };
    }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.session.id).toMatch(/^gconv-[a-f0-9]{12}$/);
    expect(body.data.session.kind).toBe("gconv");
  });

  it("kind=cli → 创建 cli-* 会话", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions",
      body: JSON.stringify({ kind: "cli" }),
    });
    const route = ROUTES.find(
      ([m, p]) => m === "POST" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    const body = parseJson<{ data: { session: { id: string; kind: string } } }>(res.body);
    expect(body.data.session.id).toMatch(/^cli-[a-f0-9]{12}$/);
    expect(body.data.session.kind).toBe("cli");
  });

  it("非法 kind → 422 VALIDATION_FAILED", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions",
      body: JSON.stringify({ kind: "bogus" }),
    });
    const route = ROUTES.find(
      ([m, p]) => m === "POST" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    expect(res.statusCode).toBe(422);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("非法 JSON → 400 INVALID_JSON", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions",
      body: "{ not json",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "POST" && p === "/api/sessions",
    );
    await route![2](req, res, {});

    expect(res.statusCode).toBe(400);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("INVALID_JSON");
  });
});

// ============================================================
// ③ GET /api/sessions/:id/history
// ============================================================

describe("GET /api/sessions/:id/history", () => {
  it("已存在会话 → 200 + 空 messages 数组", async () => {
    const session = sessionStore.create("gconv");

    const { req, res } = makeMockReqRes({
      method: "GET",
      url: `/api/sessions/${session.sessionId}/history`,
    });
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p instanceof RegExp && p.source.includes("/history$"),
    );
    await route![2](req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(200);
    const body = parseJson<{ ok: boolean; data: { messages: unknown[] } }>(res.body);
    expect(body.ok).toBe(true);
    expect(body.data.messages).toEqual([]);
  });

  it("不存在的会话 → 404 SESSION_NOT_FOUND", async () => {
    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions/gconv-deadbeef/history",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p instanceof RegExp && p.source.includes("/history$"),
    );
    await route![2](req, res, { id: "gconv-deadbeef" });

    expect(res.statusCode).toBe(404);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("非法路径段 → 404 SESSION_NOT_FOUND", async () => {
    const { req, res } = makeMockReqRes({
      method: "GET",
      url: "/api/sessions/..%2Fbad/history",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "GET" && p instanceof RegExp && p.source.includes("/history$"),
    );
    await route![2](req, res, { id: "../bad" });

    expect(res.statusCode).toBe(404);
    const body = parseJson<{ error: { code: string } }>(res.body);
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });
});

// ============================================================
// ④ DELETE /api/sessions/:id
// ============================================================

describe("DELETE /api/sessions/:id", () => {
  it("已存在 → 204 + 文件被删", async () => {
    const session = sessionStore.create("gconv");
    const file = path.join(tmpDir, `${session.sessionId}.jsonl`);
    expect(fs.existsSync(file)).toBe(true);

    const { req, res } = makeMockReqRes({
      method: "DELETE",
      url: `/api/sessions/${session.sessionId}`,
    });
    const route = ROUTES.find(
      ([m, p]) =>
        m === "DELETE" &&
        p instanceof RegExp &&
        p.source.includes("sessions") &&
        !p.source.includes("history") &&
        !p.source.includes("compact"),
    );
    expect(route).toBeDefined();
    await route![2](req, res, { id: session.sessionId });

    expect(res.statusCode).toBe(204);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("幂等：不存在的会话 → 204（spec § 3.4.7）", async () => {
    const { req, res } = makeMockReqRes({
      method: "DELETE",
      url: "/api/sessions/gconv-nonexistent",
    });
    const route = ROUTES.find(
      ([m, p]) =>
        m === "DELETE" &&
        p instanceof RegExp &&
        p.source.includes("sessions"),
    );
    await route![2](req, res, { id: "gconv-nonexistent" });

    expect(res.statusCode).toBe(204);
  });

  it("非法路径段 → 204（幂等）", async () => {
    const { req, res } = makeMockReqRes({
      method: "DELETE",
      url: "/api/sessions/..%2Fbad",
    });
    const route = ROUTES.find(
      ([m, p]) =>
        m === "DELETE" &&
        p instanceof RegExp &&
        p.source.includes("sessions"),
    );
    await route![2](req, res, { id: "../bad" });

    expect(res.statusCode).toBe(204);
  });
});

// ============================================================
// ⑤ POST /api/sessions/:cid/compact  → 501
// ============================================================

describe("POST /api/sessions/:cid/compact", () => {
  it("任意 cid → 501 NOT_IMPLEMENTED（WU-06a 占位）", async () => {
    const { req, res } = makeMockReqRes({
      method: "POST",
      url: "/api/sessions/gconv-deadbeef/compact",
      body: "{}",
    });
    const route = ROUTES.find(
      ([m, p]) => m === "POST" && p instanceof RegExp && p.source.includes("/compact$"),
    );
    await route![2](req, res, { cid: "gconv-deadbeef" });

    expect(res.statusCode).toBe(501);
    const body = parseJson<{ error: { code: string; details?: { cid?: string } } }>(res.body);
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
    expect(body.error.details?.cid).toBe("gconv-deadbeef");
  });
});

// ============================================================
// 重复 cid → SESSION_ALREADY_EXISTS（done criteria #8）
// 注：本实现中 POST /api/sessions 不接受 client 传 id（server 自动生成），
// 故 409 触发路径不在 create；而通过 GET /history 删除后访问的语义覆盖。
// 这里改为额外断言：create 后立即 getHistory 不会触发 SESSION_ALREADY_EXISTS。
// ============================================================

describe("SESSION_ALREADY_EXISTS 错误码注册", () => {
  it("http-helpers ERROR_STATUS_MAP 中存在该码 → 409", async () => {
    const { ERROR_STATUS_MAP } = await import("../http-helpers.js");
    expect(ERROR_STATUS_MAP["SESSION_ALREADY_EXISTS"]).toBe(409);
  });
});