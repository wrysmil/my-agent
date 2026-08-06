/**
 * SessionStore — 会话生命周期管理器
 *
 * 管理 PersistentSession 的创建、加载、缓存和清理。
 * 提供懒加载 + LRU 风格的缓存策略。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PersistentSession } from "../agent/persistent-session.js";
import { defaultSessionDir, ensureDir, removeFile } from "./jsonl.js";
import { assertPathSegment } from "./paths.js";

// ============================================================
// Session Kind 系统
// ============================================================

const RECOVERABLE_KINDS = ["gconv", "cli"] as const;
const EPHEMERAL_KINDS = ["anon", "extract"] as const;
const KNOWN_KINDS_RE = /^(gconv|cli|anon|extract)(?:-|$)/;

export type SessionKind = "gconv" | "cli" | "anon" | "extract";

/**
 * 校验并解析 session kind。
 *
 * 安全要点：
 * 1. **路径穿越防御** — id 可能来自外部输入（未来前端 HTTP），进入 path.join 前
 *    必须过 `assertPathSegment`（拒绝 `/` `\` `..` `\0`）。
 * 2. **存量兼容** — `session-` 前缀（旧命名）归为可恢复会话 `gconv`，
 *    保证 `PersistentSession.list()` 扫出的存量会话可被本函数解析。
 */
export function sessionKindOf(sessionId: string): SessionKind {
  const safe = assertPathSegment(sessionId, "sessionId");
  if (safe.startsWith("session-")) return "gconv";
  if (!KNOWN_KINDS_RE.test(safe)) {
    throw new Error(
      `invalid session id "${sessionId}" — must start with a known kind ` +
      `(gconv | cli | anon | extract)`,
    );
  }
  return safe.split("-")[0] as SessionKind;
}

/** 是否为短暂会话（可被 GC 清理）。存量 `session-` 视为可恢复，返回 false */
export function isEphemeralSession(sessionId: string): boolean {
  for (const kind of EPHEMERAL_KINDS) {
    if (sessionId === kind || sessionId.startsWith(`${kind}-`)) {
      return true;
    }
  }
  return false;
}

/** 返回 session 的 memory scope（预留）。未知 kind 兜底返回 null，不抛错 */
export function memoryScopeForSession(sessionId: string): string | null {
  if (KNOWN_KINDS_RE.test(sessionId) || sessionId.startsWith("session-")) {
    if (sessionId.startsWith("gconv-") || sessionId.startsWith("session-")) {
      return "commander";
    }
  }
  return null;
}

// ============================================================
// GC：清理过期短暂会话
// ============================================================

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7天

/** 扫描并删除过期的短暂会话文件。返回删除数量。 */
export function sweepEphemeralSessions(
  sessionDir?: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): number {
  const dir = sessionDir ?? defaultSessionDir();
  if (!fs.existsSync(dir)) return 0;

  const now = Date.now();
  let removed = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.jsonl$/);
    if (!match) continue;

    const sessionId = match[1];
    if (!isEphemeralSession(sessionId)) continue;

    const filePath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs >= maxAgeMs) {
        removeFile(filePath);
        // 同步删除上下文侧车
        const ctxFile = path.join(dir, `${sessionId}.context.json`);
        removeFile(ctxFile);
        removed++;
      }
    } catch {
      // stat 失败跳过
    }
  }

  return removed;
}

export class SessionStore {
  private cache = new Map<string, PersistentSession>();
  private sessionDir: string;

  constructor(sessionDir?: string) {
    this.sessionDir = sessionDir ?? defaultSessionDir();
    ensureDir(this.sessionDir);
  }

  // ============================================================
  // CRUD
  // ============================================================

  /**
   * 创建新的持久化会话，自动生成 `<kind>-<12hex>` 格式 id。
   */
  create(kind: SessionKind = "gconv"): PersistentSession {
    // 运行时校验 kind，防止外部输入直接拼进 sessionId（进而进 path.join）
    if (!["gconv", "cli", "anon", "extract"].includes(kind)) {
      throw new Error(`invalid session kind: "${String(kind)}"`);
    }
    const tail = randomUUID().replace(/-/g, "").slice(0, 12);
    const sessionId = `${kind}-${tail}`;
    const session = new PersistentSession({ sessionId, sessionDir: this.sessionDir });
    this.cache.set(sessionId, session);
    return session;
  }

  /**
   * 懒加载已有会话。
   *
   * 先从缓存查找，未命中则从磁盘加载。
   * 返回 null 表示会话不存在。
   */
  get(sessionId: string): PersistentSession | null {
    assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
    // 1. 缓存命中
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    // 2. 从磁盘加载
    const session = PersistentSession.load(sessionId, this.sessionDir);
    if (session) {
      this.cache.set(sessionId, session);
    }
    return session;
  }

  /**
   * 列出所有可用的会话及其元数据。
   */
  list(): Array<{ id: string; name: string }> {
    const ids = PersistentSession.list(this.sessionDir);
    return ids.map((id) => {
      const session = this.cache.get(id) ?? PersistentSession.load(id, this.sessionDir);
      const name = session?.getDisplayName() ?? id;
      // 不在缓存中的临时加载实例要清理引用
      if (!this.cache.has(id)) {
        session?.close();
      }
      return { id, name };
    });
  }

  /**
   * 删除会话（文件 + 缓存）。
   */
  delete(sessionId: string): boolean {
    assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
    const cached = this.cache.get(sessionId);
    if (cached) {
      cached.delete();
      this.cache.delete(sessionId);
      return true;
    }

    // 不在缓存中，直接删文件
    const sessionFile = path.join(this.sessionDir, `${sessionId}.jsonl`);
    const contextFile = path.join(this.sessionDir, `${sessionId}.context.json`);

    if (!fs.existsSync(sessionFile)) return false;

    removeFile(sessionFile);
    removeFile(contextFile);
    return true;
  }

  /**
   * 关闭并清理缓存的会话（不删除文件）。
   */
  close(sessionId: string): void {
    const cached = this.cache.get(sessionId);
    if (cached) {
      cached.close();
      this.cache.delete(sessionId);
    }
  }

  /**
   * 关闭所有缓存的会话。
   */
  closeAll(): void {
    for (const [id, session] of this.cache) {
      session.close();
    }
    this.cache.clear();
  }
}
