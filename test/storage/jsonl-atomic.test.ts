import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  appendJsonLineAtomic,
  readJsonLines,
  readJsonLinesPage,
  invalidateLineCount,
  atomicWrite,
  removeFile,
} from "../../src/storage/jsonl.js";

describe("appendJsonLineAtomic", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-test-"));
    tmpFile = path.join(tmpDir, "test.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("单条追加返回 msgIndex=1", async () => {
    const { msgIndex } = await appendJsonLineAtomic(tmpFile, { text: "hello" });
    expect(msgIndex).toBe(1);
  });

  it("连续追加返回递增 msgIndex", async () => {
    const r1 = await appendJsonLineAtomic(tmpFile, { n: 1 });
    const r2 = await appendJsonLineAtomic(tmpFile, { n: 2 });
    const r3 = await appendJsonLineAtomic(tmpFile, { n: 3 });
    expect(r1.msgIndex).toBe(1);
    expect(r2.msgIndex).toBe(2);
    expect(r3.msgIndex).toBe(3);
  });

  it("并发追加不丢数据且 msgIndex 连续", async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendJsonLineAtomic(tmpFile, { idx: i }),
      ),
    );
    const indices = results.map((r) => r.msgIndex).sort((a, b) => a - b);
    // msgIndex 应该覆盖 1..N
    expect(indices).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // 读取验证
    const records = readJsonLines<{ idx: number }>(tmpFile);
    expect(records).toHaveLength(N);
  });
});

describe("readJsonLinesPage", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-test-"));
    tmpFile = path.join(tmpDir, "test.jsonl");
    // 写入 50 条记录
    for (let i = 1; i <= 50; i++) {
      await appendJsonLineAtomic(tmpFile, { n: i });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("首页返回最近的 limit 条", () => {
    const page = readJsonLinesPage<{ n: number }>(tmpFile, 10);
    expect(page.records).toHaveLength(10);
    // 最近 10 条：n=41..50
    expect(page.records[0].n).toBe(41);
    expect(page.records[9].n).toBe(50);
  });

  it("翻页返回更早的记录", () => {
    const page1 = readJsonLinesPage<{ n: number }>(tmpFile, 10);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = readJsonLinesPage<{ n: number }>(tmpFile, 10, page1.nextCursor!);
    expect(page2.records).toHaveLength(10);
    expect(page2.records[0].n).toBe(31);
    expect(page2.records[9].n).toBe(40);
  });

  it("游标耗尽返回空数组和 null cursor", () => {
    const page = readJsonLinesPage<{ n: number }>(tmpFile, 100);
    expect(page.nextCursor).toBeNull();
  });
});
