/**
 * my-agent Web 前端 — Agent 域 GET 路由（WU-02c / B4）。
 *
 * 来源：spec § 3.1.4 / § 6.2 + contract § 1 / § 3。
 *
 * ## 路由
 *
 * - `GET /api/agents`        → 列表（builtin + user）
 * - `GET /api/agents/:id`    → 单个详情（含 workflow preview、skill_list、source）
 *
 * ## 数据源
 *
 * 完全复用既有模块，**不**重新解析磁盘：
 * - `loadAgentSpec(id)` — 从 `{dataRoot}/agents/<id>/agent.json` 读用户 spec
 * - `loadAgentSpecFromDir(dir, id)` — 从 `fixtures/orchestration/agents/<id>/agent.json` 读内置 spec
 * - `agent-spec.ts` 内部已 `assertPathSegment(agent_id, "agent_id")`
 *
 * ## 行为
 *
 * - 全部只读，无副作用
 * - 路径穿越防御：路由 regex `[^/]+` 拦 `/`；本层再校验 NUL / `..` / `\` / 超长
 * - 404 `AGENT_NOT_FOUND`：builtin / user 两处都查不到时
 * - frontmatter / JSON 解析异常由 `loadAgentSpec` 内部 swallow（异常 spec 返回 null）
 *
 * ## 字段映射
 *
 * 路由 contract 与 disk `AgentSpec` 不完全对齐，做如下映射：
 *
 * | contract 字段 | 来源                                |
 * | ------------- | ----------------------------------- |
 * | `id`          | `agent_id`                          |
 * | `name`        | `name` 或 `agent_id` fallback       |
 * | `description` | `description_zh ?? description_en`  |
 * | `enabled`     | 始终 `true`（当前实现无禁用机制） |
 * | `scope`       | `"builtin"` / `"user"` / `"both"`   |
 * | `tools`       | `skill_list`                        |
 * | `systemPrompt`| `workflow` 字段（详情接口）         |
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  loadAgentSpec,
  loadAgentSpecFromDir,
  type AgentSpec,
} from "../../../orchestration/agent-spec.js";
import { dataRoot } from "../../../storage/paths.js";

// ============================================================
// 仓库内置 agent 目录（与 src/cli/agent-menu.ts 同源）
// ============================================================

let _builtinAgentsDir: string | null | undefined;

/**
 * 返回项目内置 agent 目录绝对路径（`fixtures/orchestration/agents/`）。
 * 不存在则返回 `null`（如 release 打包后）。
 */
function builtinAgentsDir(): string | null {
  if (_builtinAgentsDir !== undefined) return _builtinAgentsDir;
  try {
    const dir = fileURLToPath(
      new URL("../../../../fixtures/orchestration/agents", import.meta.url),
    );
    _builtinAgentsDir = fs.existsSync(dir) ? dir : null;
  } catch {
    _builtinAgentsDir = null;
  }
  return _builtinAgentsDir;
}

/** 仅测试用：重置内置目录缓存 */
export function _resetBuiltinAgentsDir(): void {
  _builtinAgentsDir = undefined;
}

// ============================================================
// 公共类型 — API 响应 shape
// ============================================================

/**
 * Agent 列表条目。
 *
 * - `scope` 标识 agent 的可见范围：
 *   - `"builtin"`：仅内置
 *   - `"user"`：仅用户自定义
 *   - `"both"`：用户覆盖了同名内置（detail 返回 user spec）
 * - `enabled`：本期所有发现的 agent 均视为启用（无禁用机制）
 */
export type AgentListItem = {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "user";
  scope: "builtin" | "user" | "both";
  enabled: boolean;
  tools: string[];
};

/** 单个 agent 详情（在 list 基础上加 systemPrompt preview 与完整 description） */
export type AgentDetail = AgentListItem & {
  description_zh: string;
  description_en: string;
  /** workflow 字段（system prompt 的分步程序） */
  systemPrompt: string;
};

type ApiOk<T> = { ok: true; data: T };
type ApiError = {
  ok: false;
  error: { code: string; message: string };
};

// ============================================================
// 发现逻辑（同时被 list / detail 复用）
// ============================================================

/**
 * 扫描指定目录下所有含 `agent.json` 的子目录，返回 agent_id 列表。
 *
 * 失败（ENOENT / EACCES）一律返回空数组 —— 单点故障不应阻塞整体返回。
 */
function scanAgentDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const ids: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentJson = path.join(dir, entry.name, "agent.json");
      if (fs.existsSync(agentJson)) ids.push(entry.name);
    }
  } catch {
    // 权限不足 / IO 错误 → 跳过此目录
  }
  return ids;
}

interface AgentEntry {
  id: string;
  spec: AgentSpec;
  source: "builtin" | "user";
  /** 用户覆盖内置时为 "both"；否则与 source 相同 */
  scope: "builtin" | "user" | "both";
}

/**
 * 发现全部 agent（builtin 优先；同名 user 覆盖 builtin，scope = "both"）。
 *
 * 与 `src/cli/agent-menu.ts:discoverAgents()` 行为一致；本层不复用
 * 是因为 CLI 入口用 readline 异步提示，本层是纯 HTTP handler，行为更轻。
 *
 * 注：`loadAgentSpec` 是 async（内部 file I/O）—— 本函数亦 async。
 */
async function discoverAgents(): Promise<AgentEntry[]> {
  const seen = new Set<string>();
  const result: AgentEntry[] = [];

  // 1. 内置优先（`loadAgentSpecFromDir` 是同步）
  const builtinDir = builtinAgentsDir();
  if (builtinDir) {
    for (const id of scanAgentDir(builtinDir)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const spec = loadAgentSpecFromDir(builtinDir, id);
      if (spec) result.push({ id, spec, source: "builtin", scope: "builtin" });
    }
  }

  // 2. 用户自定义覆盖 / 追加（`loadAgentSpec` 是 async）
  const builtinIds = new Set(result.map((a) => a.id));
  const userDir = path.join(dataRoot(), "agents");
  for (const id of scanAgentDir(userDir)) {
    if (builtinIds.has(id)) {
      // 用户覆盖 → scope = both；source 仍记 user（detail 返回 user spec）
      const idx = result.findIndex((a) => a.id === id);
      const spec = await loadAgentSpec(id); // 从 dataRoot 读
      if (spec) result[idx] = { id, spec, source: "user", scope: "both" };
      continue;
    }
    seen.add(id);
    const spec = await loadAgentSpec(id);
    if (spec) result.push({ id, spec, source: "user", scope: "user" });
  }

  return result;
}

// ============================================================
// spec → API 形状转换
// ============================================================

function toListItem(entry: AgentEntry): AgentListItem {
  const description =
    entry.spec.description_zh || entry.spec.description_en || "";
  return {
    id: entry.id,
    name: entry.spec.name || entry.id,
    description,
    source: entry.source,
    scope: entry.scope,
    enabled: true,
    tools: entry.spec.skill_list ?? [],
  };
}

function toDetail(entry: AgentEntry): AgentDetail {
  return {
    ...toListItem(entry),
    description_zh: entry.spec.description_zh ?? "",
    description_en: entry.spec.description_en ?? "",
    systemPrompt: entry.spec.workflow ?? "",
  };
}

// ============================================================
// Path traversal 防御
// ============================================================

/**
 * 校验 `:id` 段合法（不含 NUL / `\` / `..` / 超长）。
 *
 * 路由 regex `[^/]+` 已拦截 `/`；此处兜底：
 * - NUL：fs 截断漏洞（CWE-158）
 * - `..`：恶意 id 在 system prompt 注入时不致死，但路径安全仍需兜底
 * - `\`：Windows 路径分隔符跨平台防御
 *
 * 返回 `true` 表示合法；非法 id 直接 404（与「未命中」同语义，避免探测）。
 */
function isValidAgentId(id: string): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return false;
  if (id.includes("\0") || id.includes("\\") || id.includes("..")) return false;
  if (id.includes("/")) return false;
  return true;
}

// ============================================================
// HTTP helpers
// ============================================================

function sendJson<T>(res: ServerResponse, status: number, body: T): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendOk<T>(res: ServerResponse, data: T): void {
  sendJson<ApiOk<T>>(res, 200, { ok: true, data });
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson<ApiError>(res, status, { ok: false, error: { code, message } });
}

// ============================================================
// Handlers（导出，router.ts mutate / 替换）
// ============================================================

/**
 * `GET /api/agents` — 列出全部 agent。
 *
 * 响应：`{ ok: true, data: { agents: AgentListItem[] } }`
 */
export async function listAgentsHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  _params: Record<string, string>,
): Promise<void> {
  try {
    const entries = await discoverAgents();
    const items = entries.map(toListItem);
    sendOk(res, { agents: items });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "internal error",
    );
  }
}

/**
 * `GET /api/agents/:id` — 单个 agent 详情。
 *
 * - 命中：200 + `{ ok: true, data: { agent: AgentDetail } }`
 * - 未命中 / 非法 id：404 + `{ ok: false, error: { code: "AGENT_NOT_FOUND", ... } }`
 *   —— 不暴露「该 id 非法」的语义给探测
 */
export async function getAgentHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): Promise<void> {
  const id = params.id ?? "";

  // 非法 id → 404 静默（与「未命中」同语义）
  if (!isValidAgentId(id)) {
    sendError(res, 404, "AGENT_NOT_FOUND", `Agent "${id}" not found`);
    return;
  }

  try {
    const entries = await discoverAgents();
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      sendError(res, 404, "AGENT_NOT_FOUND", `Agent "${id}" not found`);
      return;
    }
    sendOk(res, { agent: toDetail(entry) });
  } catch (err) {
    sendError(
      res,
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "internal error",
    );
  }
}