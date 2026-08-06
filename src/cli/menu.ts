import * as readline from "node:readline";
import type { ProvidersStore } from "../storage/providers-store.js";
import {
  formatBanner,
  formatMenuItem,
  prompt,
  confirm,
  menuColor,
  colorize,
} from "./io.js";

export const mainMenuChoices = ["start", "history", "settings", "view", "quit"] as const;
export const providerMenuChoices = ["list", "edit", "switch", "toggle", "delete", "back"] as const;

export type MainMenuChoice = (typeof mainMenuChoices)[number];
export type ProviderMenuChoice = (typeof providerMenuChoices)[number];

// ============================================================================
// 主菜单
// ============================================================================

export function renderMainMenu(store: ProvidersStore): string {
  const active = store.getActiveProvider();
  const lines = [
    "",
    formatBanner("🤖 My Agent — 主菜单"),
    "",
    active
      ? `   当前: ${colorize(active.id, 33)} (${active.name})${active.apiKey ? "" : colorize("  ⚠️  Key 为空", 31)}`
      : `   ${colorize("⚠️  没有可用 provider，请进入设置", 31)}`,
    "",
    formatMenuItem(1, "开始对话"),
    formatMenuItem(2, "加载历史对话"),
    formatMenuItem(3, "设置模型提供商"),
    formatMenuItem(4, "查看当前提供商"),
    formatMenuItem(5, "退出"),
    "",
  ];
  return lines.join("\n");
}

export async function runMainMenu(
  rl: readline.Interface,
  store: ProvidersStore,
): Promise<MainMenuChoice> {
  for (;;) {
    console.log(renderMainMenu(store));
    const ans = await prompt(rl, "请选择 (1-5): ");
    switch (ans) {
      case "1":
        return "start";
      case "2":
        return "history";
      case "3":
        return "settings";
      case "4":
        return "view";
      case "5":
        return "quit";
      default:
        console.log(colorize("  无效输入，请输入 1-5", 31));
    }
  }
}

// ============================================================================
// 查看当前
// ============================================================================

export function showCurrentProvider(store: ProvidersStore): void {
  const p = store.getActiveProvider();
  console.log("");
  if (!p) {
    console.log(colorize("  当前没有可用 provider", 31));
    console.log("  进入「设置」菜单新建一个");
    console.log("");
    return;
  }
  const masked = p.apiKey ? `***${p.apiKey.slice(-3)}` : "(空)";
  console.log("  ┌─────────────────────────────────────┐");
  console.log(`  │ ID:        ${p.id.padEnd(28)}│`);
  console.log(`  │ 名称:      ${p.name.padEnd(28)}│`);
  console.log(`  │ 类型:      ${p.type.padEnd(28)}│`);
  console.log(`  │ API Key:   ${masked.padEnd(28)}│`);
  console.log(`  │ Base URL:  ${p.baseUrl.padEnd(28)}│`);
  console.log(`  │ 默认模型:  ${p.defaultModel.padEnd(24)}│`);
  console.log(`  │ 状态:      ${(p.enabled ? "启用" : "禁用").padEnd(28)}│`);
  console.log("  └─────────────────────────────────────┘");
  console.log("");
}
