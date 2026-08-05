import { ipcMain, app } from "electron";
import * as path from "node:path";
import { CoreAgentConfigSchema } from "../config/schema.js";
import { readConfigFile, writeConfigFile } from "../storage/config-store.js";
import { getDb } from "../storage/db.js";
import { DeepSeekProvider } from "../providers/deepseek.js";
import {
  listProviders,
  upsertProvider,
  deleteProvider,
  setProviderEnabled,
  getApiKey,
  getProvider,
} from "../storage/provider-repo.js";

// 内存缓存，避免每次 IPC 调用重新加载
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _configCache: any = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL_MS = 30_000; // 30 秒

/** 应用配置 JSON 文件路径（userData/config.json）。 */
function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

/**
 * 从 SQLite configs 表读取原始配置（key → JSON 值）。
 * 双写过渡期保留的旧存储；config:get 时与 JSON 文件合并（JSON 文件优先）。
 */
function readConfigFromDb(): Record<string, unknown> {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT key, value FROM configs")
      .all() as Array<{ key: string; value: string }>;
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        out[row.key] = row.value;
      }
    }
    return out;
  } catch {
    // DB 未就绪时静默降级为空配置
    return {};
  }
}

async function getCachedConfig() {
  if (_configCache && Date.now() - _configCacheTime < CONFIG_CACHE_TTL_MS) {
    return _configCache;
  }
  // 合并 JSON 文件 + SQLite configs 表（JSON 文件优先），再做 Zod 校验补默认值
  const merged = {
    ...readConfigFromDb(),
    ...(readConfigFile(configFilePath()) ?? {}),
  };
  _configCache = CoreAgentConfigSchema.parse(merged);
  _configCacheTime = Date.now();
  return _configCache;
}

export function registerConfigIpc(): void {
  // ============================================================
  // 配置
  // ============================================================
  ipcMain.handle("config:get", async () => {
    return getCachedConfig();
  });

  ipcMain.handle("config:update", async (_e, patch: Record<string, unknown>) => {
    // 主存储：写 JSON 文件（与 config:get 同源）
    const configPath = configFilePath();
    const existing = readConfigFile(configPath) ?? {};
    writeConfigFile(configPath, { ...existing, ...patch });

    // 双写过渡：同步保留 SQLite configs 表写入，便于回滚/迁移
    const db = getDb();
    for (const [key, value] of Object.entries(patch)) {
      db.prepare(`
        INSERT INTO configs (key, value, updated_at)
        VALUES (@key, @value, @now)
        ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now
      `).run({ key, value: JSON.stringify(value), now: Date.now() });
    }
    _configCache = null;
    return { ok: true };
  });

  ipcMain.handle("config:getProviders", async () => {
    // 返回 DB 中的 provider 配置
    return listProviders();
  });

  ipcMain.handle("config:getModels", async () => {
    const config = await getCachedConfig();
    return (config as any).models?.catalog ?? {};
  });

  // ============================================================
  // 应用版本信息 — Renderer 中 contextIsolation 隔离了 process 对象
  // ============================================================
  ipcMain.handle("app:getVersion", async () => {
    return {
      version: "0.3.0",
      electron: process.versions.electron ?? "—",
      node: process.versions.node ?? "—",
      platform: process.platform,
    };
  });

  // ============================================================
  // Providers CRUD (R4: 从 Task 4.5 Step 3 移入)
  // ============================================================
  ipcMain.handle("providers:list", async () => {
    return listProviders();
  });

  ipcMain.handle("providers:save", async (_e, input) => {
    return upsertProvider(input);
  });

  ipcMain.handle("providers:delete", async (_e, id: string) => {
    deleteProvider(id);
    return { ok: true };
  });

  ipcMain.handle("providers:setEnabled", async (_e, id: string, enabled: boolean) => {
    setProviderEnabled(id, enabled);
    return { ok: true };
  });

  ipcMain.handle("providers:test", async (_e, id: string) => {
    const entry = getProvider(id);
    if (!entry) return { ok: false, error: "Provider 不存在" };
    const key = getApiKey(id);
    if (!key) return { ok: false, error: "未配置 API Key" };
    try {
      // 调用真实 DeepSeek API 校验（GET /models），而非直接返回 { ok: true }
      const provider = new DeepSeekProvider({
        apiKey: key,
        baseUrl: entry.baseUrl || undefined,
      });
      const valid = await provider.validateAuth();
      if (!valid) {
        return { ok: false, error: "API Key 认证失败（DeepSeek /models 校验未通过）" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
