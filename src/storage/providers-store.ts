import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { atomicWrite, ensureDir } from "./jsonl.js";
import { providersFile } from "./paths.js";
import { PROVIDER_TYPES, PROVIDER_META, type ProviderType } from "../providers/provider-metadata.js";

// ============================================================================
// Schema
// ============================================================================

export const ProviderConfigEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(PROVIDER_TYPES),
  apiKey: z.string(),
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1),
  enabled: z.boolean(),
});

export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;

export const ProvidersConfigSchema = z.object({
  version: z.literal(1),
  activeProviderId: z.string(),
  providers: z.record(z.string(), ProviderConfigEntrySchema),
});

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

// ============================================================================
// 默认值
// ============================================================================

export function defaultProvidersConfig(): ProvidersConfig {
  return {
    version: 1,
    activeProviderId: "deepseek",
    providers: {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        type: "deepseek",
        apiKey: "",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat",
        enabled: true,
      },
    },
  };
}

// ============================================================================
// 文件路径
// ============================================================================

export function defaultProvidersFilePath(): string {
  return providersFile();
}

// ============================================================================
// ProvidersStore
// ============================================================================

export class ProvidersStore {
  private config: ProvidersConfig;
  private readonly filePath: string;

  private constructor(filePath: string, config: ProvidersConfig) {
    this.filePath = filePath;
    this.config = config;
  }

  /** 加载（不存在则创建并返回默认）。 */
  static async load(filePath: string = defaultProvidersFilePath()): Promise<ProvidersStore> {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      const store = new ProvidersStore(filePath, defaultProvidersConfig());
      store.saveSync();
      return store;
    }
    return ProvidersStore.fromFile(filePath);
  }

  private static fromFile(filePath: string): ProvidersStore {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      return ProvidersStore.recoverFromCorrupt(filePath);
    }
    try {
      const data = JSON.parse(raw);
      const parsed = ProvidersConfigSchema.parse(data);
      return new ProvidersStore(filePath, parsed);
    } catch {
      return ProvidersStore.recoverFromCorrupt(filePath);
    }
  }

  private static recoverFromCorrupt(filePath: string): ProvidersStore {
    const ts = Date.now();
    const backupPath = `${filePath}.bak-${ts}`;
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // 备份失败不阻塞
    }
    const store = new ProvidersStore(filePath, defaultProvidersConfig());
    try {
      store.saveSync();
    } catch {
      // 落盘失败也接受：内存里默认配置可用
    }
    return store;
  }

  getConfig(): ProvidersConfig {
    return this.config;
  }

  getActiveProvider(): ProviderConfigEntry | undefined {
    const id = this.config.activeProviderId;
    const p = this.config.providers[id];
    if (p && p.enabled) return this.resolveEnvApiKey(p);
    // fallback 到第一个 enabled
    for (const cand of Object.values(this.config.providers)) {
      if (cand.enabled) return this.resolveEnvApiKey(cand);
    }
    return undefined;
  }

  /** 若 apiKey 为空，从环境变量 fallback（按 type 查找对应 env var） */
  private resolveEnvApiKey(p: ProviderConfigEntry): ProviderConfigEntry {
    if (p.apiKey) return p;
    const meta = PROVIDER_META[p.type as ProviderType];
    const envKey = meta ? process.env[meta.envKey] : undefined;
    if (envKey) {
      return { ...p, apiKey: envKey };
    }
    return p;
  }

  setActiveProvider(id: string): void {
    if (!this.config.providers[id]) {
      throw new Error(`Provider "${id}" not found`);
    }
    this.config.activeProviderId = id;
  }

  upsertProvider(p: ProviderConfigEntry): void {
    this.config.providers[p.id] = p;
  }

  removeProvider(id: string): void {
    if (!this.config.providers[id]) return;
    delete this.config.providers[id];
    // active 落空 → 切到第一个 enabled
    if (this.config.activeProviderId === id) {
      const firstEnabled = Object.values(this.config.providers).find((p) => p.enabled);
      this.config.activeProviderId = firstEnabled?.id ?? "";
    }
  }

  async save(): Promise<void> {
    this.saveSync();
  }

  private saveSync(): void {
    const json = JSON.stringify(this.config, null, 2);
    atomicWrite(this.filePath, json);
    // 显式收紧权限（atomicWrite 用 wx flag 创建，权限受 umask 影响）
    if (process.platform !== "win32") {
      fs.chmodSync(this.filePath, 0o600);
    }
  }
}
