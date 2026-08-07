/**
 * 技能查看工具（view_skill）
 *
 * 按 internal read id 加载某个 SKILL.md 的完整正文，
 * 供 Agent 在遵循技能前读取其指令。id 来自 Available skills 菜单
 * 的 internal read id（可能与展示名不同）。
 */

import { SkillLoader } from "../skills/loader.js";
import { defineTool } from "./base.js";

export function createViewSkillTool(loader: SkillLoader) {
  return defineTool({
    name: "view_skill",
    description: `Load the full SKILL.md body for a skill by its internal read id. The id comes from the "Available skills" menu (the internal read id, which may differ from the display name). Use this to read a skill's instructions before following them.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The internal read id from the Available skills menu",
        },
      },
      required: ["id"],
    },
    execute: async (input, _ctx) => {
      const id = typeof input.id === "string" ? input.id : "";
      const spec = loader.list().find((s) => s.id === id);
      if (!spec) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `Skill not found: "${id}". Check the internal read id in the Available skills menu.`,
          }),
          isError: true,
        };
      }
      const loaded = SkillLoader.load(spec);
      if (!loaded) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `Skill "${id}" was found but its SKILL.md could not be read.`,
          }),
          isError: true,
        };
      }
      return { content: loaded.body };
    },
  });
}
