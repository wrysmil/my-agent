import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "my-agent-urepo-"));

describe("usage-repo", () => {
  let usageRepo: typeof import("../src/storage/usage-repo.js");
  let sessionRepo: typeof import("../src/storage/session-repo.js");
  let db: typeof import("../src/storage/db.js");

  const now = Date.now();

  beforeAll(async () => {
    process.env.MY_AGENT_HOME = tmpRoot;
    usageRepo = await import("../src/storage/usage-repo.js");
    sessionRepo = await import("../src/storage/session-repo.js");
    db = await import("../src/storage/db.js");
  });

  afterAll(() => {
    db.closeDb();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    db.getDb().exec("DELETE FROM usage_logs");
    db.getDb().exec("DELETE FROM sessions");
  });

  // 辅助：插入测试 session
  function seedSession(id: string) {
    sessionRepo.upsertSession({
      id,
      name: "Test",
      model: "deepseek-chat",
      provider: "deepseek",
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("logUsage 写入用量记录", () => {
    seedSession("s1");

    usageRepo.logUsage({
      sessionId: "s1",
      model: "deepseek-chat",
      provider: "deepseek",
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      toolLoops: 3,
      durationMs: 5000,
    });

    const rows = db.getDb().prepare(
      "SELECT * FROM usage_logs WHERE session_id = ?"
    ).all("s1") as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].input_tokens).toBe(100);
    expect(rows[0].output_tokens).toBe(200);
    expect(rows[0].tool_loops).toBe(3);
    expect(rows[0].duration_ms).toBe(5000);
  });

  it("logUsage 聚合更新 session 的 token 计数", () => {
    seedSession("s2");

    usageRepo.logUsage({
      sessionId: "s2",
      model: "deepseek-chat",
      provider: "deepseek",
      usage: { inputTokens: 150, outputTokens: 250, totalTokens: 400 },
      toolLoops: 1,
      durationMs: 3000,
    });

    usageRepo.logUsage({
      sessionId: "s2",
      model: "deepseek-chat",
      provider: "deepseek",
      usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
      toolLoops: 0,
      durationMs: 1000,
    });

    const s = sessionRepo.getSession("s2");
    expect(s!.inputTokens).toBe(200); // 150 + 50
    expect(s!.outputTokens).toBe(350); // 250 + 100
  });

  it("logUsage 记录 cache token", () => {
    seedSession("s3");

    usageRepo.logUsage({
      sessionId: "s3",
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      usage: {
        inputTokens: 500, outputTokens: 1000, totalTokens: 1500,
        cacheReadTokens: 200, cacheWriteTokens: 50,
      },
      toolLoops: 0,
      durationMs: 2000,
    });

    const rows = db.getDb().prepare(
      "SELECT * FROM usage_logs WHERE session_id = ?"
    ).all("s3") as any[];
    expect(rows[0].cache_read_tokens).toBe(200);
    expect(rows[0].cache_write_tokens).toBe(50);
  });

  it("dailyUsage 按天聚合", () => {
    seedSession("s4");

    const d1 = Date.now();
    const d2 = d1 - 86400_000; // 昨天
    const d3 = d1 - 2 * 86400_000; // 前天

    usageRepo.logUsage({
      sessionId: "s4", model: "m1", provider: "p1",
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      toolLoops: 0, durationMs: 100,
    });

    const rows = usageRepo.dailyUsage(30);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // 第一条是今天
    const today = rows.find((r) => r.date === new Date(d1).toISOString().slice(0, 10));
    expect(today).toBeDefined();
    expect(today!.inputTokens).toBeGreaterThanOrEqual(10);
  });

  it("logUsage 无 session 时外键约束拒绝", () => {
    // 不 seedSession → FK 违反
    expect(() => {
      usageRepo.logUsage({
        sessionId: "no_such_session",
        model: "m", provider: "p",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        toolLoops: 0, durationMs: 1,
      });
    }).toThrow();
  });
});
