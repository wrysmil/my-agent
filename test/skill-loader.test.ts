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
    // frontmatter 以第二个 --- 结束，这里只有开头一个
    // 整个文本被视为无 frontmatter
    expect(attrs.id).toBe("broken");
    expect(body).toBe("正文");
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

  it("应该扫描目录中的 SKILL.md 文件", () => {
    // 创建模拟 skill 目录结构
    const skillDir = path.join(dir, "coding");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
id: coding
name: Coding
description_zh: 编码规范
description_en: Coding standards
---
# Coding Standards

遵循仓库约定。`,
    );

    const specs = SkillLoader.scan(dir, "system");
    expect(specs.length).toBe(1);
    expect(specs[0].id).toBe("coding");
    expect(specs[0].name).toBe("Coding");
    expect(specs[0].source).toBe("system");
  });

  it("应该加载 Skill 完整内容", () => {
    const skillDir = path.join(dir, "test-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
id: test-skill
name: Test
description_zh: 测试技能
---
# 指令

1. 第一步
2. 第二步`,
    );

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
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(
      path.join(hiddenDir, "SKILL.md"),
      `---
id: hidden
name: Hidden
description_zh: 隐藏技能
---
Hidden content.`,
    );

    const specs = SkillLoader.scan(dir);
    expect(specs.length).toBe(0);
  });

  it("相同 id 的 skill 应该去重（后者覆盖前者）", () => {
    // 创建两个同名 id 的 skill
    const dir1 = path.join(dir, "skill-v1");
    const dir2 = path.join(dir, "skill-v2");
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });

    fs.writeFileSync(
      path.join(dir1, "SKILL.md"),
      `---
id: my-skill
name: My Skill v1
description_zh: 版本1
---
Version 1 content.`,
    );

    fs.writeFileSync(
      path.join(dir2, "SKILL.md"),
      `---
id: my-skill
name: My Skill v2
description_zh: 版本2
---
Version 2 content.`,
    );

    const specs = SkillLoader.scan(dir);
    expect(specs.length).toBe(1);
    expect(specs[0].name).toBe("My Skill v2"); // 后者覆盖
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
