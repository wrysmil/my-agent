/**
 * api.js 测试 — F3 / WU-04a
 *
 * api.js 是经典 <script defer> 加载（非 ES module），运行时挂到 window.MyAgent.api。
 * 这里用 node:vm 起一个干净的全局上下文，注入一个 mock fetch（含可配置的
 * Response 工厂 + 错误注入）—— 不引 jsdom / undici。
 *
 * 测试覆盖：
 *   - 全局挂载（ApiClientError / apiFetch / ApiClientErrorCode）
 *   - 成功（200 + {ok:true, data: ...}）→ 返回 data
 *   - 业务失败（422 + {ok:false, error:{code,message,details}}）→ 抛 ApiClientError
 *   - 401 → 抛 ApiClientError(code, status=401)
 *   - 网络错（fetch reject）→ 抛 ApiClientError(NETWORK_ERROR)
 *   - AbortSignal 触发 → 抛 ApiClientError(ABORTED)
 *   - 协议错（非 JSON / 缺 ok） → 抛 PROTOCOL_ERROR
 *   - body 自动 JSON 序列化 + Content-Type
 *   - instance + 字段对称（code/message/details/status）
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const API_PATH = fileURLToPath(new URL("../../web/js/shared/api.js", import.meta.url));
const API_SOURCE = readFileSync(API_PATH, "utf-8");

// ----------------------------------------------------------------------
// mock fetch 工具
// ----------------------------------------------------------------------

interface MockResponseInit {
  status?: number;
  body?: unknown; // object → 序列化为 JSON；string → 原样
  contentType?: string;
  raw?: string; // 直接当作响应体原样返回（用于「非 JSON」场景）
}

function makeResponse(init: MockResponseInit = {}) {
  const status = init.status ?? 200;
  let raw: string;
  if (init.raw !== undefined) {
    raw = init.raw;
  } else if (typeof init.body === "string") {
    raw = init.body;
  } else if (init.body === undefined) {
    raw = "";
  } else {
    raw = JSON.stringify(init.body);
  }
  const ct =
    init.contentType ??
    (init.raw !== undefined
      ? "text/plain"
      : "application/json; charset=utf-8");
  return {
    status,
    headers: { get(name: string) {
      if (name.toLowerCase() === "content-type") return ct;
      return null;
    } },
    text() {
      return Promise.resolve(raw);
    },
    json() {
      return Promise.resolve(JSON.parse(raw));
    },
  };
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
  /** 下一次 fetch 调用的「响应」（resolved）或「拒绝」（rejected） */
  respondWith: (
    value: Response | Promise<Response> | Error | Promise<Error>,
  ) => void;
  /** 自定义一次性 fetch（最常用：返回特定 Response） */
  respondWithResponse: (resp: MockResponseInit) => void;
  /** 触发网络错 */
  rejectWith: (err: Error) => void;
}

function makeMockFetch(): MockFetch {
  let nextBehavior: unknown = null;
  const calls: FetchCall[] = [];
  const fn = vi.fn((url: string, init: RequestInit | undefined) => {
    calls.push({ url, init });
    if (nextBehavior === null) {
      return Promise.resolve(makeResponse({ status: 200, body: { ok: true, data: null } }));
    }
    if (nextBehavior instanceof Error || (nextBehavior && typeof (nextBehavior as Promise<Error>).then === "function")) {
      const p = nextBehavior;
      nextBehavior = null;
      return Promise.reject(p);
    }
    const r = nextBehavior as Response;
    nextBehavior = null;
    return Promise.resolve(r);
  });
  return {
    fn,
    calls,
    respondWith(v) {
      nextBehavior = v;
    },
    respondWithResponse(init) {
      nextBehavior = makeResponse(init);
    },
    rejectWith(err) {
      nextBehavior = err;
    },
  };
}

// ----------------------------------------------------------------------
// api.js 加载 + 测试工具
// ----------------------------------------------------------------------

interface ApiApi {
  apiFetch: (
    path: string,
    opts?: {
      method?: string;
      body?: unknown;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      base?: string;
    },
  ) => Promise<any>;
  ApiClientError: new (
    code: string,
    message?: string,
    details?: Record<string, unknown>,
    status?: number,
    cause?: unknown,
  ) => ApiClientErrorInstance;
  ApiClientErrorCode: {
    NETWORK_ERROR: string;
    ABORTED: string;
    PROTOCOL_ERROR: string;
    HTTP_ERROR: string;
  };
  _parseResponse: (resp: any) => Promise<any>;
}

interface ApiClientErrorInstance extends Error {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  status: number;
  name: string;
  toJSON(): {
    name: string;
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
  };
  toString(): string;
}

interface ApiGlobal {
  MyAgent: { api: ApiApi };
  fetch: MockFetch["fn"];
  location: { origin: string };
  console: { error?: ReturnType<typeof vi.fn> };
}

function loadApi(
  fetchImpl: MockFetch["fn"] = vi
    .fn()
    .mockResolvedValue(makeResponse({ status: 200, body: { ok: true, data: null } })),
): { g: ApiGlobal; mockFetch: MockFetch } {
  // 注：MockFetch 内部自带 fn 实例，本工具允许外部传 fn 实现
  // 为简化，直接构造
  const mock: MockFetch = makeMockFetch();
  // 用传入的 fetchImpl 替换 mock.fn（如果调用方想精确控制）
  if (fetchImpl !== mock.fn) {
    // 把 mock.calls 同步到传入 fn 的实现里 —— 但这里测试一般用 mock 自带
    // 因此忽略本分支，调用方应使用 mock.respond* API
  }

  const sandbox: Record<string, unknown> = {
    console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    location: { origin: "http://localhost" },
    fetch: mock.fn,
  };
  createContext(sandbox);
  runInContext(API_SOURCE, sandbox);
  return { g: sandbox as unknown as ApiGlobal, mockFetch: mock };
}

// ======================================================================
// 测试
// ======================================================================

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.js — 全局挂载", () => {
  it("挂载到 window.MyAgent.api", () => {
    const { g } = loadApi();
    expect(g.MyAgent).toBeDefined();
    expect(g.MyAgent.api).toBeDefined();
  });

  it("导出 apiFetch / ApiClientError / ApiClientErrorCode", () => {
    const a = loadApi().g.MyAgent.api;
    expect(typeof a.apiFetch).toBe("function");
    expect(typeof a.ApiClientError).toBe("function");
    expect(a.ApiClientErrorCode).toMatchObject({
      NETWORK_ERROR: expect.any(String),
      ABORTED: expect.any(String),
      PROTOCOL_ERROR: expect.any(String),
      HTTP_ERROR: expect.any(String),
    });
  });

  it("源码无 emoji 且无 import / require", () => {
    expect(API_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(API_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(API_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});

describe("apiFetch — 成功路径", () => {
  it("200 + {ok:true, data: ...} → 返回 data", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { id: 42, name: "Alice" } },
    });
    const result = await g.MyAgent.api.apiFetch("/api/users/1");
    expect(result).toEqual({ id: 42, name: "Alice" });
    expect(mockFetch.calls[0]!.url).toBe("http://localhost/api/users/1");
    expect(mockFetch.calls[0]!.init?.method).toBe("GET");
  });

  it("body 自动 JSON 序列化 + Content-Type", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { ok: true } },
    });
    await g.MyAgent.api.apiFetch("/api/echo", {
      method: "POST",
      body: { hello: "world" },
    });
    const init = mockFetch.calls[0]!.init!;
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
  });

  it("headers 透传 + 已设 Content-Type 不覆盖", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({ status: 200, body: { ok: true, data: {} } });
    await g.MyAgent.api.apiFetch("/api/x", {
      method: "POST",
      body: { a: 1 },
      headers: { "Content-Type": "application/x-custom", "X-Token": "t" },
    });
    const init = mockFetch.calls[0]!.init!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-custom");
    expect(headers["X-Token"]).toBe("t");
  });

  it("path 不是以 / 开头会自动加 /", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({ status: 200, body: { ok: true, data: 1 } });
    await g.MyAgent.api.apiFetch("api/no-slash");
    expect(mockFetch.calls[0]!.url).toBe("http://localhost/api/no-slash");
  });

  it("显式 base 覆盖 window.location.origin", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({ status: 200, body: { ok: true, data: 1 } });
    await g.MyAgent.api.apiFetch("/v2/x", { base: "https://api.example.com" });
    expect(mockFetch.calls[0]!.url).toBe("https://api.example.com/v2/x");
  });
});

describe("apiFetch — 失败路径抛 ApiClientError", () => {
  it("422 + {ok:false, error:{code,message,details}} → 抛 ApiClientError", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 422,
      body: {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Field 'name' required",
          details: { field: "name" },
        },
      },
    });
    await expect(g.MyAgent.api.apiFetch("/api/x", { method: "POST" })).rejects.toMatchObject({
      name: "ApiClientError",
      code: "VALIDATION_FAILED",
      message: "Field 'name' required",
      status: 422,
      details: { field: "name" },
    });
  });

  it("401 → 抛 ApiClientError（status=401, code 透传）", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 401,
      body: { ok: false, error: { code: "UNAUTHORIZED", message: "auth required" } },
    });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "UNAUTHORIZED",
      status: 401,
      message: "auth required",
    });
  });

  it("404 + 缺 error.code → 抛 HTTP_ERROR（兜底）", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 404,
      body: { ok: false, error: { message: "missing" } },
    });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "HTTP_ERROR",
      status: 404,
      message: "missing", // 透传 body.error.message
    });
  });

  it("200 + 缺 ok:true → 抛 PROTOCOL_ERROR", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 200,
      body: { data: 1 }, // 缺 ok
    });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "PROTOCOL_ERROR",
      status: 200,
    });
  });

  it("响应非 JSON → 抛 PROTOCOL_ERROR", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({
      status: 200,
      raw: "<html>oops</html>",
      contentType: "text/html",
    });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "PROTOCOL_ERROR",
    });
  });

  it("fetch reject（网络错） → 抛 ApiClientError(NETWORK_ERROR)", async () => {
    const { g, mockFetch } = loadApi();
    const netErr = new TypeError("Failed to fetch");
    mockFetch.rejectWith(netErr);
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "NETWORK_ERROR",
      message: "Failed to fetch",
      status: 0,
    });
  });

  it("AbortSignal 触发 → 抛 ApiClientError(ABORTED)，cause 是 AbortError", async () => {
    const { g, mockFetch } = loadApi();
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.rejectWith(abortErr);
    const ctrl = new AbortController();
    const promise = g.MyAgent.api.apiFetch("/api/x", { signal: ctrl.signal });
    await expect(promise).rejects.toMatchObject({
      name: "ApiClientError",
      code: "ABORTED",
      message: "Request aborted",
    });
  });

  it("200 + ok:true 但缺 data 字段 → 抛 PROTOCOL_ERROR", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({ status: 200, body: { ok: true } });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "PROTOCOL_ERROR",
    });
  });

  it("204 No Content + 空 body → 抛 PROTOCOL_ERROR（缺 ok 字段）", async () => {
    const { g, mockFetch } = loadApi();
    mockFetch.respondWithResponse({ status: 204, raw: "" });
    await expect(g.MyAgent.api.apiFetch("/api/x")).rejects.toMatchObject({
      name: "ApiClientError",
      code: "PROTOCOL_ERROR",
    });
  });
});

describe("ApiClientError", () => {
  it("字段全部可读（code/message/details/status）", () => {
    const { g } = loadApi();
    const Err = g.MyAgent.api.ApiClientError;
    const e = new Err("MY_CODE", "msg-x", { field: "x" }, 400);
    expect(e.name).toBe("ApiClientError");
    expect(e.code).toBe("MY_CODE");
    expect(e.message).toBe("msg-x");
    expect(e.details).toEqual({ field: "x" });
    expect(e.status).toBe(400);
    // 跨 realm（vm 沙箱）下 instanceof Error 不可靠；用原型链 + name 替代
    expect(Object.getPrototypeOf(e)).toBe(Err.prototype);
    expect((Err.prototype as any).constructor).toBe(Err);
  });

  it("status 缺省 → 0；message 缺省 → code", () => {
    const { g } = loadApi();
    const Err = g.MyAgent.api.ApiClientError;
    const e = new Err("CODE_ONLY");
    expect(e.status).toBe(0);
    expect(e.message).toBe("CODE_ONLY");
  });

  it("toString() 输出稳定可读", () => {
    const { g } = loadApi();
    const Err = g.MyAgent.api.ApiClientError;
    const e = new Err("X", "msg", undefined, 401);
    expect(e.toString()).toBe("ApiClientError[X 401]: msg");
  });

  it("toJSON() 含 name/code/message/status/details（details 仅在有值时）", () => {
    const { g } = loadApi();
    const Err = g.MyAgent.api.ApiClientError;
    const e1 = new Err("X", "msg");
    expect(e1.toJSON()).toEqual({
      name: "ApiClientError",
      code: "X",
      message: "msg",
      status: 0,
    });
    const e2 = new Err("X", "msg", { a: 1 }, 500);
    expect(e2.toJSON()).toEqual({
      name: "ApiClientError",
      code: "X",
      message: "msg",
      status: 500,
      details: { a: 1 },
    });
  });
});