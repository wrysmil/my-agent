/**
 * 交互式对话 CLI
 *
 * 用法：
 *   npx tsx chat.ts              # 新建会话
 *   npx tsx chat.ts --load <id>  # 恢复会话
 *   npx tsx chat.ts --list       # 列出历史会话
 *
 * 命令（对话中）：
 *   /quit /exit    退出
 *   /clear         清空当前会话上下文
 *   /save          显示当前会话 ID
 *   /tools         列出可用工具
 *   /skills        列出可用 Skill
 *   /skill <id>    查看 Skill 内容
 */

import * as readline from "node:readline";
import { loadConfig } from "./src/config/loader.js";
import { AgentRunner } from "./src/agent/runner.js";
import { DeepSeekProvider } from "./src/providers/deepseek.js";
import { ProviderRegistry } from "./src/providers/registry.js";
import { defineTool, type AgentTool } from "./src/tools/base.js";
import { BUILTIN_TOOLS } from "./src/tools/builtin.js";
import { PersistentSession } from "./src/agent/persistent-session.js";
import { SessionStore } from "./src/storage/session-store.js";
import { SkillLoader } from "./src/skills/loader.js";
import type { SkillSpec, SkillContent } from "./src/skills/types.js";
import { pickDescription } from "./src/skills/types.js";
import { buildSystemPrompt } from "./src/prompts/system-prompt-builder.js";

// ============================================================
// 命令行参数
// ============================================================
const args = process.argv.slice(2);
const flagList = args.includes("--list");
const loadIdx = args.indexOf("--load");
const loadId = loadIdx >= 0 ? args[loadIdx + 1] : undefined;

// ============================================================
// 初始化
// ============================================================
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("❌ 请设置 DEEPSEEK_API_KEY 环境变量");
  console.error("   export DEEPSEEK_API_KEY=sk-xxx");
  process.exit(1);
}

const config = await loadConfig("./config.json");

const provider = new DeepSeekProvider({
  apiKey: API_KEY,
  baseUrl: config.models.providers?.deepseek?.baseUrl,
});

const providers = new ProviderRegistry(config);
providers.registerFactory("deepseek", () => provider);

// ============================================================
// 自定义工具
// ============================================================
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

// ============================================================
// Skill 加载
// ============================================================
const skillDir = new URL("./skills", import.meta.url).pathname;
const skillSpecs = SkillLoader.scan(skillDir, "system");
const skillMap = new Map<string, SkillContent>();
for (const spec of skillSpecs) {
  const content = SkillLoader.load(spec);
  if (content) skillMap.set(spec.id, content);
}

// 构建 skill 列表（注入到 system prompt）
function buildSkillContext(): string {
  if (skillSpecs.length === 0) return "";
  const lines = ["## 可用技能 (Skills)", ""];
  for (const spec of skillSpecs) {
    const desc = pickDescription(spec);
    lines.push(`- **${spec.name}** (\`${spec.id}\`): ${desc}`);
  }
  lines.push("", "通过描述中的关键词触发相应 Skill 的指令规范。");
  return lines.join("\n");
}

// ============================================================
// 工具汇总
// ============================================================
const allTools: AgentTool[] = [
  ...BUILTIN_TOOLS,
  calculator,
  getTime,
];

// ============================================================
// Session 管理
// ============================================================
const store = new SessionStore();

let session: PersistentSession;
if (flagList) {
  // --list：列出历史会话
  const sessions = store.list();
  if (sessions.length === 0) {
    console.log("📭 没有已保存的会话");
  } else {
    console.log(`📋 已保存的会话 (${sessions.length}):\n`);
    for (const s of sessions) {
      console.log(`  ${s.id}  →  ${s.name}`);
    }
  }
  process.exit(0);
} else if (loadId) {
  // --load <id>：恢复会话
  const loaded = store.get(loadId);
  if (!loaded) {
    console.error(`❌ 会话不存在: ${loadId}`);
    console.error("   使用 --list 查看可用会话");
    process.exit(1);
  }
  session = loaded;
  console.log(`📂 已恢复会话: ${session.sessionId}`);
} else {
  // 新建会话
  session = store.create();
  console.log(`🆕 新建会话: ${session.sessionId}`);
}

// ============================================================
// System prompt（使用模板体系构建）
// ============================================================
const skillContext = buildSkillContext();
const { systemPrompt } = buildSystemPrompt({
  skillsIndex: skillContext || undefined,
  extraSystemPrompt: config.agent.systemPrompt,
});

// ============================================================
// 创建 AgentRunner
// ============================================================
function createRunner(): AgentRunner {
  return new AgentRunner({
    config,
    providers,
    tools: allTools,
    session,
  });
}

let runner = createRunner();

// ============================================================
// 交互循环
// ============================================================
console.log("🤖 Agent 对话模式");
console.log(`   Session: ${session.sessionId}`);
console.log(`   工具: ${allTools.map((t) => t.name).join(", ")}`);
console.log(`   Skill: ${skillSpecs.map((s) => s.name).join(", ") || "无"}`);
console.log("   输入消息后回车，/help 查看命令\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

async function chat() {
  while (true) {
    const input = await ask();
    if (!input) continue;

    // 命令处理
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
          session = store.create();
          runner = createRunner();
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
}

chat().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
