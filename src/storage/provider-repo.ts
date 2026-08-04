import { getDb } from "./db.js";
import { encryptApiKey, decryptApiKey } from "../util/crypto.js";

export interface ProviderEntry {
  id: string;
  name: string;
  provider: string;          // 'anthropic' | 'openai' | 'deepseek' | 'moonshot' | 'doubao'
  apiKeyEnc: string;
  baseUrl: string;
  models: string[];          // 模型 ID 列表 ['deepseek-chat', 'deepseek-reasoner']
  isEnabled: boolean;
  priority: number;           // 越小越优先（0 = 主 Provider）
  createdAt: number;
  updatedAt: number;
}

function rowToEntry(row: any): ProviderEntry {
  return {
    ...row,
    isEnabled: row.is_enabled === 1,
    apiKeyEnc: row.api_key_enc,
    baseUrl: row.base_url,
    models: JSON.parse(row.models ?? "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出所有 Provider（按 priority 排序） */
export function listProviders(): ProviderEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM providers ORDER BY priority ASC, updated_at DESC
  `).all() as any[];
  return rows.map(rowToEntry);
}

/** 获取单个 Provider */
export function getProvider(id: string): ProviderEntry | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as any;
  return row ? rowToEntry(row) : undefined;
}

/** 新增或更新 Provider */
export function upsertProvider(input: {
  id?: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  priority?: number;
}): ProviderEntry {
  const db = getDb();
  const id = input.id ?? `${input.provider}-${Date.now().toString(36)}`;
  const now = Date.now();

  // 如果传入了 API Key，加密存储；否则保留已有值（编辑时不强制要求重新输入）
  const apiKeyEnc = input.apiKey
    ? encryptApiKey(input.apiKey)
    : input.id
      ? (db.prepare("SELECT api_key_enc FROM providers WHERE id = ?").get(input.id) as any)?.api_key_enc ?? ""
      : "";

  db.prepare(`
    INSERT INTO providers (id, name, provider, api_key_enc, base_url, models,
      is_enabled, priority, created_at, updated_at)
    VALUES (@id, @name, @provider, @apiKeyEnc, @baseUrl, @models,
      1, @priority, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      api_key_enc = @apiKeyEnc,
      base_url = excluded.base_url,
      models = excluded.models,
      priority = excluded.priority,
      updated_at = @now
  `).run({
    id,
    name: input.name,
    provider: input.provider,
    apiKeyEnc,
    baseUrl: input.baseUrl ?? "",
    models: JSON.stringify(input.models ?? []),
    priority: input.priority ?? 10,
    now,
  });
  return getProvider(id)!;
}

/** 解密并返回 API Key */
export function getApiKey(providerId: string): string | null {
  const entry = getProvider(providerId);
  if (!entry || !entry.apiKeyEnc) return null;
  return decryptApiKey(entry.apiKeyEnc);
}

/** 删除 Provider */
export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

/** 切换 Provider 启用/禁用 */
export function setProviderEnabled(id: string, enabled: boolean): void {
  getDb().prepare(
    "UPDATE providers SET is_enabled = @enabled, updated_at = @now WHERE id = @id"
  ).run({ id, enabled: enabled ? 1 : 0, now: Date.now() });
}

/** 设置 Provider 优先级（用于故障转移排序） */
export function setProviderPriority(id: string, priority: number): void {
  getDb().prepare(
    "UPDATE providers SET priority = @priority, updated_at = @now WHERE id = @id"
  ).run({ id, priority, now: Date.now() });
}
