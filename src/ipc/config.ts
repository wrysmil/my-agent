import { ipcMain, app } from "electron";
import * as path from "node:path";
import { loadConfig } from "../config/loader.js";
import { getDb } from "../storage/db.js";
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

async function getCachedConfig() {
  if (_configCache && Date.now() - _configCacheTime < CONFIG_CACHE_TTL_MS) {
    return _configCache;
  }
  // R5 修正: 传入 userData 下的 config.json 路径
  const configPath = path.join(app.getPath("userData"), "config.json");
  _configCache = await loadConfig(configPath);
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
    const key = getApiKey(id);
    if (!key) return { ok: false, error: "未配置 API Key" };
    const entry = getProvider(id);
    if (!entry) return { ok: false, error: "Provider 不存在" };
    try {
      // 具体测试逻辑由 provider 类型决定（后续 Plan B/C 实现）
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
