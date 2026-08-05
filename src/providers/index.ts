import { ProviderRegistry } from "./registry.js";
import { DeepSeekProvider } from "./deepseek.js";
import {
  getProvider,
  getApiKey,
  listProviders,
} from "../storage/provider-repo.js";
import type { ProviderEntry } from "../storage/provider-repo.js";
import type { ProviderFactory } from "./base.js";

// ============================================================
// DeepSeek provider 工厂 — 模块加载时自动注册
//
// 配置解析优先级：
//   1. 显式传入的 config（ProviderRegistry.createProvider 场景）
//   2. DB providers 表（provider 字段标识，如 "deepseek"；api_key_enc 为加密 key）
//   3. 环境变量 DEEPSEEK_API_KEY
// ============================================================

/** 从 DB providers 表读取 DeepSeek 配置；DB 不可用时降级为空配置。 */
function resolveDeepSeekFromDb(): { apiKey?: string; baseUrl?: string } {
  try {
    // 优先按固定 id 直接查（兼容手动插入 id="deepseek" 的场景）；
    // 常规情况下 id 形如 deepseek-<timestamp>，故再按 provider 字段匹配已启用项
    const direct = getProvider("deepseek");
    const entry: ProviderEntry | undefined =
      direct ?? listProviders().find((p) => p.provider === "deepseek" && p.isEnabled);
    if (!entry) return {};
    return {
      apiKey: getApiKey(entry.id) ?? undefined,
      baseUrl: entry.baseUrl || undefined,
    };
  } catch {
    // better-sqlite3 / DB 未就绪时静默降级，交由环境变量兜底
    return {};
  }
}

const deepSeekFactory: ProviderFactory = (config) => {
  const fromDb = resolveDeepSeekFromDb();
  const apiKey =
    config.apiKey ?? fromDb.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
  const baseUrl = config.baseUrl ?? fromDb.baseUrl;
  return new DeepSeekProvider({ apiKey, baseUrl });
};

/** 模块级共享 ProviderRegistry（已预注册 deepseek factory）。 */
export const registry = new ProviderRegistry();

try {
  registry.registerFactory("deepseek", deepSeekFactory);
} catch (err) {
  // 注册失败不应阻塞模块加载，保持 barrel export 可用
  console.warn("[providers] 注册 deepseek factory 失败:", err);
}

// ============================================================
// Barrel exports — 保持原有导出不变
// ============================================================
export type { LLMProvider, ProviderFactory, CompletionParams, CompletionResult, ToolDefinition } from "./base.js";
export { ProviderRegistry } from "./registry.js";
export { DeepSeekProvider } from "./deepseek.js";
