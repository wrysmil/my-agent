import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "my-agent-prepo-"));

describe("provider-repo", () => {
  let repo: typeof import("../src/storage/provider-repo.js");

  beforeAll(async () => {
    process.env.MY_AGENT_HOME = tmpRoot;
    repo = await import("../src/storage/provider-repo.js");
  });

  afterAll(async () => {
    const db = await import("../src/storage/db.js");
    db.closeDb();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("upsertProvider 创建新 Provider", () => {
    const entry = repo.upsertProvider({
      name: "My DeepSeek",
      provider: "deepseek",
      apiKey: "sk-test-key-123",
      models: ["deepseek-chat", "deepseek-reasoner"],
    });

    expect(entry.id).toBeDefined();
    expect(entry.name).toBe("My DeepSeek");
    expect(entry.provider).toBe("deepseek");
    expect(entry.models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(entry.isEnabled).toBe(true);
    expect(entry.priority).toBe(10); // default
    // API Key 加密存储，不解密返回
    expect(entry.apiKeyEnc).not.toBe("sk-test-key-123");
    expect(entry.apiKeyEnc).toContain(":");
  });

  it("getApiKey 解密返回原始 key", () => {
    const entry = repo.upsertProvider({
      name: "KeyTest",
      provider: "openai",
      apiKey: "sk-openai-secret",
    });

    const key = repo.getApiKey(entry.id);
    expect(key).toBe("sk-openai-secret");
  });

  it("getProvider 返回加密后的 entry", () => {
    const entry = repo.upsertProvider({
      name: "GetTest",
      provider: "anthropic",
      apiKey: "sk-ant-secret",
    });

    const fetched = repo.getProvider(entry.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("GetTest");
    expect(fetched!.apiKeyEnc).not.toBe("sk-ant-secret");
  });

  it("listProviders 返回所有 Provider（按 priority 排序）", () => {
    repo.upsertProvider({
      name: "P1", provider: "p1", apiKey: "k1",
      priority: 10,
    });
    repo.upsertProvider({
      name: "P2", provider: "p2", apiKey: "k2",
      priority: 0,
    });

    const list = repo.listProviders();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // priority 小的排在前面
    const p2Idx = list.findIndex((p) => p.name === "P2");
    const p1Idx = list.findIndex((p) => p.name === "P1");
    expect(p2Idx).toBeLessThan(p1Idx);
  });

  it("upsertProvider 更新已有 Provider", () => {
    const e1 = repo.upsertProvider({
      name: "UpdOriginal",
      provider: "deepseek",
      apiKey: "sk-old",
    });

    const e2 = repo.upsertProvider({
      id: e1.id,
      name: "UpdUpdated",
      provider: "deepseek",
      apiKey: "sk-new",
    });

    expect(e2.id).toBe(e1.id);
    expect(e2.name).toBe("UpdUpdated");
  });

  it("deleteProvider 删除 Provider", () => {
    const entry = repo.upsertProvider({
      name: "ToDelete",
      provider: "test",
      apiKey: "sk-del",
    });

    repo.deleteProvider(entry.id);
    expect(repo.getProvider(entry.id)).toBeUndefined();
  });

  it("setProviderEnabled 切换状态", () => {
    const entry = repo.upsertProvider({
      name: "Toggle",
      provider: "test",
      apiKey: "sk-tog",
    });

    repo.setProviderEnabled(entry.id, false);
    expect(repo.getProvider(entry.id)!.isEnabled).toBe(false);

    repo.setProviderEnabled(entry.id, true);
    expect(repo.getProvider(entry.id)!.isEnabled).toBe(true);
  });

  it("setProviderPriority 修改优先级", () => {
    const entry = repo.upsertProvider({
      name: "PrioTest",
      provider: "test",
      apiKey: "sk-prio",
      priority: 5,
    });

    repo.setProviderPriority(entry.id, 1);
    expect(repo.getProvider(entry.id)!.priority).toBe(1);
  });

  it("getApiKey 无 key 时返回 null", () => {
    const key = repo.getApiKey("nonexistent-id");
    expect(key).toBeNull();
  });

  it("upsertProvider 不传 apiKey 时保留已有 key", () => {
    const e1 = repo.upsertProvider({
      name: "KeepKey",
      provider: "test",
      apiKey: "sk-original-key",
    });

    const e2 = repo.upsertProvider({
      id: e1.id,
      name: "KeepKey-Renamed",
      provider: "test",
      apiKey: "", // 空字符串 → 保留已有 key
    });

    // 空 apiKey（falsy）→ 实现走 fallback 保留已有加密值
    const key = repo.getApiKey(e1.id);
    expect(key).toBe("sk-original-key");
  });
});
