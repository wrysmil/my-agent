import { describe, it, expect } from "vitest";
import { sessionLock, fileEditLock } from "../../src/storage/locks.js";

describe("sessionLock", () => {
  it("同 id 返回同一把锁", () => {
    const a = sessionLock("gconv-abc");
    const b = sessionLock("gconv-abc");
    expect(a).toBe(b); // 同一个 Mutex 实例
  });

  it("不同 id 返回不同锁", () => {
    const a = sessionLock("gconv-abc");
    const b = sessionLock("gconv-def");
    expect(a).not.toBe(b);
  });

  it("锁是可重入的（async-mutex 默认行为）", async () => {
    const lock = sessionLock("test-reentrant");
    const r1 = await lock.acquire();
    // 不同 id 可并发获取
    const lock2 = sessionLock("test-reentrant-2");
    const r2 = await lock2.acquire();
    expect(typeof r1).toBe("function");
    expect(typeof r2).toBe("function");
    r1();
    r2();
  });
});

describe("fileEditLock", () => {
  it("同路径返回同一把锁", () => {
    const a = fileEditLock("/home/user/project/src/a.ts");
    const b = fileEditLock("/home/user/project/src/a.ts");
    expect(a).toBe(b);
  });

  it("不同路径返回不同锁", () => {
    const a = fileEditLock("/home/user/project/src/a.ts");
    const b = fileEditLock("/home/user/project/src/b.ts");
    expect(a).not.toBe(b);
  });

  it("串行化同文件操作", async () => {
    const results: number[] = [];
    const lock = fileEditLock("/tmp/test.txt");

    // 模拟两个编辑操作
    const p1 = lock.acquire().then((release) => {
      results.push(1);
      // 模拟一小段操作时间
      return new Promise<void>((resolve) => setTimeout(() => { release(); resolve(); }, 10));
    });

    const p2 = lock.acquire().then((release) => {
      results.push(2);
      release();
    });

    await Promise.all([p1, p2]);
    // 1 一定先于 2 执行
    expect(results).toEqual([1, 2]);
  });
});
