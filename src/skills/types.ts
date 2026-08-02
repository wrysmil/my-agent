/**
 * Skill 类型定义
 *
 * Skill 是 markdown 格式的指令文件（SKILL.md），
 * 通过 YAML frontmatter 声明元数据，正文为给 LLM 的指令。
 *
 * 仿 Orkas core-agent/src/skills/types.ts
 */

/**
 * Skill 的元数据描述。
 *
 * 从 SKILL.md 的 YAML frontmatter 解析得到。
 */
export type SkillSpec = {
  /** 唯一标识（从 frontmatter 的 id 字段读取，或从文件名推断） */
  id: string;
  /** 技能名称 */
  name: string;
  /** 中文描述 */
  description_zh: string;
  /** 英文描述 */
  description_en: string;
  /** SKILL.md 所在目录的绝对路径 */
  dir: string;
  /** SKILL.md 文件的绝对路径 */
  skillFile: string;
  /** Skill 来源（系统内置 / 用户自定义 / Marketplace） */
  source: "system" | "user" | "marketplace";
  /** 所属 Agent ID（嵌入式 skill），可选 */
  ownerAgent?: string;
};

/**
 * Skill 的完整内容（元数据 + 正文）。
 */
export type SkillContent = SkillSpec & {
  /** SKILL.md 的正文内容（除去 frontmatter） */
  body: string;
};

/**
 * 根据当前语言选择合适的描述。
 */
export function pickDescription(skill: SkillSpec, lang?: string): string {
  if (lang === "en") return skill.description_en || skill.description_zh;
  return skill.description_zh || skill.description_en;
}
