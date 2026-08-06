#!/usr/bin/env node
// run-skill.cjs — Skill 脚本统一执行入口（CommonJS，平台无关）
//
// 用法：node <APP_DIR>/bin/run-skill.cjs <skill-id-or-name> <script-basename> [-- args...]
//
// 约定（对齐 docs/plan/Skill系统实现文档.md §S1.7，审查 D2/D3 修订）：
// - 不依赖 MY_NODE / APP_DIR 环境变量：Node 用 process.execPath，自身位置用 __dirname。
// - 数据根 = process.env.MY_AGENT_HOME ?? ~/.my-agent；skills/ 与 marketplace/skills/ 分列其下。
// - 搜索顺序：custom(skills) → marketplace(marketplace/skills)；扩展名顺序按平台分支。
// - .mjs/.js 用动态 import()（本项目 "type": "module"，.js 按 ESM 解析，勿用 require()）；
//   .cjs 用 require() + module.exports；.ts 本阶段不执行；.py 用 py -3 / python3 spawn。
// - 失败：stderr 打 JSON { ok:false, error, searched? }；找不到脚本 / 参数非法 exit 64。

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const EXIT_USAGE = 64; // 参数/校验失败、找不到脚本（对齐验收表）
const EXIT_ERROR = 1; // 加载/执行失败

const EXT_ORDER_WINDOWS = ["py", "ts", "mjs", "js", "cjs", "ps1", "cmd", "bat", "sh", "rb"];
const EXT_ORDER_POSIX = ["py", "ts", "mjs", "js", "cjs", "sh", "rb", "ps1"];

// 与 src/storage/paths.ts 的 assertPathSegment 相同语义（run-skill.cjs 独立，不 import TS）
const FORBIDDEN_IN_SEGMENT = /[\/\\\0]/;

function assertPathSegment(segment, label) {
  if (!segment || typeof segment !== "string") {
    throw new Error(`invalid ${label} for path: ${JSON.stringify(segment)}`);
  }
  if (segment.includes("..")) {
    throw new Error(
      `invalid ${label} for path (contains ".."): ${JSON.stringify(segment)}`,
    );
  }
  if (FORBIDDEN_IN_SEGMENT.test(segment)) {
    throw new Error(
      `invalid ${label} for path (forbidden char): ${JSON.stringify(segment)}`,
    );
  }
  return segment;
}

function dataRoot() {
  return process.env.MY_AGENT_HOME || path.join(os.homedir(), ".my-agent");
}

function skillRoots() {
  const root = dataRoot();
  return [path.join(root, "skills"), path.join(root, "marketplace", "skills")];
}

function extOrder() {
  return process.platform === "win32" ? EXT_ORDER_WINDOWS : EXT_ORDER_POSIX;
}

function errMsg(err) {
  return err && err.message ? err.message : String(err);
}

function fail(payload, exitCode) {
  process.stderr.write(JSON.stringify(payload) + "\n");
  process.exitCode = exitCode;
}

// 解析：<skill-id-or-name> <script-basename> [-- args...]
// 无 `--` 时，scriptBase 之后的额外位置参数也视为 args（对调用方更宽容）。
function parseArgv(argv) {
  const sep = argv.indexOf("--");
  const head = sep === -1 ? argv : argv.slice(0, sep);
  const args = sep === -1 ? argv.slice(2) : argv.slice(sep + 1);
  if (head.length < 2) {
    throw new Error(
      "usage: node <APP_DIR>/bin/run-skill.cjs <skill-id-or-name> <script-basename> [-- args...]",
    );
  }
  return { skillId: head[0], scriptBase: head[1], args };
}

async function invokeEntry(fn, ctx) {
  let result;
  try {
    result = await fn(ctx);
  } catch (err) {
    fail({ ok: false, error: `script execution failed: ${errMsg(err)}` }, EXIT_ERROR);
    return;
  }
  if (result !== undefined) {
    process.stdout.write(JSON.stringify(result) + "\n");
  }
}

async function loadAndRunJs(scriptPath, ctx) {
  let mod;
  try {
    mod = await import(pathToFileURL(scriptPath).href);
  } catch (err) {
    fail({ ok: false, error: `failed to load script: ${errMsg(err)}` }, EXIT_ERROR);
    return;
  }
  const fn = mod && mod.default !== undefined ? mod.default : mod;
  if (typeof fn !== "function") {
    fail({ ok: false, error: `script entry is not a function: ${scriptPath}` }, EXIT_ERROR);
    return;
  }
  await invokeEntry(fn, ctx);
}

function loadAndRunCjs(scriptPath, ctx) {
  let mod;
  try {
    mod = require(scriptPath);
  } catch (err) {
    fail({ ok: false, error: `failed to load script: ${errMsg(err)}` }, EXIT_ERROR);
    return;
  }
  const fn = mod && mod.default !== undefined ? mod.default : mod;
  if (typeof fn !== "function") {
    fail({ ok: false, error: `script entry is not a function: ${scriptPath}` }, EXIT_ERROR);
    return;
  }
  return invokeEntry(fn, ctx);
}

function runPython(scriptPath, ctx) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const pyExe = win ? "py" : "python3";
    const pyArgs = win ? ["-3", scriptPath, ...ctx.args] : [scriptPath, ...ctx.args];
    const child = spawn(pyExe, pyArgs, { stdio: ["ignore", "inherit", "inherit"] });
    let settled = false;
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      fail({ ok: false, error: `failed to spawn ${pyExe}: ${errMsg(err)}` }, EXIT_ERROR);
      resolve();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) process.exitCode = code ?? EXIT_ERROR;
      resolve();
    });
  });
}

async function main() {
  let skillId;
  let scriptBase;
  let args;
  try {
    const parsed = parseArgv(process.argv.slice(2));
    skillId = assertPathSegment(parsed.skillId, "skillId");
    scriptBase = assertPathSegment(parsed.scriptBase, "scriptBase");
    args = parsed.args;
  } catch (err) {
    fail({ ok: false, error: errMsg(err) }, EXIT_USAGE);
    return;
  }

  const searched = [];
  for (const root of skillRoots()) {
    const skillDir = path.join(root, skillId);
    for (const ext of extOrder()) {
      const candidate = path.join(skillDir, "scripts", `${scriptBase}.${ext}`);
      searched.push(candidate);
      if (!fs.existsSync(candidate)) continue;
      const ctx = { args, skillId, skillDir };
      if (ext === "mjs" || ext === "js") {
        await loadAndRunJs(candidate, ctx);
        return;
      }
      if (ext === "cjs") {
        await loadAndRunCjs(candidate, ctx);
        return;
      }
      if (ext === "ts") {
        fail(
          { ok: false, error: `.ts script execution is not supported in this phase: ${candidate}` },
          EXIT_ERROR,
        );
        return;
      }
      if (ext === "py") {
        await runPython(candidate, ctx);
        return;
      }
      fail({ ok: false, error: `unsupported script extension: ${ext} (${candidate})` }, EXIT_ERROR);
      return;
    }
  }

  fail(
    { ok: false, error: `skill script not found: ${skillId}/${scriptBase}`, searched },
    EXIT_USAGE,
  );
}

main().catch((err) => {
  fail({ ok: false, error: errMsg(err) }, EXIT_ERROR);
});
