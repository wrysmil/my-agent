/**
 * 交互式对话 CLI
 *
 * 用法：
 *   npx tsx chat.ts              # 主菜单（默认）
 *   npx tsx chat.ts --load <id>  # 恢复会话，跳过菜单
 *   npx tsx chat.ts --list       # 列出历史会话
 *
 * 主菜单（数字彩菜单）：
 *   ① 开始对话
 *   ② 设置模型提供商
 *   ③ 查看当前提供商
 *   ④ 退出
 *
 * 启动时若 active provider 的 API Key 为空，主动引导进入设置。
 */

import * as readline from "node:readline";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/config/loader.js";
import type { CoreAgentConfig } from "./src/config/schema.js";
import { AgentRunner } from "./src/agent/runner.js";
import { DeepSeekProvider } from "./src/providers/deepseek.js";
import { ProviderRegistry } from "./src/providers/registry.js";
import { defineTool, type AgentTool } from "./src/tools/base.js";
import { BUILTIN_TOOLS } from "./src/tools/builtin.js";
import { buildDispatchTools } from "./src/orchestration/tools.js";
import { createExecutionPlanTool, type ExecutionPlanController } from "./src/tools/execution-plan.js";
import { createViewSkillTool } from "./src/tools/view-skill.js";
import { PersistentSession } from "./src/agent/persistent-session.js";
import { SessionStore } from "./src/storage/session-store.js";
import { ProvidersStore, type ProviderConfigEntry } from "./src/storage/providers-store.js";
import { userSkillsDir, userMarketplaceSkillsDir, toolResultsDir, ensureDataLayout } from "./src/storage/paths.js";
import { sweepToolResults } from "./src/tools/tool-result-cap.js";
import { TOOL_RESULT_TOOLS } from "./src/tools/tool-result-tools.js";
import { getToolsSystemPromptBlock, registerCatalogEntry, getCatalogEntry } from "./src/tools/catalog.js";
import { getLocalExecMode, describeMode } from "./src/tools/bash-permissions.js";
import { SkillLoader } from "./src/skills/loader.js";
import { buildAvailableSkillsBlock } from "./src/skills/index.js";
import type { SkillSpec, SkillContent } from "./src/skills/types.js";
import { pickDescription } from "./src/skills/types.js";
import { buildSystemPrompt } from "./src/prompts/system-prompt-builder.js";
import {
  runMainMenu,
  showCurrentProvider,
  type MainMenuChoice,
} from "./src/cli/menu.js";
import { runProviderMenu } from "./src/cli/provider-menu.js";
import { runAgentMenu } from "./src/cli/agent-menu.js";
import * as fs from "node:fs";
import { confirm, prompt, colorize, menuColor } from "./src/cli/io.js";
import { renderSessionHistory } from "./src/cli/session-history.js";

// ============================================================================
// 辅助函数
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// CLI 解析（导出供测试）
// ============================================================================

export interface CliIo {
  consoleLog: (...args: unknown[]) => void;
  consoleError: (...args: unknown[]) => void;
  exit: (code: number) => void;
}

export interface BootstrapOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  providersPath: string;
  cli: CliIo;
  projectConfig: CoreAgentConfig;
}

export interface BootstrapResult {
  store: ProvidersStore;
  activeProvider: ProviderConfigEntry | undefined;
  parsedArgs: ReturnType<typeof parseArgs>;
}

export function parseArgs(argv: string[]) {
  const flagList = argv.includes("--list");
  const loadIdx = argv.indexOf("--load");
  const loadId = loadIdx >= 0 ? argv[loadIdx + 1] : undefined;
  return { flagList, loadId };
}

/**
 * 解析历史会话列表选择。返回 1-based 索引；0 = 返回主菜单；null = 无效输入。
 */
export function pickHistoryIndex(input: string, count: number): number | null {
  if (input === "0") return 0;
  const idx = Number(input);
  if (!Number.isInteger(idx) || idx < 1 || idx > count) return null;
  return idx;
}

/** 加载 providers 并解析参数（不进入交互）。供测试与 main 共用。 */
export async function bootstrapChat(opts: BootstrapOptions): Promise<BootstrapResult> {
  const store = await ProvidersStore.load(opts.providersPath);
  const parsedArgs = parseArgs(opts.argv);
  return {
    store,
    activeProvider: store.getActiveProvider(),
    parsedArgs,
  };
}

// ============================================================================
// 工具（calculator / getTime）
// ============================================================================

const calculator = defineTool({
  name: "calculator",
  description: "执行数学计算。输入一个数学表达式字符串。",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string", description: "数学表达式，如 '2+3*4'" },
    },
    required: ["expression"],
  },
  execute: async (input) => {
    try {
      const expr = String(input.expression);
      const result = Function(`"use strict"; return (${expr})`)();
      return { content: `${expr} = ${result}` };
    } catch (err) {
      return { content: `计算失败: ${String(err)}`, isError: true };
    }
  },
});

const getTime = defineTool({
  name: "get_current_time",
  description: "获取当前日期和时间",
  inputSchema: {
    type: "object",
    properties: {
      timezone: { type: "string", description: "时区，默认 Asia/Shanghai" },
    },
  },
  execute: async (input) => {
    const tz = (input.timezone as string) || "Asia/Shanghai";
    return { content: `${tz} 当前时间: ${new Date().toLocaleString("zh-CN", { timeZone: tz })}` };
  },
});

// ============================================================================
// Skills
// ============================================================================

// 仓库内示例 skill 目录（S1.4 迁移方案 A：过渡期兼容保留，先到先得排在 dataRoot 之后）
// new URL(...).pathname 在 Windows 下产出 /D:/... 无效路径，必须 fileURLToPath
const repoSkillDir = fileURLToPath(new URL("./skills", import.meta.url));
const skillLoader = new SkillLoader({
  dirs: [userMarketplaceSkillsDir(), userSkillsDir(), repoSkillDir],
});
const skillSpecs: SkillSpec[] = skillLoader.list();
const skillMap = new Map<string, SkillContent>();
for (const spec of skillSpecs) {
  const content = SkillLoader.load(spec);
  if (content) skillMap.set(spec.id, content);
}

function buildSkillContext(): string {
  return buildAvailableSkillsBlock(skillLoader, {
    roots: {
      custom: userSkillsDir(),
      marketplace: userMarketplaceSkillsDir(),
      builtin: repoSkillDir,
    },
  });
}

const allTools: AgentTool[] = [...BUILTIN_TOOLS, ...TOOL_RESULT_TOOLS, calculator, getTime];

// 注册非 builtin 工具到目录
registerCatalogEntry({
  name: "calculator",
  summary: "Evaluate mathematical expressions.",
  group: "meta",
});
registerCatalogEntry({
  name: "get_current_time",
  summary: "Get the current date and time for a timezone.",
  group: "meta",
});

const skillContext = buildSkillContext();

// ============================================================================
// Provider 装配
// ============================================================================

function buildProviderRegistry(store: ProvidersStore): ProviderRegistry {
  const registry = new ProviderRegistry();
  const active = store.getActiveProvider();
  if (!active) {
    throw new Error("没有可用的 provider；请先在设置菜单中新建一个");
  }
  if (active.type === "deepseek") {
    const dp = new DeepSeekProvider({ apiKey: active.apiKey, baseUrl: active.baseUrl });
    registry.registerFactory(active.id, () => dp);
  }
  return registry;
}

// ============================================================================
// 主入口
// ============================================================================

async function main() {
  const config = await loadConfig("./config.json");
  const providersPath = path.join(
    process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent"),
    "providers.json",
  );

  const { store, parsedArgs } = await bootstrapChat({
    argv: process.argv.slice(2),
    env: process.env,
    providersPath,
    cli: { consoleLog: console.log, consoleError: console.error, exit: process.exit },
    projectConfig: config,
  });

  // 启动时清理过期工具结果
  ensureDataLayout();
  const sweepResult = sweepToolResults(toolResultsDir());
  if (sweepResult.deleted > 0) {
    console.log(`🧹 已清理 ${sweepResult.deleted} 个过期工具结果 (释放 ${formatBytes(sweepResult.freedBytes)})`);
  }

  // --list 优先（不进入菜单）
  if (parsedArgs.flagList) {
    const sessions = new SessionStore().list();
    if (sessions.length === 0) {
      console.log("📭 没有已保存的会话");
    } else {
      console.log(`📋 已保存的会话 (${sessions.length}):\n`);
      for (const s of sessions) {
        console.log(`  ${s.id}  →  ${s.name}`);
      }
    }
    return;
  }

  // --load 跳过菜单
  if (parsedArgs.loadId) {
    const sessionStore = new SessionStore();
    const loaded = sessionStore.get(parsedArgs.loadId);
    if (!loaded) {
      console.error(`❌ 会话不存在: ${parsedArgs.loadId}`);
      console.error("   使用 --list 查看可用会话");
      process.exit(1);
    }
    await runChat({ config, store, session: loaded });
    return;
  }

  // 默认：主菜单循环
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const choice: MainMenuChoice = await runMainMenu(rl, store);
      switch (choice) {
        case "start": {
          const active = store.getActiveProvider();
          if (!active || !active.apiKey) {
            const go = await confirm(
              rl,
              "⚠️ 当前 provider 缺少 API Key，是否进入设置？",
              true,
            );
            if (go) {
              await runProviderMenu(rl, store);
            }
            if (!store.getActiveProvider()?.apiKey) {
              console.log("❌ 仍未配置 API Key，无法开始对话\n");
              continue;
            }
          }
          await runChat({ config, store, session: undefined, rl });
          return;
        }
        case "history": {
          const loaded = await runHistoryMenu(rl);
          if (loaded) {
            await runChat({ config, store, session: loaded, rl });
            return;
          }
          continue;
        }
        case "settings":
          await runProviderMenu(rl, store);
          continue;
        case "view":
          showCurrentProvider(store);
          continue;
        case "agents":
          await runAgentMenu(rl);
          continue;
        case "quit":
          console.log("👋 再见！");
          return;
      }
    }
  } finally {
    rl.close();
  }
}

// ============================================================================
// 历史会话选择
// ============================================================================

async function runHistoryMenu(
  rl: readline.Interface,
): Promise<PersistentSession | undefined> {
  const sessionStore = new SessionStore();
  const sessions = sessionStore.list();

  console.log("");
  if (sessions.length === 0) {
    console.log("📭 没有已保存的会话\n");
    return undefined;
  }

  console.log(`📋 已保存的会话 (${sessions.length}):\n`);
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    console.log(`  ${colorize("•", menuColor(i + 1))} ${i + 1}. ${s.name}  (${s.id})`);
  }
  console.log(`  ${colorize("•", 31)} 0. 返回主菜单\n`);

  for (;;) {
    const ans = await prompt(rl, "  选择要加载的会话 (0 返回): ");
    const idx = pickHistoryIndex(ans, sessions.length);
    if (idx === 0) return undefined;
    if (idx === null) {
      console.log(colorize("  无效输入", 31));
      continue;
    }
    const session = sessionStore.get(sessions[idx - 1].id);
    if (session) return session;
    console.log(colorize(`  会话不存在或已损坏: ${sessions[idx - 1].id}`, 31));
    return undefined;
  }
}

// ============================================================================
// 对话主循环
// ============================================================================

/** 扫描内置 agent 目录，返回 agent_id 列表 */
function discoverChatAgents(): string[] {
  const fixturesDir = fileURLToPath(new URL("./fixtures/orchestration/agents", import.meta.url));
  if (!fs.existsSync(fixturesDir)) return [];
  try {
    return fs.readdirSync(fixturesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(`${fixturesDir}/${e.name}/agent.json`))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function runChat(opts: {
  config: CoreAgentConfig;
  store: ProvidersStore;
  session: PersistentSession | undefined;
  /** 外部传入时复用该 readline（避免与主菜单双实例共享 stdin 导致双重回显）；缺省时自建 */
  rl?: readline.Interface;
}): Promise<void> {
  const sessionStore = new SessionStore();
  let session: PersistentSession = opts.session ?? sessionStore.create();

  // ---- 5.5 / 5.4 工具实例化与注入 ----
  // executionPlanController 桥接当前 session（闭包捕获 `let session`，
  // /clear 或 /provider 重建 runner 后仍指向新 session）。
  const executionPlanController: ExecutionPlanController = {
    update: (update) =>
      session.updateExecutionPlan(
        update as Parameters<typeof session.updateExecutionPlan>[0],
      ),
    clear: () => session.clearExecutionPlan(),
  };
  const executionPlanTool = createExecutionPlanTool(executionPlanController);
  const viewSkillTool = createViewSkillTool(skillLoader);
  allTools.push(executionPlanTool, viewSkillTool);

  let registry = buildProviderRegistry(opts.store);
  const toolsBlock = getToolsSystemPromptBlock(allTools.map((t) => t.name));
  const { systemPrompt } = buildSystemPrompt({
    skillsIndex: skillContext || undefined,
    extraSystemPrompt: opts.config.agent.systemPrompt,
    toolsBlock,
  });

  let runner: AgentRunner = new AgentRunner({
    config: opts.config,
    providers: registry,
    tools: allTools,
    session,
    executionPlanController,
    skillLoader,
  });

  // 注入调度工具（run_worker / dispatch_to / hand_off_to），使主 Agent 可调用子 Agent
  // onWorkerEvent 回调将 worker 的实时输出（text_delta / tool_start / tool_end）
  // 推送到终端，用青色（36）区分，让用户可以看到子 Agent 的执行过程。
  const dispatchTools = buildDispatchTools({
    getRunner: () => runner,
    config: opts.config,
    cid: session.sessionId,
    onWorkerEvent: (ev) => {
      const name = ev.actor.name || ev.actor.id;
      switch (ev.type) {
        case "text_delta":
          // 使用 stderr 确保即时可见（不受 stdout 缓冲影响）
          process.stderr.write(ev.text);
          break;
        case "tool_start":
          process.stderr.write(`\n  [${name}] 🔧 ${ev.name}(${JSON.stringify(ev.input)})\n`);
          break;
        case "tool_end": {
          const icon = ev.isError ? "❌" : "✅";
          const preview = ev.result.slice(0, 200);
          process.stderr.write(`  [${name}] ${icon} ${preview}\n`);
          break;
        }
      }
    },
  });
  for (const dt of dispatchTools) {
    runner.addTool(dt);
  }

  // 发现可用子Agent
  const agentIds = discoverChatAgents();

  if (opts.session) {
    console.log(`💬 恢复会话: ${session.sessionId}`);
    const history = renderSessionHistory(session);
    if (history) {
      console.log("");
      console.log(history);
    }
  } else {
    console.log(`🆕 新建会话: ${session.sessionId}`);
  }

  // 按 group 统计工具
  const toolGroups = { fs: 0, shell: 0, web: 0, meta: 0 };
  for (const t of allTools) {
    // 统计时包含调度工具
    const name = t.name;
    if (["run_worker", "dispatch_to", "hand_off_to"].includes(name)) {
      toolGroups.meta++;
    } else if (["read_file", "write_file", "edit_file", "delete_file", "list_files", "search_files", "grep_files", "stat_file", "tool_result_search", "tool_result_read_chunk"].includes(name)) {
      toolGroups.fs++;
    } else if (name === "bash") {
      toolGroups.shell++;
    } else if (name === "web_fetch") {
      toolGroups.web++;
    } else {
      toolGroups.meta++;
    }
  }
  const bashMode = getLocalExecMode();

  console.log("🤖 Agent 对话模式");
  console.log(`   Session: ${session.sessionId}`);
  console.log(`   工具: fs:${toolGroups.fs} shell:${toolGroups.shell} web:${toolGroups.web} meta:${toolGroups.meta}`);
  console.log(`   Bash:  ${describeMode(bashMode)}`);
  console.log(`   Skill: ${skillSpecs.map((s) => s.name).join(", ") || "无"}`);
  if (agentIds.length > 0) {
    console.log(`   子Agent: ${agentIds.map((a) => `\`${a}\``).join(", ")}`);
    console.log(`   用法: 在对话中说「用 coder 帮我写...」或 LLM 自动调用 run_worker / dispatch_to`);
  }
  console.log("   输入消息后回车，/help 查看命令\n");

  // 启动健康检查（惰性，best-effort；失败不阻塞启动）
  try {
    const activeProvider = opts.store.getActiveProvider();
    if (activeProvider) {
      const providerInst = registry.get(activeProvider.id);
      if (providerInst) {
        const ok = await providerInst.validateAuth();
        if (!ok) {
          console.log(`⚠️  Provider "${activeProvider.name}" 健康检查失败，可能无法使用。`);
          console.log(`   可尝试 /provider 切换到其他 Provider。\n`);
        }
      }
    }
  } catch {
    // 静默失败，不阻塞启动
  }

  const ownsRl = opts.rl === undefined;
  const rl = opts.rl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question("👤 ", (answer) => resolve(answer.trim()));
    });

  function showHelp() {
    const mode = getLocalExecMode();
    console.log(`
┌─────────────────────────────────────────────┐
│  /quit, /exit    退出                        │
│  /clear          清空上下文（新建 session）     │
│  /save           显示当前 session ID          │
│  /tools          列出所有工具（按分组）         │
│  /skills         列出所有 Skill               │
│  /skill <id>     查看 Skill 详细内容           │
│  /plan           查看当前执行计划              │
│  /compact        手动触发上下文压缩            │
│  /provider [name] 查看/切换 LLM Provider       │
│  /mode [mode]    查看/切换 Bash 执行模式        │
│                   模式: disabled|workspace_only|unrestricted
│                   当前: ${describeMode(mode)}
│  /gc             手动清理过期工具结果           │
│  /help           显示此帮助                    │
└─────────────────────────────────────────────┘
`);
  }

  function showTools() {
    console.log("\n📦 可用工具（按分组）:\n");

    const groups = [
      { group: "fs", title: "📁 Files / workspace" },
      { group: "shell", title: "💻 Shell" },
      { group: "web", title: "🌐 Web" },
      { group: "meta", title: "🔀 Task / cross-session state" },
    ] as const;

    for (const { group, title } of groups) {
      console.log(`  ${title}`);
      for (const tool of allTools) {
        const entry = getCatalogEntry(tool.name);
        if (entry?.group === group || (!entry && group === "meta")) {
          const destructive = entry?.destructive ? " ⚠️" : "";
          const permission = entry?.permission === "localExec" ? " 🔒" : "";
          console.log(`    🔧 ${tool.name}${destructive}${permission}`);
          const desc = (entry?.summary || tool.description).slice(0, 70);
          console.log(`       ${desc}`);
        }
      }
      console.log("");
    }

    // 调度工具（动态注入）
    console.log("  🔀 Task / cross-session state (动态注入)");
    console.log("    🔧 run_worker — Spawn ephemeral worker for bounded sub-task.");
    console.log("    🔧 dispatch_to — Send task to named agent (visible reply).");
    console.log("    🔧 hand_off_to — Hand off control to named agent; turn ends.");
    console.log("");
  }

  function showSkills() {
    if (skillSpecs.length === 0) {
      console.log("\n📭 无可用 Skill\n");
      return;
    }
    console.log("\n📚 可用 Skill:\n");
    for (const spec of skillSpecs) {
      const desc = pickDescription(spec);
      console.log(`  📋 ${spec.name} (\`${spec.id}\`)`);
      console.log(`     ${desc}`);
    }
    console.log();
  }

  function showSkill(id: string) {
    const content = skillMap.get(id);
    if (!content) {
      console.log(`\n❌ Skill 不存在: ${id}\n`);
      return;
    }
    console.log(`\n📋 Skill: ${content.name} (\`${content.id}\`)\n`);
    console.log(`${"=".repeat(50)}`);
    console.log(content.body);
    console.log(`${"=".repeat(50)}\n`);
  }

  try {
    for (;;) {
      const input = await ask();
      if (!input) continue;

      if (input.startsWith("/")) {
        const [cmd, ...rest] = input.split(/\s+/);
        switch (cmd) {
          case "/quit":
          case "/exit":
            rl.close();
            session.close();
            console.log("👋 再见！");
            return;
          case "/help":
            showHelp();
            continue;
          case "/clear":
            session.close();
            session = sessionStore.create();
            runner = new AgentRunner({
              config: opts.config,
              providers: registry,
              tools: allTools,
              session,
              executionPlanController,
              skillLoader,
            });
            // 修复：重建 runner 后调度工具（run_worker/dispatch_to/hand_off_to）丢失，
            // 必须重新注入，否则子 Agent 编排失效。
            for (const dt of dispatchTools) {
              runner.addTool(dt);
            }
            console.log(`🧹 上下文已清除，新会话: ${session.sessionId}\n`);
            continue;
          case "/save":
            console.log(`💾 当前会话 ID: ${session.sessionId}`);
            console.log(`   下次使用: npx tsx chat.ts --load ${session.sessionId}\n`);
            continue;
          case "/plan": {
            const plan = runner.getSession().getExecutionPlan();
            if (!plan || plan.steps.length === 0) {
              console.log("📋 当前没有执行计划（模型尚未创建）\n");
            } else {
              const done = plan.steps.filter((s) => s.status === "completed").length;
              const total = plan.steps.length;
              console.log(`📋 当前执行计划 (${done}/${total} 完成)`);
              if (plan.objective) {
                console.log(`   目标: ${plan.objective.slice(0, 120)}${plan.objective.length > 120 ? "..." : ""}`);
              }
              console.log("─".repeat(44));
              for (const step of plan.steps) {
                const icon = { pending: "⏳", in_progress: "🔄", completed: "✅", blocked: "🚫" }[step.status] ?? "❓";
                console.log(`  ${icon} ${step.id}. ${step.step}`);
              }
              console.log("─".repeat(44) + "\n");
            }
            continue;
          }
          case "/compact": {
            const activeProvider = opts.store.getActiveProvider();
            const provider = activeProvider ? registry.get(activeProvider.id) : undefined;
            const modelId = activeProvider?.defaultModel ?? opts.config.agent.defaultModel;
            if (!provider) {
              console.log("⚠️  无活跃 Provider，无法执行压缩\n");
              continue;
            }
            console.log("🧹 上下文压缩中…");
            const result = await runner.compactNow(provider, modelId);
            if (!result) {
              console.log("   ⚠️ 无可压缩的上下文（历史轮次不足）\n");
            } else {
              console.log("🧹 上下文压缩完成");
              console.log(`   📊 压缩前: ~${result.before.toLocaleString()} tokens`);
              console.log(`   📊 压缩后: ~${result.after.toLocaleString()} tokens`);
              const pct = result.before > 0 ? ((1 - result.after / result.before) * 100).toFixed(1) : "0.0";
              console.log(`   ✅ 节省 ${pct}% (${(result.before - result.after).toLocaleString()} tokens)\n`);
            }
            continue;
          }
          case "/provider": {
            const arg = rest[0];
            if (!arg) {
              const active = opts.store.getActiveProvider();
              if (!active) {
                console.log("📡 无活跃 Provider\n");
              } else {
                console.log(`📡 当前 Provider: ${active.id} (${active.name})`);
                console.log(`   Model: ${active.defaultModel}`);
                console.log(`   Fallback 链: ${active.fallbackModels?.length ? active.fallbackModels.join(" → ") : "(无同 provider 备用模型)"}`);
                console.log(`   跨 Provider Fallback: ${active.fallbackProvider ?? "(无)"}`);
                console.log(`   状态: ✅ 正常\n`);
              }
            } else {
              const available = Object.keys(opts.store.getConfig().providers);
              if (!available.includes(arg)) {
                console.log(`❌ Provider 不存在: ${arg}。可用: ${available.join(", ") || "(无)"}\n`);
                continue;
              }
              console.log(`⚠️  切换到 ${arg} 需要重建 Agent 上下文。`);
              console.log(`   当前对话历史保留，但底层 provider 将变更。继续？(y/n)`);
              const confirmAns = await ask();
              if (confirmAns.toLowerCase() !== "y") {
                console.log("   已取消\n");
                continue;
              }
              try {
                opts.store.setActiveProvider(arg);
                await opts.store.save();
                session.close();
                session = sessionStore.create();
                registry = buildProviderRegistry(opts.store);
                runner = new AgentRunner({
                  config: opts.config,
                  providers: registry,
                  tools: allTools,
                  session,
                  executionPlanController,
                  skillLoader,
                });
                for (const dt of dispatchTools) {
                  runner.addTool(dt);
                }
                console.log(`✅ 已切换至 ${arg}\n`);
              } catch (err) {
                console.log(`❌ 切换失败: ${String(err)}\n`);
              }
            }
            continue;
          }
          case "/tools":
            showTools();
            continue;
          case "/skills":
            showSkills();
            continue;
          case "/skill":
            if (rest.length === 0) {
              console.log("用法: /skill <id>\n");
            } else {
              showSkill(rest[0]);
            }
            continue;
          case "/mode": {
            const validModes = ["disabled", "workspace_only", "unrestricted"];
            if (rest.length === 0) {
              // 查看当前模式
              const mode = getLocalExecMode();
              console.log(`\n🔧 当前 Bash 执行模式: ${describeMode(mode)}`);
              console.log(`   切换: /mode <${validModes.join("|")}>`);
              console.log(`   设置环境变量 TOOL_EXEC_MODE 也可更改\n`);
            } else {
              const target = rest[0].toLowerCase();
              if (validModes.includes(target)) {
                process.env.TOOL_EXEC_MODE = target;
                console.log(`\n✅ Bash 执行模式已切换为: ${describeMode(target as "disabled" | "workspace_only" | "unrestricted")}\n`);
              } else {
                console.log(`\n❌ 无效模式: ${target}。可选: ${validModes.join(", ")}\n`);
              }
            }
            continue;
          }
          case "/gc": {
            const result = sweepToolResults(toolResultsDir());
            if (result.deleted === 0) {
              console.log("\n🧹 没有需要清理的过期工具结果\n");
            } else {
              console.log(`\n🧹 已清理 ${result.deleted} 个过期工具结果 (释放 ${formatBytes(result.freedBytes)})\n`);
            }
            continue;
          }
          default:
            console.log(`未知命令: ${cmd}，输入 /help 查看帮助\n`);
            continue;
        }
      }

      process.stdout.write("🤖 ");
      let toolPhase = false;
      try {
        for await (const ev of runner.runStream({
          message: input,
          systemPrompt,
        })) {
          switch (ev.type) {
            case "text_delta":
              if (toolPhase) {
                toolPhase = false;
                process.stdout.write("\n🤖 ");
              }
              process.stdout.write(ev.text);
              break;
            case "tool_start":
              toolPhase = true;
              console.log(`\n   🔧 ${ev.name}(${JSON.stringify(ev.input)})`);
              break;
            case "tool_end": {
              const res = (ev as any).result ?? "";
              const icon = (ev as any).isError ? "❌" : "✅";
              const preview = String(res).slice(0, 150);
              console.log(`   ${icon} ${preview}`);
              break;
            }
            case "retry":
              console.log(`\n   🔄 重试: ${(ev as any).reason}`);
              break;
            case "done":
              if (ev.result.meta.error) {
                console.log(
                  `\n❌ [${ev.result.meta.error.kind}] ${ev.result.meta.error.message}`,
                );
              }
              break;
          }
        }
      } catch (err) {
        console.log(`\n❌ 错误: ${String(err)}`);
      }
      console.log("\n");
    }
  } finally {
    if (ownsRl) rl.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
