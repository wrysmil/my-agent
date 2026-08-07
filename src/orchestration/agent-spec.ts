import * as fs from "node:fs";
import * as path from "node:path";
import { dataRoot } from "../storage/paths.js";
import { assertPathSegment } from "../storage/paths.js";

/**
 * Agent 规格（从 agent.json 读取）。
 *
 * 路径：{dataRoot}/agents/{agent_id}/agent.json
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

/**
 * 加载并校验 agent 规格文件。
 *
 * 安全：对 agent_id 做段断言（防路径穿越）。
 * 返回 null 表示文件不存在。
 */
export async function loadAgentSpec(agentId: string): Promise<AgentSpec | null> {
  assertPathSegment(agentId, "agent_id");

  const filePath = path.join(dataRoot(), "agents", agentId, "agent.json");
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<AgentSpec>;
    return normalizeAgentSpec(raw, agentId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function normalizeAgentSpec(raw: Partial<AgentSpec>, agentId: string): AgentSpec {
  if (raw.agent_id && raw.agent_id !== agentId) {
    throw new Error(`agent_id mismatch: file says "${raw.agent_id}", expected "${agentId}"`);
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
