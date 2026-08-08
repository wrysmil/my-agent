/**
 * my-agent Web 前端 — Skill 域 GET 路由测试（WU-02c / B4）。
 *
 * 来源：spec § 3.1.4 + contract § 1 / § 3。
 *
 * 覆盖：
 * - ① list 非空（fixtures 内置 hello-skill）
 * - ② get by id 命中 → 完整 shape 校验（含 body）
 * - ③ get by id 404 → SKILL_NOT_FOUND
 * - ④ list shape 校验
 * - ⑤ 路径穿越防御（NUL / `..` / `\` / 超长）
 * - ⑥ frontmatter parse 异常 / SKILL.md 缺失跳过（健壮性）
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
  listSkillsHandler,
  getSkillHandler,
  _resetBuiltinSkillsDir,
} from "./skills.js";

// ============================================================
// 共享 setup
// ============================================================

let server: WebServer | undefined;
let origDataRoot: string | undefined;
let tmpHomeRoot: string | undefined;

function setupTmpHome(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-skills-test-"));
  tmpHomeRoot = tmp;
  const fakeHome = path.join(tmp, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env.MY_AGENT_HOME = path.join(fakeHome, ".my-agent");
  _resetDataRoot();
  _resetBuiltinSkillsDir();
  return tmp;
}

function teardownTmpHome(): void {
  delete process.env.MY_AGENT_HOME;
  if (origDataRoot !== undefined) {
    process.env.MY_AGENT_HOME = origDataRoot;
  }
  origDataRoot = undefined;
  if (tmpHomeRoot) {
    fs.rmSync(tmpHomeRoot, { recursive: true, force: true });
    tmpHomeRoot = undefined;
  }
  _resetDataRoot();
  _resetBuiltinSkillsDir();
}

beforeEach(() => {
  origDataRoot = process.env.MY_AGENT_HOME;
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

// ============================================================
// 路由表 + handler 替换
// ============================================================

/**
 * 模块加载时立即 mutate ROUTES 槽位 —— vitest 各 describe 块按声明顺序执行，
 * 不在 module-load 时注册则其它 test 会先于 mutate 执行拿到 placeholder handler。
 */
const _listIdx = ROUTES.findIndex(
  ([m, p]) => m === "GET" && p === "/api/skills",
);
const _getIdx = ROUTES.findIndex(
  ([m, p]) =>
    m === "GET" &&
    typeof p === "object" &&
    p.source === String.raw`^\/api\/skills\/([^/]+)$`,
);

if (_listIdx >= 0) {
  ROUTES[_listIdx][2] = listSkillsHandler as unknown as typeof ROUTES[number][2];
}
if (_getIdx >= 0) {
  ROUTES[_getIdx][2] = getSkillHandler as unknown as typeof ROUTES[number][2];
}

describe("skills routes — 路由表 / handler 替换", () => {
  it("ROUTES 表里 /api/skills 与 /api/skills/:id 槽位由 skill handler 替换", () => {
    expect(_listIdx).toBeGreaterThanOrEqual(0);
    expect(_getIdx).toBeGreaterThanOrEqual(0);

    const listMatch = matchRoute("GET", "/api/skills");
    expect(listMatch).not.toBeNull();
    expect(listMatch?.handler).toBe(listSkillsHandler);

    const detailMatch = matchRoute("GET", "/api/skills/hello-skill");
    expect(detailMatch).not.toBeNull();
    expect(detailMatch?.handler).toBe(getSkillHandler);
    expect(detailMatch?.params).toEqual({ id: "hello-skill" });
  });
});

// ============================================================
// ① list 非空
// ============================================================

describe("GET /api/skills — 列表", () => {
  it("① 返回非空 skills 数组（含 fixtures 内置 hello-skill）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/skills`);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { skills: Array<{ id: string }> };
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data?.skills)).toBe(true);
    expect(body.data!.skills.length).toBeGreaterThan(0);

    const ids = body.data!.skills.map((s) => s.id);
    expect(ids).toContain("hello-skill");
  });

  it("④ list shape 校验（含 id/name/description/source/scope）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/skills`);
    const body = (await res.json()) as {
      data: {
        skills: Array<{
          id: string;
          name: string;
          description: string;
          source: string;
          scope: string;
        }>;
      };
    };

    const skill = body.data.skills.find((s) => s.id === "hello-skill");
    expect(skill).toBeDefined();
    expect(skill!.id).toBe("hello-skill");
    expect(skill!.name).toBe("Hello Skill");
    expect(skill!.description).toBeTruthy();
    expect(skill!.source).toBe("builtin");
    expect(skill!.scope).toBe("builtin");
  });
});

// ============================================================
// ② get by id 命中
// ============================================================

describe("GET /api/skills/:id — 详情", () => {
  it("② 命中 → 200 + 完整 detail shape（含 body / description_zh / description_en）", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/hello-skill`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      data?: {
        skill: {
          id: string;
          name: string;
          description: string;
          description_zh: string;
          description_en: string;
          source: string;
          scope: string;
          body: string;
        };
      };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const skill = body.data!.skill;
    expect(skill.id).toBe("hello-skill");
    expect(skill.name).toBe("Hello Skill");
    expect(skill.description_zh).toContain("演示技能");
    expect(skill.description_en).toContain("Demo skill");
    expect(skill.source).toBe("builtin");
    expect(skill.scope).toBe("builtin");
    expect(typeof skill.body).toBe("string");
    expect(skill.body.length).toBeGreaterThan(0);
    // body 不应再含 frontmatter（已被 parseFrontmatter 剥离）
    expect(skill.body).not.toMatch(/^---/);
    expect(skill.body).toContain("Hello Skill");
  });
});

// ============================================================
// ③ get by id 404
// ============================================================

describe("GET /api/skills/:id — 404 SKILL_NOT_FOUND", () => {
  it("③ 不存在的 id → 404 + SKILL_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/no-such-skill-xyz`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SKILL_NOT_FOUND");
    expect(body.error.message).toBeTruthy();
  });
});

// ============================================================
// ⑤ 路径穿越防御
// ============================================================

describe("GET /api/skills/:id — 路径穿越防御", () => {
  it("⑤a id 含 `..` → 404 SKILL_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    // 用 `foo..bar` 验证路径穿越防御；不能用裸 `..` 或 `%2E%2E`，
    // Node URL 解析器会解码后规整掉父目录段
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/foo..bar`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("SKILL_NOT_FOUND");
  });

  it("⑤b id 含反斜杠 → 404 SKILL_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/${encodeURIComponent("a\\b")}`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("SKILL_NOT_FOUND");
  });

  it("⑤c id 超长 (>256) → 404 SKILL_NOT_FOUND", async () => {
    setupTmpHome();
    server = await createServer({ port: 0 });

    const longId = "x".repeat(257);
    const res = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/${longId}`,
    );
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string };
    };
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("SKILL_NOT_FOUND");
  });
});

// ============================================================
// ⑥ 健壮性：异常 SKILL.md / 缺失目录
// ============================================================

describe("GET /api/skills — 健壮性", () => {
  it("⑥ frontmatter parse 异常或目录不存在 → 跳过该条目，其他正常返回", async () => {
    setupTmpHome();

    // 在用户 skills 目录写一个无效 frontmatter 的 SKILL.md
    const userSkillsDir = path.join(
      process.env.MY_AGENT_HOME!,
      "skills",
      "broken-skill",
    );
    fs.mkdirSync(userSkillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSkillsDir, "SKILL.md"),
      "---\nid: \nname: \n: : invalid\n---",
      "utf-8",
    );

    server = await createServer({ port: 0 });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/skills`);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { skills: Array<{ id: string }> };
    };

    // 即使 broken-skill 解析异常，list 仍应 200 + 至少含 builtin hello-skill
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const ids = (body.data?.skills ?? []).map((s) => s.id);
    expect(ids).toContain("hello-skill");
  });
});