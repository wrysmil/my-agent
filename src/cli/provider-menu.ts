import * as readline from "node:readline";
import type { ProvidersStore, ProviderConfigEntry } from "../storage/providers-store.js";
import {
  formatBanner,
  formatMenuItem,
  prompt,
  confirm,
  colorize,
  menuColor,
} from "./io.js";
import type { ProviderMenuChoice } from "./menu.js";

// ============================================================================
// 渲染
// ============================================================================

export function renderProviderMenu(store: ProvidersStore): string {
  const active = store.getActiveProvider();
  const lines = [
    "",
    formatBanner("⚙️  模型提供商设置"),
    "",
    active
      ? `   当前: ${active.id} (${active.name}) [${active.enabled ? "启用" : "禁用"}]`
      : `   ${colorize("⚠️  没有可用 provider", 31)}`,
    "",
    formatMenuItem(1, "列出所有提供商"),
    formatMenuItem(2, "修改当前提供商"),
    formatMenuItem(3, "切换当前提供商"),
    formatMenuItem(4, "启用 / 禁用"),
    formatMenuItem(5, "删除提供商"),
    formatMenuItem(6, "返回上级"),
    "",
  ];
  return lines.join("\n");
}

export async function runProviderMenu(
  rl: readline.Interface,
  store: ProvidersStore,
): Promise<ProviderMenuChoice | "exit"> {
  for (;;) {
    console.log(renderProviderMenu(store));
    const ans = await prompt(rl, "请选择 (1-6): ");
    switch (ans) {
      case "1":
        listProviders(store);
        continue;
      case "2":
        await editCurrentProvider(rl, store);
        await store.save();
        continue;
      case "3":
        await switchActiveProvider(rl, store);
        await store.save();
        continue;
      case "4":
        await toggleEnabled(rl, store);
        await store.save();
        continue;
      case "5":
        await deleteProvider(rl, store);
        await store.save();
        continue;
      case "6":
        return "back";
      default:
        console.log(colorize("  无效输入，请输入 1-6", 31));
    }
  }
}

// ============================================================================
// 子动作
// ============================================================================

function listProviders(store: ProvidersStore): void {
  const cfg = store.getConfig();
  const ids = Object.keys(cfg.providers);
  console.log("");
  if (ids.length === 0) {
    console.log(colorize("  还没有任何 provider", 33));
    console.log("");
    return;
  }
  for (const id of ids) {
    const p = cfg.providers[id];
    const marker = id === cfg.activeProviderId ? "★" : " ";
    const status = p.enabled ? "启用" : "禁用";
    console.log(`  ${marker} ${id}  (${p.name})  [${status}]`);
  }
  console.log("");
}

async function editCurrentProvider(rl: readline.Interface, store: ProvidersStore): Promise<void> {
  const active = store.getActiveProvider();
  if (!active) {
    console.log(colorize("  当前没有可用 provider（已自动创建一个新的 deepseek）", 33));
    const newP = defaultDeepSeek();
    store.upsertProvider(newP);
    store.setActiveProvider(newP.id);
    return editProvider(rl, store, newP.id);
  }
  await editProvider(rl, store, active.id);
}

async function editProvider(rl: readline.Interface, store: ProvidersStore, id: string): Promise<void> {
  const cur = store.getConfig().providers[id];
  if (!cur) return;
  console.log("");
  console.log(`  ── 修改 ${id} ──`);
  console.log("");
  const name = (await prompt(rl, `  显示名称 [${cur.name}]: `)) || cur.name;
  const keyMask = cur.apiKey ? `***${cur.apiKey.slice(-3)}` : "(空)";
  const apiKey = await prompt(rl, `  API Key [${keyMask}]: `);
  const baseUrl = (await prompt(rl, `  Base URL [${cur.baseUrl}]: `)) || cur.baseUrl;
  if (!isValidBaseUrl(baseUrl)) {
    console.log(colorize("  ❌ 无效的 URL，应形如 https://.../v1", 31));
    return;
  }
  const defaultModel = (await prompt(rl, `  默认模型 [${cur.defaultModel}]: `)) || cur.defaultModel;
  const enabledAns = await prompt(rl, `  启用 (y/n) [${cur.enabled ? "y" : "n"}]: `);
  const enabled = enabledAns === "" ? cur.enabled : /^[yY]/.test(enabledAns);

  store.upsertProvider({
    id: cur.id,
    name,
    type: "deepseek",
    apiKey: apiKey === "" ? cur.apiKey : apiKey,
    baseUrl,
    defaultModel,
    enabled,
  });
  console.log(colorize("  ✅ 已保存", 32));
  console.log("");
}

async function switchActiveProvider(rl: readline.Interface, store: ProvidersStore): Promise<void> {
  const ids = Object.keys(store.getConfig().providers);
  if (ids.length === 0) {
    console.log(colorize("  还没有任何 provider", 33));
    return;
  }
  console.log("");
  console.log("  可选 provider:");
  for (let i = 0; i < ids.length; i++) {
    const p = store.getConfig().providers[ids[i]];
    console.log(`    ${colorize("•", menuColor(i + 1))} ${i + 1}. ${ids[i]} (${p.name})`);
  }
  console.log("");
  const ans = await prompt(rl, "  选择: ");
  const idx = parseInt(ans, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > ids.length) {
    console.log(colorize("  无效选择", 31));
    return;
  }
  const newActive = ids[idx - 1];
  store.setActiveProvider(newActive);
  console.log(colorize(`  ✅ 已切换到 ${newActive}`, 32));
}

async function toggleEnabled(rl: readline.Interface, store: ProvidersStore): Promise<void> {
  const ids = Object.keys(store.getConfig().providers);
  if (ids.length === 0) {
    console.log(colorize("  还没有任何 provider", 33));
    return;
  }
  console.log("");
  for (let i = 0; i < ids.length; i++) {
    const p = store.getConfig().providers[ids[i]];
    console.log(`    ${i + 1}. ${ids[i]}  [${p.enabled ? "启用" : "禁用"}]`);
  }
  console.log("");
  const ans = await prompt(rl, "  切换哪个: ");
  const idx = parseInt(ans, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > ids.length) {
    console.log(colorize("  无效选择", 31));
    return;
  }
  const id = ids[idx - 1];
  const p = store.getConfig().providers[id];
  store.upsertProvider({ ...p, enabled: !p.enabled });
  console.log(colorize(`  ✅ ${id} 现在 ${p.enabled ? "禁用" : "启用"}`, 32));
}

async function deleteProvider(rl: readline.Interface, store: ProvidersStore): Promise<void> {
  const ids = Object.keys(store.getConfig().providers);
  if (ids.length === 0) {
    console.log(colorize("  还没有任何 provider", 33));
    return;
  }
  console.log("");
  for (let i = 0; i < ids.length; i++) {
    console.log(`    ${i + 1}. ${ids[i]}`);
  }
  console.log("");
  const ans = await prompt(rl, "  删除哪个: ");
  const idx = parseInt(ans, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > ids.length) {
    console.log(colorize("  无效选择", 31));
    return;
  }
  const id = ids[idx - 1];
  const ok = await confirm(rl, `  确认删除 "${id}"?`, false);
  if (!ok) return;
  store.removeProvider(id);
  console.log(colorize(`  ✅ 已删除 ${id}`, 32));
}

// ============================================================================
// 工具
// ============================================================================

function isValidBaseUrl(s: string): boolean {
  if (!s.startsWith("http://") && !s.startsWith("https://")) return false;
  if (s.endsWith("/")) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function defaultDeepSeek(): ProviderConfigEntry {
  return {
    id: "deepseek",
    name: "DeepSeek",
    type: "deepseek",
    apiKey: "",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    enabled: true,
  };
}
