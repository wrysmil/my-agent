import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ProvidersStore,
  ProvidersConfigSchema,
  type ProviderConfigEntry,
} from "../src/storage/providers-store.js";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-store-"));
  storePath = path.join(tmpDir, "providers.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ProvidersStore", () => {
  it("returns default config when file does not exist", async () => {
    const store = await ProvidersStore.load(storePath);
    const cfg = store.getConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.activeProviderId).toBe("deepseek");
    expect(cfg.providers.deepseek.apiKey).toBe("");
    expect(cfg.providers.deepseek.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(cfg.providers.deepseek.defaultModel).toBe("deepseek-chat");
    expect(cfg.providers.deepseek.enabled).toBe(true);
  });

  it("creates the file with default config on first load", async () => {
    const store = await ProvidersStore.load(storePath);
    await store.save();
    expect(fs.existsSync(storePath)).toBe(true);
    const stat = fs.statSync(storePath);
    // POSIX 检查权限；非 POSIX（如 Windows）跳过
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("persists edits to disk on save", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek Custom",
      type: "deepseek",
      apiKey: "sk-test",
      baseUrl: "https://custom.example.com/v1",
      defaultModel: "deepseek-coder",
      enabled: true,
    });
    await store.save();
    const reloaded = await ProvidersStore.load(storePath);
    expect(reloaded.getConfig().providers.deepseek.defaultModel).toBe("deepseek-coder");
    expect(reloaded.getConfig().providers.deepseek.apiKey).toBe("sk-test");
  });

  it("returns earlier-saved config on subsequent loads", async () => {
    const store1 = await ProvidersStore.load(storePath);
    store1.setActiveProvider("deepseek");
    store1.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "sk-persist",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    await store1.save();

    const store2 = await ProvidersStore.load(storePath);
    expect(store2.getConfig().providers.deepseek.apiKey).toBe("sk-persist");
  });

  it("backs up and recovers when file is corrupted", async () => {
    fs.writeFileSync(storePath, "{ not valid json", { mode: 0o600 });
    const store = await ProvidersStore.load(storePath);
    const cfg = store.getConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.providers.deepseek).toBeDefined();
    // 备份文件存在
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith("providers.json.bak-"));
    expect(backups.length).toBe(1);
  });

  it("rejects mismatched version and falls back to default", async () => {
    fs.writeFileSync(
      storePath,
      JSON.stringify({ version: 999, providers: {} }),
      { mode: 0o600 },
    );
    const store = await ProvidersStore.load(storePath);
    expect(store.getConfig().version).toBe(1);
    expect(store.getConfig().providers.deepseek.apiKey).toBe("");
  });

  it("performs CRUD: upsert / remove / getActive", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "x",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    expect(store.getActiveProvider()?.id).toBe("deepseek");

    store.removeProvider("deepseek");
    expect(store.getConfig().providers.deepseek).toBeUndefined();
    expect(store.getActiveProvider()).toBeUndefined();
  });

  it("falls back to first enabled provider when active is removed", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "k",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    store.upsertProvider({
      id: "deepseek2",
      name: "DeepSeek 2",
      type: "deepseek",
      apiKey: "k2",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-reasoner",
      enabled: true,
    });
    store.setActiveProvider("deepseek");
    store.removeProvider("deepseek");
    expect(store.getActiveProvider()?.id).toBe("deepseek2");
  });
});

describe("ProvidersConfigSchema", () => {
  it("rejects invalid provider type", () => {
    expect(() =>
      ProvidersConfigSchema.parse({
        version: 1,
        activeProviderId: "deepseek",
        providers: {
          deepseek: {
            id: "deepseek",
            name: "DeepSeek",
            type: "invalid-type" as any, // 故意错（不在 PROVIDER_TYPES 中）
            apiKey: "",
            baseUrl: "https://api.deepseek.com/v1",
            defaultModel: "deepseek-chat",
            enabled: true,
          },
        },
      }),
    ).toThrow();
  });
});
