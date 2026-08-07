/**
 * 工具结果溢出管理测试
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  estimateToolResultTokens,
  buildBoundedPreview,
  persistToolResult,
  claimRoundInlineBudget,
  buildPersistedOutputMarker,
  capToolResult,
  sweepToolResults,
  TOOL_RESULT_INLINE_LEDGER_STATE_KEY,
  DEFAULT_INLINE_RESULT_TOKENS,
  type ToolResultInlineLedger,
} from "./tool-result-cap.js";
import type { ToolContext, ToolResult } from "./base.js";

// ============================================================
// 辅助
// ============================================================

function makeCtx(state?: Record<string, unknown>): ToolContext {
  return { state: state ?? {} };
}

function makeResult(content: string, isError = false): ToolResult {
  return { content, isError };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-cap-test-"));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================
// estimateToolResultTokens
// ============================================================

describe("estimateToolResultTokens", () => {
  it("空串 → 0", () => {
    expect(estimateToolResultTokens("")).toBe(0);
  });

  it("纯英文 → ~字符数/4", () => {
    const text = "Hello world this is a test string with about fifty characters in it!";
    const estimated = estimateToolResultTokens(text);
    // 约 70 字符 → ~18 tokens (70/4 ≈ 17.5)
    expect(estimated).toBeGreaterThan(10);
    expect(estimated).toBeLessThan(25);
  });

  it("纯中文 → ~字符数×1.5", () => {
    const text = "这是一段中文文本用来测试中文token估算是否准确合理";
    const estimated = estimateToolResultTokens(text);
    // 22 CJK 字符 → ~33 tokens
    expect(estimated).toBeGreaterThan(25);
    expect(estimated).toBeLessThan(40);
  });

  it("中英混合 → 加权估算", () => {
    const text = "Hello你好World世界";
    const estimated = estimateToolResultTokens(text);
    // 10 ascii + 4 cjk → 10/4 + 4*1.5 ≈ 2.5 + 6 = 8.5 → 9
    expect(estimated).toBeGreaterThan(5);
    expect(estimated).toBeLessThan(15);
  });
});

// ============================================================
// buildBoundedPreview
// ============================================================

describe("buildBoundedPreview", () => {
  it("短内容 → 不截断", () => {
    const text = "short text";
    const preview = buildBoundedPreview(text, 1000);
    expect(preview).toBe(text);
  });

  it("长内容 → 72/28 截断", () => {
    // 生成足够长的文本（~500 字符英文）
    const text = "A".repeat(500);
    const preview = buildBoundedPreview(text, 50); // 50 tokens → 约 200 字符
    expect(preview.length).toBeLessThan(text.length);
    expect(preview).toContain("字符省略");
    // head 部分应 > tail 部分（72% vs 28%）
    const headPart = preview.split("...")[0];
    const tailPart = preview.split("...").pop() ?? "";
    expect(headPart.length).toBeGreaterThan(tailPart.length);
  });
});

// ============================================================
// persistToolResult
// ============================================================

describe("persistToolResult", () => {
  it("内容寻址去重", () => {
    const ref1 = persistToolResult(tmpDir, "bash", "hello world");
    const ref2 = persistToolResult(tmpDir, "bash", "hello world");
    expect(ref1).toBe(ref2);
    // 磁盘上只应有一个文件
    const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith(".tmp"));
    expect(files.length).toBe(1);
  });

  it("不同内容 → 不同 ref", () => {
    const ref1 = persistToolResult(tmpDir, "bash", "content A");
    const ref2 = persistToolResult(tmpDir, "bash", "content B");
    expect(ref1).not.toBe(ref2);
  });

  it("ref 为 16 位 hex", () => {
    const ref = persistToolResult(tmpDir, "bash", "test content");
    expect(ref).toMatch(/^[a-f0-9]{16}$/);
  });

  it("文件包含工具名前缀", () => {
    const ref = persistToolResult(tmpDir, "grep_files", "some text");
    const files = fs.readdirSync(tmpDir).filter((f) => !f.endsWith(".tmp"));
    expect(files.length).toBe(1);
    expect(files[0]).toContain("grep_files");
    expect(files[0]).toContain(ref);
  });
});

// ============================================================
// claimRoundInlineBudget
// ============================================================

describe("claimRoundInlineBudget", () => {
  it("足够 → 扣除成功", () => {
    const ledger: ToolResultInlineLedger = { initialTokens: 1000, remainingTokens: 1000 };
    const ctx = makeCtx({ [TOOL_RESULT_INLINE_LEDGER_STATE_KEY]: ledger });
    expect(claimRoundInlineBudget(ctx, 300)).toBe(true);
    expect(ledger.remainingTokens).toBe(700);
  });

  it("不足 → 返回 false，余额不变", () => {
    const ledger: ToolResultInlineLedger = { initialTokens: 100, remainingTokens: 100 };
    const ctx = makeCtx({ [TOOL_RESULT_INLINE_LEDGER_STATE_KEY]: ledger });
    expect(claimRoundInlineBudget(ctx, 300)).toBe(false);
    expect(ledger.remainingTokens).toBe(100);
  });

  it("无账本 → 返回 true（无账本时放行，不强制预算检查）", () => {
    const ctx = makeCtx({});
    expect(claimRoundInlineBudget(ctx, 100)).toBe(true);
  });

  it("余额正好 → 扣除成功", () => {
    const ledger: ToolResultInlineLedger = { initialTokens: 300, remainingTokens: 300 };
    const ctx = makeCtx({ [TOOL_RESULT_INLINE_LEDGER_STATE_KEY]: ledger });
    expect(claimRoundInlineBudget(ctx, 300)).toBe(true);
    expect(ledger.remainingTokens).toBe(0);
  });
});

// ============================================================
// buildPersistedOutputMarker
// ============================================================

describe("buildPersistedOutputMarker", () => {
  it("marker 包含 ref / tool / size / estimated_tokens 属性", () => {
    const marker = buildPersistedOutputMarker("abc123", "bash", "test content", "success");
    expect(marker).toContain('<persisted-output ref="abc123"');
    expect(marker).toContain('tool="bash"');
    expect(marker).toContain("size=");
    expect(marker).toContain("estimated_tokens=");
    expect(marker).toContain("status=\"success\"");
    expect(marker).toContain("</persisted-output>");
  });

  it("marker 包含取回指导", () => {
    const marker = buildPersistedOutputMarker("abc123", "bash", "test", "success");
    expect(marker).toContain("tool_result_search");
    expect(marker).toContain("tool_result_read_chunk");
  });
});

// ============================================================
// capToolResult
// ============================================================

describe("capToolResult", () => {
  it("小结果 → 原样返回", () => {
    const result = makeResult("small result");
    const capped = capToolResult("bash", result, makeCtx(), { toolResultsDir: tmpDir, maxInlineTokens: 1000 });
    expect(capped.content).toBe("small result");
  });

  it("超过单结果预算 → 溢出为 marker", () => {
    const bigText = "你好".repeat(6000); // ~12000 CJK chars → ~18000 tokens
    const result = makeResult(bigText);
    const capped = capToolResult("bash", result, makeCtx(), {
      toolResultsDir: tmpDir,
      maxInlineTokens: 100,
    });
    expect(capped.content).toContain("<persisted-output");
    expect(capped.content).toContain("</persisted-output>");
    expect(capped.persistedOutput).toBeDefined();
  });

  it("超过账本预算 → 溢出", () => {
    const ledger: ToolResultInlineLedger = { initialTokens: 50, remainingTokens: 50 };
    const ctx = makeCtx({ [TOOL_RESULT_INLINE_LEDGER_STATE_KEY]: ledger });
    const text = "A".repeat(500); // ~125 tokens
    const result = makeResult(text);

    const capped = capToolResult("bash", result, ctx, {
      toolResultsDir: tmpDir,
      maxInlineTokens: 1000, // 单结果不超
    });
    // 账本不足 → 溢出
    expect(capped.content).toContain("<persisted-output");
  });

  it("空结果 → 原样返回", () => {
    const result: ToolResult = { content: "" };
    const capped = capToolResult("bash", result, makeCtx(), { toolResultsDir: tmpDir });
    expect(capped.content).toBe("");
  });

  it("持久化失败 → 降级，不抛异常", () => {
    // 将 toolResultsDir 设为一个文件路径（而非目录），使 mkdirSync 失败
    const filePath = path.join(tmpDir, "not-a-dir");
    fs.writeFileSync(filePath, "block");
    const result = makeResult("big content here ".repeat(200));
    const capped = capToolResult("bash", result, makeCtx(), {
      toolResultsDir: filePath, // 文件当目录 → persist 失败
      maxInlineTokens: 10,
    });
    // 降级为截断预览
    expect(capped.content).toContain("truncated preview");
    expect(capped.content).not.toContain("<persisted-output");
  });

  it("保留 isError / endTurn", () => {
    const result: ToolResult = {
      content: "error ".repeat(500),
      isError: true,
      endTurn: true,
    };
    const capped = capToolResult("bash", result, makeCtx(), {
      toolResultsDir: tmpDir,
      maxInlineTokens: 10,
    });
    expect(capped.isError).toBe(true);
    expect(capped.endTurn).toBe(true);
  });
});

// ============================================================
// sweepToolResults
// ============================================================

describe("sweepToolResults", () => {
  it("空目录 → 0/0", () => {
    const r = sweepToolResults(tmpDir);
    expect(r.deleted).toBe(0);
    expect(r.freedBytes).toBe(0);
  });

  it("不存在目录 → 0/0", () => {
    const r = sweepToolResults(path.join(tmpDir, "nonexistent"));
    expect(r.deleted).toBe(0);
    expect(r.freedBytes).toBe(0);
  });

  it("删除过期文件", () => {
    // 创建一个旧文件（mtime 设为 10 天前）
    const f = path.join(tmpDir, "bash-old.txt");
    fs.writeFileSync(f, "old content");
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(f, oldTime, oldTime);

    const r = sweepToolResults(tmpDir, 7); // 7 天
    expect(r.deleted).toBe(1);
  });

  it("保留新文件", () => {
    const f = path.join(tmpDir, "bash-new.txt");
    fs.writeFileSync(f, "new content");

    const r = sweepToolResults(tmpDir, 7);
    expect(r.deleted).toBe(0);
  });
});
