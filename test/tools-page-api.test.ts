/**
 * my-agent Web 前端 — Tools 域 GET 路由测试（tools-management-page）。
 *
 * 来源：spec 2026-08-08-tools-management-page-spec § 4 / § 6.1。
 *
 * 覆盖：
 * - ① GET /api/tools 返回 8 个内置工具摘要（不含 inputSchema）
 * - ② GET /api/tools/:name 命中 → 完整信息（含 inputSchema）
 * - ③ GET /api/tools/:name 404 → TOOL_NOT_FOUND
 * - ④ 列表 shape 校验（name/description/executionMode）
 * - ⑤ 详情 shape 校验（含 inputSchema 对象）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

let baseUrl = "";

beforeAll(async () => {
  // 动态 import server 以复用已有启动逻辑
  const { createServer } = await import("../src/web/server/index.js");
  // 注册 tools handler 到 ROUTES
  const { wireApiRoutes } = await import("../src/web/server/wire-routes.js");
  wireApiRoutes({ logger: undefined });
  const server = await createServer({ port: 0 });
  baseUrl = `http://127.0.0.1:${server.port}`;
  // 保持 server 引用防止 GC
  (globalThis as any).__toolsTestServer = server;
});

afterAll(async () => {
  const server = (globalThis as any).__toolsTestServer;
  if (server) await server.close();
});

describe("Tools API — GET /api/tools (list)", () => {
  it("① 返回 8 个内置工具摘要列表", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { tools: Array<{ name: string; description: string; executionMode?: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.data.tools).toHaveLength(8);

    const names = body.data.tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_files");
    expect(names).toContain("search_files");
    expect(names).toContain("grep_files");
    expect(names).toContain("bash");
    expect(names).toContain("web_fetch");
  });

  it("④ 每个工具包含 name, description, executionMode 字段", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    const body = (await res.json()) as {
      ok: boolean;
      data: { tools: Array<Record<string, unknown>> };
    };

    for (const t of body.data.tools) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      // executionMode 可为 undefined
      if (t.executionMode !== undefined) {
        expect(["sequential", "parallel"]).toContain(t.executionMode);
      }
      // 摘要不应包含 inputSchema
      expect(t).not.toHaveProperty("inputSchema");
    }
  });
});

describe("Tools API — GET /api/tools/:name (detail)", () => {
  it("② 存在的工具返回完整信息（含 inputSchema）", async () => {
    const res = await fetch(`${baseUrl}/api/tools/read_file`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        tool: {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          executionMode?: string;
        };
      };
    };

    expect(body.ok).toBe(true);
    expect(body.data.tool.name).toBe("read_file");
    expect(typeof body.data.tool.description).toBe("string");
    expect(body.data.tool.inputSchema).toBeDefined();
    expect(body.data.tool.inputSchema.type).toBe("object");
    expect(body.data.tool.inputSchema.properties).toBeDefined();
    // read_file 的 inputSchema 应包含 filePath 属性
    const props = body.data.tool.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("filePath");
  });

  it("③ 不存在的工具返回 404 + TOOL_NOT_FOUND", async () => {
    const res = await fetch(`${baseUrl}/api/tools/nonexistent_tool_xyz`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("TOOL_NOT_FOUND");
  });
});
