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
import { TOOL_RESULT_TOOLS } from "../src/tools/tool-result-tools.js";
import { buildDispatchTools } from "../src/orchestration/tools.js";
import { getToolsSystemPromptBlock } from "../src/tools/catalog.js";
import { buildSystemPrompt } from "../src/prompts/system-prompt-builder.js";
import { DISPATCH_GUIDELINE } from "../src/prompts/dispatch-guideline.js";
import type { StreamEvent } from "../src/shared/types.js";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { GoogleProvider } from "../src/providers/google.js";
import { MoonshotProvider } from "../src/providers/moonshot.js";
import { QwenProvider } from "../src/providers/qwen.js";
import { MistralProvider } from "../src/providers/mistral.js";
import { GrokProvider } from "../src/providers/grok.js";
import type { LLMProvider } from "../src/providers/base.js";
import { PROVIDER_META, type ProviderType } from "../src/providers/provider-metadata.js";
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

  // 注册所有 8 种 Provider 工厂（按 type → 构造函数映射）
  function createProviderByType(type: string, opts: { apiKey: string; baseUrl: string }): LLMProvider | null {
    switch (type) {
      case "deepseek": return new DeepSeekProvider(opts);
      case "anthropic": return new AnthropicProvider(opts);
      case "openai": return new OpenAIProvider(opts);
      case "google": return new GoogleProvider(opts);
      case "moonshot": return new MoonshotProvider(opts);
      case "qwen": return new QwenProvider(opts);
      case "mistral": return new MistralProvider(opts);
      case "xai": return new GrokProvider(opts);
      default: return null;
    }
  }

  for (const type of Object.keys(PROVIDER_META)) {
    providers.registerFactory(type, (opts) => {
      const apiKey = opts.apiKey || process.env[PROVIDER_META[type as ProviderType].envKey] || "";
      const provider = createProviderByType(type, { apiKey, baseUrl: opts.baseUrl ?? PROVIDER_META[type as ProviderType].defaultBaseUrl });
      if (!provider) throw new Error(`Unknown provider type: ${type}`);
      return provider;
    });
  }

  // 将 Web UI 配置的供应商同步到 ProviderRegistry
  const storeCfg = providersStore.getConfig();
  for (const [id, entry] of Object.entries(storeCfg.providers)) {
    const meta = PROVIDER_META[entry.type as ProviderType];
    const envKey = meta ? process.env[meta.envKey] : undefined;
    const apiKey = entry.apiKey || envKey || "";
    const provider = createProviderByType(entry.type, { apiKey, baseUrl: entry.baseUrl });
    if (provider) {
      providers.setProvider(id, provider);
    }
  }
  logger.info(`已注册 ${providers.list().length} 个模型供应商: ${providers.list().join(", ")}`);

  // ---- Agent Runner Factory（Chat SSE 流依赖） ----
  // 与 CLI（chat.ts）对齐：除 BUILTIN_TOOLS 外注入 tool-result 工具与
  // 三个调度工具（run_worker / dispatch_to / hand_off_to），使主 Agent 在
  // web 端也能派生/派发子 Agent；worker 实时事件转成 SSE tool_use/tool_result
  // 转发给前端，让用户看到子 Agent 的工具调用过程。
  const runnerFactory: RunnerFactory = ({ session }: { session: PersistentSession }) => {
    let runner: AgentRunner | undefined;

    // worker 事件 → StreamEvent 队列（在工具执行期间同步入队，由 runStream 排空）
    const workerQueue: StreamEvent[] = [];
    // per-actor 工具调用栈：worker 事件无 id，用栈配对 tool_start/tool_end
    const actorToolStacks = new Map<string, string[]>();
    let subSeq = 0;

    const dispatchTools = buildDispatchTools({
      getRunner: () => runner as AgentRunner,
      config,
      cid: session.sessionId,
      onWorkerEvent: (ev) => {
        const actorId = ev.actor.id;
        switch (ev.type) {
          case "tool_start": {
            const id = `sub:${actorId}:${subSeq++}`;
            const stack = actorToolStacks.get(actorId) ?? [];
            stack.push(id);
            actorToolStacks.set(actorId, stack);
            workerQueue.push({
              type: "tool_start",
              name: ev.name,
              id,
              input: ev.input,
              actorName: ev.actor.name,
              actorKind: ev.actor.kind,
            });
            break;
          }
          case "tool_end": {
            const stack = actorToolStacks.get(actorId) ?? [];
            const id = stack.pop() ?? `sub:${actorId}:${subSeq++}`;
            workerQueue.push({
              type: "tool_end",
              name: ev.name,
              id,
              result: ev.result.slice(0, 500),
              isError: ev.isError,
              actorName: ev.actor.name,
              actorKind: ev.actor.kind,
            });
            break;
          }
          case "text_delta":
            // worker 文本由 worker_text_delta 单独转发（替代被丢弃的 text_delta）
            break;
          case "agent_reply": {
            workerQueue.push({
              type: "agent_message",
              actorId: ev.actor.id,
              actorName: ev.actor.name || ev.actor.id,
              actorKind: ev.actor.kind,
              text: ev.text,
              isFinal: ev.isFinal,
            });
            break;
          }
          case "dispatch_started": {
            workerQueue.push({
              type: "dispatch_started",
              actorId: ev.actor.id,
              actorName: ev.actor.name || ev.actor.id,
              toolName: ev.toolName,
              toolId: `sub:${ev.actor.id}:${subSeq++}`,
              isFinal: ev.isFinal,
            });
            break;
          }
          case "worker_step_start": {
            workerQueue.push({
              type: "worker_step_start",
              actorId: ev.actor.id,
              kind: ev.kind,
              label: ev.label,
              stepId: ev.stepId,
            });
            break;
          }
          case "worker_text_delta": {
            workerQueue.push({
              type: "worker_text_delta",
              actorId: ev.actor.id,
              text: ev.text,
              stepId: ev.stepId,
            });
            break;
          }
          case "worker_step_end": {
            workerQueue.push({
              type: "worker_step_end",
              actorId: ev.actor.id,
              stepId: ev.stepId,
              summary: ev.summary.slice(0, 500),
              isError: ev.isError,
            });
            break;
          }
          case "dispatch_done": {
            workerQueue.push({
              type: "dispatch_done",
              actorId: ev.actor.id,
              toolName: ev.toolName,
            });
            break;
          }
        }
      },
    });

    runner = new AgentRunner({
      config,
      providers,
      tools: [...BUILTIN_TOOLS, ...TOOL_RESULT_TOOLS],
      session,
      logger: logger.child("agent"),
    });
    for (const dt of dispatchTools) {
      runner.addTool(dt);
    }

    // 组合 system prompt：把工具列表（含调度工具）注入，让模型明确可派发子 Agent
    const toolNames = [...BUILTIN_TOOLS, ...TOOL_RESULT_TOOLS, ...dispatchTools].map(
      (t) => t.name,
    );
    const webSystemPrompt = buildSystemPrompt({
      extraSystemPrompt: config.agent.systemPrompt
        ? `${config.agent.systemPrompt}\n\n${DISPATCH_GUIDELINE}`
        : DISPATCH_GUIDELINE,
      toolsBlock: getToolsSystemPromptBlock(toolNames),
    }).systemPrompt;

    return {
      runStream: async function* (params) {
        // 组合 system prompt：前端显式传 systemPrompt 时优先，否则注入
        // 含调度工具列表的完整 prompt，让模型明确可派发子 Agent。
        const finalParams: Parameters<AgentRunner["runStream"]>[0] =
          params.systemPrompt === undefined
            ? { ...params, systemPrompt: webSystemPrompt }
            : params;

        // 预取一个事件，先排空 worker 队列再 yield 内层事件，
        // 保证子 Agent 活动显示在 run_worker 工具结果之前。
        const iterator = runner!.runStream(finalParams)[Symbol.asyncIterator]();
        let pending: IteratorResult<StreamEvent> | undefined;
        for (;;) {
          if (pending === undefined) {
            pending = (await iterator.next()) as IteratorResult<StreamEvent>;
          }
          if (pending.done) break;
          while (workerQueue.length > 0) {
            yield workerQueue.shift()!;
          }
          yield pending.value;
          pending = undefined;
        }
        while (workerQueue.length > 0) {
          yield workerQueue.shift()!;
        }
      },
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