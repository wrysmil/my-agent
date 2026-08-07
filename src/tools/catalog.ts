/**
 * 工具目录（Tool Catalog）
 *
 * 建立工具元数据注册表，支撑 system prompt 中分组渲染 + 可见性门控。
 *
 * 设计原则：
 * - 单一事实源：builtin 工具 + 调度的名字必须在此注册，反漂移测试保证一致性
 * - 分组渲染：按 fs / shell / web / meta 四组输出 system prompt 块
 * - 可见性门控：ownerAgent 限定仅指定 agent 可见；permission 标注受运行时权限影响
 */

// ============================================================
// 类型
// ============================================================

/** 工具渲染分组（简化为本项目实际的 4 组） */
export type ToolGroup = "fs" | "shell" | "web" | "meta";

/** 权限标注（用于 system prompt 渲染，非强制门控） */
export type ToolPermission = "localExec";

export interface ToolCatalogEntry {
  /** 必须与 AgentTool.name 精确匹配 */
  name: string;
  /** 面向 LLM 的一行英文摘要（短，用于 system prompt） */
  summary: string;
  /** 渲染分组 */
  group: ToolGroup;
  /** 运行时权限门控标注（渲染为 "(gated by local-execution permission)"） */
  permission?: ToolPermission;
  /** 仅指定 agent 可见；缺省则所有 agent 可见 */
  ownerAgent?: string | string[];
  /** 标注为破坏性操作（渲染时加 ⚠️ 标记） */
  destructive?: boolean;
}

// ============================================================
// 工具全表
// ============================================================

const CATALOG: ToolCatalogEntry[] = [
  // ---- fs ----
  {
    name: "read_file",
    summary: "读取文件内容，支持指定行号范围。",
    group: "fs",
  },
  {
    name: "write_file",
    summary: "将 UTF-8 文本写入文件（覆盖已有文件）。",
    group: "fs",
  },
  {
    name: "edit_file",
    summary: "对现有文件进行精确字符串替换（old→new）。",
    group: "fs",
  },
  {
    name: "delete_file",
    summary: "删除工作区内的文件。⚠️ 不可恢复，请谨慎使用。",
    group: "fs",
    destructive: true,
  },
  {
    name: "list_files",
    summary: "列出目录内容，支持递归深度控制。",
    group: "fs",
  },
  {
    name: "search_files",
    summary: "按文件名/glob 模式搜索文件。",
    group: "fs",
  },
  {
    name: "grep_files",
    summary: "在文件内容中搜索文本/正则表达式。",
    group: "fs",
  },
  {
    name: "stat_file",
    summary: "获取文件元信息：大小、行数、字符数。",
    group: "fs",
  },
  {
    name: "tool_result_search",
    summary: "在已持久化的超大工具结果中按 ref 搜索。",
    group: "fs",
  },
  {
    name: "tool_result_read_chunk",
    summary: "按游标读取持久化工具结果的指定片段。",
    group: "fs",
  },

  // ---- shell ----
  {
    name: "bash",
    summary: "在子进程中执行 shell 命令。⚠️ 具有副作用。",
    group: "shell",
    permission: "localExec",
    destructive: true,
  },

  // ---- web ----
  {
    name: "web_fetch",
    summary: "抓取指定 URL 的网页内容并提取文本。",
    group: "web",
  },

  // ---- meta ----
  {
    name: "run_worker",
    summary: "派生临时 worker 完成有界子任务（结果私密）。",
    group: "meta",
    ownerAgent: "commander",
  },
  {
    name: "dispatch_to",
    summary: "向命名 agent 派发任务，其回复对用户可见。",
    group: "meta",
    ownerAgent: "commander",
  },
  {
    name: "hand_off_to",
    summary: "将控制权移交给命名 agent；本轮结束。",
    group: "meta",
    ownerAgent: "commander",
  },
  {
    name: "manage_execution_plan",
    summary: "Maintain durable milestones for long tasks.",
    group: "meta",
  },
  {
    name: "view_skill",
    summary: "Load the full instructions for a skill by its internal read id.",
    group: "meta",
  },
];

// ============================================================
// 索引
// ============================================================

const catalogByName = new Map<string, ToolCatalogEntry>();
for (const entry of CATALOG) {
  catalogByName.set(entry.name, entry);
}

/** 全部注册的工具名集合（供反漂移测试使用） */
export const CATALOG_NAME_SET: ReadonlySet<string> = new Set(catalogByName.keys());

/** 调度工具名集合（不在常驻注册表中，由 buildDispatchTools 动态注入） */
export const DISPATCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  "run_worker",
  "dispatch_to",
  "hand_off_to",
]);

// ============================================================
// 固定渲染顺序
// ============================================================

const GROUP_ORDER: ReadonlyArray<{ group: ToolGroup; title: string }> = [
  { group: "fs", title: "Files / workspace" },
  { group: "shell", title: "Shell" },
  { group: "web", title: "Web" },
  { group: "meta", title: "Task / cross-session state" },
];

// ============================================================
// 扩展注册（供非 builtin 工具注册后加入目录）
// ============================================================

/**
 * 注册/覆盖一个工具目录条目。
 * 用于 chat.ts 等入口处注册 calculator、getTime 等非 builtin 工具。
 */
export function registerCatalogEntry(entry: ToolCatalogEntry): void {
  catalogByName.set(entry.name, entry);
}

// ============================================================
// 可见性门控
// ============================================================

/**
 * 判断工具对指定 agent 是否可见。
 *
 * @param name — 工具名
 * @param agentId — 当前 agent 标识（如 `"commander"`、`"coder"`）
 * @returns 可见则 true
 */
export function isToolVisibleToAgent(name: string, agentId: string): boolean {
  const entry = catalogByName.get(name);
  if (!entry) return true; // 未注册的放行（兼容未知工具）
  if (!entry.ownerAgent) return true;
  if (Array.isArray(entry.ownerAgent)) {
    return entry.ownerAgent.includes(agentId);
  }
  return entry.ownerAgent === agentId;
}

// ============================================================
// System Prompt 块渲染
// ============================================================

/**
 * 按分组渲染工具列表为 system prompt 块。
 *
 * 输出格式：
 * ```
 * ## Available tools
 *
 * ### Files / workspace
 * - **read_file** — Read file contents with optional line range.
 * - **write_file** — Write UTF-8 text content to a file (overwrite).
 * ...
 * ```
 *
 * @param names — 实际注册的工具名列表（来自 runner.tools）
 * @returns 格式化后的工具列表块；空 names 返回 ""
 */
export function getToolsSystemPromptBlock(names: string[]): string {
  if (!names || names.length === 0) return "";

  const nameSet = new Set(names);

  // 按 GROUP_ORDER 分组
  const groups = new Map<ToolGroup, ToolCatalogEntry[]>();
  for (const { group } of GROUP_ORDER) {
    groups.set(group, []);
  }

  for (const name of names) {
    const entry = catalogByName.get(name);
    if (!entry) {
      // 不在 catalog 中 → 跳过（调度工具等动态注入的，预期如此）
      continue;
    }
    groups.get(entry.group)?.push(entry);
  }

  // 渲染
  const lines: string[] = ["## Available tools", ""];

  for (const { group, title } of GROUP_ORDER) {
    const entries = groups.get(group);
    if (!entries || entries.length === 0) continue;

    lines.push(`### ${title}`);
    for (const entry of entries) {
      let line = `- **${entry.name}** — ${entry.summary}`;
      if (entry.permission === "localExec") {
        line += " (gated by local-execution permission)";
      }
      if (entry.destructive) {
        line = `- **${entry.name}** ⚠️ — ${entry.summary}`;
        if (entry.permission === "localExec") {
          line += " (gated by local-execution permission)";
        }
      }
      lines.push(line);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

// ============================================================
// 查询辅助
// ============================================================

/** 获取工具目录条目 */
export function getCatalogEntry(name: string): ToolCatalogEntry | undefined {
  return catalogByName.get(name);
}

/** 获取全部目录条目（只读） */
export function getAllCatalogEntries(): ReadonlyArray<ToolCatalogEntry> {
  return CATALOG;
}
