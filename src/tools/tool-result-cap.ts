/**
 * 工具结果溢出管理（Tool Result Cap）
 *
 * 超大工具结果自动溢出持久化，防止撑爆 LLM 上下文。
 *
 * 核心机制：
 * - 双预算：单结果 token 上限 + 本轮总 inline token 上限
 * - CJK 感知 token 估算（CJK 字符 × 1.5，其他字符 / 4）
 * - 内容寻址持久化（SHA-256） + 原子 rename
 * - 72% head + 28% tail 预览
 * - 永不抛异常降级
 * - GC：按天数/容量驱逐过期结果
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ToolContext, ToolResult } from "./base.js";

// ============================================================
// 常量
// ============================================================

/** 单结果内联 token 预算（默认 8000） */
export const DEFAULT_INLINE_RESULT_TOKENS = 8_000;

/** 本轮总 inline token 预算（默认 16000） */
export const MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND = 16_000;

/** 降级预览 token 数（持久化失败时用） */
const FALLBACK_PREVIEW_TOKENS = 600;

/** 本轮账本 state key */
export const TOOL_RESULT_INLINE_LEDGER_STATE_KEY = "toolResultInlineLedger";

/** persisted-output marker 前缀 */
const PERSISTED_OUTPUT_PREFIX = "[Full content is stored under result ref ";

// ============================================================
// 类型
// ============================================================

export type ToolResultInlineLedger = {
  initialTokens: number;
  remainingTokens: number;
};

// ============================================================
// CJK 感知 token 估算
// ============================================================

/**
 * CJK 字符 × 1.5 tokens（含中文、日文、韩文等全角字符），
 * 其他字符 / 4 tokens（英文约 4 字符/token）。
 */
export function estimateToolResultTokens(text: string): number {
  let cjk = 0;
  let other = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ext-A
      (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Unified Ext-B
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compat
      (cp >= 0x3000 && cp <= 0x303f) || // CJK Symbols
      (cp >= 0xff00 && cp <= 0xffef) || // Half/Full-width
      (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
      (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
      (cp >= 0xac00 && cp <= 0xd7af) // Hangul
    ) {
      cjk++;
    } else {
      other++;
    }
  }

  return Math.ceil(cjk * 1.5 + other / 4);
}

// ============================================================
// 预览构建
// ============================================================

/**
 * 构建 72% head + 28% tail 的有界预览。
 *
 * @param content — 原始内容
 * @param maxTokens — 预览最大 token 数
 */
export function buildBoundedPreview(content: string, maxTokens: number): string {
  if (!content) return "";

  const estimated = estimateToolResultTokens(content);
  if (estimated <= maxTokens) return content;

  // 按字符数近似截断（72/28 比例）
  const totalChars = content.length;
  const headTargetTokens = Math.floor(maxTokens * 0.72);
  const tailTargetTokens = maxTokens - headTargetTokens;

  // 按字符比例估算截断位置
  const tokensPerChar = estimated / totalChars;
  const headChars = Math.floor(headTargetTokens / tokensPerChar);
  const tailChars = Math.floor(tailTargetTokens / tokensPerChar);

  const head = content.slice(0, headChars);
  const tail = content.slice(totalChars - tailChars);

  const separator = `\n\n... [${totalChars - headChars - tailChars} 字符省略] ...\n\n`;

  return head + separator + tail;
}

// ============================================================
// 内容寻址持久化
// ============================================================

/**
 * 将工具结果持久化到 tool-results 目录。
 *
 * 内容寻址（SHA-256）去重：相同内容只存一份。
 * 原子 rename：先写 .tmp 再 rename 到最终路径。
 *
 * @param toolResultsDir — 持久化根目录
 * @param toolName — 工具名（用于文件前缀）
 * @param content — 结果内容
 * @returns ref（SHA-256 哈希前 16 位 hex）
 */
export function persistToolResult(
  toolResultsDir: string,
  toolName: string,
  content: string,
): string {
  if (!fs.existsSync(toolResultsDir)) {
    fs.mkdirSync(toolResultsDir, { recursive: true });
  }

  const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  const ref = hash.slice(0, 16);
  const finalPath = path.join(toolResultsDir, `${toolName}-${ref}.txt`);

  // 去重：同内容已存在
  if (fs.existsSync(finalPath)) return ref;

  // 原子 rename：先写 .tmp
  const tmpPath = finalPath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, content, "utf-8");
    try {
      fs.renameSync(tmpPath, finalPath);
    } catch (renameErr) {
      // 并发竞态：目标可能已被其他调用创建
      if (!fs.existsSync(finalPath)) throw renameErr;
      // 目标已存在 → 清理 tmp
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  } catch (writeErr) {
    // 写入失败 → 清理 tmp，抛给调用方降级
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw writeErr;
  }

  return ref;
}

// ============================================================
// 账本管理
// ============================================================

/**
 * 尝试从本轮账本中扣除 inline token 预算。
 *
 * @returns 扣除成功则 true；余额不足或无账本则 false
 */
export function claimRoundInlineBudget(
  ctx: ToolContext,
  tokens: number,
): boolean {
  const ledger = ctx.state[TOOL_RESULT_INLINE_LEDGER_STATE_KEY] as
    | ToolResultInlineLedger
    | undefined;

  if (!ledger) return true; // 无账本 → 放行（向后兼容，不强制账本检查）

  if (ledger.remainingTokens >= tokens) {
    ledger.remainingTokens -= tokens;
    return true;
  }

  return false;
}

// ============================================================
// 构建 persisted-output marker
// ============================================================

export function buildPersistedOutputMarker(
  ref: string,
  toolName: string,
  content: string,
  status: string,
): string {
  const size = Buffer.byteLength(content, "utf-8");
  const estimatedTokens = estimateToolResultTokens(content);
  const preview = buildBoundedPreview(content, FALLBACK_PREVIEW_TOKENS);

  return [
    `<persisted-output ref="${ref}" tool="${toolName}" size="${size}" estimated_tokens="${estimatedTokens}" status="${status}">`,
    preview,
    `${PERSISTED_OUTPUT_PREFIX}${ref}.`,
    " Use tool_result_search(ref, query) first, or tool_result_read_chunk(ref, cursor, maxTokens)",
    " for an exact bounded slice. Do not use read_file on the stored path.",
    "</persisted-output>",
  ].join("\n");
}

// ============================================================
// 主入口：capToolResult
// ============================================================

export interface CapToolResultOpts {
  /** 单结果 inline token 上限 */
  maxInlineTokens?: number;
  /** 持久化目录 */
  toolResultsDir: string;
}

/**
 * 检查工具结果是否超过预算，超限则溢出持久化。
 *
 * 双预算逻辑：
 * 1. 单结果预算：超过 maxInlineTokens → 溢出
 * 2. 本轮账本：claimRoundInlineBudget 失败 → 溢出
 * 3. 都不超 → 原样返回
 * 4. 溢出：持久化 → 返回 persisted-output marker
 * 5. 持久化失败 → 降级为 buildBoundedPreview（永不抛异常）
 *
 * @returns 处理后的 ToolResult（可能被替换为 marker）
 */
export function capToolResult(
  toolName: string,
  result: ToolResult,
  ctx: ToolContext,
  opts: CapToolResultOpts,
): ToolResult {
  const content = result.content ?? "";
  if (!content) return result;

  const maxInline = opts.maxInlineTokens ?? DEFAULT_INLINE_RESULT_TOKENS;
  const estimatedTokens = estimateToolResultTokens(content);

  // 单结果预算检查
  if (estimatedTokens > maxInline) {
    return spillResult(toolName, result, content, opts.toolResultsDir);
  }

  // 本轮账本预算检查
  if (!claimRoundInlineBudget(ctx, estimatedTokens)) {
    return spillResult(toolName, result, content, opts.toolResultsDir);
  }

  // 不超 → 原样返回
  return result;
}

function spillResult(
  toolName: string,
  result: ToolResult,
  content: string,
  toolResultsDir: string,
): ToolResult {
  try {
    const ref = persistToolResult(toolResultsDir, toolName, content);
    const marker = buildPersistedOutputMarker(
      ref,
      toolName,
      content,
      result.isError ? "error" : "success",
    );

    return {
      content: marker,
      isError: result.isError,
      endTurn: result.endTurn,
      persistedOutput: { path: path.join(toolResultsDir, `${toolName}-${ref}.txt`), size: Buffer.byteLength(content, "utf-8"), ref },
    };
  } catch {
    // 持久化失败 → 降级：返回截断预览 + error marker（永不抛异常）
    const preview = buildBoundedPreview(content, FALLBACK_PREVIEW_TOKENS);
    return {
      content: `[⚠️ Persistence failed — showing truncated preview]\n\n${preview}`,
      isError: result.isError,
      endTurn: result.endTurn,
    };
  }
}

// ============================================================
// wrapToolWithCap — 工具包装器
// ============================================================

/**
 * 包装工具，自动对执行结果应用 capToolResult。
 *
 * 用于非 runner 内联集成场景（如直接在 AgentRunner 外部调用工具时）。
 */
export function wrapToolWithCap(
  tool: import("./base.js").AgentTool,
  opts: CapToolResultOpts,
): import("./base.js").AgentTool {
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (input, ctx) => {
      const result = await originalExecute(input, ctx);
      return capToolResult(tool.name, result, ctx, opts);
    },
  };
}

// ============================================================
// GC：驱逐过期/超配额结果
// ============================================================

export interface SweepResult {
  deleted: number;
  freedBytes: number;
}

/**
 * 清理过期的工具结果。
 *
 * 驱逐策略：
 * 1. 按 mtime：删除超过 maxAgeDays 的条目
 * 2. 按容量：累计超 maxTotalBytes 后按 mtime 升序驱逐（最早先删）
 *
 * @param toolResultsDir — 工具结果目录
 * @param maxAgeDays — 最大保留天数（默认 7）
 * @param maxTotalBytes — 最大总字节数（默认 200MB）
 */
export function sweepToolResults(
  toolResultsDir: string,
  maxAgeDays: number = 7,
  maxTotalBytes: number = 200 * 1024 * 1024,
): SweepResult {
  if (!fs.existsSync(toolResultsDir)) {
    return { deleted: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  interface FileInfo {
    path: string;
    size: number;
    mtimeMs: number;
  }

  // 收集文件信息
  const files: FileInfo[] = [];
  try {
    for (const entry of fs.readdirSync(toolResultsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(toolResultsDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // 文件可能已被删除
      }
    }
  } catch {
    return { deleted: 0, freedBytes: 0 };
  }

  let deleted = 0;
  let freedBytes = 0;
  const remaining: FileInfo[] = [];

  // 第1轮：按时间驱逐
  for (const f of files) {
    if (now - f.mtimeMs > maxAgeMs) {
      try {
        fs.unlinkSync(f.path);
        deleted++;
        freedBytes += f.size;
      } catch {
        // 忽略删除失败
      }
    } else {
      remaining.push(f);
    }
  }

  // 第2轮：按容量驱逐（mtime 升序，最早先删）
  let totalBytes = remaining.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > maxTotalBytes) {
    remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of remaining) {
      if (totalBytes <= maxTotalBytes) break;
      try {
        fs.unlinkSync(f.path);
        deleted++;
        freedBytes += f.size;
        totalBytes -= f.size;
      } catch {
        // 忽略删除失败
      }
    }
  }

  return { deleted, freedBytes };
}
