/**
 * Skills IPC — 接入 SkillLoader 扫描磁盘 skill 目录，
 * 同步到 DB `skills_index` 表，供 Skills 管理页展示真实数据。
 *
 * 协议（与 electron/renderer/js/api.js `skills` 命名空间一致）：
 * - `skills:list`       → SkillLoader.scan() 扫描 → 同步 DB skills_index → 返回 SkillListItem[]
 * - `skills:get(id)`    → 读取指定 SKILL.md 内容（SkillContent | null）
 * - `skills:setEnabled` → 写 DB skills_index.enabled
 *
 * 说明：SkillLoader 的 scan / load 为静态实现；扫描结果同步到 DB 后，enabled 等
 * 持久化状态以 DB 为准（约束 #3 / #5），避免重复扫描破坏用户启停开关。
 */

import { ipcMain, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { SkillLoader, parseFrontmatter } from "../skills/loader.js";
import type { SkillSpec } from "../skills/types.js";
import { getDb } from "../storage/db.js";
import { builtinSkillsDir } from "../storage/paths.js";
import { readConfigFile } from "../storage/config-store.js";
import { CoreAgentConfigSchema } from "../config/schema.js";

/** `skills:list` 单条返回格式（WU-3.1 契约）。 */
export type SkillListItem = {
  id: string;
  name: string;
  description_zh: string;
  description_en: string;
  category?: string;
  source: string;
  enabled: boolean;
  version?: string;
};

/** skills_index 表行（better-sqlite3 返回未类型化，此处给出最小形状）。 */
type SkillDbRow = {
  id: string;
  name: string;
  description_zh: string;
  description_en: string;
  source: string;
  dir: string;
  enabled: number;
};

/** 读取配置中的 `evolution.skillsDir`（相对路径基于 app 根目录解析）；未配置返回 undefined。 */
function configSkillsDir(): string | undefined {
  try {
    const configPath = path.join(app.getPath("userData"), "config.json");
    const config = CoreAgentConfigSchema.parse(readConfigFile(configPath) ?? {});
    const dir = config.evolution.skillsDir;
    if (!dir) return undefined;
    return path.isAbsolute(dir) ? dir : path.join(app.getAppPath(), dir);
  } catch {
    // 配置缺失/解析失败 → 走默认路径
    return undefined;
  }
}

/**
 * 候选 skill 扫描目录（id 冲突时靠后的覆盖靠前的，与 loader 去重语义一致）。
 * 优先级从低到高：内置 `~/.my-agent/skills` → 项目 `skills/` → 环境变量 → 配置。
 */
function candidateSkillsDirs(): string[] {
  const dirs: string[] = [];
  const push = (d: string | undefined) => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };
  push(builtinSkillsDir());
  try {
    push(path.join(app.getAppPath(), "skills"));
  } catch {
    // app 未就绪时忽略项目目录
  }
  if (process.env.MY_AGENT_SKILLS_DIR) push(process.env.MY_AGENT_SKILLS_DIR);
  push(configSkillsDir());
  return dirs;
}

/** 扫描全部候选目录并按 id 去重合并（靠后的覆盖靠前的）。 */
function scanSkills(): SkillSpec[] {
  const merged = new Map<string, SkillSpec>();
  for (const dir of candidateSkillsDirs()) {
    for (const spec of SkillLoader.scan(dir, "user")) {
      merged.set(spec.id, spec);
    }
  }
  return [...merged.values()];
}

/** 读取 SKILL.md 的 frontmatter 原始键值（category/version 等 loader 未保留的字段）。 */
function readFrontmatterAttrs(spec: SkillSpec): Record<string, string> {
  try {
    const text = fs.readFileSync(spec.skillFile, "utf-8");
    return parseFrontmatter(text).attrs;
  } catch {
    return {};
  }
}

/** 将扫描结果同步到 skills_index 表（新 skill INSERT / 已有 skill UPDATE / 磁盘已删除标记 disabled）。 */
function syncSkillsToDb(specs: SkillSpec[]): void {
  const db = getDb();
  const now = Date.now();

  const upsert = db.prepare(`
    INSERT INTO skills_index (id, name, description_zh, description_en, source, dir, enabled, installed_at, updated_at)
    VALUES (@id, @name, @description_zh, @description_en, @source, @dir, 1, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name = @name,
      description_zh = @description_zh,
      description_en = @description_en,
      source = @source,
      dir = @dir,
      updated_at = @now
  `);

  const ids = specs.map((s) => s.id);
  const markMissing = () => {
    if (ids.length === 0) {
      db.prepare("UPDATE skills_index SET enabled = 0, updated_at = ?").run(now);
    } else {
      const ph = ids.map(() => "?").join(",");
      db.prepare(
        `UPDATE skills_index SET enabled = 0, updated_at = ? WHERE id NOT IN (${ph})`,
      ).run(now, ...ids);
    }
  };

  db.transaction(() => {
    for (const spec of specs) {
      upsert.run({
        id: spec.id,
        name: spec.name,
        description_zh: spec.description_zh,
        description_en: spec.description_en,
        source: spec.source,
        dir: spec.dir,
        now,
      });
    }
    markMissing();
  })();
}

/** 按 id 查找 SkillSpec（优先查 DB dir 索引；未同步/DB 不可用时回退磁盘扫描）。 */
function findSpec(id: string): SkillSpec | null {
  try {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT id, name, description_zh, description_en, source, dir FROM skills_index WHERE id = ?",
      )
      .get(id) as SkillDbRow | undefined;
    if (row) {
      return {
        id: row.id,
        name: row.name,
        description_zh: row.description_zh,
        description_en: row.description_en,
        dir: row.dir,
        skillFile: path.join(row.dir, "SKILL.md"),
        source: (row.source as SkillSpec["source"]) || "user",
      };
    }
  } catch {
    // DB 不可用 → 回退到磁盘扫描
  }
  return scanSkills().find((s) => s.id === id) ?? null;
}

/** `skills:list` 实现：扫描 → 同步 DB → 返回合并后的列表（enabled 以 DB 持久化状态为准）。 */
function listSkills(): SkillListItem[] {
  const specs = scanSkills();

  let enabledById = new Map<string, boolean>();
  try {
    const db = getDb();
    syncSkillsToDb(specs);
    const rows = db
      .prepare("SELECT id, enabled FROM skills_index")
      .all() as Array<{ id: string; enabled: number }>;
    enabledById = new Map(rows.map((r) => [r.id, r.enabled === 1]));
  } catch (err) {
    // DB 未就绪时降级：返回扫描结果，enabled 默认启用（不阻断 Skills 页展示）
    console.warn("[skills] DB 不可用，返回扫描结果（enabled 默认 true）:", err);
  }

  return specs.map((spec) => {
    const attrs = readFrontmatterAttrs(spec);
    return {
      id: spec.id,
      name: spec.name,
      description_zh: spec.description_zh,
      description_en: spec.description_en,
      category: attrs.category || undefined,
      source: spec.source,
      enabled: enabledById.get(spec.id) ?? true,
      version: attrs.version || undefined,
    };
  });
}

/** `skills:setEnabled` 实现：写 DB skills_index.enabled。 */
function setSkillEnabled(id: string, enabled: boolean): { ok: boolean; error?: string } {
  try {
    const db = getDb();
    const result = db
      .prepare("UPDATE skills_index SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, Date.now(), id);
    if (result.changes > 0) return { ok: true };
    return { ok: false, error: `skill 不存在或未同步: ${id}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function registerSkillsIpc(): void {
  ipcMain.handle("skills:list", async () => listSkills());

  ipcMain.handle("skills:get", async (_e, id: string) => {
    if (typeof id !== "string" || !id.trim()) return null;
    const spec = findSpec(id);
    return spec ? SkillLoader.load(spec) : null;
  });

  ipcMain.handle("skills:setEnabled", async (_e, id: string, enabled: boolean) => {
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: "无效的 skill id" };
    }
    return setSkillEnabled(id, enabled);
  });
}
