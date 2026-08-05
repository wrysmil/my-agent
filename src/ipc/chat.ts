/**
 * Chat IPC — AgentRunner 流式对话
 *
 * 将渲染进程的 `chat:stream` 请求接入 AgentRunner.runStream()，
 * 把 AgentRunEvent 逐事件转发到渲染进程的 `stream:*` 通道。
 *
 * 协议（与 electron/preload.cjs 的 stream() 严格一致）：
 * - 渲染进程 → 主进程: `ipcRenderer.send("chat:stream", { streamId, message, sessionId })`
 * - 主进程 → 渲染进程: `event.sender.send("stream:<event>", { streamId, payload })`
 * - 取消: `ipcRenderer.send("chat:stream:cancel", { streamId })`
 *   （preload 的 stream().cancel() 走此通道；api.chat.cancel(id) 走 invoke 模式 `chat:cancel`）
 */

import { ipcMain, app } from "electron";
import * as path from "node:path";
import { AgentRunner } from "../agent/runner.js";
import type { Session } from "../agent/session.js";
import type { PersistentSession } from "../agent/persistent-session.js";
import type { AgentRunMeta } from "../agent/types.js";
import { registry } from "../providers/index.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import {
  CoreAgentConfigSchema,
  type CoreAgentConfig,
} from "../config/schema.js";
import { readConfigFile } from "../storage/config-store.js";
import { SessionStore } from "../storage/session-store.js";
import { upsertSession } from "../storage/session-repo.js";
import { logUsage } from "../storage/usage-repo.js";

// ============================================================
// 类型
// ============================================================

/** 渲染进程通过 preload stream() 发来的请求体（`{ streamId, ...payload }`）。 */
type ChatStreamInput = {
  streamId?: string;
  message?: unknown;
  sessionId?: string;
  /** 本次 run 的模型覆盖（可选；缺省用配置 defaultModel） */
  model?: string;
  /** 本次 run 的 provider 覆盖（可选；缺省用配置 defaultProvider） */
  provider?: string;
};

/**
 * registerChatIpc 的依赖注入参数（全部可选）。
 *
 * 缺省时使用模块级默认实现：
 * - `createRunner`: 从 `userData/config.json` 加载 CoreAgentConfig，
 *   使用 providers 模块单例 `registry`（已预注册 deepseek）与 BUILTIN_TOOLS
 *   构造 `AgentRunner`。
 * - `store`: 模块级 SessionStore 单例。
 *
 * 传入自定义 `createRunner` 可用于测试注入 mock runner。
 */
export type ChatIpcDeps = {
  /** 根据会话创建 AgentRunner。 */
  createRunner?: (session: Session) => AgentRunner;
  /** SessionStore 实例。 */
  store?: SessionStore;
};

// ============================================================
// 模块级状态
// ============================================================

/** streamId → AbortController，用于取消正在进行的 run。 */
const activeStreams = new Map<string, AbortController>();

let _defaultStore: SessionStore | undefined;

function getDefaultStore(): SessionStore {
  if (!_defaultStore) _defaultStore = new SessionStore();
  return _defaultStore;
}

// ============================================================
// 默认依赖实现
// ============================================================

/** 从 userData/config.json 加载核心 Agent 配置；读取/解析失败时回退默认值。 */
function loadCoreConfig(): CoreAgentConfig {
  try {
    const configPath = path.join(app.getPath("userData"), "config.json");
    return CoreAgentConfigSchema.parse(readConfigFile(configPath) ?? {});
  } catch (err) {
    console.warn("[chat] 加载 config.json 失败，使用默认配置:", err);
    return CoreAgentConfigSchema.parse({});
  }
}

/** 默认 runner 工厂：共享 providers registry（deepseek 单例）+ 内置工具 + 传入会话。 */
function createDefaultRunner(session: Session): AgentRunner {
  return new AgentRunner({
    config: loadCoreConfig(),
    providers: registry,
    tools: BUILTIN_TOOLS,
    session,
  });
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** 对话完成后将会话元数据 + token 用量写入 SQLite。 */
function persistSession(session: PersistentSession, meta: AgentRunMeta): void {
  try {
    const now = Date.now();
    upsertSession({
      id: session.sessionId,
      name: session.getDisplayName(),
      model: meta.model,
      provider: meta.provider,
      messageCount: session.getAllMessages().length,
      inputTokens: meta.usage.inputTokens ?? 0,
      outputTokens: meta.usage.outputTokens ?? 0,
      createdAt: now,
      updatedAt: now,
    });

    logUsage({
      sessionId: session.sessionId,
      model: meta.model,
      provider: meta.provider,
      usage: meta.usage,
      toolLoops: meta.toolLoops,
      durationMs: meta.durationMs,
    });
  } catch (err) {
    console.warn("[chat] 会话持久化失败:", err);
  }
}

// ============================================================
// 注册
// ============================================================

export function registerChatIpc(deps: ChatIpcDeps = {}): void {
  const store = deps.store ?? getDefaultStore();
  const createRunner = deps.createRunner ?? createDefaultRunner;

  // ---- 流式对话 ----
  // preload stream() 使用 ipcRenderer.send，因此这里用 ipcMain.on 而非 handle
  ipcMain.on("chat:stream", async (event, input: ChatStreamInput) => {
    const { streamId, message, sessionId } = input ?? {};

    if (!streamId || typeof message !== "string" || !message.trim()) {
      event.sender.send("stream:error", {
        streamId,
        payload: { message: "无效的聊天请求: message 必须为非空字符串" },
      });
      return;
    }

    const abort = new AbortController();
    activeStreams.set(streamId, abort);

    // ---- 会话管理：存在则恢复，否则新建 ----
    let session: PersistentSession | null = sessionId ? store.get(sessionId) : null;
    if (!session) session = store.create();

    // ---- 创建 AgentRunner ----
    let runner: AgentRunner;
    try {
      runner = createRunner(session);
    } catch (err) {
      activeStreams.delete(streamId);
      event.sender.send("stream:error", {
        streamId,
        payload: { message: `创建 AgentRunner 失败: ${formatErr(err)}` },
      });
      return;
    }

    // ---- 流式转发 ----
    try {
      for await (const ev of runner.runStream({
        message,
        signal: abort.signal,
        model: input.model,
        provider: input.provider,
      })) {
        switch (ev.type) {
          case "text_delta":
            event.sender.send("stream:text_delta", {
              streamId,
              payload: { text: ev.text },
            });
            break;
          case "tool_start":
            event.sender.send("stream:tool_start", {
              streamId,
              payload: { name: ev.name, id: ev.id, input: ev.input },
            });
            break;
          case "tool_end":
            event.sender.send("stream:tool_end", {
              streamId,
              payload: {
                name: ev.name,
                id: ev.id,
                result: ev.result,
                isError: ev.isError ?? false,
                errorCode: ev.errorCode,
                durationMs: ev.durationMs,
              },
            });
            break;
          case "retry":
            event.sender.send("stream:retry", {
              streamId,
              payload: { attempt: ev.attempt, reason: ev.reason, waitMs: ev.waitMs },
            });
            break;
          case "done": {
            const meta = ev.result.meta;
            // runner 以 done(meta.error) 形式上报失败（而非抛异常）：
            // 非用户取消时额外发一条 stream:error，让 UI 能展示失败原因
            if (meta.error && !abort.signal.aborted) {
              event.sender.send("stream:error", {
                streamId,
                payload: { message: meta.error.message },
              });
            }
            event.sender.send("stream:done", {
              streamId,
              payload: { sessionId: session.sessionId, meta },
            });
            persistSession(session, meta);
            break;
          }
          // 其余事件（tool_delta / tool_progress / compaction /
          // context_status / provider_fallback）当前无需转发给渲染进程
        }
      }
    } catch (err) {
      // 未捕获错误 → stream:error（用户主动取消时不重复提示）
      if (!abort.signal.aborted) {
        event.sender.send("stream:error", {
          streamId,
          payload: { message: formatErr(err) },
        });
      }
    } finally {
      activeStreams.delete(streamId);
    }
  });

  // ---- 取消（preload stream().cancel() 通道）----
  ipcMain.on(
    "chat:stream:cancel",
    (_event, { streamId }: { streamId?: string }) => {
      if (streamId) {
        activeStreams.get(streamId)?.abort();
        activeStreams.delete(streamId);
      }
    },
  );

  // ---- 取消（api.chat.cancel(id) 兼容，invoke/handle 模式）----
  // 兼容传入 streamId 字符串或 { streamId } 对象
  ipcMain.handle(
    "chat:cancel",
    async (_event, streamIdOrObj: string | { streamId?: string }) => {
      const streamId =
        typeof streamIdOrObj === "string" ? streamIdOrObj : streamIdOrObj?.streamId;
      if (streamId) {
        activeStreams.get(streamId)?.abort();
        activeStreams.delete(streamId);
      }
      return { ok: true };
    },
  );
}
