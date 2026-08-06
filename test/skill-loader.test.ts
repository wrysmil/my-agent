/**
 * Skill Loader 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SkillLoader, parseFrontmatter } from "../src/skills/loader.js";
import { pickDescription } from "../src/skills/types.js";

function tempDir() {
  const dir = path.join(os.tmpdir(), `my-agent-skill-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, attrs: Record<string, string>, body = "# body") {
  fs.mkdirSync(dir, { recursive: true });
  const lines = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`);
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${lines.join("\n")}\n---\n${body}`);
}

// ============================================================
// parseFrontmatter
// ============================================================
describe("parseFrontmatter", () => {
  it("应该解析 YAML frontmatter", () => {
    const text = `---
id: test-skill
name: Test Skill
description_zh: 测试技能
---
# 正文内容

这是技能的指令正文。`;

    const { attrs, body } = parseFrontmatter(text);
    expect(attrs.id).toBe("test-skill");
    expect(attrs.name).toBe("Test Skill");
    expect(attrs.description_zh).toBe("测试技能");
    expect(body).toContain("# 正文内容");
    expect(body).toContain("这是技能的指令正文");
  });

  it("没有 frontmatter 时返回空 attrs", () => {
    const text = "# 普通 markdown\n\n没有 frontmatter。";
    const { attrs, body } = parseFrontmatter(text);
    expect(Object.keys(attrs).length).toBe(0);
    expect(body).toBe(text);
  });

  it("frontmatter 不完整时保持稳健", () => {
    const text = `---
id: broken
---
正文`;
    const { attrs, body } = parseFrontmatter(text);
    expect(attrs.id).toBe("broken");
    expect(body).toBe("正文");
  });

  it("无 frontmatter 时 body 被 trim 规范化", () => {
    const text = "\n  # 普通 markdown\n\n没有 frontmatter。  \n";
    const { attrs, body } = parseFrontmatter(text);
    expect(Object.keys(attrs).length).toBe(0);
    expect(body).toBe("# 普通 markdown\n\n没有 frontmatter。");
  });

  it("有 frontmatter 时 body 被 trim 规范化", () => {
    const text = `---
id: trim-skill
---

  正文首行带缩进与空行。  `;
    const { attrs, body } = parseFrontmatter(text);
    expect(attrs.id).toBe("trim-skill");
    expect(body).toBe("正文首行带缩进与空行。");
  });

  it("剥离匹配的成对引号（值含冒号）", () => {
    const text = `---
description: "a: b"
name: 'Skill: name'
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.description).toBe("a: b");
    expect(attrs.name).toBe("Skill: name");
  });

  it("残缺引号原样保留", () => {
    const text = `---
description: "只有开头引号
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.description).toBe('"只有开头引号');
  });

  it("块标量 | 保留换行", () => {
    const text = `---
description: |
  第一行
  第二行
  第三行
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.description).toBe("第一行\n第二行\n第三行");
  });

  it("块标量 > 空格折叠、空行转成换行", () => {
    const text = `---
description: >
  第一行
  第二行

  第四行
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.description).toBe("第一行 第二行\n第四行");
  });

  it("注释行与列表行被忽略", () => {
    const text = `---
# 这是注释
name: foo
- item one
- item two
category: data # 行尾注释保留为值
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.name).toBe("foo");
    expect(attrs.category).toBe("data # 行尾注释保留为值");
    expect(attrs["# 这是注释"]).toBeUndefined();
    expect(attrs["- item one"]).toBeUndefined();
  });

  it("块标量在遇到同级 key 时结束", () => {
    const text = `---
description: |
  块内容
name: after-block
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.description).toBe("块内容");
    expect(attrs.name).toBe("after-block");
  });

  it("未知键原样保留", () => {
    const text = `---
ownerAgent: my-agent
category: data
---`;
    const { attrs } = parseFrontmatter(text);
    expect(attrs.ownerAgent).toBe("my-agent");
    expect(attrs.category).toBe("data");
  });
});

// ============================================================
// SkillLoader
// ============================================================
describe("SkillLoader", () => {
  let dir: string;

  beforeEach(() => {
    dir = tempDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---- 静态兼容层 ----
  it("静态 scan 应该扫描目录中的 SKILL.md 文件", () => {
    const skillDir = path.join(dir, "coding");
    writeSkill(skillDir, { id: "coding", name: "Coding", description_zh: "编码规范", description_en: "Coding standards" }, "# Coding Standards\n\n遵循仓库约定。");

    const specs = SkillLoader.scan(dir, "system");
    expect(specs.length).toBe(1);
    expect(specs[0].id).toBe("coding");
    expect(specs[0].name).toBe("Coding");
    expect(specs[0].source).toBe("system");
  });

  it("静态 load 应该加载 Skill 完整内容", () => {
    const skillDir = path.join(dir, "test-skill");
    writeSkill(skillDir, { id: "test-skill", name: "Test", description_zh: "测试技能" }, "# 指令\n\n1. 第一步\n2. 第二步");

    const specs = SkillLoader.scan(dir, "user");
    const content = SkillLoader.load(specs[0]);

    expect(content).not.toBeNull();
    expect(content!.body).toContain("第一步");
    expect(content!.body).toContain("第二步");
    expect(content!.description_zh).toBe("测试技能");
  });

  it("空目录应该返回空列表", () => {
    const specs = SkillLoader.scan(dir);
    expect(specs.length).toBe(0);
  });

  it("不应该扫描隐藏目录", () => {
    const hiddenDir = path.join(dir, ".hidden-skill");
    writeSkill(hiddenDir, { id: "hidden", name: "Hidden", description_zh: "隐藏技能" }, "Hidden content.");

    const specs = SkillLoader.scan(dir);
    expect(specs.length).toBe(0);
  });

  it("静态 scan 兼容层保留递归与同 id 去重", () => {
    writeSkill(path.join(dir, "skill-v1"), { id: "my-skill", name: "My Skill v1" }, "Version 1 content.");
    writeSkill(path.join(dir, "skill-v2"), { id: "my-skill", name: "My Skill v2" }, "Version 2 content.");

    const specs = SkillLoader.scan(dir);
    expect(specs.length).toBe(1);
    expect(specs[0].id).toBe("my-skill");
  });

  // ---- 实例 API（S1.4）----
  it("实例 list() 只扫描直接子目录（不递归）", () => {
    const top = path.join(dir, "top");
    const nested = path.join(dir, "nested", "deep");
    writeSkill(top, { id: "top-skill" });
    writeSkill(nested, { id: "deep-skill" });

    // 静态兼容层保留递归
    const compatIds = SkillLoader.scan(dir).map((s) => s.id);
    expect(compatIds).toContain("deep-skill");

    const loader = new SkillLoader({ dirs: [dir] });
    const ids = loader.list().map((s) => s.id);
    expect(ids).toContain("top-skill");
    expect(ids).not.toContain("deep-skill");
  });

  it("实例 list() 相同目录名先到先得（dirs 数组序）", () => {
    const dirA = path.join(dir, "a");
    const dirB = path.join(dir, "b");
    writeSkill(path.join(dirA, "coding"), { id: "coding", name: "From A" });
    writeSkill(path.join(dirB, "coding"), { id: "coding", name: "From B" });

    const loader = new SkillLoader({ dirs: [dirA, dirB] });
    const specs = loader.list();
    expect(specs.length).toBe(1);
    expect(specs[0].name).toBe("From A");
  });

  it("实例 list() 按 id 排序", () => {
    writeSkill(path.join(dir, "zeta"), { id: "zeta", name: "Zeta" });
    writeSkill(path.join(dir, "alpha"), { id: "alpha", name: "Alpha" });
    writeSkill(path.join(dir, "beta"), { id: "beta", name: "Beta" });

    const loader = new SkillLoader({ dirs: [dir] });
    expect(loader.list().map((s) => s.id)).toEqual(["alpha", "beta", "zeta"]);
  });

  it("list() 命中 mtime 缓存时返回同一引用", () => {
    writeSkill(path.join(dir, "coding"), { id: "coding", name: "Coding" });

    const loader = new SkillLoader({ dirs: [dir] });
    const first = loader.list();
    const second = loader.list();
    expect(first).toBe(second);
    expect(first).toHaveLength(1);
  });

  it("文件内容变化不刷新缓存，invalidate 后刷新", () => {
    const skillDir = path.join(dir, "coding");
    writeSkill(skillDir, { id: "coding", name: "V1" });

    const loader = new SkillLoader({ dirs: [dir] });
    expect(loader.list()[0].name).toBe("V1");

    // 改文件内容不改变父目录 mtime → 缓存命中，仍是旧元数据
    writeSkill(skillDir, { id: "coding", name: "V2" });
    expect(loader.list()[0].name).toBe("V1");

    loader.invalidate();
    expect(loader.list()[0].name).toBe("V2");
  });

  it("新增技能目录触发 dirStamp 变化自动刷新", () => {
    const loader = new SkillLoader({ dirs: [dir] });
    expect(loader.list()).toHaveLength(0);

    writeSkill(path.join(dir, "coding"), { id: "coding", name: "Coding" });
    // 显式推进目录 mtime，避免同一毫秒内创建子目录未改变 mtimeMs 导致缓存命中
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(dir, future, future);
    expect(loader.list()).toHaveLength(1);
  });

  // ---- description 迁移（S1.2）----
  it("旧版 description 含 CJK 迁到 description_zh", () => {
    writeSkill(path.join(dir, "cjk-skill"), { id: "cjk-skill", description: "中文描述" });

    const spec = new SkillLoader({ dirs: [dir] }).list()[0];
    expect(spec.description_zh).toBe("中文描述");
    expect(spec.description_en).toBe("");
  });

  it("旧版 description 不含 CJK 迁到 description_en", () => {
    writeSkill(path.join(dir, "en-skill"), { id: "en-skill", description: "English description" });

    const spec = new SkillLoader({ dirs: [dir] }).list()[0];
    expect(spec.description_zh).toBe("");
    expect(spec.description_en).toBe("English description");
  });

  it("显式 description_zh/en 优先于旧版 description", () => {
    writeSkill(path.join(dir, "both-skill"), {
      id: "both-skill",
      description: "legacy desc",
      description_zh: "显式中文",
      description_en: "Explicit EN",
    });

    const spec = new SkillLoader({ dirs: [dir] }).list()[0];
    expect(spec.description_zh).toBe("显式中文");
    expect(spec.description_en).toBe("Explicit EN");
  });
});

// ============================================================
// pickDescription
// ============================================================
describe("pickDescription", () => {
  it("中文环境返回中文描述", () => {
    const spec = {
      id: "test",
      name: "Test",
      description_zh: "测试技能",
      description_en: "Test skill",
      dir: "/tmp",
      skillFile: "/tmp/SKILL.md",
      source: "system" as const,
    };
    expect(pickDescription(spec)).toBe("测试技能");
    expect(pickDescription(spec, "zh")).toBe("测试技能");
  });

  it("英文环境返回英文描述", () => {
    const spec = {
      id: "test",
      name: "Test",
      description_zh: "测试技能",
      description_en: "Test skill",
      dir: "/tmp",
      skillFile: "/tmp/SKILL.md",
      source: "system" as const,
    };
    expect(pickDescription(spec, "en")).toBe("Test skill");
  });

  it("缺少中文描述时回退到英文", () => {
    const spec = {
      id: "test",
      name: "Test",
      description_zh: "",
      description_en: "Test skill",
      dir: "/tmp",
      skillFile: "/tmp/SKILL.md",
      source: "system" as const,
    };
    expect(pickDescription(spec)).toBe("Test skill");
  });
});
