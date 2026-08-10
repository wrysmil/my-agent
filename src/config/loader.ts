import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { CoreAgentConfigSchema, type CoreAgentConfig } from "./schema.js";
import { formatError } from "../shared/errors.js";

export type CoreAgentConfigInput = z.input<typeof CoreAgentConfigSchema>;

/** 从 JSON 文件加载配置，文件不存在时返回默认值。 */
export async function loadConfig(configPath?: string): Promise<CoreAgentConfig> {
  const resolved = configPath
    ? path.resolve(configPath)
    : path.join(process.cwd(), "config.json");

  let config: CoreAgentConfig;
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const data = JSON.parse(raw);
    config = CoreAgentConfigSchema.parse(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      config = CoreAgentConfigSchema.parse({});
    } else {
      throw new Error(
        `Failed to load config from "${resolved}": ${formatError(err)}`,
        { cause: err as Error },
      );
    }
  }

  // 为每个 provider 注入环境变量 apiKey（若 config 中未显式设置）
  const providerEnvKeyMap: Record<string, string> = {
    deepseek: "DEEPSEEK_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    qwen: "QWEN_API_KEY",
    mistral: "MISTRAL_API_KEY",
    xai: "XAI_API_KEY",
  };
  for (const [providerId, provider] of Object.entries(config.models.providers)) {
    if (!provider.apiKey) {
      const envVar = providerEnvKeyMap[providerId];
      if (envVar && process.env[envVar]) {
        provider.apiKey = process.env[envVar];
      }
    }
  }

  return config;
}

/** 从部分字段创建配置（合并默认值）。 */
export function createConfig(
  partial: CoreAgentConfigInput = {},
): CoreAgentConfig {
  return CoreAgentConfigSchema.parse(partial);
}

/**
 * 保存配置到文件（原子写入 + apiKey 脱敏）。
 *
 * 1. 深拷贝配置，移除所有 provider 的 apiKey
 * 2. 先写入 .tmp 临时文件，再 rename 到目标路径（原子操作）
 *
 * @param configPath — 目标配置文件绝对路径
 * @param config    — 待保存的 CoreAgentConfig
 */
export async function saveConfig(
  configPath: string,
  config: CoreAgentConfig,
): Promise<void> {
  // 深拷贝并脱敏 apiKey
  const sanitized = structuredClone(config) as CoreAgentConfig;
  for (const provider of Object.values(sanitized.models.providers)) {
    delete provider.apiKey;
  }

  const json = JSON.stringify(sanitized, null, 2);
  const tmpPath = configPath + ".tmp";
  const resolved = path.resolve(configPath);

  await fs.writeFile(tmpPath, json, "utf-8");
  await fs.rename(tmpPath, resolved);
}
