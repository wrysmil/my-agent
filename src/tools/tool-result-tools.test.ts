/**
 * 工具结果取回工具测试
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { persistToolResult } from "./tool-result-cap.js";
import {
  toolResultSearchTool,
  toolResultReadChunkTool,
} from "./tool-result-tools.js";
import type { ToolContext } from "./base.js";

// ============================================================
// 辅助
// ============================================================

let tmpDir: string;

function makeCtx(extraState?: Record<string, unknown>): ToolContext {
  return {
    state: { toolResultsDir: tmpDir, ...extraState },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-retrieve-test-"));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================
// tool_result_search
// ============================================================

describe("tool_result_search", () => {
  it("搜索命中 → 返回匹配行", async () => {
    const content = [
      "line 1: alpha",
      "line 2: beta",
      "line 3: gamma",
      "line 4: ALPHA again",
      "line 5: delta",
    ].join("\n");

    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultSearchTool.execute(
      { ref, query: "alpha" },
      makeCtx(),
    );
    expect(result.content).toContain("alpha");
    expect(result.content).toContain("ALPHA");
    expect(result.content).toContain("2 处匹配");
  });

  it("搜索无匹配 → 提示", async () => {
    const content = "nothing here";
    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultSearchTool.execute(
      { ref, query: "zzzz_not_found" },
      makeCtx(),
    );
    expect(result.content).toContain("未找到匹配");
  });

  it("无效 ref → 错误", async () => {
    const result = await toolResultSearchTool.execute(
      { ref: "../../etc/passwd", query: "test" },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("无效的 ref");
  });

  it("ref 不存在 → 错误", async () => {
    const result = await toolResultSearchTool.execute(
      { ref: "deadbeef12345678", query: "test" },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });

  it("无 toolResultsDir → 错误", async () => {
    const result = await toolResultSearchTool.execute(
      { ref: "abc123", query: "test" },
      { state: {} },
    );
    expect(result.isError).toBe(true);
  });
});

// ============================================================
// tool_result_read_chunk
// ============================================================

describe("tool_result_read_chunk", () => {
  it("按游标读取片段", async () => {
    const content = "0123456789ABCDEFGHIJ"; // 20 字符
    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultReadChunkTool.execute(
      { ref, cursor: 5, maxTokens: 10 },
      makeCtx(),
    );
    expect(result.content).toContain("ref=\"" + ref + "\"");
    expect(result.content).toContain("56789ABCD");
  });

  it("cursor=0 → 从开头读", async () => {
    const content = "Hello World";
    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultReadChunkTool.execute(
      { ref, cursor: 0, maxTokens: 10 },
      makeCtx(),
    );
    expect(result.content).toContain("Hello World");
  });

  it("cursor 超界 → 错误", async () => {
    const content = "short";
    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultReadChunkTool.execute(
      { ref, cursor: 99999, maxTokens: 10 },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("超出文件大小");
  });

  it("cursor 负数 → 错误", async () => {
    const content = "test";
    const ref = persistToolResult(tmpDir, "bash", content);

    const result = await toolResultReadChunkTool.execute(
      { ref, cursor: -1, maxTokens: 10 },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });

  it("无效 ref → 错误", async () => {
    const result = await toolResultReadChunkTool.execute(
      { ref: "../etc/passwd", cursor: 0 },
      makeCtx(),
    );
    expect(result.isError).toBe(true);
  });
});
