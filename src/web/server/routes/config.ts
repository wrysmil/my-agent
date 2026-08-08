/**
 * my-agent Web 前端 — Config API 端点（WU-P2 / Task 7）。
 *
 * 路由：
 * - `GET  /api/config` — 返回当前配置（provider apiKey 脱敏）
 * - `PUT  /api/config` — 部分更新配置 → 深合并 → 原子写入
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreAgentConfig } from "../../../config/schema.js";
import { CoreAgentConfigSchema } from "../../../config/schema.js";
import type { Logger } from "../../../shared/logger.js";
import { readBodyJson, sendJsonOk, sendJsonError } from "../http-helpers.js";
import { z } from "zod";

/** 脱敏后返回给前端的 provider 信息 */
type SanitizedProvider = {
  baseUrl?: string;
  auth?: string;
  maxConcurrency?: number;
  apiKey: string;
};

/** 对 config 做 apiKey 脱敏，返回 safe copy */
function sanitizeConfig(config: CoreAgentConfig): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const models = raw.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;

  if (providers) {
    for (const [, p] of Object.entries(providers)) {
      p.apiKey = p.apiKey ? "***" : "";
    }
  }

  return raw;
}

/**
 * 安装 config 路由 handler。
 *
 * 期望在 `wireApiRoutes()` 中调用，将 handler 注入 ROUTES 表。
 */
export function installConfigRoutes(deps: {
  config: CoreAgentConfig;
  configPath: string;
  logger?: Logger;
}): {
  getConfig: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  putConfig: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  const { config, configPath } = deps;

  // 动态 import saveConfig 以避免循环依赖（loader.ts 可能引用本模块的依赖方）
  let _saveConfig: ((p: string, c: CoreAgentConfig) => Promise<void>) | null = null;
  const getSaveConfig = async () => {
    if (!_saveConfig) {
      const mod = await import("../../../config/loader.js");
      _saveConfig = mod.saveConfig;
    }
    return _saveConfig;
  };

  const getConfig = async (
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    try {
      const safe = sanitizeConfig(config);
      sendJsonOk(res, safe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJsonError(res, 500, "INTERNAL_ERROR", msg);
    }
  };

  const putConfig = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    try {
      // 读取 body
      let body: unknown;
      try {
        body = await readBodyJson<unknown>(req);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Bad request";
        if (msg.includes("PAYLOAD_TOO_LARGE")) {
          sendJsonError(res, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
          return;
        }
        sendJsonError(res, 400, "INVALID_JSON", msg);
        return;
      }

      // Zod partial 校验：只允许合法的部分字段
      const partialSchema = CoreAgentConfigSchema.partial().deepPartial();
      const parsed = partialSchema.safeParse(body);
      if (!parsed.success) {
        sendJsonError(res, 422, "VALIDATION_FAILED", "Invalid config body", {
          details: parsed.error.flatten(),
        });
        return;
      }

      // 深合并：以现有 config 为基础，覆盖 parsed.data
      const merged = deepMerge(config, parsed.data as Record<string, unknown>);

      // 最终全量 Zod 校验（确保合并后仍然合法）
      const validated = CoreAgentConfigSchema.safeParse(merged);
      if (!validated.success) {
        sendJsonError(res, 422, "VALIDATION_FAILED", "Merged config invalid", {
          details: validated.error.flatten(),
        });
        return;
      }

      const saveConfig = await getSaveConfig();
      await saveConfig(configPath, validated.data);

      deps.logger?.info("config saved", { configPath });
      sendJsonOk(res, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJsonError(res, 500, "INTERNAL_ERROR", msg);
    }
  };

  return { getConfig, putConfig };
}

/**
 * 简单深合并：target 为基础，source 覆盖。
 * 仅处理 plain object，不处理数组/特殊类型。
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, val] of Object.entries(source)) {
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      result[key] = val;
    }
  }
  return result;
}
