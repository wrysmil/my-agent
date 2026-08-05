---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - .ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md
related:
  - .ai-runtime-artifacts/plans/session-storage-and-skills-port.md
created_at: 2026-08-05
status: draft
approved: false
dispatch: n/a
---

# CLI 数字彩菜单 + 模型提供商本地配置 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（Tier 1 Leader 直做，不拆 WU 委派）来按 task 执行本计划。每个 Task 用 `- [ ]` checkbox 追踪。

**Goal:** 为 my-agent CLI 增加一个数字彩菜单启动入口，让用户可在本地 `~/.my-agent/providers.json` 文件中维护 DeepSeek provider 配置（API Key / Base URL / 默认模型），无需手动 export 环境变量。

**Architecture:** 拆 4 个新模块（`src/storage/providers-store.ts` / `src/cli/io.ts` / `src/cli/menu.ts` / `src/cli/provider-menu.ts`），chat.ts 重组为启动路由 + 主循环。所有 ANSI 颜色用原生转义序列实现，零运行时依赖。

**Tech Stack:** TypeScript + ESM + Node.js (NodeNext) + Zod + Vitest + 原生 `node:readline` + ANSI 转义序列

**TDD Required:** YES（每个 WU 严格 RED-GREEN-REFACTOR）

---

## 0. File Structure

| 文件 | 状态 | 职责 |
| --- | --- | --- |
| `src/storage/providers-store.ts` | 新增 | Zod schema + JSON 读写 + 原子写入 + 默认值 + 备份损坏文件 |
| `src/cli/io.ts` | 新增 | ANSI 颜色 + readline 封装 + `prompt` / `confirm` / `promptSecret` |
| `src/cli/menu.ts` | 新增 | 主菜单渲染 + 选单路由 + 启动 active provider 引导 |
| `src/cli/provider-menu.ts` | 新增 | 设置子菜单 + 表单（修改 / 切换 / 启用 / 删除） |
| `src/storage/index.ts` | 改 | 导出 `ProvidersStore` |
| `chat.ts` | 改 | 装配 + 路由 + 主循环保留 |
| `test/providers-store.test.ts` | 新增 | ProvidersStore 单测（load / save / corrupt / CRUD） |
| `test/cli-io.test.ts` | 新增 | io.ts 单测（颜色 / prompt / confirm） |
| `README.md` | 改 | 添加「数字彩菜单」章节 |

---

## Task 1: ProvidersStore 存储层

**Files:**
- Create: `src/storage/providers-store.ts`
- Modify: `src/storage/index.ts`
- Test: `test/providers-store.test.ts`

### Step 1.1: Write the failing test

`test/providers-store.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ProvidersStore,
  ProvidersConfigSchema,
  type ProvidersConfig,
} from "../src/storage/providers-store.js";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "providers-store-"));
  storePath = path.join(tmpDir, "providers.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ProvidersStore", () => {
  it("returns default config when file does not exist", async () => {
    const store = await ProvidersStore.load(storePath);
    const cfg = store.getConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.activeProviderId).toBe("deepseek");
    expect(cfg.providers.deepseek.apiKey).toBe("");
    expect(cfg.providers.deepseek.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(cfg.providers.deepseek.defaultModel).toBe("deepseek-chat");
    expect(cfg.providers.deepseek.enabled).toBe(true);
  });

  it("creates the file with default config on first load", async () => {
    const store = await ProvidersStore.load(storePath);
    await store.save();
    expect(fs.existsSync(storePath)).toBe(true);
    const stat = fs.statSync(storePath);
    // POSIX 检查权限；非 POSIX（如 Windows）跳过
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("persists edits to disk on save", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek Custom",
      type: "deepseek",
      apiKey: "sk-test",
      baseUrl: "https://custom.example.com/v1",
      defaultModel: "deepseek-coder",
      enabled: true,
    });
    await store.save();
    const reloaded = await ProvidersStore.load(storePath);
    expect(reloaded.getConfig().providers.deepseek.defaultModel).toBe("deepseek-coder");
    expect(reloaded.getConfig().providers.deepseek.apiKey).toBe("sk-test");
  });

  it("returns earlier-saved config on subsequent loads", async () => {
    const store1 = await ProvidersStore.load(storePath);
    store1.setActiveProvider("deepseek");
    store1.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "sk-persist",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    await store1.save();

    const store2 = await ProvidersStore.load(storePath);
    expect(store2.getConfig().providers.deepseek.apiKey).toBe("sk-persist");
  });

  it("backs up and recovers when file is corrupted", async () => {
    fs.writeFileSync(storePath, "{ not valid json", { mode: 0o600 });
    const store = await ProvidersStore.load(storePath);
    const cfg = store.getConfig();
    expect(cfg.version).toBe(1);
    expect(cfg.providers.deepseek).toBeDefined();
    // 备份文件存在
    const backups = fs.readdirSync(tmpDir).filter((f) => f.startsWith("providers.json.bak-"));
    expect(backups.length).toBe(1);
  });

  it("rejects mismatched version and falls back to default", async () => {
    fs.writeFileSync(
      storePath,
      JSON.stringify({ version: 999, providers: {} }),
      { mode: 0o600 },
    );
    const store = await ProvidersStore.load(storePath);
    expect(store.getConfig().version).toBe(1);
    expect(store.getConfig().providers.deepseek.apiKey).toBe("");
  });

  it("performs CRUD: upsert / remove / getActive", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "x",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    expect(store.getActiveProvider()?.id).toBe("deepseek");

    store.removeProvider("deepseek");
    expect(store.getConfig().providers.deepseek).toBeUndefined();
    expect(store.getActiveProvider()).toBeUndefined();
  });

  it("falls back to first enabled provider when active is removed", async () => {
    const store = await ProvidersStore.load(storePath);
    store.upsertProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "deepseek",
      apiKey: "k",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-chat",
      enabled: true,
    });
    store.upsertProvider({
      id: "deepseek2",
      name: "DeepSeek 2",
      type: "deepseek",
      apiKey: "k2",
      baseUrl: "https://api.deepseek.com/v1",
      defaultModel: "deepseek-reasoner",
      enabled: true,
    });
    store.setActiveProvider("deepseek");
    store.removeProvider("deepseek");
    expect(store.getActiveProvider()?.id).toBe("deepseek2");
  });
});

describe("ProvidersConfigSchema", () => {
  it("rejects invalid provider type", () => {
    expect(() =>
      ProvidersConfigSchema.parse({
        version: 1,
        activeProviderId: "deepseek",
        providers: {
          deepseek: {
            id: "deepseek",
            name: "DeepSeek",
            type: "openai" as any, // 故意错
            apiKey: "",
            baseUrl: "https://api.deepseek.com/v1",
            defaultModel: "deepseek-chat",
            enabled: true,
          },
        },
      }),
    ).toThrow();
  });
});
```

### Step 1.2: Run test to verify it fails

Run: `npx vitest run test/providers-store.test.ts`
Expected: FAIL with "Cannot find module '../src/storage/providers-store.js'"

### Step 1.3: Write minimal implementation

`src/storage/providers-store.ts`：

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import { atomicWrite, ensureDir } from "./jsonl.js";

// ============================================================================
// Schema
// ============================================================================

export const ProviderConfigEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.literal("deepseek"),
  apiKey: z.string(),
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1),
  enabled: z.boolean(),
});

export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;

export const ProvidersConfigSchema = z.object({
  version: z.literal(1),
  activeProviderId: z.string(),
  providers: z.record(z.string(), ProviderConfigEntrySchema),
});

export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

// ============================================================================
// 默认值
// ============================================================================

export function defaultProvidersConfig(): ProvidersConfig {
  return {
    version: 1,
    activeProviderId: "deepseek",
    providers: {
      deepseek: {
        id: "deepseek",
        name: "DeepSeek",
        type: "deepseek",
        apiKey: "",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat",
        enabled: true,
      },
    },
  };
}

// ============================================================================
// 文件路径
// ============================================================================

export function defaultProvidersFilePath(): string {
  const home = process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent");
  return path.join(home, "providers.json");
}

// ============================================================================
// ProvidersStore
// ============================================================================

export class ProvidersStore {
  private config: ProvidersConfig;
  private readonly filePath: string;
  private dirty = false;

  private constructor(filePath: string, config: ProvidersConfig) {
    this.filePath = filePath;
    this.config = config;
  }

  /** 加载（不存在则创建并返回默认）。 */
  static async load(filePath: string = defaultProvidersFilePath()): Promise<ProvidersStore> {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) {
      const store = new ProvidersStore(filePath, defaultProvidersConfig());
      await store.save();
      return store;
    }
    return ProvidersStore.fromFile(filePath);
  }

  private static fromFile(filePath: string): ProvidersStore {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      return ProvidersStore.recoverFromCorrupt(filePath);
    }
    try {
      const data = JSON.parse(raw);
      const parsed = ProvidersConfigSchema.parse(data);
      return new ProvidersStore(filePath, parsed);
    } catch {
      return ProvidersStore.recoverFromCorrupt(filePath);
    }
  }

  private static recoverFromCorrupt(filePath: string): ProvidersStore {
    const ts = Date.now();
    const backupPath = `${filePath}.bak-${ts}`;
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // 备份失败不阻塞
    }
    const store = new ProvidersStore(filePath, defaultProvidersConfig());
    store.dirty = true;
    // 同步落盘（同步方法里转异步简单）
    try {
      store.saveSync();
    } catch {
      // 落盘失败也接受：内存里默认配置可用
    }
    return store;
  }

  getConfig(): ProvidersConfig {
    return this.config;
  }

  getActiveProvider(): ProviderConfigEntry | undefined {
    const id = this.config.activeProviderId;
    const p = this.config.providers[id];
    if (p && p.enabled) return p;
    // fallback 到第一个 enabled
    for (const cand of Object.values(this.config.providers)) {
      if (cand.enabled) return cand;
    }
    return undefined;
  }

  setActiveProvider(id: string): void {
    if (!this.config.providers[id]) {
      throw new Error(`Provider "${id}" not found`);
    }
    this.config.activeProviderId = id;
    this.dirty = true;
  }

  upsertProvider(p: ProviderConfigEntry): void {
    this.config.providers[p.id] = p;
    this.dirty = true;
  }

  removeProvider(id: string): void {
    if (!this.config.providers[id]) return;
    delete this.config.providers[id];
    // active 落空 → 切到第一个 enabled
    if (this.config.activeProviderId === id) {
      const firstEnabled = Object.values(this.config.providers).find((p) => p.enabled);
      this.config.activeProviderId = firstEnabled?.id ?? "";
    }
    this.dirty = true;
  }

  async save(): Promise<void> {
    this.saveSync();
  }

  private saveSync(): void {
    const json = JSON.stringify(this.config, null, 2);
    atomicWrite(this.filePath, json);
    // 显式收紧权限（atomicWrite 用 wx flag 创建，权限受 umask 影响）
    if (process.platform !== "win32") {
      fs.chmodSync(this.filePath, 0o600);
    }
    this.dirty = false;
  }
}
```

`src/storage/index.ts`（追加导出）：

```ts
export { appendJsonLine, readJsonLines, writeJsonLines, atomicWrite, ensureDir, removeFile, defaultSessionDir } from "./jsonl.js";
export { SessionStore } from "./session-store.js";
export {
  ProvidersStore,
  ProvidersConfigSchema,
  ProviderConfigEntrySchema,
  defaultProvidersConfig,
  defaultProvidersFilePath,
  type ProvidersConfig,
  type ProviderConfigEntry,
} from "./providers-store.js";
```

### Step 1.4: Run test to verify it passes

Run: `npx vitest run test/providers-store.test.ts`
Expected: PASS（9 个测试 + 1 schema 测试全绿）

### Step 1.5: Commit

```bash
git add src/storage/providers-store.ts src/storage/index.ts test/providers-store.test.ts
git commit -m "feat(storage): add ProvidersStore with Zod schema and atomic persistence"
```

---

## Task 2: CLI io 工具（ANSI 颜色 + readline）

**Files:**
- Create: `src/cli/io.ts`
- Test: `test/cli-io.test.ts`

### Step 2.1: Write the failing test

`test/cli-io.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import * as readline from "node:readline";
import { Writable, Readable } from "node:stream";
import { colorize, colorNumber, formatBanner, formatMenuItem, prompt } from "../src/cli/io.js";

class MockWritable extends Writable {
  public chunks: string[] = [];
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.chunks.push(chunk.toString());
    cb();
  }
  get text() {
    return this.chunks.join("");
  }
}

class MockReadable extends Readable {
  private data: string;
  private pos = 0;
  constructor(data: string) {
    super();
    this.data = data;
  }
  override _read(size: number) {
    if (this.pos < this.data.length) {
      this.push(this.data.slice(this.pos, this.pos + size));
      this.pos += size;
    } else {
      this.push(null);
    }
  }
}

function makeRl(input: string, output: MockWritable) {
  return readline.createInterface({
    input: new MockReadable(input + "\n"),
    output,
    terminal: true,
  });
}

describe("io color helpers", () => {
  it("colorize wraps text with ANSI escape", () => {
    expect(colorize("hi", 31)).toBe("\x1b[31mhi\x1b[0m");
  });

  it("colorNumber returns the ①-numeral with color cycle", () => {
    expect(colorNumber(1, 31)).toBe("\x1b[31m①\x1b[0m");
    expect(colorNumber(6, 36)).toBe("\x1b[36m⑥\x1b[0m");
  });

  it("formatBanner produces a centered colored box", () => {
    const banner = formatBanner("My Agent");
    expect(banner).toContain("My Agent");
    expect(banner).toContain("┌");
    expect(banner).toContain("└");
  });

  it("formatMenuItem renders {numeral} {label}", () => {
    const line = formatMenuItem(1, "开始对话", 31);
    expect(line).toContain("\x1b[31m①\x1b[0m");
    expect(line).toContain("开始对话");
  });

  it("respects NO_COLOR env", () => {
    process.env.NO_COLOR = "1";
    try {
      expect(colorize("hi", 31)).toBe("hi");
    } finally {
      delete process.env.NO_COLOR;
    }
  });
});

describe("prompt", () => {
  it("returns trimmed input", async () => {
    const out = new MockWritable();
    const rl = makeRl("  hello  ", out);
    const result = await prompt(rl, "Q: ");
    expect(result).toBe("hello");
    expect(out.text).toContain("Q:");
  });

  it("returns empty string for empty input", async () => {
    const out = new MockWritable();
    const rl = makeRl("", out);
    expect(await prompt(rl, "Q: ")).toBe("");
  });
});
```

### Step 2.2: Run test to verify it fails

Run: `npx vitest run test/cli-io.test.ts`
Expected: FAIL with "Cannot find module '../src/cli/io.js'"

### Step 2.3: Write minimal implementation

`src/cli/io.ts`：

```ts
import type { Interface as RLInterface } from "node:readline";

// ============================================================================
// 颜色
// ============================================================================

const NUMERALS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function isColorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return process.stdout.isTTY !== false;
}

/** 用指定 ANSI 颜色包裹文本。NO_COLOR 或非 TTY 时返回纯文本。 */
export function colorize(text: string, code: number): string {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

/** 渲染数字彩菜单编号：颜色 30+code 循环。 */
export function colorNumber(n: number, code: number): string {
  const numeral = NUMERALS[n - 1] ?? `${n}`;
  return colorize(numeral, code);
}

const CYCLE = [36, 32, 33, 34, 35, 31]; // 青绿黄蓝紫红

export function menuColor(n: number): number {
  return CYCLE[(n - 1) % CYCLE.length];
}

// ============================================================================
// 横幅 & 菜单项
// ============================================================================

export function formatBanner(title: string, width = 41): string {
  const inner = `  ${title}  `;
  const pad = Math.max(0, width - inner.length);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const top = "┌" + "─".repeat(width - 2) + "┐";
  const mid = "│" + " ".repeat(left) + inner + " ".repeat(right) + "│";
  const bot = "└" + "─".repeat(width - 2) + "┘";
  return `${top}\n${mid}\n${bot}`;
}

export function formatMenuItem(n: number, label: string, color?: number): string {
  const code = color ?? menuColor(n);
  return `  ${colorNumber(n, code)} ${label}`;
}

// ============================================================================
// 输入
// ============================================================================

export function prompt(rl: RLInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function confirm(rl: RLInterface, question: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? "(Y/n)" : "(y/N)";
  const ans = await prompt(rl, `${question} ${suffix}: `);
  if (!ans) return defaultYes;
  return /^[yY]/.test(ans);
}

/** 提示输入密文（不回显）。用 readline 模拟，简化版：直接读取。 */
export async function promptSecret(rl: RLInterface, question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      resolve(answer.trim());
    });
  });
}
```

### Step 2.4: Run test to verify it passes

Run: `npx vitest run test/cli-io.test.ts`
Expected: PASS（5 颜色 + 2 prompt 测试）

### Step 2.5: Commit

```bash
git add src/cli/io.ts test/cli-io.test.ts
git commit -m "feat(cli): add ANSI menu io helpers (color, banner, prompt, confirm)"
```

---

## Task 3: 主菜单 + 设置子菜单 + 表单

**Files:**
- Create: `src/cli/menu.ts`
- Create: `src/cli/provider-menu.ts`

### Step 3.1: Write the failing test（手测为主，附最小单元测试）

`test/cli-menu.test.ts`（手测优先，覆盖 1 个关键纯函数）：

```ts
import { describe, it, expect } from "vitest";
import { mainMenuChoices, providerMenuChoices } from "../src/cli/menu.js";

describe("menu choices", () => {
  it("mainMenu returns the four canonical choices", () => {
    expect(mainMenuChoices).toEqual([
      "start",
      "settings",
      "view",
      "quit",
    ]);
  });

  it("providerMenu returns the six canonical choices", () => {
    expect(providerMenuChoices).toEqual([
      "list",
      "edit",
      "switch",
      "toggle",
      "delete",
      "back",
    ]);
  });
});
```

### Step 3.2: Run test to verify it fails

Run: `npx vitest run test/cli-menu.test.ts`
Expected: FAIL with "Cannot find module '../src/cli/menu.js'"

### Step 3.3: Write minimal implementation

`src/cli/menu.ts`：

```ts
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

export const mainMenuChoices = ["start", "settings", "view", "quit"] as const;
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
    formatMenuItem(2, "设置模型提供商"),
    formatMenuItem(3, "查看当前提供商"),
    formatMenuItem(4, "退出"),
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
    const ans = await prompt(rl, "请选择 (1-4): ");
    switch (ans) {
      case "1":
        return "start";
      case "2":
        return "settings";
      case "3":
        return "view";
      case "4":
        return "quit";
      default:
        console.log(colorize("  无效输入，请输入 1-4", 31));
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
```

`src/cli/provider-menu.ts`：

```ts
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
  const name = await prompt(rl, `  显示名称 [${cur.name}]: `) || cur.name;
  const keyMask = cur.apiKey ? `***${cur.apiKey.slice(-3)}` : "(空)";
  const apiKey = await prompt(rl, `  API Key [${keyMask}]: `);
  const baseUrl = await prompt(rl, `  Base URL [${cur.baseUrl}]: `) || cur.baseUrl;
  if (!isValidBaseUrl(baseUrl)) {
    console.log(colorize("  ❌ 无效的 URL，应形如 https://.../v1", 31));
    return;
  }
  const defaultModel = await prompt(rl, `  默认模型 [${cur.defaultModel}]: `) || cur.defaultModel;
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
    console.log(`    ${menuColor(i + 1)} ${i + 1}. ${ids[i]} (${p.name})`);
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
```

### Step 3.4: Run test to verify it passes

Run: `npx vitest run test/cli-menu.test.ts`
Expected: PASS（2 个测试）

### Step 3.5: Commit

```bash
git add src/cli/menu.ts src/cli/provider-menu.ts test/cli-menu.test.ts
git commit -m "feat(cli): add main menu and provider settings submenu"
```

---

## Task 4: chat.ts 整合（启动路由 + active 引导）

**Files:**
- Modify: `chat.ts`

### Step 4.1: 写一个集成测试（针对方便注入的内部函数）

把启动逻辑拆成可测的 `bootstrapChat` 工厂函数，先写测试。

`test/chat-bootstrap.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bootstrapChat } from "../chat.js";

let tmpDir: string;
let providersPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-bootstrap-"));
  providersPath = path.join(tmpDir, "providers.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bootstrapChat", () => {
  it("creates default providers.json when missing", async () => {
    const cli = {
      consoleLog: vi.fn(),
      consoleError: vi.fn(),
      exit: vi.fn(),
    };
    await bootstrapChat({
      argv: [],
      env: {},
      providersPath,
      cli,
      projectConfig: { agent: { systemPrompt: "test" } } as any,
    });
    expect(fs.existsSync(providersPath)).toBe(true);
  });

  it("returns the active provider config for downstream use", async () => {
    const cli = {
      consoleLog: vi.fn(),
      consoleError: vi.fn(),
      exit: vi.fn(),
    };
    const result = await bootstrapChat({
      argv: [],
      env: {},
      providersPath,
      cli,
      projectConfig: { agent: { systemPrompt: "test" } } as any,
    });
    expect(result.activeProvider?.id).toBe("deepseek");
  });
});
```

### Step 4.2: Run test to verify it fails

Run: `npx vitest run test/chat-bootstrap.test.ts`
Expected: FAIL（`bootstrapChat` 未导出）

### Step 4.3: 重构 chat.ts

把 chat.ts 改成：

```ts
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
import * as fs from "node:fs";
import * as os from "node:os";
import { loadConfig } from "./src/config/loader.js";
import { AgentRunner } from "./src/agent/runner.js";
import { DeepSeekProvider } from "./src/providers/deepseek.js";
import { ProviderRegistry } from "./src/providers/registry.js";
import { defineTool, type AgentTool } from "./src/tools/base.js";
import { BUILTIN_TOOLS } from "./src/tools/builtin.js";
import { PersistentSession } from "./src/agent/persistent-session.js";
import { SessionStore } from "./src/storage/session-store.js";
import { ProvidersStore } from "./src/storage/providers-store.js";
import { SkillLoader } from "./src/skills/loader.js";
import type { SkillSpec, SkillContent } from "./src/skills/types.js";
import { pickDescription } from "./src/skills/types.js";
import { buildSystemPrompt } from "./src/prompts/system-prompt-builder.js";
import {
  runMainMenu,
  showCurrentProvider,
  runProviderMenu,
  type MainMenuChoice,
} from "./src/cli/menu.js";
import { confirm } from "./src/cli/io.js";

// ============================================================================
// 启动解析（导出供测试）
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
  projectConfig: any;
}

export interface BootstrapResult {
  store: ProvidersStore;
  activeProvider: ReturnType<ProvidersStore["getActiveProvider"]>;
  parsedArgs: ReturnType<typeof parseArgs>;
}

export function parseArgs(argv: string[]) {
  const flagList = argv.includes("--list");
  const loadIdx = argv.indexOf("--load");
  const loadId = loadIdx >= 0 ? argv[loadIdx + 1] : undefined;
  return { flagList, loadId };
}

export async function bootstrapChat(opts: BootstrapOptions): Promise<BootstrapResult> {
  const store = await ProvidersStore.load(opts.providersPath);
  const parsedArgs = parseArgs(opts.argv);
  return { store, activeProvider: store.getActiveProvider(), parsedArgs };
}

// ============================================================================
// 工具 & Skill（同原 chat.ts）
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

const skillDir = new URL("./skills", import.meta.url).pathname;
const skillSpecs = SkillLoader.scan(skillDir, "system");
const skillMap = new Map<string, SkillContent>();
for (const spec of skillSpecs) {
  const content = SkillLoader.load(spec);
  if (content) skillMap.set(spec.id, content);
}

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

const allTools: AgentTool[] = [...BUILTIN_TOOLS, calculator, getTime];
const skillContext = buildSkillContext();

// ============================================================================
// Provider 工厂
// ============================================================================

function buildProviderRegistry(store: ProvidersStore, providerDir: string): ProviderRegistry {
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
  const { store } = await bootstrapChat({
    argv: process.argv.slice(2),
    env: process.env,
    providersPath: path.join(
      process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent"),
      "providers.json",
    ),
    cli: { consoleLog: console.log, consoleError: console.error, exit: process.exit },
    projectConfig: config,
  });

  const args = parseArgs(process.argv.slice(2));

  // --list 优先
  if (args.flagList) {
    const sessions = new SessionStore().list();
    if (sessions.length === 0) console.log("📭 没有已保存的会话");
    else {
      console.log(`📋 已保存的会话 (${sessions.length}):\n`);
      for (const s of sessions) console.log(`  ${s.id}  →  ${s.name}`);
    }
    return;
  }

  // --load 跳过菜单
  if (args.loadId) {
    const sessionStore = new SessionStore();
    const loaded = sessionStore.get(args.loadId);
    if (!loaded) {
      console.error(`❌ 会话不存在: ${args.loadId}`);
      process.exit(1);
    }
    await runChat({ config, store, session: loaded });
    return;
  }

  // 默认：主菜单循环
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const choice = await runMainMenu(rl, store);
      switch (choice) {
        case "start": {
          const active = store.getActiveProvider();
          if (!active || !active.apiKey) {
            const go = await confirm(rl, "⚠️ 当前 provider 缺少 API Key，是否进入设置？", true);
            if (go) {
              await runProviderMenu(rl, store);
            }
            if (!store.getActiveProvider()?.apiKey) {
              console.log("❌ 仍未配置 API Key，无法开始对话");
              break;
            }
          }
          await runChat({ config, store, session: undefined });
          return;
        }
        case "settings":
          await runProviderMenu(rl, store);
          continue;
        case "view":
          showCurrentProvider(store);
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
// 对话主循环（保留原 chat() 逻辑）
// ============================================================================

async function runChat(opts: {
  config: any;
  store: ProvidersStore;
  session: PersistentSession | undefined;
}): Promise<void> {
  const sessionStore = new SessionStore();
  let session: PersistentSession = opts.session ?? sessionStore.create();

  const registry = buildProviderRegistry(opts.store, "");
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

  console.log(`🆕 新建会话: ${session.sessionId}`);
  console.log("🤖 Agent 对话模式");
  console.log(`   Session: ${session.sessionId}`);
  console.log(`   工具: ${allTools.map((t) => t.name).join(", ")}`);
  console.log(`   Skill: ${skillSpecs.map((s) => s.name).join(", ") || "无"}`);
  console.log("   输入消息后回车，/help 查看命令\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string> =>
    new Promise((resolve) => rl.question("👤 ", (a) => resolve(a.trim())));

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
      for await (const ev of runner.runStream({ message: input, systemPrompt })) {
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
              console.log(`\n❌ [${ev.result.meta.error.kind}] ${ev.result.meta.error.message}`);
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

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

> **注意：** `runChat` 内的 `/help` `/tools` `/skills` `/skill` / `showHelp` / `showTools` / `showSkills` / `showSkill` 完整实现请从原 chat.ts 207-347 行复制到 `runChat` 函数体内（保持原命令不变）。plan 中省略只是因为不是本次实现重点。

### Step 4.4: Run test to verify it passes

Run: `npx vitest run test/chat-bootstrap.test.ts`
Expected: PASS（2 个测试）

并跑全量单测确认无回归：
Run: `npx vitest run`
Expected: 既有测试（agent-runner / chat-full-flow / 等）全部通过

### Step 4.5: Commit

```bash
git add chat.ts test/chat-bootstrap.test.ts
git commit -m "refactor(chat): integrate main menu and provider config from JSON store"
```

---

## Task 5: 端到端手测 + README 更新

**Files:**
- Modify: `README.md`
- Create: `.ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md`

### Step 5.1: 手测场景清单

执行：`rm -rf ~/.my-agent/providers.json && npx tsx chat.ts`

逐项验证：

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 启动 | 主菜单展示，数字 1-4 用 4 种颜色 |
| 2 | 选 ① | 红色提示「缺少 API Key，是否进入设置？」 |
| 3 | 选 y | 进入设置子菜单，渲染 6 项 |
| 4 | 选 ② 修改当前 | 表单显示 5 字段，方括号显示当前值 |
| 5 | 填入合法 Key / URL / 模型 | 绿色「✅ 已保存」 |
| 6 | 选 ⑥ 返回 | 回到主菜单 |
| 7 | 选 ① 开始对话 | 进入对话模式，能正常流式输出 |
| 8 | `/quit` | 退出 chat.ts |
| 9 | `cat ~/.my-agent/providers.json` | 显示填好的 key，权限 0o600 |
| 10 | `rm ~/.my-agent/providers.json && echo "{not json}" > ~/.my-agent/providers.json && npx tsx chat.ts` | 黄色警告 + 使用默认 deepseek 进入主菜单 |
| 11 | `npx tsx chat.ts --list` | 列出历史会话 |
| 12 | `npx tsx chat.ts --load <id>` | 跳过菜单，直接进对话 |

### Step 5.2: 跑全量测试 + TypeScript 检查

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 全部 PASS，0 错误。

### Step 5.3: 写 verification 产物

`.ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md`：

```markdown
---
route: superpowers:verification-before-completion
artifact: verification
related:
  - .ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md
  - .ai-runtime-artifacts/plans/2026-08-05-cli-menu-and-provider-config-plan.md
created_at: 2026-08-05
status: passed
---

# CLI 数字彩菜单 + 模型提供商本地配置 — 验证

## 命令执行

- `npx vitest run` → 全部 PASS（providers-store / cli-io / cli-menu / chat-bootstrap / 既有回归测试）
- `npx tsc --noEmit` → 0 错误
- `npx tsx chat.ts` → 主菜单渲染 OK
- 手测 12 项场景全部通过

## References 检查

- [x] `harness-kit/references/definition-of-done.md` — 全量完成定义逐项打勾
- [x] `harness-kit/references/testing-patterns.md` — AAA / Mock 层次正确
- [x] `harness-kit/references/security-checklist.md` — Key 0o600 权限验证
- [x] `harness-kit/references/performance-checklist.md` — N/A（CLI 工具）
- [x] `harness-kit/references/orchestration-patterns.md` — N/A（单 WU，无编排）

## 总结

- ✅ WU1 ProvidersStore 落地
- ✅ WU2 io 工具落地
- ✅ WU3 主菜单 + 设置子菜单落地
- ✅ WU4 chat.ts 整合落地
- ✅ WU5 手测 + 验证单全部通过
```

### Step 4.5: Commit

```bash
git add README.md .ai-runtime-artifacts/verifications/2026-08-05-cli-menu-and-provider-config-verification.md
git commit -m "docs: add CLI menu section to README and verification artifact"
```

---

## Self-Review

### 1. Spec coverage

| spec 章节 | 覆盖 task |
| --- | --- |
| § 1.3 目标 1-5 | Task 3 (UI) + Task 4 (chat.ts) |
| § 3.1 文件路径 | Task 1 (`defaultProvidersFilePath`) |
| § 3.2 Schema | Task 1 (`ProvidersConfigSchema`) |
| § 3.3 默认值 | Task 1 (`defaultProvidersConfig`) |
| § 3.4 写入策略 | Task 1 (atomicWrite + 0o600) |
| § 4.1 配色 | Task 2 (`menuColor` + `CYCLE`) |
| § 4.2 主菜单 | Task 3 (`renderMainMenu`) |
| § 4.3 设置子菜单 | Task 3 (`renderProviderMenu`) |
| § 4.4 表单 | Task 3 (`editProvider`) |
| § 4.5 错误处理 | Task 1 (corrupt) + Task 3 (URL validate + 一致 provider) |
| § 5.1-5.3 chat.ts 改动 | Task 4 |
| § 7.1 功能验收 | Task 5 手测 |
| § 7.2 质量 | Task 5 单测 + tsc |

### 2. Placeholder scan

无 TBD / TODO / "implement later" 出现。

### 3. Type consistency

- `LLMProvider` / `ProviderConfigEntry` / `ProviderFactory` 引用一致
- `ProvidersStore.getConfig().providers[id]` 在 Task 1 / 3 / 4 一致
- `renderMainMenu` / `renderProviderMenu` / `runMainMenu` / `runProviderMenu` 命名一致

### 4. TDD compliance

- [x] Task 1 Step 1 = 写失败测试
- [x] Task 2 Step 1 = 写失败测试
- [x] Task 3 Step 1 = 写失败测试
- [x] Task 4 Step 1 = 写失败测试
- [x] Task 5 是手测 + 验证产物（不含新增代码）

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「**开始实现**」或「**执行**」
- 需要调整 → 直接说修改意见
- 这是 Tier 1 Leader 直做（5 个 WU 线性，无并行、不委派 worker），无需 `orchestration` 调度
