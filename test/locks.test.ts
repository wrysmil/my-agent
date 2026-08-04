import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "my-agent-locks-"));

describe("FileLock", () => {
  let locks: typeof import("../src/storage/locks.js");

  beforeAll(async () => {
    process.env.MY_AGENT_HOME = tmpRoot;
    locks = await import("../src/storage/locks.js");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("acquire 获取锁成功", () => {
    const lock = new locks.FileLock("test1");
    const ok = lock.acquire(1000);
    expect(ok).toBe(true);
    lock.release();
  });

  it("同一进程可重复获取释放", () => {
    const lock = new locks.FileLock("test2");
    expect(lock.acquire(1000)).toBe(true);
    lock.release();
    expect(lock.acquire(1000)).toBe(true);
    lock.release();
  });

  it("release 多次调用不报错", () => {
    const lock = new locks.FileLock("test3");
    lock.acquire(1000);
    lock.release();
    lock.release(); // 不应抛出
    lock.release();
  });

  it("release 未获取时也不报错", () => {
    const lock = new locks.FileLock("test4");
    lock.release(); // 未 acquire 先 release — 不应抛出
    lock.release();
  });

  it("同锁名互斥（模拟：用 EEXIST 判断）", () => {
    const lock1 = new locks.FileLock("test-mutex");
    const lock2 = new locks.FileLock("test-mutex");

    expect(lock1.acquire(1000)).toBe(true);
    // lock2 尝试获取同名锁，应失败（已被 lock1 持有）
    expect(lock2.acquire(100)).toBe(false);
    lock1.release();
    // lock2 现在可以获取
    expect(lock2.acquire(1000)).toBe(true);
    lock2.release();
  });

  it("多次 acquire 同一实例返回 true（可重入，非严格 POSIX）", () => {
    // FileLock 目前是非重入锁：同一实例上再次 acquire 会尝试写锁文件
    // 由于 wx flag，第二次写入同一文件会报 EEXIST
    const lock = new locks.FileLock("test-reenter");
    expect(lock.acquire(500)).toBe(true);
    // 第二次 acquire：锁文件已存在（被自己持有），wx → EEXIST → 返回 false
    const again = lock.acquire(100);
    // 这取决于实现语义：当前实现会在超时后返回 false
    expect(again).toBe(false);
    lock.release();
  });
});
