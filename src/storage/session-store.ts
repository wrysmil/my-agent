/**
 * SessionStore — 会话生命周期管理器
 *
 * 管理 PersistentSession 的创建、加载、缓存和清理。
 * 提供懒加载 + LRU 风格的缓存策略。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PersistentSession } from "../agent/persistent-session.js";
import { defaultSessionDir, ensureDir, removeFile } from "./jsonl.js";

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
   * 创建新的持久化会话。
   */
  create(): PersistentSession {
    const session = PersistentSession.create(this.sessionDir);
    this.cache.set(session.sessionId, session);
    return session;
  }

  /**
   * 懒加载已有会话。
   *
   * 先从缓存查找，未命中则从磁盘加载。
   * 返回 null 表示会话不存在。
   */
  get(sessionId: string): PersistentSession | null {
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
