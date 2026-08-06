/**
 * JSONL 读写工具
 *
 * 提供 JSON Lines 格式的原子读写操作，用于 session 消息持久化。
 *
 * 特性：
 * - 追加写入：`appendJsonLine()` — 原子追加（POSIX <4KB 保证）
 * - 全量重写：`writeJsonLines()` — tempfile + rename 原子替换
 * - 逐行读取：`readJsonLines()` — 流式解析，损坏行跳过
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { Mutex } from "async-mutex";
import { sessionsDir } from "./paths.js";

// ============================================================
// 原子写入
// ============================================================

/**
 * 原子写入文件（tempfile + rename）。
 *
 * 先写入临时文件，完成后 fsync + rename 到目标路径。
 * 保证目标文件在任何时刻都是完整有效的（不会出现半写状态）。
 */
export function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmpName = `.${path.basename(filePath)}.${randomUUID().slice(0, 8)}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  try {
    fs.writeFileSync(tmpPath, content, { encoding: "utf-8", flag: "wx" });
    const fd = fs.openSync(tmpPath, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // 清理临时文件
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* 忽略清理失败 */
    }
    throw err;
  }
}

// ============================================================
// JSONL 操作
// ============================================================

/**
 * 追加一条 JSON 行到文件末尾。
 *
 * 每行一个 JSON 对象，以 `\n` 分隔。
 * 使用 `fs.appendFileSync`，对 <4KB 的写入 POSIX 保证原子性。
 *
 * @param filePath — JSONL 文件路径
 * @param obj — 可 JSON 序列化的对象
 * @param ensureDir — 是否自动创建父目录（默认 true）
 */
export function appendJsonLine(
  filePath: string,
  obj: unknown,
  ensureDir = true,
): void {
  if (ensureDir) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const line = JSON.stringify(obj) + "\n";
  fs.appendFileSync(filePath, line, { encoding: "utf-8" });
}

/**
 * 读取 JSONL 文件，逐行解析为对象数组。
 *
 * 空行跳过，解析失败的行跳过并触发 `onError` 回调（如果提供）。
 * 这使得部分损坏的 JSONL 文件仍可恢复大部分数据。
 *
 * @param filePath — JSONL 文件路径
 * @param onError — 解析失败回调（可选），参数为 (line, error, lineIndex)
 * @returns 成功解析的对象数组
 */
export function readJsonLines<T = unknown>(
  filePath: string,
  onError?: (line: string, error: Error, lineIndex: number) => void,
): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const text = fs.readFileSync(filePath, { encoding: "utf-8" });
  const lines = text.split("\n");
  const results: T[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // 跳过空行

    try {
      results.push(JSON.parse(line) as T);
    } catch (err) {
      if (onError) {
        onError(line, err instanceof Error ? err : new Error(String(err)), i);
      }
      // 跳过损坏行，继续解析后续行
    }
  }

  return results;
}

/**
 * 全量重写 JSONL 文件（原子写入）。
 *
 * 用于 compaction、heal 等需要完全替换文件内容的场景。
 *
 * @param filePath — JSONL 文件路径
 * @param objects — 要写入的对象数组
 */
export function writeJsonLines(
  filePath: string,
  objects: readonly unknown[],
): void {
  const content = objects.map((obj) => JSON.stringify(obj)).join("\n") + "\n";
  atomicWrite(filePath, content);
}

// ============================================================
// 路径工具
// ============================================================

/**
 * 获取默认的 session 存储目录。
 *
 * 委托给 paths.ts 集中管理，避免路径逻辑散落多处。
 */
export function defaultSessionDir(): string {
  return sessionsDir();
}

/**
 * 确保目录存在（递归创建）。
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 删除文件，文件不存在时不报错。
 */
export function removeFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

// ============================================================
// Per-file Mutex（并发安全）
// ============================================================

const fileMutexes = new Map<string, Mutex>();
const fileLineCounts = new Map<string, number>();

function getFileMutex(filePath: string): Mutex {
  let m = fileMutexes.get(filePath);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(filePath, m);
  }
  return m;
}

function countLinesSync(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, "utf-8");
  if (!text.trim()) return 0;
  return text.split("\n").filter((l) => l.trim()).length;
}

export function invalidateLineCount(filePath: string): void {
  fileLineCounts.delete(filePath);
}

// ============================================================
// 并发安全原子追加
// ============================================================

export async function appendJsonLineAtomic<T extends Record<string, unknown>>(
  filePath: string,
  record: T,
): Promise<{ record: T; msgIndex: number }> {
  const mutex = getFileMutex(filePath);
  const release = await mutex.acquire();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 在临界区内计数 + 追加
    const count = countLinesSync(filePath);
    const msgIndex = count + 1;

    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });

    fileLineCounts.set(filePath, msgIndex);

    return { record, msgIndex };
  } finally {
    release();
  }
}

// ============================================================
// 分页读取
// ============================================================

export function readJsonLinesPage<T = unknown>(
  filePath: string,
  limit: number,
  before?: number,
): { records: T[]; nextCursor: number | null } {
  if (!fs.existsSync(filePath)) {
    return { records: [], nextCursor: null };
  }

  const all = readJsonLines<T>(filePath);
  if (all.length === 0) {
    return { records: [], nextCursor: null };
  }

  // before 是字节偏移游标（简化：用记录索引代替）
  // 实际实现中，before 为 undefined 表示从末尾开始
  const totalLines = all.length;

  if (before === undefined) {
    // 首页：返回最后 limit 条
    const start = Math.max(0, totalLines - limit);
    const records = all.slice(start);
    const nextCursor = start > 0 ? start : null;
    return { records, nextCursor };
  }

  // 翻页：返回 before 之前的最多 limit 条
  const end = Math.min(before, totalLines);
  const start = Math.max(0, end - limit);
  const records = all.slice(start, end);
  const nextCursor = start > 0 ? start : null;
  return { records, nextCursor };
}
