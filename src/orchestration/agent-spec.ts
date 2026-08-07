import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { dataRoot } from "../storage/paths.js";
import { assertPathSegment } from "../storage/paths.js";

/**
 * Agent 规格（从 agent.json 读取）。
 */
export interface AgentSpec {
  agent_id: string;
  name: string;
  description_zh?: string;
  description_en?: string;
  /** 分步程序（注入 worker system prompt） */
  workflow?: string;
  /** 技能白名单：缺失=全部可用，[] = 零技能，非空 = 仅这些 */
  skill_list?: string[];
}

// ---- 内置 agent 目录（随项目发布） ----

let _builtinAgentsDir: string | null | undefined;

/** 返回项目内置 agent 目录路径（fixtures/orchestration/agents/），不存在返回 null */
function builtinAgentsDir(): string | null {
  if (_builtinAgentsDir !== undefined) return _builtinAgentsDir;
  try {
    const dir = fileURLToPath(
      new URL("../../fixtures/orchestration/agents", import.meta.url),
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

// ---- 加载 ----

/**
 * 加载并校验 agent 规格文件。
 *
 * 查找顺序：
 * 1. {dataRoot}/agents/{agent_id}/agent.json  — 用户自定义（优先，可覆盖内置）
 * 2. {builtin}/agents/{agent_id}/agent.json   — 项目内置（fallback）
 *
 * 安全：对 agent_id 做段断言（防路径穿越）。
 * 返回 null 表示两处均不存在。
 */
export async function loadAgentSpec(agentId: string): Promise<AgentSpec | null> {
  assertPathSegment(agentId, "agent_id");

  // 1. 用户自定义优先
  const userPath = path.join(dataRoot(), "agents", agentId, "agent.json");
  try {
    const raw = JSON.parse(fs.readFileSync(userPath, "utf-8")) as Partial<AgentSpec>;
    return normalizeAgentSpec(raw, agentId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // 2. 内置 fallback
  const builtin = builtinAgentsDir();
  if (builtin) {
    const builtinPath = path.join(builtin, agentId, "agent.json");
    try {
      const raw = JSON.parse(fs.readFileSync(builtinPath, "utf-8")) as Partial<AgentSpec>;
      return normalizeAgentSpec(raw, agentId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  return null;
}

/**
 * 从指定目录加载 agent spec（不经过 dataRoot / builtin 查找链）。
 * 供 agent-menu 等需要直接扫描目录的调用方使用。
 */
export function loadAgentSpecFromDir(
  dir: string,
  agentId: string,
): AgentSpec | null {
  assertPathSegment(agentId, "agent_id");
  const filePath = path.join(dir, agentId, "agent.json");
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<AgentSpec>;
    return normalizeAgentSpec(raw, agentId);
  } catch {
    return null;
  }
}

function normalizeAgentSpec(raw: Partial<AgentSpec>, agentId: string): AgentSpec {
  if (raw.agent_id && raw.agent_id !== agentId) {
    throw new Error(
      `agent_id mismatch: file says "${raw.agent_id}", expected "${agentId}"`,
    );
  }
  return {
    agent_id: agentId,
    name: raw.name || agentId,
    description_zh: raw.description_zh,
    description_en: raw.description_en,
    workflow: raw.workflow,
    skill_list: raw.skill_list,
  };
}
