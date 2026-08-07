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
import { PersistentSession } from "./src/agent/persistent-session.js";
import { SessionStore } from "./src/storage/session-store.js";
import { ProvidersStore, type ProviderConfigEntry } from "./src/storage/providers-store.js";
import { userSkillsDir, userMarketplaceSkillsDir } from "./src/storage/paths.js";
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
import { confirm, prompt, colorize, menuColor } from "./src/cli/io.js";
import { renderSessionHistory } from "./src/cli/session-history.js";

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

const allTools: AgentTool[] = [...BUILTIN_TOOLS, calculator, getTime];
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

async function runChat(opts: {
  config: CoreAgentConfig;
  store: ProvidersStore;
  session: PersistentSession | undefined;
  /** 外部传入时复用该 readline（避免与主菜单双实例共享 stdin 导致双重回显）；缺省时自建 */
  rl?: readline.Interface;
}): Promise<void> {
  const sessionStore = new SessionStore();
  let session: PersistentSession = opts.session ?? sessionStore.create();

  const registry = buildProviderRegistry(opts.store);
  const { systemPrompt } = buildSystemPrompt({
    skillsIndex: skillContext || undefined,
    extraSystemPrompt: opts.config.agent.systemPrompt,
  });

  let runner: AgentRunner = new AgentRunner({
    config: opts.config,
    providers: registry,
    tools: allTools,
    session,
  });

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
  console.log("🤖 Agent 对话模式");
  console.log(`   Session: ${session.sessionId}`);
  console.log(`   工具: ${allTools.map((t) => t.name).join(", ")}`);
  console.log(`   Skill: ${skillSpecs.map((s) => s.name).join(", ") || "无"}`);
  console.log("   输入消息后回车，/help 查看命令\n");

  const ownsRl = opts.rl === undefined;
  const rl = opts.rl ?? readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question("👤 ", (answer) => resolve(answer.trim()));
    });

  function showHelp() {
    console.log(`
┌─────────────────────────────────────────────┐
│  /quit, /exit    退出                        │
│  /clear          清空上下文（新建 session）     │
│  /save           显示当前 session ID          │
│  /tools          列出所有工具                  │
│  /skills         列出所有 Skill               │
│  /skill <id>     查看 Skill 详细内容           │
│  /help           显示此帮助                    │
└─────────────────────────────────────────────┘
`);
  }

  function showTools() {
    console.log("\n📦 可用工具:\n");
    for (const tool of allTools) {
      console.log(`  🔧 ${tool.name}`);
      console.log(`     ${tool.description.slice(0, 80)}`);
    }
    console.log();
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
            });
            console.log(`🧹 上下文已清除，新会话: ${session.sessionId}\n`);
            continue;
          case "/save":
            console.log(`💾 当前会话 ID: ${session.sessionId}`);
            console.log(`   下次使用: npx tsx chat.ts --load ${session.sessionId}\n`);
            continue;
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
