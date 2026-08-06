/**
 * run-skill.cjs 统一脚本执行入口测试
 *
 * 通过 spawn 子进程调用 bin/run-skill.cjs，用临时 MY_AGENT_HOME 隔离，
 * 在测试内创建 skill 目录结构，不污染真实 ~/.my-agent。
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runSkillPath = path.join(projectRoot, "bin", "run-skill.cjs");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(home: string, ...args: string[]): RunResult {
  const res = spawnSync(process.execPath, [runSkillPath, ...args], {
    env: { ...process.env, MY_AGENT_HOME: home },
    encoding: "utf8",
  });
  return {
    status: res.status,
    stdout: res.stdout?.toString() ?? "",
    stderr: res.stderr?.toString() ?? "",
  };
}

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-runskill-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** 在 MY_AGENT_HOME 下创建 skill 目录与脚本文件 */
function writeSkill(relDir: string, skillId: string, files: Record<string, string>): void {
  const scriptsDir = path.join(home, relDir, skillId, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(scriptsDir, name), content, "utf8");
  }
}

const marketplaceRel = path.join("marketplace", "skills");

let pyAvailable: boolean;

beforeAll(() => {
  const pyExe = process.platform === "win32" ? "py" : "python3";
  const args = process.platform === "win32" ? ["-3", "--version"] : ["--version"];
  pyAvailable = spawnSync(pyExe, args, { encoding: "utf8" }).status === 0;
});

describe("run-skill.cjs 参数校验", () => {
  it("scriptBase 含 .. 时拒绝并 exit 64（JSON error 含 ..）", () => {
    const res = runCli(home, "hello-skill", "../x");
    expect(res.status).toBe(64);
    expect(res.stderr).toContain('"ok":false');
    expect(res.stderr).toContain("..");
  });

  it("skillId 含路径穿越字符时拒绝（路径穿越防护）", () => {
    const res = runCli(home, "../evil", "main");
    expect(res.status).toBe(64);
    expect(res.stderr).toContain("..");
  });

  it("缺少参数时输出用法错误", () => {
    const res = runCli(home, "hello-skill");
    expect(res.status).toBe(64);
    expect(res.stderr).toContain("usage");
  });

  it("scriptBase 含单个 . 时不被拒绝（如 main.test）", () => {
    writeSkill("skills", "hello-skill", {
      "main.test.mjs":
        'export default async function () { return { ok: true, dotted: true }; }\n',
    });
    const res = runCli(home, "hello-skill", "main.test");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"dotted":true');
  });
});

describe("run-skill.cjs 脚本发现与执行", () => {
  it("custom skill 的 .mjs 脚本返回对象时 JSON 输出到 stdout", () => {
    writeSkill("skills", "hello-skill", {
      "main.mjs":
        'export default async function (ctx) { return { ok: true, hello: "world", skillId: ctx.skillId }; }\n',
    });
    const res = runCli(home, "hello-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"ok":true');
    expect(res.stdout).toContain('"hello":"world"');
    expect(res.stdout).toContain('"skillId":"hello-skill"');
  });

  it(".py 脚本通过 py -3（Windows）/ python3（POSIX）运行", () => {
    writeSkill("skills", "hello-skill", {
      "main.py": 'import json\nprint(json.dumps({"ok": True, "hello": "python"}))\n',
    });
    const res = runCli(home, "hello-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("python");
    expect(res.stdout).toContain('"ok": true');
  });

  it("custom 与 marketplace 同 id 都有脚本时运行 custom 版", () => {
    writeSkill("skills", "hello-skill", {
      "main.mjs": 'export default async function () { return { source: "custom" }; }\n',
    });
    writeSkill(marketplaceRel, "hello-skill", {
      "main.mjs": 'export default async function () { return { source: "marketplace" }; }\n',
    });
    const res = runCli(home, "hello-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"source":"custom"');
  });

  it("仅 marketplace 有脚本时运行 marketplace 版", () => {
    writeSkill(marketplaceRel, "hello-skill", {
      "main.mjs": 'export default async function () { return { source: "marketplace" }; }\n',
    });
    const res = runCli(home, "hello-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"source":"marketplace"');
  });

  it("缺少脚本时输出 JSON error 与 searched 列表并 exit 64", () => {
    writeSkill("skills", "hello-skill", {
      "main.mjs": "export default async function () {}\n",
    });
    const res = runCli(home, "hello-skill", "nope");
    expect(res.status).toBe(64);
    const payload = JSON.parse(res.stderr) as {
      ok: boolean;
      error: string;
      searched: string[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("not found");
    expect(Array.isArray(payload.searched)).toBe(true);
    expect(payload.searched.some((p) => p.includes("nope.mjs"))).toBe(true);
  });

  it("将 -- 后的参数传给入口函数 ctx.args", () => {
    writeSkill("skills", "arg-skill", {
      "main.mjs": "export default async function (ctx) { return { args: ctx.args }; }\n",
    });
    const res = runCli(home, "arg-skill", "main", "--", "hello", "world");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"args":["hello","world"]');
  });
});

describe("run-skill.cjs 脚本加载规则", () => {
  it(".js 脚本的 ESM export default 被 import() 正确加载（D2 回归）", () => {
    // .js 是否按 ESM 解析取决于最近 package.json 的 type 字段，这里在 home 根声明
    fs.writeFileSync(
      path.join(home, "package.json"),
      JSON.stringify({ type: "module" }),
      "utf8",
    );
    writeSkill("skills", "d2-skill", {
      "main.js": 'export default async function (ctx) { return { ok: true, esm: true }; }\n',
    });
    const res = runCli(home, "d2-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"esm":true');
  });

  it(".cjs 脚本通过 require() 加载 module.exports", () => {
    writeSkill("skills", "cjs-skill", {
      "main.cjs": "module.exports = async function () { return { ok: true, cjs: true }; };\n",
    });
    const res = runCli(home, "cjs-skill", "main");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"cjs":true');
  });

  it("脚本抛错时输出 JSON error 并非零退出", () => {
    writeSkill("skills", "boom-skill", {
      "main.mjs": 'export default async function () { throw new Error("boom"); }\n',
    });
    const res = runCli(home, "boom-skill", "main");
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('"ok":false');
    expect(res.stderr).toContain("boom");
  });
});
