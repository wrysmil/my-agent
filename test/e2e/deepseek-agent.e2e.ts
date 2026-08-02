/**
 * DeepSeek AgentRunner 端到端测试
 *
 * 使用真实 DeepSeek API 验证 AgentRunner 完整流程。
 *
 * 前置条件：
 *   1. 复制 .env.example 为 .env，填入 DEEPSEEK_API_KEY
 *   2. 安装依赖：npm install
 *
 * 运行：npx tsx test/e2e/deepseek-agent.e2e.ts
 */

import { loadConfig } from "../../src/config/loader.js";
import { AgentRunner } from "../../src/agent/runner.js";
import { DeepSeekProvider } from "../../src/providers/deepseek.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { defineTool } from "../../src/tools/base.js";
import type { AgentRunEvent } from "../../src/agent/types.js";

// ============================================================
// 从环境变量读 API Key
// ============================================================
const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY || API_KEY === "sk-your-key-here") {
  console.error("❌ 请先设置 DEEPSEEK_API_KEY 环境变量");
  console.error("   cp .env.example .env");
  console.error("   编辑 .env 填入你的 API Key");
  process.exit(1);
}

// ============================================================
// 定义测试工具
// ============================================================
const calculator = defineTool({
  name: "calculator",
  description: "执行数学计算，支持加减乘除、幂运算等。输入一个数学表达式，返回计算结果。",
  inputSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "数学表达式，如 '2+3*4'、'sqrt(16)'、'2**10'",
      },
    },
    required: ["expression"],
  },
  execute: async (input) => {
    const expr = String(input.expression);
    try {
      // 安全的数学计算（仅允许数字、运算符、Math 函数）
      const sanitized = expr.replace(/[^0-9+\-*/().%,\s]|Math\.\w+/g, (m) => {
        if (m.startsWith("Math.")) return m;
        throw new Error(`不允许的字符: ${m}`);
      });
      const result = Function(`"use strict"; return (${sanitized})`)();
      return { content: `${expr} = ${result}` };
    } catch (err) {
      return { content: `计算失败: ${String(err)}`, isError: true };
    }
  },
});

const getCurrentTime = defineTool({
  name: "get_current_time",
  description: "获取当前日期和时间",
  inputSchema: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "时区，如 'Asia/Shanghai'、'America/New_York'。默认为系统时区。",
      },
    },
  },
  execute: async (input) => {
    const tz = (input.timezone as string) || "Asia/Shanghai";
    const now = new Date();
    const formatted = now.toLocaleString("zh-CN", { timeZone: tz });
    return { content: `${tz} 当前时间: ${formatted}` };
  },
});

// ============================================================
// 辅助：流式打印事件
// ============================================================
async function runAndPrint(runner: AgentRunner, message: string) {
  console.log(`\n👤 用户: ${message}`);
  console.log("🤖 助手: ");

  let fullText = "";
  const toolCalls: string[] = [];

  for await (const ev of runner.runStream({ message })) {
    switch (ev.type) {
      case "text_delta":
        process.stdout.write(ev.text);
        fullText += ev.text;
        break;
      case "tool_start":
        console.log(`\n   🔧 调用工具: ${ev.name}(${JSON.stringify(ev.input)})`);
        break;
      case "tool_end":
        const result = (ev as any).result ?? "";
        const preview = String(result).slice(0, 200);
        const status = (ev as any).isError ? "❌" : "✅";
        console.log(`   ${status} 工具结果: ${preview}${String(result).length > 200 ? "..." : ""}`);
        toolCalls.push(`${ev.name}: ${preview}`);
        break;
      case "retry":
        console.log(`\n   🔄 重试 #${(ev as any).attempt}: ${(ev as any).reason}`);
        break;
      case "done":
        const meta = ev.result.meta;
        console.log(`\n${"─".repeat(50)}`);
        console.log(
          `⏱️  耗时: ${meta.durationMs}ms | 🔧 工具轮次: ${meta.toolLoops}`,
        );
        console.log(
          `📊 Token: 入 ${meta.usage.inputTokens} / 出 ${meta.usage.outputTokens}`,
        );
        if (meta.error) {
          console.log(`❌ 错误: [${meta.error.kind}] ${meta.error.message}`);
        } else {
          console.log(`✅ 完成 (${meta.stopReason})`);
        }
        break;
    }
  }
  console.log(); // 换行
  return { text: "", toolCalls, meta: null as any };
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log("🚀 DeepSeek AgentRunner 端到端测试\n");

  // 1. 加载配置
  const config = await loadConfig("./config.json");
  console.log(`📋 配置: model=${config.agent.defaultModel}, provider=${config.agent.defaultProvider}`);

  // 2. 创建 Provider
  const deepseekProvider = new DeepSeekProvider({
    apiKey: API_KEY!,
    baseUrl: config.models.providers?.deepseek?.baseUrl,
  });

  // 3. 注册到 ProviderRegistry
  const providers = new ProviderRegistry(config);
  providers.registerFactory("deepseek", () => deepseekProvider);

  // 4. 创建 AgentRunner
  const runner = new AgentRunner({
    config,
    providers,
    tools: [calculator, getCurrentTime],
  });

  // 5. 验证 API Key
  console.log("🔑 验证 API Key...");
  const authed = await deepseekProvider.validateAuth();
  if (!authed) {
    console.error("❌ API Key 验证失败，请检查 DEEPSEEK_API_KEY");
    process.exit(1);
  }
  console.log("✅ API Key 有效\n");

  // 6. 测试 1: 纯文本对话（无工具）
  console.log("=".repeat(50));
  console.log("测试 1: 纯文本对话");
  console.log("=".repeat(50));
  await runAndPrint(runner, "你好！请用一句话介绍你自己。");

  // 7. 测试 2: 工具调用 — 数学计算
  console.log("=".repeat(50));
  console.log("测试 2: 工具调用 — 数学计算");
  console.log("=".repeat(50));
  await runAndPrint(runner, "请帮我计算 (15 * 8 + 12) / 3 的结果，使用计算器工具。");

  // 8. 测试 3: 多工具调用
  console.log("=".repeat(50));
  console.log("测试 3: 多工具调用");
  console.log("=".repeat(50));
  await runAndPrint(
    runner,
    "请告诉我现在北京时间几点几分，然后计算当前小时数乘以 60 等于多少分钟。",
  );

  console.log("\n🎉 端到端测试完成！");
}

main().catch((err) => {
  console.error("测试失败:", err);
  process.exit(1);
});
