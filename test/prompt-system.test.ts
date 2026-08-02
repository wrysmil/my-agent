/**
 * Prompt 系统单元测试。
 *
 * 覆盖：
 * 1. loader.ts — safeSubstitute、PromptManager
 * 2. runtime-context.ts — formatCurrentDate、getRuntimeTimezone、buildRuntimeDatetimeBlock
 * 3. system-prompt-builder.ts — buildSystemPrompt、splitVolatilePromptTail、splitVolatileDateTail
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  safeSubstitute,
  PromptManager,
} from "../src/prompts/loader.js";
import {
  formatCurrentDate,
  getRuntimeTimezone,
  buildRuntimeDatetimeBlock,
} from "../src/prompts/runtime-context.js";
import {
  buildSystemPrompt,
  buildDefaultSystemPrompt,
  splitVolatilePromptTail,
  splitVolatileDateTail,
} from "../src/prompts/system-prompt-builder.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// safeSubstitute
// ============================================================

describe("safeSubstitute", () => {
  it("替换简单 $identifier", () => {
    const result = safeSubstitute("Hello $name", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("替换 ${identifier} 花括号形式", () => {
    const result = safeSubstitute("Hello ${name}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("$$ 转义为字面量 $", () => {
    const result = safeSubstitute("Price: $$100", {});
    expect(result).toBe("Price: $100");
  });

  it("未知变量保留字面量", () => {
    const result = safeSubstitute("Hello $unknown", { name: "World" });
    expect(result).toBe("Hello $unknown");
  });

  it("支持数字和布尔值（自动转字符串）", () => {
    const result = safeSubstitute("Count: $count, Ok: $ok", {
      count: 42,
      ok: true,
    });
    expect(result).toBe("Count: 42, Ok: true");
  });

  it("混合使用多种占位符", () => {
    const result = safeSubstitute(
      "Hi $name, your ${role} level is $level. Cost: $$50.",
      { name: "Alice", role: "admin", level: 5 },
    );
    expect(result).toBe("Hi Alice, your admin level is 5. Cost: $50.");
  });

  it("空 args 不报错", () => {
    const result = safeSubstitute("Hello $name", {});
    expect(result).toBe("Hello $name");
  });

  it("args 中有多余 key 不影响替换", () => {
    const result = safeSubstitute("Hello $name", {
      name: "World",
      extra: "unused",
    });
    expect(result).toBe("Hello World");
  });
});

// ============================================================
// PromptManager
// ============================================================

describe("PromptManager", () => {
  let pm: PromptManager;

  beforeEach(() => {
    pm = new PromptManager(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "prompts", "templates"),
    );
  });

  it("构造函数使用默认目录", () => {
    const defaultPm = new PromptManager();
    expect(defaultPm.root).toContain("templates");
  });

  it("exists() 检测存在的模板", () => {
    expect(pm.exists("base-agent")).toBe(true);
    expect(pm.exists("shared-rules")).toBe(true);
  });

  it("exists() 检测不存在的模板", () => {
    expect(pm.exists("non-existent-template")).toBe(false);
  });

  it("load() 加载并渲染模板", () => {
    const result = pm.load("base-agent", {
      name: "TestAgent",
      language_directive: "Always respond in Chinese.",
      skills_index: "- test-skill: A test skill",
      project_context: "(Test project)",
      os: "Linux",
      working_dir: "/test/dir",
      shell_hint: "Shell: bash",
    });
    expect(result).toContain("TestAgent");
    expect(result).toContain("Always respond in Chinese.");
    expect(result).toContain("- test-skill: A test skill");
    expect(result).toContain("Linux");
    expect(result).toContain("/test/dir");
    expect(result).toContain("运行时注入");
  });

  it("load() 不存在的模板返回空字符串", () => {
    const result = pm.load("non-existent");
    expect(result).toBe("");
  });

  it("load() 无变量模板正常返回正文", () => {
    const result = pm.load("shared-rules");
    expect(result).toContain("网络搜索规则");
    expect(result).toContain("PDF 规则");
  });

  it("reload() 清空缓存", () => {
    pm.load("base-agent", { name: "A", language_directive: "EN", skills_index: "", project_context: "", os: "test", working_dir: "/tmp", shell_hint: "" });
    pm.reload();
    // reload 后再次 load 应从磁盘重读（可通过 coverage 验证进入 readFileSync）
    const result = pm.load("base-agent", { name: "B", language_directive: "EN2", skills_index: "", project_context: "", os: "test2", working_dir: "/tmp2", shell_hint: "" });
    expect(result).toContain("B");
    expect(result).toContain("EN2");
  });
});

// ============================================================
// runtime-context
// ============================================================

describe("runtime-context", () => {
  it("formatCurrentDate() 返回 YYYY-MM-DD 格式", () => {
    const d = new Date("2026-08-02T12:00:00+08:00");
    expect(formatCurrentDate(d)).toBe("2026-08-02");
  });

  it("formatCurrentDate() 无参使用当前时间", () => {
    const result = formatCurrentDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formatCurrentDate() 正确补零", () => {
    const d = new Date("2026-01-05T00:00:00Z");
    expect(formatCurrentDate(d)).toBe("2026-01-05");
  });

  it("getRuntimeTimezone() 返回合理字符串", () => {
    const tz = getRuntimeTimezone();
    expect(tz).toBeTruthy();
    expect(typeof tz).toBe("string");
    // 应该是 IANA 时区或 UTC±HH:MM
    expect(tz.length).toBeGreaterThan(0);
  });

  it("buildRuntimeDatetimeBlock() 包含当前日期和时区", () => {
    const d = new Date("2026-12-25T00:00:00+08:00");
    const block = buildRuntimeDatetimeBlock(d);
    expect(block).toContain("## Current date");
    expect(block).toContain("2026-12-25");
    expect(block).toContain("Timezone:");
  });
});

// ============================================================
// system-prompt-builder
// ============================================================

describe("system-prompt-builder", () => {
  it("buildDefaultSystemPrompt() 返回基础 prompt", () => {
    const prompt = buildDefaultSystemPrompt();
    expect(prompt).toContain("helpful AI assistant");
    expect(prompt).toContain("运行时注入");
    expect(prompt).toContain("Always respond in Chinese");
  });

  it("buildDefaultSystemPrompt() 接受自定义语言指令", () => {
    const prompt = buildDefaultSystemPrompt("Respond in English.");
    expect(prompt).toContain("Respond in English.");
  });

  it("buildSystemPrompt() 组装完整 prompt", () => {
    const { systemPrompt, stable, volatile, turnEphemeral } = buildSystemPrompt({
      workingDir: "/test/project",
    });

    // 包含基础内容
    expect(systemPrompt).toContain("AI Assistant");
    expect(systemPrompt).toContain("运行时注入");

    // 包含工作目录
    expect(systemPrompt).toContain("/test/project");

    // stable 不应包含 运行时注入
    expect(stable).not.toContain("## 运行时注入");

    // volatile 应包含 运行时注入
    expect(volatile).toContain("## 运行时注入");

    // turnEphemeral 包含日期
    expect(turnEphemeral).toContain("## Current date");
    expect(turnEphemeral).toContain("Timezone:");
  });

  it("buildSystemPrompt() 注入技能索引", () => {
    const { systemPrompt } = buildSystemPrompt({
      skillsIndex: "## Available skills\n- bash: Run shell commands\n- read: Read files",
    });
    expect(systemPrompt).toContain("- bash: Run shell commands");
    expect(systemPrompt).toContain("- read: Read files");
  });

  it("buildSystemPrompt() 注入项目上下文", () => {
    const { systemPrompt } = buildSystemPrompt({
      projectContext: "## Project: MyApp\nThis is a React project.",
    });
    expect(systemPrompt).toContain("MyApp");
  });

  it("buildSystemPrompt() 注入额外系统指令", () => {
    const { systemPrompt } = buildSystemPrompt({
      extraSystemPrompt: "NEVER delete files without confirmation.",
    });
    expect(systemPrompt).toContain(
      "NEVER delete files without confirmation.",
    );
  });

  it("buildSystemPrompt() 注入语言指令", () => {
    const { systemPrompt } = buildSystemPrompt({
      languageDirective: "Respond in Japanese.",
    });
    expect(systemPrompt).toContain("Respond in Japanese.");
  });
});

// ============================================================
// splitVolatilePromptTail / splitVolatileDateTail
// ============================================================

describe("splitVolatilePromptTail", () => {
  it("拆分出稳定区域和易变尾部", () => {
    const prompt = "Stable prefix\n## 运行时注入\nVolatile tail";
    const { stable, volatileTail } = splitVolatilePromptTail(prompt);
    expect(stable).toBe("Stable prefix");
    expect(volatileTail).toContain("## 运行时注入");
    expect(volatileTail).toContain("Volatile tail");
  });

  it("无标记时 volatileTail 为空", () => {
    const prompt = "Just a simple prompt";
    const { stable, volatileTail } = splitVolatilePromptTail(prompt);
    expect(stable).toBe(prompt);
    expect(volatileTail).toBe("");
  });

  it("空字符串不报错", () => {
    const { stable, volatileTail } = splitVolatilePromptTail("");
    expect(stable).toBe("");
    expect(volatileTail).toBe("");
  });
});

describe("splitVolatileDateTail", () => {
  it("拆分出日期尾部", () => {
    const prompt = "Some content\n\n## Current date\n2026-08-02";
    const { stable, volatileTail } = splitVolatileDateTail(prompt);
    expect(stable).toBe("Some content");
    expect(volatileTail).toContain("## Current date");
  });

  it("无日期标记时 volatileTail 为空", () => {
    const prompt = "No date here";
    const { stable, volatileTail } = splitVolatileDateTail(prompt);
    expect(stable).toBe(prompt);
    expect(volatileTail).toBe("");
  });
});
