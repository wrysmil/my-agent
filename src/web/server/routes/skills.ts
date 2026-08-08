/**
 * my-agent Web 前端 — Skill 域 GET 路由（WU-02c / B4）。
 *
 * 来源：spec § 3.1.4 / § 6.2 + contract § 1 / § 3。
 *
 * ## 路由
 *
 * - `GET /api/skills`     → 列表（来自 user skills 目录 + builtin fixtures）
 * - `GET /api/skills/:id` → 详情（含正文 body、完整 SKILL.md frontmatter）
 *
 * ## 数据源
 *
 * 完全复用 `src/skills/loader.ts` 的静态 API，**不**重新解析磁盘：
 * - `SkillLoader.scan(dir, source)` — 扫描目录返回 `SkillSpec[]`
 * - `SkillLoader.load(spec)` — 读完整内容（含 body）
 *
 * 扫描根：
 * - builtin：`fixtures/skills/`（与 skill-loader test 同源）
 * - user：`{dataRoot}/skills/`
 * - marketplace：`{dataRoot}/marketplace/skills/`（future）
 *
 * ## 行为
 *
 * - 全部只读，无副作用
 * - 路径穿越防御：路由 regex `[^/]+` 拦 `/`；本层再校验 NUL / `..` / `\` / 超长
 * - 404 `SKILL_NOT_FOUND`：在任一来源查不到时
 * - frontmatter 解析异常由 `parseFrontmatter` 内吞（`buildSpec` 直接生成缺字段 spec）
 *
 * ## 字段映射
 *
 * | contract 字段        | 来源                        |
 * | -------------------- | --------------------------- |
 * | `id`                 | `SkillSpec.id`              |
 * | `name`               | `SkillSpec.name`            |
 * | `description`        | `description_zh ?? description_en` |
 * | `description_zh`     | `SkillSpec.description_zh`  |
 * | `description_en`     | `SkillSpec.description_en`  |
 * | `source`             | `"builtin" \| "user" \| "marketplace"` |
 * | `scope`              | 同 `source`（无覆盖机制） |
 * | `body`               | SKILL.md 全文（详情接口）   |
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  SkillLoader,
  type SkillSpec,
  pickDescription,
} from "../../../skills/index.js";
import {
  dataRoot,
  userSkillsDir,
  userMarketplaceSkillsDir,
} from "../../../storage/paths.js";

// ============================================================
// 仓库内置 skill 目录（与 fixtures/skills/ 对齐）
// ============================================================

let _builtinSkillsDir: string | null | undefined;

/** 返回项目内置 skill 目录绝对路径（`fixtures/skills/`），不存在返回 null */
function builtinSkillsDir(): string | null {
  if (_builtinSkillsDir !== undefined) return _builtinSkillsDir;
  try {
    const dir = fileURLToPath(
      new URL("../../../../fixtures/skills", import.meta.url),
    );
    _builtinSkillsDir = fs.existsSync(dir) ? dir : null;
  } catch {
    _builtinSkillsDir = null;
  }
  return _builtinSkillsDir;
}

/** 仅测试用：重置内置目录缓存 */
export function _resetBuiltinSkillsDir(): void {
  _builtinSkillsDir = undefined;
}

// ============================================================
// 项目根 skills/ 目录（25 个预置 skill —— 与 CLI 共用）
// ============================================================

let _projectSkillsDir: string | null | undefined;

/** 返回项目根目录 skills/ 的绝对路径，不存在返回 null */
function projectSkillsDir(): string | null {
  if (_projectSkillsDir !== undefined) return _projectSkillsDir;
  try {
    const dir = fileURLToPath(
      new URL("../../../../skills", import.meta.url),
    );
    _projectSkillsDir = fs.existsSync(dir) ? dir : null;
  } catch {
    _projectSkillsDir = null;
  }
  return _projectSkillsDir;
}

/** 仅测试用 */
export function _resetProjectSkillsDir(): void {
  _projectSkillsDir = undefined;
}

// ============================================================
// 公共类型 — API 响应 shape
// ============================================================

export type SkillListItem = {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "user" | "marketplace";
  scope: "builtin" | "user" | "marketplace";
};

/** 单个 skill 详情（在 list 基础上加 body + 完整 description） */
export type SkillDetail = SkillListItem & {
  description_zh: string;
  description_en: string;
  /** SKILL.md 全文（frontmatter 已剥离） */
  body: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiError = {
  ok: false;
  error: { code: string; message: string };
};

// ============================================================
// 发现逻辑（同时被 list / detail 复用）
// ============================================================

interface SkillEntry {
  spec: SkillSpec;
  source: "builtin" | "user" | "marketplace";
}

/**
 * 发现全部 skill。
 *
 * 优先级：
 * 1. builtin（fixtures/skills/）
 * 2. marketplace（{dataRoot}/marketplace/skills/）—— 当前无内置 marketplace 测试夹具
 * 3. user（{dataRoot}/skills/）—— 用户自定义，覆盖前面同名条目
 *
 * 错误容忍：
 * - 单个目录失败（ENOENT / EACCES / frontmatter 解析异常）→ 跳过该目录
 * - 单个 SKILL.md 失败（已被 `SkillLoader.scan` 吞掉）→ 仅丢该条目
 */
function discoverSkillsSync(): SkillEntry[] {
  const builtinDir = builtinSkillsDir();
  const projSkills = projectSkillsDir();
  const userDir = userSkillsDir();
  const marketDir = userMarketplaceSkillsDir();

  const entries: SkillEntry[] = [];

  // 1. fixtures/skills/（hello-skill 等测试夹具）
  if (builtinDir) {
    for (const spec of SkillLoader.scan(builtinDir, "system")) {
      entries.push({ spec, source: "builtin" });
    }
  }
  // 2. 项目根 skills/（25 个预置 skill，与 CLI 共用）
  if (projSkills) {
    for (const spec of SkillLoader.scan(projSkills, "system")) {
      entries.push({ spec, source: "builtin" });
    }
  }
  // 3. marketplace（{dataRoot}/marketplace/skills/）
  for (const spec of SkillLoader.scan(marketDir, "marketplace")) {
    entries.push({ spec, source: "marketplace" });
  }
  // 4. user 自定义可覆盖前面同名条目（保持去重，user 优先）
  const seen = new Set(entries.map((e) => e.spec.id));
  for (const spec of SkillLoader.scan(userDir, "user")) {
    if (seen.has(spec.id)) {
      const idx = entries.findIndex((e) => e.spec.id === spec.id);
      if (idx >= 0) entries[idx] = { spec, source: "user" };
    } else {
      entries.push({ spec, source: "user" });
      seen.add(spec.id);
    }
  }

  return entries;
}

// ============================================================
// spec → API 形状转换
// ============================================================

function toListItem(entry: SkillEntry): SkillListItem {
  return {
    id: entry.spec.id,
    name: entry.spec.name || entry.spec.id,
    description: pickDescription(entry.spec),
    source: entry.source,
    scope: entry.source,
  };
}

function toDetail(entry: SkillEntry, body: string): SkillDetail {
  return {
    ...toListItem(entry),
    description_zh: entry.spec.description_zh ?? "",
    description_en: entry.spec.description_en ?? "",
    body,
  };
}

// ============================================================
// Path traversal 防御
// ============================================================

/**
 * 校验 `:id` 段合法（不含 NUL / `\` / `..` / 超长）。
 *
 * Skill id 通常来自 frontmatter，可能含中文 / 数字 / 字母 / `-` `_` `.`。
 * 为避免探测，本层只校验危险字符，长度 / 字符集允许 frontmatter 自然范围。
 *
 * 返回 `true` 表示合法；非法 id 直接 404。
 */
function isValidSkillId(id: string): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 256) return false;
  if (id.includes("\0") || id.includes("\\") || id.includes("..")) return false;
  if (id.includes("/")) return false;
  return true;
}

// ============================================================
// HTTP helpers
// ============================================================

function sendJson<T>(res: ServerResponse, status: number, body: T): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendOk<T>(res: ServerResponse, data: T): void {
  sendJson<ApiOk<T>>(res, 200, { ok: true, data });
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson<ApiError>(res, status, { ok: false, error: { code, message } });
}

// ============================================================
// Handlers（导出，router.ts mutate / 替换）
// ============================================================

/**
 * `GET /api/skills` — 列出全部 skill。
 *
 * 响应：`{ ok: true, data: { skills: SkillListItem[] } }`
 */
export function listSkillsHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): void {
  try {
    const entries = discoverSkillsSync();
    const items = entries.map(toListItem);
    sendOk(res, { skills: items });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "internal error",
    );
  }
}

/**
 * `GET /api/skills/:id` — 单个 skill 详情（含 body）。
 *
 * - 命中：200 + `{ ok: true, data: { skill: SkillDetail } }`
 * - 未命中 / 非法 id：404 + `{ ok: false, error: { code: "SKILL_NOT_FOUND", ... } }`
 */
export function getSkillHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const id = params.id ?? "";

  // 非法 id → 404 静默（与「未命中」同语义）
  if (!isValidSkillId(id)) {
    sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
    return;
  }

  try {
    const entries = discoverSkillsSync();
    const entry = entries.find((e) => e.spec.id === id);
    if (!entry) {
      sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
      return;
    }

    // 读取 SKILL.md 完整正文（不缓存；磁盘现读）
    const content = SkillLoader.load(entry.spec);
    if (!content) {
      // spec 在但 disk 文件已不在（被并发删除）→ 视为 not found
      sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
      return;
    }

    sendOk(res, { skill: toDetail(entry, content.body) });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "internal error",
    );
  }
}

// ============================================================
// CRUD Handlers（写入 user skills 目录）
// ============================================================

/**
 * `POST /api/skills` — 创建新 skill。
 *
 * body: { id, name, description_zh?, description_en?, body }
 * 写入 `{userSkillsDir()}/{id}/SKILL.md`
 *
 * - id 已存在 → 409 SKILL_ALREADY_EXISTS
 * - 201 Created + SkillListItem
 */
export async function createSkillHandler(
  req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): Promise<void> {
  let body: { id?: string; name?: string; description_zh?: string; description_en?: string; body?: string };
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(res, 400, "INVALID_JSON", err instanceof Error ? err.message : "Invalid JSON");
    return;
  }

  const id = (body.id ?? "").trim();
  if (!isValidSkillId(id)) {
    sendError(res, 422, "VALIDATION_FAILED", "Invalid skill id");
    return;
  }
  if (!body.name?.trim()) {
    sendError(res, 422, "VALIDATION_FAILED", "name is required");
    return;
  }

  const userDir = userSkillsDir();
  const skillDir = path.join(userDir, id);

  if (fs.existsSync(skillDir)) {
    sendError(res, 409, "SKILL_ALREADY_EXISTS", `Skill "${id}" already exists`);
    return;
  }

  try {
    const frontmatter = buildFrontmatter({
      id,
      name: body.name.trim(),
      description_zh: body.description_zh ?? "",
      description_en: body.description_en ?? "",
    });
    const skillMd = `---\n${frontmatter}---\n\n${body.body ?? ""}`;
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

    // 清除扫描缓存
    _builtinSkillsDir = undefined;
    _projectSkillsDir = undefined;

    sendJson(res, 201, {
      ok: true,
      data: {
        id,
        name: body.name.trim(),
        description: body.description_zh || body.description_en || "",
        source: "user",
        scope: "user",
      },
    });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Failed to create skill",
    );
  }
}

/**
 * `PUT /api/skills/:id` — 更新 skill 正文。
 *
 * body: { name?, description_zh?, description_en?, body? }
 * 只支持更新 user source 的 skill；builtin 不可编辑。
 * 200 OK + 更新后的 SkillListItem
 */
export async function updateSkillHandler(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const id = params.id ?? "";
  if (!isValidSkillId(id)) {
    sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
    return;
  }

  const entries = discoverSkillsSync();
  const entry = entries.find((e) => e.spec.id === id);
  if (!entry) {
    sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
    return;
  }
  if (entry.source !== "user") {
    sendError(res, 403, "FORBIDDEN", "Only user-created skills can be edited");
    return;
  }

  let body: { name?: string; description_zh?: string; description_en?: string; body?: string };
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(res, 400, "INVALID_JSON", err instanceof Error ? err.message : "Invalid JSON");
    return;
  }

  try {
    const content = SkillLoader.load(entry.spec);
    if (!content) {
      sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" file missing`);
      return;
    }

    const frontmatter = buildFrontmatter({
      id,
      name: body.name ?? entry.spec.name ?? id,
      description_zh: body.description_zh ?? entry.spec.description_zh ?? "",
      description_en: body.description_en ?? entry.spec.description_en ?? "",
    });
    const skillMd = `---\n${frontmatter}---\n\n${body.body ?? content.body}`;
    fs.writeFileSync(entry.spec.skillFile, skillMd, "utf-8");

    // 清除扫描缓存
    _builtinSkillsDir = undefined;
    _projectSkillsDir = undefined;

    sendOk(res, {
      id,
      name: body.name ?? entry.spec.name ?? id,
      description: body.description_zh || body.description_en || content.description_zh || content.description_en || "",
      source: "user",
      scope: "user",
    });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Failed to update skill",
    );
  }
}

/**
 * `DELETE /api/skills/:id` — 删除 skill 目录。
 *
 * 只支持删除 user source 的 skill。
 * 200 OK + { deleted: id }
 */
export async function deleteSkillHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const id = params.id ?? "";
  if (!isValidSkillId(id)) {
    sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
    return;
  }

  const entries = discoverSkillsSync();
  const entry = entries.find((e) => e.spec.id === id);
  if (!entry) {
    sendError(res, 404, "SKILL_NOT_FOUND", `Skill "${id}" not found`);
    return;
  }
  if (entry.source !== "user") {
    sendError(res, 403, "FORBIDDEN", "Only user-created skills can be deleted");
    return;
  }

  try {
    const skillDir = path.dirname(entry.spec.skillFile);
    fs.rmSync(skillDir, { recursive: true, force: true });

    // 清除扫描缓存
    _builtinSkillsDir = undefined;
    _projectSkillsDir = undefined;

    sendOk(res, { deleted: id });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Failed to delete skill",
    );
  }
}

// ============================================================
// CRUD 工具
// ============================================================

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function buildFrontmatter(opts: {
  id: string;
  name: string;
  description_zh: string;
  description_en: string;
}): string {
  const lines: string[] = [];
  lines.push(`id: ${opts.id}`);
  lines.push(`name: ${opts.name}`);
  if (opts.description_zh) lines.push(`description_zh: |\n  ${opts.description_zh}`);
  if (opts.description_en) lines.push(`description_en: |\n  ${opts.description_en}`);
  return lines.join("\n");
}