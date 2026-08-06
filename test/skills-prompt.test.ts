/**
 * buildAvailableSkillsBlock 测试（S1.5 Prompt 注入）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillLoader } from "../src/skills/loader.js";
import { buildAvailableSkillsBlock } from "../src/skills/prompt.js";

function tempDir() {
  const dir = path.join(
    os.tmpdir(),
    `my-agent-skills-prompt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, attrs: Record<string, string>, body = "# body") {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${lines.join("\n")}\n---\n${body}`);
}

describe("buildAvailableSkillsBlock", () => {
  let dir: string;
  let customRoot: string;
  let marketplaceRoot: string;

  beforeEach(() => {
    dir = tempDir();
    customRoot = path.join(dir, "custom", "skills");
    marketplaceRoot = path.join(dir, "marketplace", "skills");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const roots = () => ({ custom: customRoot, marketplace: marketplaceRoot });

  it("空 loader 返回空串", () => {
    const loader = new SkillLoader({ dirs: [path.join(dir, "nope")] });
    expect(buildAvailableSkillsBlock(loader, { roots: roots() })).toBe("");
  });

  it("ROOT 绝对路径内联在块上方，并含固定说明句", () => {
    writeSkill(path.join(customRoot, "coding"), { id: "coding", name: "coding", description_zh: "编码" });
    const loader = new SkillLoader({ dirs: [customRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });

    expect(block).toContain("## Available skills (skills)");
    expect(block).toContain("`read_file(<ROOT>/<id>/SKILL.md)` — ROOT by Source:");
    expect(block).toContain(`- custom: ${customRoot}`);
    expect(block).toContain(`- marketplace: ${marketplaceRoot}`);
    expect(block).toContain("Use these ROOT values verbatim.");
    expect(block).toContain(
      "These entries are skills, not tool names: read SKILL.md and follow it;",
    );
    expect(block).toContain("never call the display name or id as a tool.");
    expect(block).not.toContain("## Resource locations");
  });

  it("Source 标签按根绝对路径判定（两根都叫 skills 不靠 basename）", () => {
    writeSkill(path.join(customRoot, "alpha"), { id: "alpha", name: "alpha", description_zh: "A" });
    writeSkill(path.join(marketplaceRoot, "beta"), { id: "beta", name: "beta", description_zh: "B" });
    // 不在 roots 中的来源 → builtin
    const builtinRoot = path.join(dir, "builtin", "skills");
    writeSkill(path.join(builtinRoot, "gamma"), { id: "gamma", name: "gamma", description_zh: "G" });

    const loader = new SkillLoader({ dirs: [customRoot, marketplaceRoot, builtinRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });

    expect(block).toContain("- **alpha** (Source: custom)");
    expect(block).toContain("- **beta** (Source: marketplace)");
    expect(block).toContain("- **gamma** (Source: builtin)");
  });

  it("name 与 id 不同时标注 internal read id，相同则省略", () => {
    writeSkill(path.join(customRoot, "dr"), { id: "ee99fbb42964", name: "deep-research", description_zh: "研究" });
    writeSkill(path.join(customRoot, "coding"), { id: "coding", name: "coding", description_zh: "编码" });

    const loader = new SkillLoader({ dirs: [customRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });

    expect(block).toContain("- **deep-research** (Source: custom; internal read id: ee99fbb42964)");
    expect(block).toContain("- **coding** (Source: custom) — 编码");
    expect(block).not.toContain("internal read id: coding");
  });

  it("描述按 lang 选择并截断到 240 字符", () => {
    writeSkill(path.join(customRoot, "longskill"), {
      id: "longskill",
      name: "longskill",
      description_zh: "长".repeat(300),
      description_en: "x".repeat(300),
    });

    const loader = new SkillLoader({ dirs: [customRoot] });
    const zhBlock = buildAvailableSkillsBlock(loader, { roots: roots() });
    const enBlock = buildAvailableSkillsBlock(loader, { roots: roots(), lang: "en" });

    const zhLine = zhBlock.split("\n").find((l) => l.includes("**longskill**"));
    expect(zhLine).toBeDefined();
    expect(zhLine!).toContain("长".repeat(240));
    expect(zhLine!).not.toContain("长".repeat(241));

    const enLine = enBlock.split("\n").find((l) => l.includes("**longskill**"));
    expect(enLine).toBeDefined();
    expect(enLine!).toContain("x".repeat(240));
    expect(enLine!).not.toContain("x".repeat(241));
  });

  it("同名 skill 先到先得（dirs 数组序），只出一个条目", () => {
    writeSkill(path.join(marketplaceRoot, "coding"), { id: "coding", name: "coding", description_zh: "来自 marketplace" });
    writeSkill(path.join(customRoot, "coding"), { id: "coding", name: "coding", description_zh: "来自 custom" });

    const loader = new SkillLoader({ dirs: [marketplaceRoot, customRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });

    const codingLines = block.split("\n").filter((l) => l.includes("**coding**"));
    expect(codingLines).toHaveLength(1);
    expect(codingLines[0]).toContain("来自 marketplace");
    expect(codingLines[0]).toContain("(Source: marketplace)");
  });

  it("提供 builtin 根时渲染 - builtin: ROOT 行，且 builtin 根下条目标 builtin", () => {
    const builtinRoot = path.join(dir, "repo", "skills");
    writeSkill(path.join(builtinRoot, "coding"), { id: "coding", name: "coding", description_zh: "仓库示例" });
    writeSkill(path.join(customRoot, "alpha"), { id: "alpha", name: "alpha", description_zh: "A" });

    const loader = new SkillLoader({ dirs: [customRoot, builtinRoot] });
    const block = buildAvailableSkillsBlock(loader, {
      roots: { custom: customRoot, marketplace: marketplaceRoot, builtin: builtinRoot },
    });

    expect(block).toContain(`- builtin: ${builtinRoot}`);
    expect(block).toContain("- **coding** (Source: builtin)");
    expect(block).toContain("- **alpha** (Source: custom)");
  });

  it("未提供 builtin 根时不渲染 - builtin 行（既有行为保持）", () => {
    writeSkill(path.join(customRoot, "coding"), { id: "coding", name: "coding", description_zh: "编码" });
    const loader = new SkillLoader({ dirs: [customRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });
    expect(block).not.toContain("- builtin:");
  });

  it("含路径穿越字符的 id 被跳过（不进入 read_file 路径）", () => {
    writeSkill(path.join(customRoot, "ok"), { id: "ok", name: "ok", description_zh: "OK" });
    writeSkill(path.join(customRoot, "evil"), { id: "../../evil", name: "evil", description_zh: "EVIL" });

    const loader = new SkillLoader({ dirs: [customRoot] });
    const block = buildAvailableSkillsBlock(loader, { roots: roots() });

    expect(block).toContain("**ok**");
    expect(block).not.toContain("evil");
  });
});
