/**
 * 工具目录反漂移测试 + 可见性门控 + 渲染测试
 */

import { describe, it, expect } from "vitest";
import {
  isToolVisibleToAgent,
  getToolsSystemPromptBlock,
  registerCatalogEntry,
  getCatalogEntry,
  getAllCatalogEntries,
  CATALOG_NAME_SET,
  DISPATCH_TOOL_NAMES,
} from "./catalog.js";

// ============================================================
// 可见性门控
// ============================================================

describe("isToolVisibleToAgent", () => {
  it("未注册的工具默认可见", () => {
    expect(isToolVisibleToAgent("unknown_tool", "any")).toBe(true);
  });

  it("无 ownerAgent 的工具对所有 agent 可见", () => {
    expect(isToolVisibleToAgent("read_file", "coder")).toBe(true);
    expect(isToolVisibleToAgent("read_file", "commander")).toBe(true);
    expect(isToolVisibleToAgent("read_file", "any")).toBe(true);
  });

  it("ownerAgent 单值时仅指定 agent 可见", () => {
    // run_worker 的 ownerAgent 为 "commander"
    expect(isToolVisibleToAgent("run_worker", "commander")).toBe(true);
    expect(isToolVisibleToAgent("run_worker", "coder")).toBe(false);
  });

  it("ownerAgent 数组时任一匹配即可见", () => {
    // 注册一个 ownerAgent 为数组的测试条目
    registerCatalogEntry({
      name: "test_multi_owner",
      summary: "Test multi-owner tool.",
      group: "meta",
      ownerAgent: ["commander", "admin"],
    });
    expect(isToolVisibleToAgent("test_multi_owner", "commander")).toBe(true);
    expect(isToolVisibleToAgent("test_multi_owner", "admin")).toBe(true);
    expect(isToolVisibleToAgent("test_multi_owner", "coder")).toBe(false);
  });

  it("dispatch_to / hand_off_to 仅 commander 可见", () => {
    expect(isToolVisibleToAgent("dispatch_to", "commander")).toBe(true);
    expect(isToolVisibleToAgent("dispatch_to", "coder")).toBe(false);
    expect(isToolVisibleToAgent("hand_off_to", "commander")).toBe(true);
    expect(isToolVisibleToAgent("hand_off_to", "coder")).toBe(false);
  });
});

// ============================================================
// System prompt 块渲染
// ============================================================

describe("getToolsSystemPromptBlock", () => {
  it("空 names → 空字符串", () => {
    expect(getToolsSystemPromptBlock([])).toBe("");
  });

  it("渲染包含分组标题", () => {
    const names = ["read_file", "bash", "web_fetch"];
    const block = getToolsSystemPromptBlock(names);

    expect(block).toContain("## Available tools");
    expect(block).toContain("### Files / workspace");
    expect(block).toContain("### Shell");
    expect(block).toContain("### Web");
    // meta 组无匹配 → 不渲染
    expect(block).not.toContain("### Task / cross-session state");
  });

  it("缺失 name → 跳过（不崩溃）", () => {
    const names = ["read_file", "nonexistent_tool_xyz", "bash"];
    const block = getToolsSystemPromptBlock(names);

    expect(block).toContain("read_file");
    expect(block).toContain("bash");
    expect(block).not.toContain("nonexistent_tool_xyz");
  });

  it("permission=localExec 标注", () => {
    const block = getToolsSystemPromptBlock(["bash"]);
    expect(block).toContain("(gated by local-execution permission)");
  });

  it("destructive 工具标注 ⚠️", () => {
    const block = getToolsSystemPromptBlock(["delete_file"]);
    expect(block).toContain("⚠️");
  });

  it("按 GROUP_ORDER 固定顺序渲染", () => {
    const names = ["web_fetch", "read_file", "bash"];
    const block = getToolsSystemPromptBlock(names);

    const fsIdx = block.indexOf("### Files / workspace");
    const shellIdx = block.indexOf("### Shell");
    const webIdx = block.indexOf("### Web");

    expect(fsIdx).toBeLessThan(shellIdx);
    expect(shellIdx).toBeLessThan(webIdx);
  });

  it("调度工具不在渲染中", () => {
    const block = getToolsSystemPromptBlock(["run_worker", "dispatch_to", "hand_off_to"]);
    // 它们注册在 catalog 中但 nameSet 匹配后只有它们，meta 组应该有输出
    expect(block).toContain("### Task / cross-session state");
    expect(block).toContain("run_worker");
  });
});

// ============================================================
// 注册
// ============================================================

describe("registerCatalogEntry", () => {
  it("注册后可通过 getCatalogEntry 查询", () => {
    registerCatalogEntry({
      name: "my_custom_tool",
      summary: "A custom tool.",
      group: "fs",
    });
    const entry = getCatalogEntry("my_custom_tool");
    expect(entry).toBeDefined();
    expect(entry!.summary).toBe("A custom tool.");
  });

  it("覆盖已有条目", () => {
    registerCatalogEntry({
      name: "read_file",
      summary: "Overridden summary.",
      group: "fs",
    });
    const entry = getCatalogEntry("read_file");
    expect(entry!.summary).toBe("Overridden summary.");
  });
});

// ============================================================
// 反漂移：builtin 工具 ⊆ catalog
// ============================================================

describe("反漂移", () => {
  it("所有 BUILTIN_TOOLS 在 catalog 中有注册", async () => {
    // 动态导入避免循环依赖
    const { BUILTIN_TOOLS } = await import("./builtin.js");
    const builtinNames = BUILTIN_TOOLS.map((t) => t.name);

    for (const name of builtinNames) {
      // 调度工具由 buildDispatchTools 动态注入，不在 catalog 常驻列表中
      if (DISPATCH_TOOL_NAMES.has(name)) continue;
      expect(CATALOG_NAME_SET.has(name)).toBe(true);
    }
  });

  it("catalog 中每个条目都有 name 和 summary", () => {
    for (const entry of getAllCatalogEntries()) {
      expect(entry.name).toBeTruthy();
      expect(entry.summary).toBeTruthy();
      expect(["fs", "shell", "web", "meta"]).toContain(entry.group);
    }
  });

  it("DISPATCH_TOOL_NAMES 包含三个调度工具", () => {
    expect(DISPATCH_TOOL_NAMES.has("run_worker")).toBe(true);
    expect(DISPATCH_TOOL_NAMES.has("dispatch_to")).toBe(true);
    expect(DISPATCH_TOOL_NAMES.has("hand_off_to")).toBe(true);
    expect(DISPATCH_TOOL_NAMES.size).toBe(3);
  });
});
