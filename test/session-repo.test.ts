import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "my-agent-srepo-"));

describe("session-repo", () => {
  let repo: typeof import("../src/storage/session-repo.js");

  beforeAll(async () => {
    process.env.MY_AGENT_HOME = tmpRoot;
    repo = await import("../src/storage/session-repo.js");
  });

  afterAll(async () => {
    const db = await import("../src/storage/db.js");
    db.closeDb();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const now = Date.now();

  it("upsertSession 插入新会话", () => {
    repo.upsertSession({
      id: "s1",
      name: "Test Session",
      model: "deepseek-chat",
      provider: "deepseek",
      messageCount: 5,
      inputTokens: 100,
      outputTokens: 200,
      createdAt: now,
      updatedAt: now,
    });

    const s = repo.getSession("s1");
    expect(s).toBeDefined();
    expect(s!.name).toBe("Test Session");
    expect(s!.model).toBe("deepseek-chat");
    expect(s!.messageCount).toBe(5);
    expect(s!.isArchived).toBe(false);
  });

  it("upsertSession 更新已有会话", () => {
    repo.upsertSession({
      id: "s2",
      name: "Original",
      model: "gpt-4",
      provider: "openai",
      messageCount: 1,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: now,
      updatedAt: now,
    });

    repo.upsertSession({
      id: "s2",
      name: "Updated",
      model: "gpt-4",
      provider: "openai",
      messageCount: 10,
      inputTokens: 500,
      outputTokens: 300,
      createdAt: now,
      updatedAt: now + 1000,
    });

    const s = repo.getSession("s2");
    expect(s!.name).toBe("Updated");
    expect(s!.messageCount).toBe(10);
  });

  it("getSession 返回 undefined（不存在）", () => {
    const s = repo.getSession("nonexistent");
    expect(s).toBeUndefined();
  });

  it("listSessions 按 updated_at 降序排列", () => {
    // 自包含：使用极高时间戳确保排在前面
    const base = Date.now() + 100_000_000;
    repo.upsertSession({
      id: "lA", name: "l-A", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: base, updatedAt: base,
    });
    repo.upsertSession({
      id: "lB", name: "l-B", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: base + 1000, updatedAt: base + 1000,
    });
    repo.upsertSession({
      id: "lC", name: "l-C", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: base + 2000, updatedAt: base + 2000,
    });

    const list = repo.listSessions();
    const ids = ["lC", "lB", "lA"];
    const top = list.filter((s) => ids.includes(s.id));
    expect(top.length).toBe(3);
    expect(top[0].id).toBe("lC");
    expect(top[1].id).toBe("lB");
    expect(top[2].id).toBe("lA");
  });

  it("listSessions 支持 limit/offset", () => {
    repo.upsertSession({
      id: "lo1", name: "LO1", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 1, updatedAt: 1,
    });
    repo.upsertSession({
      id: "lo2", name: "LO2", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 2, updatedAt: 2,
    });

    const list = repo.listSessions({ limit: 1, offset: 0 });
    expect(list.length).toBe(1);
  });

  it("listSessions 支持 search", () => {
    repo.upsertSession({
      id: "srch-C", name: "Cat", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 1, updatedAt: 1,
    });
    repo.upsertSession({
      id: "srch-D", name: "Dog", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 2, updatedAt: 2,
    });

    const list = repo.listSessions({ search: "Cat" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    list.forEach((s) => {
      expect(s.name).toMatch(/Cat/i);
    });
  });

  it("countSessions 返回总数", () => {
    repo.upsertSession({
      id: "cnt1", name: "Cnt1", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 1, updatedAt: 1,
    });
    repo.upsertSession({
      id: "cnt2", name: "Cnt2", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 2, updatedAt: 2,
    });

    const count = repo.countSessions();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("countSessions 支持 search 过滤", () => {
    repo.upsertSession({
      id: "csA", name: "Apple", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: 1, updatedAt: 1,
    });

    const count = repo.countSessions({ search: "Apple" });
    expect(count).toBe(1);
  });

  it("renameSession 修改名称", () => {
    repo.upsertSession({
      id: "rn1", name: "Old Name", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: now, updatedAt: now,
    });
    repo.renameSession("rn1", "Renamed A");
    const s = repo.getSession("rn1");
    expect(s!.name).toBe("Renamed A");
  });

  it("deleteSession 删除会话", () => {
    repo.upsertSession({
      id: "del1", name: "ToDelete", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: now, updatedAt: now,
    });
    repo.deleteSession("del1");
    const s = repo.getSession("del1");
    expect(s).toBeUndefined();
  });

  it("archiveSession 归档会话", () => {
    repo.upsertSession({
      id: "arc1", name: "ToArchive", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: now, updatedAt: now,
    });
    repo.archiveSession("arc1");
    const s = repo.getSession("arc1");
    expect(s!.isArchived).toBe(true);
  });

  it("unarchiveSession 取消归档", () => {
    repo.upsertSession({
      id: "unar1", name: "Archived", model: "", provider: "",
      messageCount: 0, inputTokens: 0, outputTokens: 0,
      createdAt: now, updatedAt: now,
    });
    repo.archiveSession("unar1");
    repo.unarchiveSession("unar1");
    const s = repo.getSession("unar1");
    expect(s!.isArchived).toBe(false);
  });

  it("listSessions 排除空结果（search 无匹配）", () => {
    const list = repo.listSessions({ search: "zzz_nonexistent_zzz" });
    expect(list.length).toBe(0);
  });
});
