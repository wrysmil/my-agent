/**
 * Skill 菜单 Prompt 构建（S1.5）
 *
 * 生成注入 system prompt 的 `## Available skills` 块：
 * - ROOT 绝对路径内联在菜单上方（不单独开 `## Resource locations` 节）
 * - Source 标签按根绝对路径判定（custom / marketplace / builtin），不靠 basename
 * - name !== id 时标注 internal read id
 * - 描述经 pickDescription(lang) 后 slice(0, 240)
 */

import * as path from "node:path";
import type { SkillLoader } from "./loader.js";
import { pickDescription } from "./types.js";
import { assertPathSegment } from "../storage/paths.js";

/** 各来源根绝对路径；builtin 仅在存在仓库内示例 skill（迁移方案 A 过渡期）时提供 */
export interface SkillRoots {
  custom: string;
  marketplace: string;
  builtin?: string;
}

/** S1 描述压缩上限（S2 再做「在适合/触发词处截断」） */
const DESC_LIMIT = 240;

/** dir 是否落在 root 之下（resolve 两侧后再按路径分隔符比较，规避 / 与 \ 混用） */
function isUnderRoot(root: string, dir: string): boolean {
  const r = path.resolve(root);
  const d = path.resolve(dir);
  return d === r || d.startsWith(r + path.sep);
}

/** 按根绝对路径判定来源；未提供 builtin 根或不在任一 root 下视为 builtin */
function sourceLabel(specDir: string, roots: SkillRoots): "custom" | "marketplace" | "builtin" {
  if (roots.builtin && isUnderRoot(roots.builtin, specDir)) return "builtin";
  if (isUnderRoot(roots.custom, specDir)) return "custom";
  if (isUnderRoot(roots.marketplace, specDir)) return "marketplace";
  return "builtin";
}

/**
 * 构建 `## Available skills` 注入块。
 *
 * @param loader — 由调用方构造的 SkillLoader 实例（dirs 含 roots 对应目录）
 * @param opts.roots — 各来源根绝对路径
 * @param opts.lang — 描述语言（undefined/zh → description_zh 优先；"en" → description_en）
 * @returns 注入块文本；loader 无技能时返回空串
 */
export function buildAvailableSkillsBlock(
  loader: SkillLoader,
  opts: { lang?: string; roots: SkillRoots },
): string {
  const skills = loader.list();
  if (skills.length === 0) return "";

  const { lang, roots } = opts;
  const rootLines = [
    `- custom: ${roots.custom}`,
    `- marketplace: ${roots.marketplace}`,
  ];
  if (roots.builtin) rootLines.push(`- builtin: ${roots.builtin}`);
  const lines: string[] = [
    "## Available skills (skills)",
    "",
    "`view_skill(<id>)` — load full SKILL.md body by internal read id.",
    "Skill directories (for reference):",
    ...rootLines,
    "`<id>` is the internal read id shown after the skill name.",
    "These entries are skills, not tool names: use view_skill to load and follow them;",
    "never call the display name or id as a tool.",
    "",
  ];

  for (const spec of skills) {
    // id 会拼进 read_file 路径，先做路径段校验，拒绝 / \ .. \0 的条目
    try {
      assertPathSegment(spec.id, "skill id");
    } catch {
      continue;
    }
    const desc = pickDescription(spec, lang).slice(0, DESC_LIMIT);
    const idNote = spec.name !== spec.id ? `; internal read id: ${spec.id}` : "";
    lines.push(`- **${spec.name}** (Source: ${sourceLabel(spec.dir, roots)}${idNote}) — ${desc}`);
  }

  return lines.join("\n");
}
