/**
 * 工具结果取回工具
 *
 * 两个取回工具：
 * - `tool_result_search` — 在持久化的超大工具结果中搜索文本
 * - `tool_result_read_chunk` — 按游标读取持久化结果的指定字节片段
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defineTool } from "./base.js";
import type { ToolContext } from "./base.js";

// ============================================================
// ref 解析
// ============================================================

/**
 * 将 ref 解析为持久化文件路径。
 *
 * 安全校验：
 * - ref 仅允许 hex 字符（防止路径穿越）
 * - 目标文件必须在 toolResultsDir 内
 * - 文件必须存在
 *
 * @returns 文件的绝对路径；失败返回 null + error 消息
 */
function resolveRef(
  ref: string,
  toolResultsDir: string,
): { path: string } | { error: string } {
  // ref 校验：仅 hex 字符
  if (!ref || !/^[a-f0-9]{8,64}$/i.test(ref)) {
    return { error: `无效的 ref: "${ref}"。ref 必须为 hex 字符串。` };
  }

  const resolvedDir = path.resolve(toolResultsDir);

  // 在 toolResultsDir 下查找匹配文件
  let targetPath: string | null = null;
  try {
    if (!fs.existsSync(resolvedDir)) {
      return { error: "工具结果目录不存在。可能尚未产生溢出结果。" };
    }
    for (const entry of fs.readdirSync(resolvedDir)) {
      if (entry.includes(ref)) {
        const fullPath = path.resolve(resolvedDir, entry);
        // 二次确认在 toolResultsDir 内
        if (fullPath.startsWith(resolvedDir + path.sep) || fullPath === resolvedDir) {
          // 但 ref 匹配可以匹配到目录本身，排除
        }
        if (fullPath.startsWith(resolvedDir + path.sep)) {
          targetPath = fullPath;
          break;
        }
      }
    }
  } catch {
    return { error: "无法读取工具结果目录。" };
  }

  if (!targetPath) {
    return { error: `未找到 ref="${ref}" 对应的持久化结果。可能已被 GC 清理。` };
  }

  return { path: targetPath };
}

// ============================================================
// tool_result_search
// ============================================================

export const toolResultSearchTool = defineTool({
  name: "tool_result_search",
  description:
    "在已持久化的工具结果中搜索文本。ref 来自 <persisted-output> 标记。",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "结果引用标识（来自 <persisted-output> 标记）" },
      query: { type: "string", description: "搜索关键词或正则表达式" },
      maxTokens: { type: "number", description: "最大返回 token 数（默认 2000）" },
    },
    required: ["ref", "query"],
  },
  execute: async (input, ctx) => {
    const ref = input.ref as string;
    const query = input.query as string;
    const maxTokens = (input.maxTokens as number) ?? 2000;

    const toolResultsDir = ctx.state["toolResultsDir"] as string | undefined;
    if (!toolResultsDir) {
      return { content: "tool_result_search: 内部错误 — toolResultsDir 未配置", isError: true };
    }

    const resolved = resolveRef(ref, toolResultsDir);
    if ("error" in resolved) {
      return { content: resolved.error, isError: true };
    }

    try {
      const content = fs.readFileSync(resolved.path, "utf-8");
      const lines = content.split("\n");

      // 搜索匹配行（支持简单子串匹配和 regex）
      let regex: RegExp;
      try {
        regex = new RegExp(query, "gi");
      } catch {
        // 非法的 regex → 用子串匹配
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, "gi");
      }

      const matches: Array<{ lineNum: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ lineNum: i + 1, text: lines[i].slice(0, 200) });
          regex.lastIndex = 0;
        }
      }

      if (matches.length === 0) {
        return { content: `在结果中未找到匹配 "${query}" 的内容。` };
      }

      // 按 maxTokens 截断（粗略估算：每行约 0.25 token/char）
      let output = `🔍 在 ref="${ref}" 中搜索 "${query}" (${matches.length} 处匹配):\n\n`;
      const headerTokens = 20;
      let usedTokens = headerTokens;

      for (const m of matches) {
        const line = `  L${String(m.lineNum).padStart(5)}: ${m.text}\n`;
        const lineTokens = Math.ceil(m.text.length / 4);
        if (usedTokens + lineTokens > maxTokens) {
          output += `...(已截断，共 ${matches.length} 处匹配)\n`;
          break;
        }
        output += line;
        usedTokens += lineTokens;
      }

      return { content: output };
    } catch (err) {
      return { content: `读取结果失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// tool_result_read_chunk
// ============================================================

export const toolResultReadChunkTool = defineTool({
  name: "tool_result_read_chunk",
  description:
    "按字节偏移读取持久化工具结果的指定片段。使用游标从 0 开始。",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "结果引用标识（来自 <persisted-output> 标记）" },
      cursor: { type: "number", description: "字节偏移量（从 0 开始）" },
      maxTokens: { type: "number", description: "最大返回 token 数（默认 2000）" },
    },
    required: ["ref", "cursor"],
  },
  execute: async (input, ctx) => {
    const ref = input.ref as string;
    const cursor = input.cursor as number;
    const maxTokens = (input.maxTokens as number) ?? 2000;

    const toolResultsDir = ctx.state["toolResultsDir"] as string | undefined;
    if (!toolResultsDir) {
      return { content: "tool_result_read_chunk: 内部错误 — toolResultsDir 未配置", isError: true };
    }

    const resolved = resolveRef(ref, toolResultsDir);
    if ("error" in resolved) {
      return { content: resolved.error, isError: true };
    }

    try {
      const stat = fs.statSync(resolved.path);
      if (cursor < 0) {
        return { content: `cursor 不能为负数: ${cursor}`, isError: true };
      }
      if (cursor >= stat.size) {
        return { content: `cursor (${cursor}) 超出文件大小 (${stat.size} 字节)`, isError: true };
      }

      // 按 maxTokens * 4 估算读取字节数
      const readBytes = Math.min(maxTokens * 4, stat.size - cursor);
      const buf = Buffer.alloc(readBytes);
      const fd = fs.openSync(resolved.path, "r");
      try {
        fs.readSync(fd, buf, 0, readBytes, cursor);
      } finally {
        fs.closeSync(fd);
      }

      const text = buf.toString("utf-8");
      const end = cursor + readBytes;

      return {
        content: [
          `📄 ref="${ref}" (${stat.size} 字节) 游标 ${cursor}-${end}:`,
          "",
          text,
        ].join("\n"),
      };
    } catch (err) {
      return { content: `读取结果失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// 工具集合
// ============================================================

export const TOOL_RESULT_TOOLS = [toolResultSearchTool, toolResultReadChunkTool];
