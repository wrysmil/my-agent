import { Mutex } from "async-mutex";

// ============================================================
// Session Lock — 同 sessionId 串行化
// ============================================================

const sessionLocks = new Map<string, Mutex>();

/** 获取指定 session 的锁（不存在则创建）。同 id 并发调用拿到同一把锁 */
export function sessionLock(sessionId: string): Mutex {
  let m = sessionLocks.get(sessionId);
  if (!m) {
    m = new Mutex();
    sessionLocks.set(sessionId, m);
  }
  return m;
}

// ============================================================
// File Edit Lock — 同文件串行化
// ============================================================

const fileEditLocks = new Map<string, Mutex>();

/** 获取指定文件的编辑锁。同路径并发 edit 串行化 */
export function fileEditLock(absPath: string): Mutex {
  let m = fileEditLocks.get(absPath);
  if (!m) {
    m = new Mutex();
    fileEditLocks.set(absPath, m);
  }
  return m;
}
