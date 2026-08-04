import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { mkdtempSync, rmSync, existsSync } from "node:fs";

// 测试隔离：使用独立临时目录
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "my-agent-db-test-"));

describe("db — SQLite 初始化与迁移", () => {
  let db: typeof import("../src/storage/db.js");

  beforeAll(async () => {
    // 设置自定义 MY_AGENT_HOME 后再 import，确保 paths.ts 使用测试目录
    process.env.MY_AGENT_HOME = tmpRoot;
    db = await import("../src/storage/db.js");
  });

  afterAll(() => {
    db.closeDb();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("getDb 返回数据库实例", () => {
    const database = db.getDb();
    expect(database).toBeDefined();
    expect(database.open).toBe(true);
  });

  it("getDb 多次调用返回同一实例（单例）", () => {
    const d1 = db.getDb();
    const d2 = db.getDb();
    expect(d1).toBe(d2);
  });

  it("数据库文件创建在 dataDir 下", () => {
    const expected = path.join(tmpRoot, "data", "my-agent.db");
    expect(existsSync(expected)).toBe(true);
  });

  it("WAL 模式已启用", () => {
    const row = db.getDb().pragma("journal_mode") as { journal_mode: string }[];
    expect(row[0].journal_mode).toBe("wal");
  });

  it("外键约束已启用", () => {
    const row = db.getDb().pragma("foreign_keys") as { foreign_keys: number }[];
    expect(row[0].foreign_keys).toBe(1);
  });

  it("schema_version 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.name).toBe("schema_version");
  });

  it("sessions 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("configs 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='configs'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("usage_logs 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='usage_logs'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("skills_index 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='skills_index'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("providers 表已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='providers'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("usage_logs session_id 索引已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_usage_session'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("usage_logs created_at 索引已创建", () => {
    const row = db.getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_usage_created'"
    ).get() as { name: string } | undefined;
    expect(row).toBeDefined();
  });

  it("迁移版本记录为 1", () => {
    const row = db.getDb().prepare(
      "SELECT MAX(version) as v FROM schema_version"
    ).get() as { v: number };
    expect(row.v).toBe(1);
  });

  it("迁移幂等：再次调用 getDb 不重复建表", () => {
    // 关闭后重新打开
    db.closeDb();
    const database = db.getDb();
    expect(database.open).toBe(true);

    // 表数量不变
    const count = db.getDb().prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'"
    ).get() as { cnt: number };
    // 7 张表: sessions, configs, usage_logs, skills_index, providers, schema_version + 1 internal
    expect(count.cnt).toBeGreaterThanOrEqual(7);
  });

  it("sessions 表字段完整", () => {
    const cols = db.getDb().prepare("PRAGMA table_info(sessions)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("name");
    expect(names).toContain("model");
    expect(names).toContain("provider");
    expect(names).toContain("message_count");
    expect(names).toContain("input_tokens");
    expect(names).toContain("output_tokens");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
    expect(names).toContain("is_archived");
  });

  it("providers 表字段完整", () => {
    const cols = db.getDb().prepare("PRAGMA table_info(providers)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("api_key_enc");
    expect(names).toContain("base_url");
    expect(names).toContain("is_enabled");
    expect(names).toContain("priority");
  });

  it("closeDb 关闭数据库并清空单例", () => {
    const d1 = db.getDb();
    db.closeDb();
    const d2 = db.getDb();
    // 重新获取的应该是新实例
    expect(d1.open).toBe(false);
    expect(d2.open).toBe(true);
  });
});
