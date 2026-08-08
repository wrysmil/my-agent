/**
 * my-agent Web 前端 — API 路由接线（WU-01+ closeout / GROUP-8 修复）。
 *
 * 把 5 个路由 handler 模块（providers / sessions / messages / agents / skills）
 * 接入 router.ts 的 ROUTES 占位表，替换 routeNotFoundPlaceholder。
 *
 * 调用时机：createServer 启动前执行一次（幂等 — 重复调用会再次替换同一位置）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { ROUTES } from "./router.js";
import type { Route, Handler } from "./router.js";

// ── 路由 handler 模块 ──
import { registerProviderRoutes } from "./routes/providers.js";
import type { RegisterProviderRoutesDeps } from "./routes/providers.js";
import { installSessionRoutes } from "./routes/sessions.js";
import { installMessageRoutes } from "./routes/messages.js";
import type { RunnerFactory } from "./routes/messages.js";
import { listAgentsHandler, getAgentHandler } from "./routes/agents.js";
import { listSkillsHandler, getSkillHandler } from "./routes/skills.js";

// ── 依赖类型 ──
import type { ProvidersStore } from "../../storage/providers-store.js";
import type { SessionStore } from "../../storage/session-store.js";
import type { CoreAgentConfig } from "../../config/schema.js";
import type { ProviderRegistry } from "../../providers/registry.js";
import type { AgentRunner } from "../../agent/runner.js";
import type { Logger } from "../../shared/logger.js";

// ============================================================
// 工具
// ============================================================

function replaceHandler(
  method: string,
  pattern: string | RegExp,
  handler: Handler,
): void {
  for (const route of ROUTES) {
    if (route[0] === method) {
      const p = route[1];
      if (typeof pattern === "string" && typeof p === "string" && p === pattern) {
        route[2] = handler;
        return;
      }
      if (pattern instanceof RegExp && p instanceof RegExp && p.source === pattern.source) {
        route[2] = handler;
        return;
      }
    }
  }
}

// ============================================================
// 接线
// ============================================================

export interface WireApiRoutesDeps {
  providersStore?: ProvidersStore;
  sessionStore?: SessionStore;
  config?: CoreAgentConfig;
  providers?: ProviderRegistry;
  agentRunner?: AgentRunner;
  runnerFactory?: RunnerFactory;
  logger?: Logger;
}

/**
 * 把全部 21 条 API 路由的占位 handler 替换为真实实现。
 *
 * - providers (8 条)：需要 providersStore
 * - sessions (6 条)：需要 sessionStore
 * - messages (2 条)：需要 sessionStore + config + providers + runnerFactory
 * - agents (2 条)：无额外依赖（文件系统发现）
 * - skills (2 条)：无额外依赖（文件系统发现）
 *
 * 缺少必需依赖的域保持占位（不抛错），服务仍可启动。
 */
export function wireApiRoutes(deps: WireApiRoutesDeps = {}): void {
  const { providersStore, sessionStore, config, providers, runnerFactory, logger } = deps;

  // ── Provider 域 (8 条) ──
  if (providersStore) {
    const providerDeps: RegisterProviderRoutesDeps = { providersStore };
    if (logger) providerDeps.logger = logger;
    const replaced = registerProviderRoutes(ROUTES, providerDeps);
    if (logger) logger.info(`[wire] providers: ${replaced}/8 handlers wired`);
  }

  // ── Session 域 (4 REST + 2 compact = 6 条) ──
  if (sessionStore) {
    installSessionRoutes({ sessionStore, agentRunner: deps.agentRunner });
    if (logger) logger.info("[wire] sessions: handlers wired");
  }

  // ── Chat 流 (2 条 SSE) ──
  if (sessionStore && config && providers && runnerFactory) {
    installMessageRoutes({ sessionStore, config, providers, runnerFactory });
    if (logger) logger.info("[wire] messages: SSE stream + abort wired");
  }

  // ── Agent 域 (2 条) ──
  replaceHandler("GET", "/api/agents", listAgentsHandler);
  replaceHandler(
    "GET",
    /^\/api\/agents\/([^/]+)$/,
    (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) =>
      getAgentHandler(req, res, params),
  );
  if (logger) logger.info("[wire] agents: 2 handlers wired");

  // ── Skill 域 (2 条) ──
  replaceHandler("GET", "/api/skills", listSkillsHandler);
  replaceHandler(
    "GET",
    /^\/api\/skills\/([^/]+)$/,
    (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) =>
      getSkillHandler(req, res, params),
  );
  if (logger) logger.info("[wire] skills: 2 handlers wired");
}
