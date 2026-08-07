import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { loadAgentSpec, type AgentSpec } from "../orchestration/agent-spec.js";
import { dataRoot, userSkillsDir } from "../storage/paths.js";
import { formatBanner, formatMenuItem, prompt, colorize, menuColor } from "./io.js";

// ============================================================================
// Agent 发现
// ============================================================================

/** 仓库内置 agent 目录 */
const builtinAgentsDir = (() => {
  const fixturesDir = fileURLToPath(new URL("../../fixtures/orchestration/agents", import.meta.url));
  if (fs.existsSync(fixturesDir)) return fixturesDir;
  return null;
})();

/** 用户自定义 agent 目录 */
function userAgentsDir(): string {
  return path.join(dataRoot(), "agents");
}

/** 扫描目录下所有含 agent.json 的子目录，返回 agent_id 列表 */
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
    // 权限不足跳过
  }
  return ids;
}

interface AgentEntry {
  id: string;
  spec: AgentSpec;
  source: "builtin" | "user";
}

async function discoverAgents(): Promise<AgentEntry[]> {
  const seen = new Set<string>();
  const result: AgentEntry[] = [];

  // 仓库内置优先
  if (builtinAgentsDir) {
    for (const id of scanAgentDir(builtinAgentsDir)) {
      if (seen.has(id)) continue;
      seen.add(id);
      // 内置 agent 直接从 fixtures 加载
      const spec = await loadAgentSpecFromDir(builtinAgentsDir, id);
      if (spec) result.push({ id, spec, source: "builtin" });
    }
  }

  // 用户自定义覆盖/追加
  const userDir = userAgentsDir();
  for (const id of scanAgentDir(userDir)) {
    if (seen.has(id)) {
      // 用户覆盖：替换 builtin 条目
      const idx = result.findIndex((a) => a.id === id);
      const spec = await loadAgentSpec(id); // 从 dataRoot 加载
      if (spec) result[idx] = { id, spec, source: "user" };
      continue;
    }
    seen.add(id);
    const spec = await loadAgentSpec(id);
    if (spec) result.push({ id, spec, source: "user" });
  }

  return result;
}

/** 从指定目录加载 agent spec（绕过 dataRoot） */
async function loadAgentSpecFromDir(dir: string, agentId: string): Promise<AgentSpec | null> {
  const filePath = path.join(dir, agentId, "agent.json");
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      agent_id: agentId,
      name: raw.name || agentId,
      description_zh: raw.description_zh,
      description_en: raw.description_en,
      workflow: raw.workflow,
      skill_list: raw.skill_list,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Agent 详情展示
// ============================================================================

function showAgentDetail(entry: AgentEntry): void {
  const { spec, source } = entry;
  const sourceLabel = source === "builtin" ? "内置" : "用户";

  console.log("");
  console.log("  ┌─────────────────────────────────────────────┐");
  console.log(`  │ Agent: ${spec.name.padEnd(37)}│`);
  console.log(`  │ ID:    ${spec.agent_id.padEnd(37)}│`);
  console.log(`  │ 来源:  ${sourceLabel.padEnd(37)}│`);
  console.log("  ├─────────────────────────────────────────────┤");

  if (spec.description_zh) {
    const desc = spec.description_zh;
    // 自动换行
    const maxWidth = 41;
    for (let i = 0; i < desc.length; i += maxWidth) {
      const line = desc.slice(i, i + maxWidth);
      console.log(`  │ ${line.padEnd(41)}│`);
    }
  }

  console.log("  ├─────────────────────────────────────────────┤");
  const skills = spec.skill_list ?? ["全部"];
  console.log(`  │ 技能: ${skills.join(", ").slice(0, 35).padEnd(37)}│`);

  if (spec.workflow) {
    console.log("  ├─────────────────────────────────────────────┤");
    console.log("  │ Workflow (前 3 行):                          │");
    const wfLines = spec.workflow.split("\n").slice(0, 3);
    for (const line of wfLines) {
      const trimmed = line.slice(0, 39);
      console.log(`  │   ${trimmed.padEnd(39)}│`);
    }
  }
  console.log("  └─────────────────────────────────────────────┘");
  console.log("");
}

// ============================================================================
// Agent 管理菜单
// ============================================================================

export async function runAgentMenu(rl: readline.Interface): Promise<void> {
  const agents = await discoverAgents();

  for (;;) {
    console.log("");
    console.log(formatBanner("🤖 子Agent 管理"));
    console.log("");

    if (agents.length === 0) {
      console.log(`  ${colorize("📭 没有发现任何 Agent", 33)}`);
      console.log(`  将 agent.json 放入 ${colorize(userAgentsDir() + "/<agent_id>/", 36)}`);
      console.log(`  或使用内置 Agent: ${colorize("fixtures/orchestration/agents/", 36)}`);
      console.log("");
    } else {
      // 列出来源分组
      const builtins = agents.filter((a) => a.source === "builtin");
      const users = agents.filter((a) => a.source === "user");

      if (builtins.length > 0) {
        console.log(`  ${colorize("📦 内置 Agent", 36)}`);
        for (let i = 0; i < builtins.length; i++) {
          const a = builtins[i];
          const desc = a.spec.description_zh || a.spec.description_en || "";
          console.log(`    ${colorize("•", menuColor(i + 1))} ${a.id.padEnd(12)} ${desc.slice(0, 40)}`);
        }
        console.log("");
      }

      if (users.length > 0) {
        console.log(`  ${colorize("👤 用户 Agent", 33)}`);
        for (let i = 0; i < users.length; i++) {
          const a = users[i];
          const desc = a.spec.description_zh || a.spec.description_en || "";
          console.log(`    ${colorize("•", menuColor(builtins.length + i + 1))} ${a.id.padEnd(12)} ${desc.slice(0, 40)}`);
        }
        console.log("");
      }

      // 操作选项
      console.log(formatMenuItem(1, "查看 Agent 详情"));
      console.log(formatMenuItem(2, "刷新列表"));
    }

    console.log(formatMenuItem(agents.length > 0 ? 3 : 1, "返回主菜单", 31));
    console.log("");

    const promptText = agents.length > 0 ? "输入 Agent ID 查看详情, 或选择操作 (1-3): " : "按 1 返回: ";
    const ans = await prompt(rl, promptText);

    if (ans === "1" && agents.length > 0) {
      // 查看详情 — 提示输入 agent_id
      const id = await prompt(rl, "  输入 Agent ID: ");
      const entry = agents.find((a) => a.id === id);
      if (entry) {
        showAgentDetail(entry);
      } else {
        console.log(colorize(`  ❌ Agent "${id}" 不存在`, 31));
      }
      continue;
    }

    if (ans === "2" && agents.length > 0) {
      // 刷新
      continue;
    }

    // 直接输入 agent_id
    if (ans && !["1", "2", "3"].includes(ans)) {
      const entry = agents.find((a) => a.id === ans);
      if (entry) {
        showAgentDetail(entry);
        continue;
      }
    }

    // 返回
    return;
  }
}
