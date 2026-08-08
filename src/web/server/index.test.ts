import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createServer,
  CSP_HEADER,
  ROUTES,
  matchRoute,
  type WebServer,
} from "./index.js";
import { tryServeStatic } from "./static.js";
import { applySecurityHeaders } from "./csp.js";

// ============================================================
// 共享夹具
// ============================================================

let server: WebServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

// ============================================================
// ① /healthz → 200 + JSON {"status":"ok"}
// ============================================================

describe("createServer — /healthz", () => {
  it("GET /healthz 返回 200 + application/json + {status: 'ok'}", async () => {
    // Arrange
    server = await createServer({ port: 0 });

    // Act
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    const body = (await res.json()) as { status: string };

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body).toEqual({ status: "ok" });
  });

  it("/healthz 响应带 CSP + X-Request-Id", async () => {
    // Arrange
    server = await createServer({ port: 0 });

    // Act
    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);

    // Assert
    expect(res.headers.get("content-security-policy")).toBe(CSP_HEADER);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ============================================================
// ② /api/* → 404 ROUTE_NOT_FOUND（命中 + 未命中两种形态）
// ============================================================

describe("createServer — 路由占位 (404)", () => {
  it("ROUTES 表内但 handler 是占位 → 404 + code ROUTE_NOT_FOUND（路由表占位）", async () => {
    // Arrange：/api/providers 在 ROUTES 表内（本期 handler = placeholder）。
    // 占位 handler 内部直接 res.end JSON(code: "ROUTE_NOT_FOUND")，
    // 与 WU-02e 的 handleError 走不同路径 —— 保留 router.ts 原语义。
    server = await createServer({ port: 0 });

    // Act
    const res = await fetch(`http://127.0.0.1:${server.port}/api/providers`);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    // Assert
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(body.error.message).toBeTruthy();
  });

  it("完全未注册的路径 → 404 + code NOT_FOUND（contract § 3）", async () => {
    // Arrange
    server = await createServer({ port: 0 });

    // Act
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/this-does-not-exist`,
    );
    const body = (await res.json()) as { ok: boolean; error: { code: string } };

    // Assert
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("404 响应同样带 CSP 头", async () => {
    // Arrange
    server = await createServer({ port: 0 });

    // Act
    const res = await fetch(`http://127.0.0.1:${server.port}/api/foo`);

    // Assert：与 done criteria #3 「所有响应带 CSP 头」对齐
    expect(res.headers.get("content-security-policy")).toBe(CSP_HEADER);
  });
});

// ============================================================
// ROUTES 表导出（GROUP-2 将填充）
// ============================================================

describe("ROUTES 占位表", () => {
  it("导出 24 条路由（Provider 9 + Session 6 + Chat 2 + Models 1 + Agent 2 + Skill 5）", () => {
    // Provider 域含 9 条（含 POST test 联通测试路由）；Skills 域含 5 条 CRUD 路由（GET/POST/PUT/DELETE）
    expect(ROUTES.length).toBe(24);
  });

  it("matchRoute 能匹配 + 提取 :id 参数", () => {
    const m = matchRoute("PUT", "/api/providers/deepseek");
    expect(m).not.toBeNull();
    expect(m?.params).toEqual({ id: "deepseek" });
  });

  it("matchRoute 静态路径优先于动态正则", () => {
    // /api/providers/active 不该被 /api/providers/:id 抢走
    expect(matchRoute("GET", "/api/providers/active")?.params).toEqual({});
  });
});

// ============================================================
// 静态文件中间件：路径穿越防御 + 扩展名白名单
// ============================================================

describe("tryServeStatic — 路径防御", () => {
  let tmpRoot: string;
  let outside: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-static-"));
    fs.writeFileSync(
      path.join(tmpRoot, "index.html"),
      "<html>ok</html>",
      "utf-8",
    );
    // 在 webRoot 外面放一个白名单扩展文件，用于验证路径穿越
    outside = path.join(tmpRoot, "..", "outside-secret.html");
    fs.writeFileSync(outside, "SECRET", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (fs.existsSync(outside)) fs.rmSync(outside, { force: true });
  });

  function mockReqRes(url: string): {
    req: import("node:http").IncomingMessage;
    res: import("node:http").ServerResponse;
  } {
    // 用最小 mock —— 只用到 method/url/headers/socket
    const req = {
      url,
      method: "GET",
      headers: { host: "localhost" },
    } as unknown as import("node:http").IncomingMessage;
    const res = {
      setHeader: () => res,
      getHeader: () => undefined,
      removeHeader: () => {},
      statusCode: 0,
      end: () => {},
      write: () => {},
      pipe: () => res,
    } as unknown as import("node:http").ServerResponse;
    return { req, res };
  }

  it("拒绝 ../ 路径穿越（编码绕过也失效）", () => {
    const { req, res } = mockReqRes("/..%2Foutside-secret.html");
    const handled = tryServeStatic(req, res, tmpRoot);
    expect(handled).toBe(false);
  });

  it("拒绝非白名单扩展名（.ts）", () => {
    fs.writeFileSync(path.join(tmpRoot, "leak.ts"), "const a=1", "utf-8");
    const { req, res } = mockReqRes("/leak.ts");
    const handled = tryServeStatic(req, res, tmpRoot);
    expect(handled).toBe(false);
  });

  it("拒绝 NUL 字节", () => {
    const { req, res } = mockReqRes("/index.html\0.png");
    const handled = tryServeStatic(req, res, tmpRoot);
    expect(handled).toBe(false);
  });
});

// ============================================================
// CSP 头覆盖（done criteria #3 + #4）
// ============================================================

describe("CSP 头字符串", () => {
  it("包含 spec § 6.1 全部策略", () => {
    expect(CSP_HEADER).toContain("default-src 'self'");
    expect(CSP_HEADER).toContain("script-src 'self'");
    expect(CSP_HEADER).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(CSP_HEADER).toContain("font-src 'self' data:");
    expect(CSP_HEADER).toContain("img-src 'self' data:");
    expect(CSP_HEADER).toContain("connect-src 'self'");
    expect(CSP_HEADER).toContain("frame-ancestors 'none'");
    expect(CSP_HEADER).toContain("base-uri 'self'");
    expect(CSP_HEADER).toContain("form-action 'self'");
    expect(CSP_HEADER).toContain("object-src 'none'");
  });

  it("html: true 时附加 Permissions-Policy 头", () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string): void => {
        headers[k.toLowerCase()] = v;
      },
    } as unknown as import("node:http").ServerResponse;

    applySecurityHeaders(res, { html: true });

    expect(headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
  });

  it("html: false（默认）时不附加 Permissions-Policy", () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string): void => {
        headers[k.toLowerCase()] = v;
      },
    } as unknown as import("node:http").ServerResponse;

    applySecurityHeaders(res);

    expect(headers["permissions-policy"]).toBeUndefined();
  });
});