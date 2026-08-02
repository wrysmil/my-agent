/**
 * 内置工具集
 *
 * 包含基础文件操作、命令执行和网络抓取工具。
 * 仿 Orkas 内置工具设计，使用项目现有 defineTool 工厂。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { defineTool, type AgentTool, type ToolContext } from "./base.js";

// ============================================================
// 文件读取
// ============================================================

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "读取文件内容。支持指定行号范围和字符范围，支持文本文件（PDF/二进制文件请用其他工具）。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "文件路径（绝对路径或相对于工作目录）" },
      offset: { type: "number", description: "起始行号（从 1 开始），不传则从头读取" },
      limit: { type: "number", description: "读取行数，不传则读取全部" },
    },
    required: ["filePath"],
  },
  execute: async (input, ctx) => {
    const resolved = resolvePath(input.filePath as string, ctx);
    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const lines = content.split("\n");
      const offset = (input.offset as number) ?? 1;
      const limit = input.limit as number | undefined;

      const start = Math.max(0, offset - 1);
      const end = limit ? start + limit : lines.length;
      const sliced = lines.slice(start, end);

      const result = sliced
        .map((l, i) => `${String(start + i + 1).padStart(4, " ")}| ${l}`)
        .join("\n");

      const header = `📄 ${path.basename(resolved)} (${lines.length} 行, ${content.length} 字符)\n`;
      return { content: header + result };
    } catch (err) {
      return { content: `读取文件失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// 文件写入
// ============================================================

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "将内容写入文件。如果文件已存在则覆盖，父目录自动创建。写入内容为 UTF-8 文本。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "目标文件路径" },
      content: { type: "string", description: "要写入的内容" },
    },
    required: ["filePath", "content"],
  },
  execute: async (input, ctx) => {
    const resolved = resolvePath(input.filePath as string, ctx);
    const content = input.content as string;
    try {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, content, "utf-8");
      const size = content.length;
      return { content: `✅ 已写入 ${path.basename(resolved)} (${formatSize(size)})` };
    } catch (err) {
      return { content: `写入文件失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// 文件编辑（old_string → new_string）
// ============================================================

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "对现有文件进行精确的字符串替换（old_string → new_string）。old_string 必须在文件中唯一匹配（如不唯一则报错，需提供更多上下文使其唯一）。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "要编辑的文件路径" },
      oldString: { type: "string", description: "要被替换的原文本（必须唯一匹配）" },
      newString: { type: "string", description: "替换后的新文本" },
      replaceAll: {
        type: "boolean",
        description: "是否替换所有匹配项（默认 false，即要求唯一匹配）",
      },
    },
    required: ["filePath", "oldString", "newString"],
  },
  execute: async (input, ctx) => {
    const resolved = resolvePath(input.filePath as string, ctx);
    const oldStr = input.oldString as string;
    const newStr = input.newString as string;
    const replaceAll = (input.replaceAll as boolean) ?? false;

    try {
      const original = fs.readFileSync(resolved, "utf-8");
      const count = original.split(oldStr).length - 1;

      if (count === 0) {
        return { content: `❌ 未找到匹配的 old_string，文件未修改`, isError: true };
      }

      if (!replaceAll && count > 1) {
        return {
          content: `❌ old_string 匹配了 ${count} 处，不唯一。请提供更多上下文使其唯一，或设置 replaceAll: true`,
          isError: true,
        };
      }

      const updated = replaceAll
        ? original.replaceAll(oldStr, newStr)
        : original.replace(oldStr, newStr);

      fs.writeFileSync(resolved, updated, "utf-8");
      return {
        content: `✅ 已编辑 ${path.basename(resolved)}（替换了 ${count} 处）`,
      };
    } catch (err) {
      return { content: `编辑文件失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// 目录列表
// ============================================================

export const listFilesTool = defineTool({
  name: "list_files",
  description: "列出目录中的文件和子目录。支持递归展开（默认 2 层深度）。",
  inputSchema: {
    type: "object",
    properties: {
      dirPath: { type: "string", description: "目录路径，默认为工作目录" },
      depth: { type: "number", description: "递归深度（默认 2，最大 5）" },
      pattern: { type: "string", description: "glob 风格过滤，如 '*.ts'" },
    },
  },
  execute: async (input, ctx) => {
    const dir = input.dirPath
      ? resolvePath(input.dirPath as string, ctx)
      : (ctx.workingDir ?? process.cwd());
    const maxDepth = Math.min((input.depth as number) ?? 2, 5);
    const pattern = input.pattern as string | undefined;

    try {
      const lines = listDir(dir, "", 0, maxDepth, pattern);
      return { content: `📁 ${dir}\n${lines.join("\n")}\n\n共 ${lines.length} 项` };
    } catch (err) {
      return { content: `列出目录失败: ${String(err)}`, isError: true };
    }
  },
});

function listDir(
  base: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  pattern?: string,
): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];

  try {
    const entries = fs.readdirSync(path.join(base, prefix), { withFileTypes: true });
    // 目录在前，文件在后
    const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

    for (const d of dirs) {
      if (d.name.startsWith(".") && d.name !== ".git") continue; // 跳过隐藏目录（保留 .git）
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      results.push(`📁 ${rel}/`);
      results.push(...listDir(base, rel, depth + 1, maxDepth, pattern));
    }

    for (const f of files) {
      const name = f.name;
      if (pattern && !matchGlob(name, pattern)) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      try {
        const stat = fs.statSync(path.join(base, rel));
        results.push(`📄 ${rel} (${formatSize(stat.size)})`);
      } catch {
        results.push(`📄 ${rel}`);
      }
    }
  } catch {
    // 权限错误等，跳过
  }

  return results;
}

// ============================================================
// 文件搜索（按名称/glob）
// ============================================================

export const searchFilesTool = defineTool({
  name: "search_files",
  description: "按文件名/glob 模式在工作目录中搜索文件。",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "搜索模式，如 '*.ts'、'**/*.test.ts'" },
      dirPath: { type: "string", description: "搜索起始目录，默认为工作目录" },
      maxResults: { type: "number", description: "最大返回结果数（默认 50）" },
    },
    required: ["pattern"],
  },
  execute: async (input, ctx) => {
    const pattern = input.pattern as string;
    const dir = input.dirPath
      ? resolvePath(input.dirPath as string, ctx)
      : (ctx.workingDir ?? process.cwd());
    const maxResults = (input.maxResults as number) ?? 50;

    try {
      const results = searchFiles(dir, pattern, maxResults);
      if (results.length === 0) {
        return { content: `未找到匹配 "${pattern}" 的文件` };
      }
      return {
        content: `🔍 搜索 "${pattern}" (${results.length} 个结果):\n${results.map((r) => `  ${path.relative(dir, r)}`).join("\n")}`,
      };
    } catch (err) {
      return { content: `搜索文件失败: ${String(err)}`, isError: true };
    }
  },
});

function searchFiles(root: string, pattern: string, max: number): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function walk(dir: string) {
    if (results.length >= max) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= max) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && regex.test(entry.name)) {
          results.push(full);
        }
      }
    } catch {
      // 跳过无权限目录
    }
  }

  walk(root);
  return results;
}

// ============================================================
// 内容搜索（grep）
// ============================================================

export const grepFilesTool = defineTool({
  name: "grep_files",
  description:
    "在工作目录的文件内容中搜索文本/正则表达式。自动跳过 node_modules、.git 和二进制文件。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索文本或正则表达式" },
      dirPath: { type: "string", description: "搜索起始目录" },
      glob: { type: "string", description: "文件名过滤 glob（如 '*.ts'）" },
      maxResults: { type: "number", description: "最大返回结果数（默认 30）" },
      caseSensitive: { type: "boolean", description: "是否区分大小写（默认 false）" },
    },
    required: ["query"],
  },
  execute: async (input, ctx) => {
    const query = input.query as string;
    const dir = input.dirPath
      ? resolvePath(input.dirPath as string, ctx)
      : (ctx.workingDir ?? process.cwd());
    const glob = input.glob as string | undefined;
    const maxResults = (input.maxResults as number) ?? 30;
    const caseSensitive = (input.caseSensitive as boolean) ?? false;

    try {
      const flags = caseSensitive ? "g" : "gi";
      const regex = new RegExp(escapeRegex(query), flags);
      const results = grepDir(dir, regex, glob, maxResults);
      if (results.length === 0) {
        return { content: `未找到匹配 "${query}" 的内容` };
      }
      return {
        content: `🔍 grep "${query}" (${results.length} 个结果):\n${results.join("\n")}`,
      };
    } catch (err) {
      return { content: `搜索内容失败: ${String(err)}`, isError: true };
    }
  },
});

function grepDir(
  root: string,
  regex: RegExp,
  fileGlob: string | undefined,
  max: number,
): string[] {
  const results: string[] = [];
  const skipDirs = new Set(["node_modules", ".git", ".claude", "dist", "build"]);

  function walk(dir: string) {
    if (results.length >= max) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= max) return;
        if (entry.name.startsWith(".") && !entry.name.startsWith(".env")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(full);
        } else if (entry.isFile()) {
          if (fileGlob && !matchGlob(entry.name, fileGlob)) continue;
          if (isBinaryExtension(entry.name)) continue;
          try {
            const content = fs.readFileSync(full, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < max; i++) {
              if (regex.test(lines[i])) {
                const relPath = path.relative(root, full);
                results.push(`  ${relPath}:${i + 1}: ${lines[i].trim().slice(0, 120)}`);
                regex.lastIndex = 0; // 重置 regex 状态
              }
            }
          } catch {
            // 二进制文件或读取失败，跳过
          }
        }
      }
    } catch {
      // 权限错误跳过
    }
  }

  walk(root);
  return results;
}

// ============================================================
// Shell 命令执行
// ============================================================

export const bashTool = defineTool({
  name: "bash",
  description:
    "执行 shell 命令并返回输出。命令在子进程中执行，默认超时 30 秒。注意：此操作具有副作用。",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的 shell 命令" },
      timeout: { type: "number", description: "超时毫秒数（默认 30000，最大 120000）" },
      workingDir: { type: "string", description: "工作目录（默认为 Agent 工作目录）" },
    },
    required: ["command"],
  },
  execute: async (input, ctx) => {
    const command = input.command as string;
    const timeout = Math.min((input.timeout as number) ?? 30000, 120000);
    const cwd = input.workingDir
      ? resolvePath(input.workingDir as string, ctx)
      : (ctx.workingDir ?? process.cwd());

    return new Promise((resolve) => {
      const child = childProcess.exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: 1024 * 1024, // 1MB 输出上限
          encoding: "utf-8",
          env: { ...process.env },
        },
        (err, stdout, stderr) => {
          if (err) {
            const output = [stdout, stderr].filter(Boolean).join("\n") || err.message;
            resolve({
              content: `❌ 命令执行失败 (exit ${(err as any).code ?? "?"}):\n${output.slice(0, 2000)}`,
              isError: true,
            });
            return;
          }
          const output = [stdout, stderr].filter(Boolean).join("\n") || "(无输出)";
          resolve({ content: output.slice(0, 4000) });
        },
      );

      // AbortSignal 支持
      if (ctx.signal) {
        const onAbort = () => {
          child.kill("SIGTERM");
          resolve({ content: "⚠️ 命令已被用户中止", isError: true });
        };
        if (ctx.signal.aborted) {
          onAbort();
        } else {
          ctx.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  },
});

// ============================================================
// 网页抓取
// ============================================================

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "获取指定 URL 的网页内容并提取文本。适用于阅读文档、API 响应等。不支持需要登录的页面。",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "要抓取的 URL（http/https）" },
      maxChars: { type: "number", description: "最大返回字符数（默认 10000）" },
    },
    required: ["url"],
  },
  execute: async (input, ctx) => {
    const url = input.url as string;
    const maxChars = (input.maxChars as number) ?? 10000;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { content: `❌ URL 必须以 http:// 或 https:// 开头: ${url}`, isError: true };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "MyAgent/0.1 (web_fetch tool)",
          Accept: "text/html, text/plain, application/json, */*",
        },
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        return { content: `❌ HTTP ${resp.status} ${resp.statusText}`, isError: true };
      }

      const contentType = resp.headers.get("content-type") ?? "";
      let text: string;

      if (contentType.includes("application/json")) {
        const json = await resp.json();
        text = JSON.stringify(json, null, 2);
      } else {
        text = await resp.text();
        // 简单 HTML → 纯文本提取
        if (contentType.includes("text/html")) {
          text = stripHtml(text);
        }
      }

      const truncated = text.length > maxChars ? text.slice(0, maxChars) + "\n...(已截断)" : text;
      return { content: truncated };
    } catch (err) {
      return { content: `抓取网页失败: ${String(err)}`, isError: true };
    }
  },
});

// ============================================================
// 工具集合
// ============================================================

export const BUILTIN_TOOLS: AgentTool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  searchFilesTool,
  grepFilesTool,
  bashTool,
  webFetchTool,
];

// ============================================================
// 辅助函数
// ============================================================

function resolvePath(filePath: string, ctx: ToolContext): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(ctx.workingDir ?? process.cwd(), filePath);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchGlob(name: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(name);
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBinaryExtension(name: string): boolean {
  const binExts = new Set([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".mp3", ".mp4", ".avi", ".mov", ".wav",
    ".exe", ".dll", ".so", ".dylib", ".wasm",
    ".woff", ".woff2", ".ttf", ".eot",
  ]);
  const ext = path.extname(name).toLowerCase();
  return binExts.has(ext);
}

function stripHtml(html: string): string {
  // 简单 HTML 标签去除
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
