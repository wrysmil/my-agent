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

/**
 * 解析 markdown 文件的 YAML frontmatter。
 *
 * @param text — 文件的完整文本
 * @returns { attrs: 解析出的键值对, body: 除去 frontmatter 的正文 }
 */
export function parseFrontmatter(text: string): {
  attrs: Record<string, string>;
  body: string;
} {
  const attrs: Record<string, string> = {};

  // 检查是否以 --- 开头
  if (!text.startsWith("---")) {
    return { attrs, body: text };
  }

  const endIdx = text.indexOf("---", 3);
  if (endIdx === -1) {
    return { attrs, body: text };
  }

  const frontmatter = text.slice(3, endIdx).trim();
  const body = text.slice(endIdx + 3).trim();

  // 简单逐行解析 key: value
  let currentKey = "";
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^(\w[\w_-]*)\s*:\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      attrs[currentKey] = match[2].trim();
    } else if (currentKey && line.trim()) {
      // 续行
      attrs[currentKey] += " " + line.trim();
    }
  }

  return { attrs, body };
}

// ============================================================
// SkillLoader
// ============================================================

export class SkillLoader {
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

      const spec: SkillSpec = {
        id: attrs.id || entry.name,
        name: attrs.name || entry.name,
        description_zh: attrs.description_zh || attrs.description || "",
        description_en: attrs.description_en || attrs.description || "",
        dir: skillDir,
        skillFile,
        source,
      };

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
   * 加载单个 Skill 的完整内容（含正文）。
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
