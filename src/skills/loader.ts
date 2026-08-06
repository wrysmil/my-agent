/**
 * Skill 加载器
 *
 * 从文件系统扫描 SKILL.md 文件，解析 YAML frontmatter，
 * 返回 SkillSpec 列表。
 *
 * 仿 Orkas core-agent/src/skills/loader.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillSpec, SkillContent } from "./types.js";

// ============================================================
// YAML frontmatter 解析（轻量实现，不引入 js-yaml）
// ============================================================

/** key: value 行（key 顶格，未知键原样保留） */
const KEY_RE = /^(\w[\w_-]*)\s*:\s*(.*)$/;
/** 块标量指示符：| / > 及可选 chomp / indent 指示符（如 |-、|+、|2、>-） */
const BLOCK_RE = /^[|>][-+0-9]*$/;
/** CJK 判定（U+4E00 ~ U+9FFF） */
const CJK_RE = /[一-鿿]/;

/** 计算行首缩进（空格数） */
function lineIndent(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * 剥离匹配的成对引号（"…" / '…'），残缺引号原样保留。
 * 双引号值容忍常见转义（\" → "、\\ → \）。
 */
function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' && last === '"') {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (first === "'" && last === "'") {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * > 折叠块：单换行折叠为空格，空行转成换行（连续空行 → 连续换行）。
 */
function foldBlock(lines: string[]): string {
  const parts: string[] = [];
  let pendingBlank = 0;
  for (const line of lines) {
    if (line === "") {
      pendingBlank++;
      continue;
    }
    if (parts.length === 0) {
      parts.push(line);
    } else if (pendingBlank > 0) {
      parts.push("\n".repeat(pendingBlank) + line);
    } else {
      parts.push(" " + line);
    }
    pendingBlank = 0;
  }
  return parts.join("");
}

/**
 * 解析 markdown 文件的 YAML frontmatter。
 *
 * - 支持 key: value，剥匹配的成对引号；残缺引号原样保留
 * - 支持 | 字面量块 / > 折叠块，收集到「缩进 ≤ key 行缩进」的非空行
 * - 跳过空行、# 注释、列表行与嵌套（不进 attrs）
 * - body trim 规范化：无 frontmatter 时 body = text.trim()；
 *   有 frontmatter 时 body = text.slice(endIdx + 3).trim()
 *
 * @param text — 文件的完整文本
 * @returns { attrs: 解析出的键值对, body: 除去 frontmatter 的正文 }
 */
export function parseFrontmatter(text: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const attrs: Record<string, string> = {};

  // 快路径：首行不是 ---
  if (!text.startsWith("---")) {
    return { attrs, body: text.trim() };
  }

  const endIdx = text.indexOf("---", 3);
  if (endIdx === -1) {
    // 未闭合 --- → 整篇当正文，不抛错
    return { attrs, body: text.trim() };
  }

  const frontmatter = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 3).trim();

  let blockKey = "";
  let blockType: "|" | ">" | null = null;
  let blockLines: string[] = [];

  const finalizeBlock = () => {
    if (blockType) {
      attrs[blockKey] = blockType === "|" ? blockLines.join("\n") : foldBlock(blockLines);
    }
    blockKey = "";
    blockType = null;
    blockLines = [];
  };

  for (const rawLine of frontmatter.split("\n")) {
    // 空行：块标量内收进块，否则跳过
    if (rawLine.trim() === "") {
      if (blockType) blockLines.push("");
      continue;
    }

    // 块标量收集阶段
    if (blockType) {
      const indent = lineIndent(rawLine);
      if (indent > 0) {
        blockLines.push(rawLine.slice(indent).replace(/\r$/, ""));
        continue;
      }
      // 缩进 ≤ key 行缩进的非空行 → 块结束，本行按普通逻辑继续处理
      finalizeBlock();
    }

    const match = KEY_RE.exec(rawLine);
    if (!match) {
      // 注释 / 列表 / 嵌套 / 无冒号行 → 忽略不进 attrs
      continue;
    }

    const rawValue = match[2].trim();
    if (BLOCK_RE.test(rawValue)) {
      blockKey = match[1];
      blockType = rawValue[0] as "|" | ">";
      blockLines = [];
      continue;
    }

    attrs[match[1]] = stripQuotes(rawValue);
  }

  // frontmatter 结束仍处于块标量 → 落盘
  finalizeBlock();

  return { attrs, body };
}

// ============================================================
// SkillSpec 构造（含旧版 description 迁移）
// ============================================================

/**
 * 由 frontmatter attrs 构造 SkillSpec。
 *
 * 旧版 description 迁移：仅当无 description_zh/description_en 时，
 * 按是否含 CJK 分派到对应语言字段（避免英文描述出现在中文菜单）。
 */
function buildSpec(
  attrs: Record<string, string>,
  entryName: string,
  skillDir: string,
  source: "system" | "user" | "marketplace",
): SkillSpec {
  const legacy = (attrs.description ?? "").trim();
  const hasCjk = CJK_RE.test(legacy);
  return {
    id: attrs.id || entryName,
    name: attrs.name || entryName,
    description_zh: attrs.description_zh || (legacy && hasCjk ? legacy : "") || "",
    description_en: attrs.description_en || (legacy && !hasCjk ? legacy : "") || "",
    dir: skillDir,
    skillFile: path.join(skillDir, "SKILL.md"),
    source,
  };
}

// ============================================================
// SkillLoader
// ============================================================

export class SkillLoader {
  /** 扫描目录列表（优先级从高到低，先到先得） */
  private readonly dirs: string[];
  /** 元数据缓存（正文永远磁盘现读，仅缓存 SkillSpec） */
  private cache: { stamp: string; skills: SkillSpec[] } | null = null;

  constructor(opts: { dirs: string[] }) {
    this.dirs = [...opts.dirs];
  }

  /**
   * 列出全部 Skill 元数据。
   *
   * - dirStamp（各目录 mtime）未变 → 命中缓存
   * - 仅扫描各目录的直接子目录（不递归）
   * - 同名目录先到先得（dirs 数组序）；结果按 id 排序
   */
  list(): SkillSpec[] {
    const stamp = this.dirStamp();
    if (this.cache?.stamp === stamp) return this.cache.skills;

    const seen = new Map<string, SkillSpec>();
    for (const dir of this.dirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (seen.has(entry.name)) continue; // 先到先得
        const spec = this.parseSpec(dir, entry.name);
        if (spec) seen.set(entry.name, spec);
      }
    }

    const skills = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
    this.cache = { stamp, skills };
    return skills;
  }

  /** 清空元数据缓存（写入 skill 文件后须显式调用） */
  invalidate(): void {
    this.cache = null;
  }

  /** 读取单个 skill 目录的元数据 */
  private parseSpec(dir: string, entryName: string): SkillSpec | null {
    const skillDir = path.join(dir, entryName);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) return null;
    const text = fs.readFileSync(skillFile, "utf-8");
    const { attrs } = parseFrontmatter(text);
    return buildSpec(attrs, entryName, skillDir, "user");
  }

  /** 各目录 mtime 戳；目录不存在时记空串 */
  private dirStamp(): string {
    return this.dirs
      .map((d) => {
        try {
          return `${d}:${fs.statSync(d).mtimeMs}`;
        } catch {
          return `${d}:`;
        }
      })
      .join("|");
  }

  // ============================================================
  // 静态兼容层（新代码走实例 API；此处保留递归扫描 + 后者覆盖语义）
  // ============================================================

  /**
   * 从指定目录扫描所有 SKILL.md 文件。
   *
   * @param rootDir — 扫描根目录
   * @param source — Skill 来源标记
   * @returns SkillSpec 数组（按 id 去重，后面的优先）
   */
  static scan(rootDir: string, source: "system" | "user" | "marketplace" = "user"): SkillSpec[] {
    const specs: SkillSpec[] = [];

    if (!fs.existsSync(rootDir)) return specs;

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;

      const skillDir = path.join(rootDir, entry.name);
      const skillFile = path.join(skillDir, "SKILL.md");

      if (!fs.existsSync(skillFile)) {
        // 递归扫描子目录
        specs.push(...SkillLoader.scan(skillDir, source));
        continue;
      }

      const text = fs.readFileSync(skillFile, "utf-8");
      const { attrs } = parseFrontmatter(text);
      const spec = buildSpec(attrs, entry.name, skillDir, source);

      // 去重：相同 id 的 skill，后面的替换前面的
      const existingIdx = specs.findIndex((s) => s.id === spec.id);
      if (existingIdx >= 0) {
        specs[existingIdx] = spec;
      } else {
        specs.push(spec);
      }
    }

    return specs;
  }

  /**
   * 加载单个 Skill 的完整内容（含正文，正文始终磁盘现读）。
   */
  static load(spec: SkillSpec): SkillContent | null {
    if (!fs.existsSync(spec.skillFile)) return null;

    const text = fs.readFileSync(spec.skillFile, "utf-8");
    const { body } = parseFrontmatter(text);

    return { ...spec, body };
  }

  /**
   * 批量加载 Skill 内容。
   */
  static loadAll(specs: SkillSpec[]): SkillContent[] {
    return specs.map((s) => SkillLoader.load(s)).filter((s): s is SkillContent => s !== null);
  }
}
