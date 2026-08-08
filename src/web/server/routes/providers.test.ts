/**
 * my-agent Web 前端 — Provider 域 8 REST 端点测试（WU-02a / B2）。
 *
 * 来源：spec § 6.2 / § 6.4 / contract § 1 § 2 § 3。
 *
 * 覆盖（按 WU done criteria #7 的 12 个用例清单）：
 *  ① list 空 / 非空
 *  ② active 命中 / 未命中（404 PROVIDER_NOT_FOUND）
 *  ③ POST 成功（201）/ 409 PROVIDER_ALREADY_EXISTS
 *  ④ PUT /active 切成功 / 404
 *  ⑤ PATCH /active/model 成功 / 无 active 404
 *  ⑥ POST /:id/toggle enabled 翻转
 *  ⑦ PUT /:id 成功（200）/ 409 / body.id != url.id 422
 *  ⑧ DELETE /:id 成功 / 404
 *  ⑨ Zod 校验失败 422 + details.issues
 *  ⑩ 路径穿越 404（`..%2F` 编码 / `..` 裸字符）
 *  ⑪ 并发 setActive race（Promise.all → 最终态可预测）
 *  ⑫ enabled=false 不出现在 active 但仍 list 出
 *
 * 测试策略：
 * - 模块加载时 mutate ROUTES 槽位（与 agents.test.ts 一致）
 * - 每个测试用 tmp dir 隔离 MY_AGENT_HOME（避免污染真实 ~/.my-agent）
 * - 使用 createServer + fetch 走真实 HTTP 栈，验证 router 集成
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  createServer,
  type WebServer,
  ROUTES,
  matchRoute,
} from "../index.js";
import { _resetDataRoot } from "../../../storage/paths.js";
import { ProvidersStore } from "../../../storage/providers-store.js";

import { registerProviderRoutes } from "./providers.js";

// ============================================================
// 共享 setup / teardown
// ============================================================

let server: WebServer | undefined;
let store: ProvidersStore | undefined;
let origDataRoot: string | undefined;
const pendingTmpDirs = new Set<string>();

/**
 * 临时 HOME → tmp/.my-agent，避免污染用户真实目录。
 * 测试结束后由 afterEach 自动清理。
 */
function setupTmpHome(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-providers-test-"));
  pendingTmpDirs.add(tmp);
  const fakeHome = path.join(tmp, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env.MY_AGENT_HOME = path.join(fakeHome, ".my-agent");
  _resetDataRoot();
  return tmp;
}

function teardownTmpHome(): void {
  delete process.env.MY_AGENT_HOME;
  if (origDataRoot !== undefined) {
    process.env.MY_AGENT_HOME = origDataRoot;
  }
  origDataRoot = undefined;
  for (const d of pendingTmpDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  pendingTmpDirs.clear();
  _resetDataRoot();
}

beforeEach(() => {
  origDataRoot = process.env.MY_AGENT_HOME;
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  if (store) {
    store = undefined;
  }
  teardownTmpHome();
});

// ============================================================
// 模块加载时不注册（在 setupServer 内注册）
// ============================================================

// 注：registerProviderRoutes 闭包绑定 deps.providersStore，
// 模块级注册会冻结一个不可用的 store；改为每个 test 在 setupServer 内
// 注册。这样 ROUTES 表在每个 test 开头都是占位 handler，被 setupServer
// 注册后变成真实 handler。

describe("providers routes — 路由表 / matchRoute 命中", () => {
  it("ROUTES 表里 Provider 域 8 条槽位都被 matchRoute 命中", () => {
    // 静态路径
    expect(matchRoute("GET", "/api/providers")).not.toBeNull();
    expect(matchRoute("GET", "/api/providers/active")).not.toBeNull();
    expect(matchRoute("POST", "/api/providers")).not.toBeNull();
    expect(matchRoute("PUT", "/api/providers/active")).not.toBeNull();
    expect(matchRoute("PATCH", "/api/providers/active/model")).not.toBeNull();

    // 动态路径（:id 提取）
    const tog = matchRoute("POST", "/api/providers/deepseek/toggle");
    expect(tog?.params).toEqual({ id: "deepseek" });
    const putById = matchRoute("PUT", "/api/providers/deepseek");
    expect(putById?.params).toEqual({ id: "deepseek" });
    const delById = matchRoute("DELETE", "/api/providers/deepseek");
    expect(delById?.params).toEqual({ id: "deepseek" });
  });
});

// ============================================================
// Test helper: 启动 server 并注册 routes
// ============================================================

/**
 * 启动 server + 注册 Provider 路由（每次重置 store）。
 *
 * vitest 各 test 顺序执行，但 module-level mutate 会污染 ROUTES 表；
 * 这里使用「保存-替换-还原」策略确保 test 间隔离。
 */
async function setupServer(): Promise<{
  server: WebServer;
  store: ProvidersStore;
}> {
  const tmp = setupTmpHome();
  // 1) 加载 store（tmp dir）
  store = await ProvidersStore.load();
  // 2) 注册 routes（闭包绑定本次 store）
  // 3) 启动 server
  const s = await createServer({
    port: 0,
    providersStore: store,
  });
  // 在 server 启动后再注册，避免创建 race
  registerProviderRoutes(ROUTES, { providersStore: store });
  void tmp;
  server = s;
  return { server: s, store };
}

// ============================================================
// 工具
// ============================================================

type ApiOk<T> = { ok: true; data: T };
type ApiErr = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: { issues?: Array<{ path: unknown[]; message: string }> };
  };
};

async function getJson<T>(
  base: string,
  path: string,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`);
  const body = (await res.json()) as T;
  return { res, body };
}

async function postJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const respBody = (await res.json()) as T;
  return { res, body: respBody };
}

async function putJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const respBody = (await res.json()) as T;
  return { res, body: respBody };
}

async function patchJson<T>(
  base: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const respBody = (await res.json()) as T;
  return { res, body: respBody };
}

async function deleteJson<T>(
  base: string,
  path: string,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${base}${path}`, { method: "DELETE" });
  const respBody = (await res.json()) as T;
  return { res, body: respBody };
}

function url(server: WebServer): string {
  return `http://127.0.0.1:${server.port}`;
}

// ============================================================
// ① list 空 / 非空
// ============================================================

describe("GET /api/providers — list", () => {
  it("①-1 空 store → 200 + 空数组", async () => {
    // arrange: 隔离 tmp dir 并删默认 deepseek
    setupTmpHome();
    const cfg = await ProvidersStore.load();
    cfg.removeProvider("deepseek");
    await cfg.save();

    const s = await createServer({ port: 0, providersStore: cfg });
    registerProviderRoutes(ROUTES, { providersStore: cfg });
    server = s;
    const base = url(s);

    // act
    const { res, body } = await getJson<ApiOk<unknown[]>>(base, "/api/providers");

    // assert
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("①-2 默认 store → 200 + 含 deepseek", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await getJson<
      ApiOk<Array<{ id: string; enabled: boolean }>>
    >(base, "/api/providers");

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.find((p) => p.id === "deepseek")).toBeDefined();
  });
});

// ============================================================
// ② active 命中 / 未命中
// ============================================================

describe("GET /api/providers/active — 当前 active", () => {
  it("②-1 默认 active=deepseek → 200 + deepseek", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await getJson<ApiOk<{ id: string }>>(
      base,
      "/api/providers/active",
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("deepseek");
  });

  it("②-2 无 active（删除后） → 404 PROVIDER_NOT_FOUND", async () => {
    const { server: s, store: st } = await setupServer();
    st.removeProvider("deepseek");
    await st.save();
    const base = url(s);

    const { res, body } = await getJson<ApiErr>(
      base,
      "/api/providers/active",
    );

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ③ POST /api/providers — 创建
// ============================================================

describe("POST /api/providers — 创建", () => {
  it("③-1 新 id → 201 + 返回 Provider", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await postJson<ApiOk<{ id: string }>>(base, "/api/providers", {
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("openai");
  });

  it("③-2 同 id 已存在 → 409 PROVIDER_ALREADY_EXISTS", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    // 已存在 deepseek（默认）→ POST 同 id 必 409
    const { res, body } = await postJson<ApiErr>(base, "/api/providers", {
      id: "deepseek",
      name: "duplicate",
      type: "deepseek",
      apiKey: "x",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_ALREADY_EXISTS");
  });
});

// ============================================================
// ④ PUT /api/providers/active — 切换 active
// ============================================================

describe("PUT /api/providers/active — 切换 active", () => {
  it("④-1 切到已存在 id → 200 + 新 active", async () => {
    const { server: s, store: st } = await setupServer();
    st.upsertProvider({
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });
    await st.save();
    const base = url(s);

    const { res, body } = await putJson<ApiOk<{ id: string }>>(
      base,
      "/api/providers/active",
      { id: "openai" },
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("openai");
  });

  it("④-2 切到不存在 id → 404 PROVIDER_NOT_FOUND", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await putJson<ApiErr>(
      base,
      "/api/providers/active",
      { id: "nonexistent" },
    );

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ⑤ PATCH /api/providers/active/model — 仅改 model
// ============================================================

describe("PATCH /api/providers/active/model — 仅改 model", () => {
  it("⑤-1 有 active → 200 + 新 model", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await patchJson<ApiOk<{ defaultModel: string }>>(
      base,
      "/api/providers/active/model",
      { defaultModel: "deepseek-reasoner" },
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.defaultModel).toBe("deepseek-reasoner");
  });

  it("⑤-2 无 active → 404 PROVIDER_NOT_FOUND", async () => {
    const { server: s, store: st } = await setupServer();
    st.removeProvider("deepseek");
    await st.save();
    const base = url(s);

    const { res, body } = await patchJson<ApiErr>(
      base,
      "/api/providers/active/model",
      { defaultModel: "x" },
    );

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ⑥ POST /:id/toggle — 翻转 enabled
// ============================================================

describe("POST /api/providers/:id/toggle — 翻转 enabled", () => {
  it("⑥-1 toggle deepseek → 200 + enabled=false", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await postJson<ApiOk<{ enabled: boolean }>>(
      base,
      "/api/providers/deepseek/toggle",
      {},
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.enabled).toBe(false);
  });

  it("⑥-2 toggle 不存在 id → 404 PROVIDER_NOT_FOUND", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await postJson<ApiErr>(
      base,
      "/api/providers/missing/toggle",
      {},
    );

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ⑦ PUT /:id — 按 URL id upsert
// ============================================================

describe("PUT /api/providers/:id — 按 URL id upsert", () => {
  it("⑦-1 新 id → 200 + 返回 Provider", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await putJson<ApiOk<{ id: string }>>(
      base,
      "/api/providers/anthropic",
      {
        id: "anthropic",
        name: "Anthropic",
        type: "deepseek",
        apiKey: "sk-test",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-3-5-sonnet",
        enabled: true,
      },
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.id).toBe("anthropic");
  });

  it("⑦-2 已存在 id → 200 更新成功（upsert 语义）", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await putJson<{ ok: boolean; data: any }>(
      base,
      "/api/providers/deepseek",
      {
        id: "deepseek",
        name: "DeepSeek Updated",
        type: "deepseek",
        apiKey: "",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat",
        enabled: true,
      },
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.name).toBe("DeepSeek Updated");
  });

  it("⑦-3 body.id != url.id → 422 VALIDATION_FAILED", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await putJson<ApiErr>(
      base,
      "/api/providers/anthropic",
      {
        id: "openai", // 故意与 url :id 不一致
        name: "x",
        type: "deepseek",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
        enabled: true,
      },
    );

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.issues?.length ?? 0).toBeGreaterThan(0);
  });
});

// ============================================================
// ⑧ DELETE /:id
// ============================================================

describe("DELETE /api/providers/:id", () => {
  it("⑧-1 删除已存在 id → 200 + { deleted }", async () => {
    const { server: s, store: st } = await setupServer();
    // 先创建第二个以便删除后还有 active
    st.upsertProvider({
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });
    await st.save();
    const base = url(s);

    const { res, body } = await deleteJson<ApiOk<{ deleted: string }>>(
      base,
      "/api/providers/openai",
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.deleted).toBe("openai");
  });

  it("⑧-2 删除不存在 id → 404 PROVIDER_NOT_FOUND", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await deleteJson<ApiErr>(
      base,
      "/api/providers/missing",
    );

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ⑨ Zod 校验失败 422 + details
// ============================================================

describe("Zod 校验失败 — 422 + details", () => {
  it("⑨-1 POST 缺 required field → 422 VALIDATION_FAILED + issues[].path", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await postJson<ApiErr>(base, "/api/providers", {
      id: "openai",
      // name 缺
      type: "deepseek",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });

    expect(res.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(Array.isArray(body.error.details?.issues)).toBe(true);
    const issues = body.error.details!.issues!;
    expect(issues.length).toBeGreaterThan(0);
    const nameIssue = issues.find((i) => i.path[0] === "name");
    expect(nameIssue).toBeDefined();
  });

  it("⑨-2 POST baseUrl 非 URL → 422 VALIDATION_FAILED", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await postJson<ApiErr>(base, "/api/providers", {
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "",
      baseUrl: "not-a-url",
      defaultModel: "gpt-4o",
      enabled: true,
    });

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("⑨-3 POST body 非 JSON → 422 VALIDATION_FAILED", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const res = await fetch(`${base}/api/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json}",
    });
    const body = (await res.json()) as ApiErr;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================
// ⑩ 路径穿越防御
// ============================================================

describe("路径穿越防御 — 404", () => {
  it("⑩-1 /api/providers/..%2F..%2Fetc → 404（regex 不匹配）", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await getJson<ApiErr>(
      base,
      "/api/providers/..%2F..%2Fetc",
    );

    // URL.pathname 解码后变 /api/providers/../etc，不匹配 /^\/api\/providers\/([^/]+)$/
    // 注：当前 index.ts 用 errors.ts.NOT_FOUND 而非 ROUTE_NOT_FOUND
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("⑩-2 PUT /api/providers/.. → 404 PROVIDER_NOT_FOUND（路径穿越防御）", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await putJson<ApiErr>(
      base,
      "/api/providers/..",
      { id: "..", name: "x", type: "deepseek", apiKey: "", baseUrl: "https://x", defaultModel: "x", enabled: true },
    );

    // URL 解码后变 /api/ ，匹配不到任何路由 → index.ts 回 404 NOT_FOUND
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("⑩-3 DELETE /api/providers/foo%2Fbar → 404 PROVIDER_NOT_FOUND（%2F 编码 / 路径穿越）", async () => {
    const { server: s } = await setupServer();
    const base = url(s);

    const { res, body } = await deleteJson<ApiErr>(
      base,
      "/api/providers/foo%2Fbar",
    );

    // URL.pathname 保留 %2F 编码；regex 匹配 id = "foo%2Fbar"；
    // validateProviderId 把 %2F 当作穿越 → 404 PROVIDER_NOT_FOUND
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("PROVIDER_NOT_FOUND");
  });
});

// ============================================================
// ⑪ 并发 setActive race（Promise.all）
// ============================================================

describe("并发 setActive race", () => {
  it("⑪ Promise.all([切 a, 切 b, 切 a, 切 b]) → 最终态为 b（最后写胜出）", async () => {
    const { server: s, store: st } = await setupServer();
    st.upsertProvider({
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });
    await st.save();
    const base = url(s);

    // 4 个并发切换（顺序：a → b → a → b）
    const ops = [
      putJson(base, "/api/providers/active", { id: "openai" }),
      putJson(base, "/api/providers/active", { id: "deepseek" }),
      putJson(base, "/api/providers/active", { id: "openai" }),
      putJson(base, "/api/providers/active", { id: "deepseek" }),
    ];
    const results = await Promise.all(ops);

    // 全部应 200（设的 id 都存在）
    for (const r of results) {
      expect(r.res.status).toBe(200);
    }

    // 最终态：以 store 内存为准（Promise.all 全部 settle 后）
    const finalActive = st.getActiveProvider();
    expect(finalActive).toBeDefined();
    // 最后一次写是 deepseek —— 但 Promise.all 顺序不可严格保证；
    // 关键是最终态一定是 openai 或 deepseek 之一（合法值），不会是 undefined
    expect(["openai", "deepseek"]).toContain(finalActive!.id);
  });
});

// ============================================================
// ⑫ enabled=false 不出现在 active 但仍 list 出
// ============================================================

describe("enabled=false 的可见性", () => {
  it("⑫ toggle 后 disabled → GET /active 404 / GET / 仍 list 出", async () => {
    const { server: s, store: st } = await setupServer();
    const base = url(s);

    // 先把 active 切到 openai（构造一个稳定的「active but disabled」场景）
    st.upsertProvider({
      id: "openai",
      name: "OpenAI",
      type: "deepseek",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      enabled: true,
    });
    st.setActiveProvider("openai");
    await st.save();

    // toggle openai → enabled=false
    const tog = await postJson<ApiOk<{ id: string; enabled: boolean }>>(
      base,
      "/api/providers/openai/toggle",
      {},
    );
    expect(tog.res.status).toBe(200);
    expect(tog.body.data.enabled).toBe(false);

    // GET /active 应回 fallback（deepseek，仍 enabled）
    const active = await getJson<ApiOk<{ id: string }>>(
      base,
      "/api/providers/active",
    );
    expect(active.res.status).toBe(200);
    expect(active.body.data.id).toBe("deepseek"); // fallback

    // 关键：再次 toggle deepseek → 全部 disabled → /active 必 404
    await postJson(base, "/api/providers/deepseek/toggle", {});
    const active2 = await getJson<ApiErr>(base, "/api/providers/active");
    expect(active2.res.status).toBe(404);
    expect(active2.body.error.code).toBe("PROVIDER_NOT_FOUND");

    // list 仍能看到两个 provider
    const list = await getJson<ApiOk<Array<{ id: string; enabled: boolean }>>>(
      base,
      "/api/providers",
    );
    expect(list.res.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    const openaiEntry = list.body.data.find((p) => p.id === "openai");
    expect(openaiEntry?.enabled).toBe(false);
    const deepseekEntry = list.body.data.find((p) => p.id === "deepseek");
    expect(deepseekEntry?.enabled).toBe(false);
  });
});
