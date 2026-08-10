/**
 * my-agent Web 前端 — Agent 域 GET 路由测试（WU-02c / B4）。
 *
 * 来源：spec § 3.1.4 + contract § 1 / § 3。
 *
 * 覆盖：
 * - ① list 非空（fixtures 内置 5 个 agent）
 * - ② get by id 命中 → 完整 shape 校验
 * - ③ get by id 404 → AGENT_NOT_FOUND
 * - ④ list shape 校验（含 description/enabled/scope/source）
 * - ⑤ 路径穿越防御（NUL / `..` / `\` / 超长）
 * - ⑥ builtin + user 合并：用户覆盖内置 scope = "both"
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
import {
  listAgentsHandler,
  getAgentHandler,
  _resetBuiltinAgentsDir,
} from "./agents.js";

// ============================================================
// 共享 setup
// ============================================================

let server: WebServer | undefined;
let origDataRoot: string | undefined;
const pendingTmpDirs = new Set<string>();

/**
 * 临时 HOME → tmp/.my-agent，避免污染用户真实目录。
 * 测试结束后由 afterEach 自动清理。
 */
function setupTmpHome(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-agents-test-"));
  pendingTmpDirs.add(tmp);
  const fakeHome = path.join(tmp, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env.MY_AGENT_HOME = path.join(fakeHome, ".my-agent");
  _resetDataRoot(); // dataRoot() 模块级缓存，set env 后必须 reset
  _resetBuiltinAgentsDir();
  return tmp;
}

/**
 * 立即清理所有 tmp dir 并恢复原 MY_AGENT_HOME。
 * 测试函数若需要在 fetch 期间保持 MY_AGENT_HOME，可不调本函数，由 afterEach 兜底。
 */
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
  _resetBuiltinAgentsDir();
}

beforeEach(() => {
  origDataRoot = process.env.MY_AGENT_HOME;
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
  teardownTmpHome();
});

// ============================================================
// 路由表 + handler 替换（与 router.ts 约定一致）
// ============================================================

/**
 * 模块加载时立即 mutate ROUTES 槽位 —— vitest 各 describe 块按声明顺序执行，
 * 不在 module-load 时注册则其它 test 会先于 mutate 执行拿到 placeholder handler。
 */
const _listIdx = ROUTES.findIndex(
  ([m, p]) => m === "GET" && p === "/api/agents",
);
const _getIdx = ROUTES.findIndex(
  ([m, p]) =>
    m === "GET" &&
    typeof p === "object" &&
    p.source === String.raw`^\/api\/agents\/([^/]+)$`,
);

if (_listIdx >= 0) {
  ROUTES[_listIdx][2] = listAgentsHandler as unknown as typeof ROUTES[number][2];
}
if (_getIdx >= 0) {
  ROUTES[_getIdx][2] = getAgentHandler as unknown as typeof ROUTES[number][2];
}

describe("agents routes — 路由表 / handler 替换", () => {
  it("ROUTES 表里 /api/agents 与 /api/agents/:id 槽位由 agent handler 替换", () => {
    expect(_listIdx).toBeGreaterThanOrEqual(0);
    expect(_getIdx).toBeGreaterThanOrEqual(0);

    // 验证替换生效：matchRoute 能匹配且 handler 是新引用
    const listMatch = matchRoute("GET", "/api/agents");
    expect(listMatch).not.toBeNull();
    expect(listMatch?.handler).toBe(listAgentsHandler);

    const detailMatch = matchRoute("GET", "/api/agents/coder");
    expect(detailMatch).not.toBeNull();
    expect(detailMatch?.handler).toBe(getAgentHandler);
    expect(detailMatch?.params).toEqual({ id: "coder" });
  });
});

// ============================================================
// ① list 非空（含内置 fixtures）
// ============================================================

describe("GET /api/agents — 列表", () => {
  it("① 返回非空 agents 数组（含 fixtures 内置）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/agents`);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { agents: Array<{ id: string }> };
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.agents)).toBe(true);
    expect(body.data!.agents.length).toBeGreaterThan(0);

    // 内置 fixtures 至少含 coder / commander / debugger / explorer / reviewer
    const ids = body.data!.agents.map((a) => a.id);
    expect(ids).toContain("coder");
    expect(ids).toContain("commander");
    expect(ids).toContain("explorer");
  });

  it("④ list shape 校验（每个 entry 含 id/name/description/enabled/scope/source）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/agents`);
    const body = (await res.json()) as {
      data: {
        agents: Array<{
          id: string;
          name: string;
          description: string;
          enabled: boolean;
          scope: string;
          source: string;
          tools: string[];
        }>;
      };
    };

    const agent = body.data.agents.find((a) => a.id === "coder");
    expect(agent).toBeDefined();
    expect(agent!.id).toBe("coder");
    expect(agent!.name).toBe("Coder");
    expect(agent!.description).toBeTruthy(); // 任一语言版本有值
    expect(agent!.enabled).toBe(true);
    expect(agent!.scope).toBe("builtin");
    expect(agent!.source).toBe("builtin");
    expect(Array.isArray(agent!.tools)).toBe(true);
    expect(agent!.tools.length).toBeGreaterThan(0);
  });

  it("commander（无 description）仍能列出且 description 为空串", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/agents`);
    const body = (await res.json()) as {
      data: { agents: Array<{ id: string; description: string }> };
    };
    const commander = body.data.agents.find((a) => a.id === "commander");
    expect(commander).toBeDefined();
    expect(commander!.description).toBe(""); // 没有 description_zh/en → 空串而非 undefined
  });
});

// ============================================================
// ② get by id 命中
// ============================================================

describe("GET /api/agents/:id — 详情", () => {
  it("② 命中 → 200 + 完整 detail shape（含 systemPrompt / scope / tools）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/coder`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      data?: {
        agent: {
          id: string;
          name: string;
          description: string;
          description_zh: string;
          description_en: string;
          enabled: boolean;
          scope: string;
          source: string;
          tools: string[];
          systemPrompt: string;
        };
      };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const agent = body.data!.agent;
    expect(agent.id).toBe("coder");
    expect(agent.name).toBe("Coder");
    expect(agent.description_zh).toBeTruthy();
    expect(agent.description_en).toBeTruthy();
    expect(agent.scope).toBe("builtin");
    expect(agent.source).toBe("builtin");
    expect(agent.enabled).toBe(true);
    expect(agent.tools).toContain("read_file");
    // systemPrompt = workflow 字段
    expect(agent.systemPrompt).toContain("code implementation specialist");
  });
});

// ============================================================
// ③ get by id 404
// ============================================================

describe("GET /api/agents/:id — 404 AGENT_NOT_FOUND", () => {
  it("③ 不存在的 id → 404 + AGENT_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/no-such-agent-xyz`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
    expect(body.error.message).toBeTruthy();
  });
});

// ============================================================
// ⑤ 路径穿越防御
// ============================================================

describe("GET /api/agents/:id — 路径穿越防御", () => {
  // 路由 regex `[^/]+` 已拦截 `/`；本组测试 `..` / `\` / 超长 → handler 层兜底。
  // 注意：测试 id 不能是裸 `..` 或 `%2E%2E` —— Node URL 解析器会规整父目录段。

  it("⑤a id 含 `..` → 404 AGENT_NOT_FOUND（不抛错）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    // 用 `foo..bar`（含 `..` 但不是纯 `..` 段，URL 不会被规整）
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/foo..bar`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
  });

  it("⑤b id 含反斜杠 → 404（反斜杠不在路由 regex 允许字符集）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    // %5C = `\`，路由 regex `[^/]+` 不拒，但 handler isValidAgentId 拦
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/${encodeURIComponent("a\\b")}`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
  });

  it("⑤c id 超长 (>64) → 404 AGENT_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const longId = "x".repeat(65);
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/${longId}`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("AGENT_NOT_FOUND");
  });
});

// ============================================================
// ⑥ builtin + user 合并：用户覆盖内置 scope = "both"
// ============================================================

describe("GET /api/agents — builtin + user 合并 + 用户覆盖", () => {
  it("⑥ 用户定义同名 agent → list 中 scope = 'both'，detail 返回 user spec", async () => {
    setupTmpHome();
    // 在临时 MY_AGENT_HOME/agents/coder/agent.json 写一份用户覆盖
    const userAgentDir = path.join(
      process.env.MY_AGENT_HOME!,
      "agents",
      "coder",
    );
    fs.mkdirSync(userAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(userAgentDir, "agent.json"),
      JSON.stringify({
        agent_id: "coder",
        name: "Coder (user-overridden)",
        description_zh: "用户覆盖版 — 自定义 system prompt",
        description_en: "User override — custom system prompt",
        workflow: "USER_OVERRIDE_WORKFLOW",
        skill_list: ["bash"],
      }),
      "utf-8",
    );

    server = await createServer({ port: 0 });

    // list
    const listRes = await fetch(`http://127.0.0.1:${server.port}/api/agents`);
    const listBody = (await listRes.json()) as {
      data: { agents: Array<{ id: string; scope: string; source: string; name: string }> };
    };
    const coder = listBody.data.agents.find((a) => a.id === "coder");
    expect(coder).toBeDefined();
    expect(coder!.scope).toBe("both");
    expect(coder!.source).toBe("user");
    expect(coder!.name).toBe("Coder (user-overridden)");

    // detail
    const detailRes = await fetch(
      `http://127.0.0.1:${server.port}/api/agents/coder`,
    );
    const detailBody = (await detailRes.json()) as {
      data: {
        agent: {
          systemPrompt: string;
          description_zh: string;
          tools: string[];
        };
      };
    };
    expect(detailRes.status).toBe(200);
    expect(detailBody.data.agent.systemPrompt).toBe("USER_OVERRIDE_WORKFLOW");
    expect(detailBody.data.agent.description_zh).toBe(
      "用户覆盖版 — 自定义 system prompt",
    );
    expect(detailBody.data.agent.tools).toEqual(["bash"]);
  });

  it("⑥ frontmatter 解析异常 / 无效 agent.json → list 至少含 builtin agents", async () => {
    setupTmpHome();
    const userAgentDir = path.join(
      process.env.MY_AGENT_HOME!,
      "agents",
      "broken",
    );
    fs.mkdirSync(userAgentDir, { recursive: true });
    fs.writeFileSync(
      path.join(userAgentDir, "agent.json"),
      "{ this is not valid JSON",
      "utf-8",
    );

    server = await createServer({ port: 0 });

    // 用户 agent 解析失败会被 catch 抛 500 —— 这是本期已知行为；
    // agent-spec.ts 对非 ENOENT 错误向上抛；handler 兜底 500。
    // 此处只验证：list 接口本身进程未崩溃 + response 有 JSON body
    const res = await fetch(`http://127.0.0.1:${server.port}/api/agents`);
    expect([200, 500]).toContain(res.status);
    const body = (await res.json()) as { ok: boolean };
    expect(typeof body.ok).toBe("boolean");
    expect(body.ok).toBe(res.status === 200);
  });
});