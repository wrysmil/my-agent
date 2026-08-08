#!/usr/bin/env tsx
import "dotenv/config";
/**
 * my-agent Web 前端启动入口（WU-01 / B1）。
 *
 * 时序（spec § 6.3 简化版）：
 *   1. 解析端口 / 主机 / 静态资源根目录（env）
 *   2. createServer() 启动 HTTP server
 *   3. installShutdownHandlers() 注册 SIGINT/SIGTERM
 *   4. （CI 环境跳过）自动打开浏览器 —— B5 落地，本期动态 import
 *
 * 环境变量：
 * - `MY_AGENT_WEB_PORT`  监听端口，默认 4321
 * - `MY_AGENT_WEB_HOST`  监听主机，默认 127.0.0.1
 * - `MY_AGENT_WEB_ROOT`  静态资源根目录，默认 `<cwd>/web`
 * - `MY_AGENT_LOG_LEVEL` 日志级别（debug|info|warn|error），默认 "info"
 * - `MY_AGENT_CONFIG`    配置文件路径（本期不消费，预留给 B2+）
 * - `MY_AGENT_HOME`      数据根目录（透传给 providers/session store）
 * - `CI=1`               跳过自动打开浏览器
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { createLogger, type LogLevel } from "../src/shared/logger.js";
import {
  createServer,
  installShutdownHandlers,
} from "../src/web/server/index.js";
import { ProvidersStore } from "../src/storage/providers-store.js";
import { SessionStore } from "../src/storage/session-store.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import { loadConfig } from "../src/config/loader.js";
import { AgentRunner } from "../src/agent/runner.js";
import { BUILTIN_TOOLS } from "../src/tools/builtin.js";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import type { PersistentSession } from "../src/agent/persistent-session.js";
import type { RunnerFactory, RunnerLike } from "../src/web/server/routes/messages.js";

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const rawLevel = process.env.MY_AGENT_LOG_LEVEL ?? "info";
const logLevel: LogLevel = LOG_LEVELS.includes(rawLevel as LogLevel)
  ? (rawLevel as LogLevel)
  : "info";

const logger = createLogger("web", logLevel);

async function main(): Promise<void> {
  // ---- 端口 / 主机 / 静态资源根 ----
  const port = parsePort(process.env.MY_AGENT_WEB_PORT ?? "4321");
  const host = process.env.MY_AGENT_WEB_HOST ?? "127.0.0.1";
  const defaultWebRoot = path.join(process.cwd(), "web");
  const distPath = path.join(defaultWebRoot, "dist");
  const webRoot =
    process.env.MY_AGENT_WEB_ROOT ??
    (fs.existsSync(distPath) ? distPath : defaultWebRoot);

  // ---- Providers / Session store + Config ----
  const config = await loadConfig();
  const providersStore = await ProvidersStore.load();
  const sessionStore = new SessionStore();
  const providers = new ProviderRegistry(config);

  // 注册 Provider 工厂（必须在使用前注册）
  providers.registerFactory("deepseek", (opts) => {
    const apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY || "";
    return new DeepSeekProvider({ apiKey, baseUrl: opts.baseUrl });
  });

  // 将 Web UI 配置的供应商同步到 ProviderRegistry
  const storeCfg = providersStore.getConfig();
  for (const [id, entry] of Object.entries(storeCfg.providers)) {
    const apiKey = entry.apiKey || process.env.DEEPSEEK_API_KEY || "";
    providers.setProvider(id, new DeepSeekProvider({ apiKey, baseUrl: entry.baseUrl }));
  }
  logger.info(`已注册 ${providers.list().length} 个模型供应商: ${providers.list().join(", ")}`);

  // ---- Agent Runner Factory（Chat SSE 流依赖） ----
  const runnerFactory: RunnerFactory = ({ session }: { session: PersistentSession }) => {
    const runner = new AgentRunner({
      config,
      providers,
      tools: BUILTIN_TOOLS,
      session,
      logger: logger.child("agent"),
    });
    return {
      runStream: (params) => runner.runStream(params),
    } as RunnerLike;
  };

  // ---- 启动 HTTP server ----
  const server = await createServer({
    logger,
    providersStore,
    sessionStore,
    config,
    providers,
    runnerFactory,
    port,
    host,
    webRoot,
  });

  const url = `http://localhost:${server.port}`;
  logger.info(`🌐 服务器已启动 → ${url}`);

  // ---- 优雅退出 ----
  installShutdownHandlers({
    server,
    sessionStore,
    logger,
    signals: ["SIGINT", "SIGTERM"],
    forceExitMs: 5_000,
  });

  // ---- 自动打开浏览器（CI 环境跳过）----
  if (process.env.CI !== "1") {
    try {
      const mod = await import("../src/web/server/open-browser.js");
      await mod.openBrowser(url);
    } catch {
      logger.info("（自动打开浏览器暂未启用，请手动访问上述地址）");
    }
  }
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`无效的 MY_AGENT_WEB_PORT: ${raw}`);
  }
  return n;
}

// ============================================================
// 入口
// ============================================================

main().catch((err: unknown) => {
  // logger 还未必可用；直接走 console.error 兜底
  console.error(err);
  process.exit(1);
});