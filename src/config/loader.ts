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

  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const data = JSON.parse(raw);
    return CoreAgentConfigSchema.parse(data);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return CoreAgentConfigSchema.parse({});
    }
    throw new Error(
      `Failed to load config from "${resolved}": ${formatError(err)}`,
      { cause: err as Error },
    );
  }
}

/** 从部分字段创建配置（合并默认值）。 */
export function createConfig(
  partial: CoreAgentConfigInput = {},
): CoreAgentConfig {
  return CoreAgentConfigSchema.parse(partial);
}
