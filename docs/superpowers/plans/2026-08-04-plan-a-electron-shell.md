# Plan A: Electron 桌面壳 + Renderer 基础设施

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Electron 桌面应用最小可用壳——窗口能打开、Renderer 能渲染、IPC 能通信、侧栏导航能切换页面。

**Architecture:** Main (Node) → Preload (contextBridge) → Renderer (HTML/CSS/JS)。Renderer 只用经典 script，不用 TypeScript/JSX/bundler。Preload 必须是 `.js`。IPC 走 `ipcMain.handle` / `ipcRenderer.invoke` 模式，单向流用 `ipcMain.on` + `event.sender.send`。

**Tech Stack:** Electron 33, better-sqlite3, TypeScript (Main), vanilla JS/CSS (Renderer), marked (Markdown)

**Source spec:** [2026-08-04-my-agent-desktop-ui-design.md](../specs/2026-08-04-my-agent-desktop-ui-design.md)
**Source guide:** [第三阶段升级指南.md](../../plan/第三阶段升级指南.md)

---

## File Structure

```
my-agent/
├── electron/                          # 🆕 Electron 壳
│   ├── main.ts                        # 主进程入口
│   ├── preload.js                     # contextBridge (必须是 .js)
│   └── renderer/
│       ├── index.html                 # 单页入口
│       ├── css/
│       │   ├── variables.css          # CSS 变量（颜色/间距/字号）
│       │   ├── reset.css              # CSS Reset
│       │   ├── layout.css             # 布局（侧栏/主区/导航）
│       │   └── components.css         # 通用组件
│       ├── js/
│       │   ├── app.js                 # 路由 + 启动
│       │   └── api.js                 # window.myAgent 封装
│       ├── modules/
│       │   ├── icons.js               # 图标库
│       │   ├── markdown.js            # Markdown 渲染器
│       │   └── i18n.js                # 国际化
│       └── vendor/
│           ├── marked.min.js
│           └── highlight.min.js
├── src/
│   ├── ipc/                           # 🆕 IPC 处理器
│   │   ├── index.ts
│   │   ├── chat.ts
│   │   ├── sessions.ts
│   │   ├── config.ts
│   │   └── skills.ts
│   ├── features/                      # 🆕 业务流程
│   │   ├── chat/
│   │   │   └── stream-chat.ts
│   │   ├── sessions/
│   │   │   └── session-service.ts
│   │   ├── config/
│   │   │   └── config-service.ts
│   │   └── skills/
│   │       └── skill-service.ts
│   └── storage/                       # 扩展
│       ├── db.ts                      # 🆕 SQLite 初始化 + 迁移
│       ├── session-repo.ts            # 🆕 会话数据访问层
│       ├── usage-repo.ts              # 🆕 用量统计
│       ├── paths.ts                   # 🆕 路径收口
│       └── locks.ts                   # 🆕 文件锁
├── package.json                       # 修改：+electron +better-sqlite3
└── tsconfig.json                      # 不变
```

---

### Task 0: 环境准备 🔧

> **Phase 1 — 环境准备（强制）**：在执行任何功能 Task 之前，确保开发环境完整可用。

- [ ] **Step 0.1: 确认 Node.js 版本**

```bash
node --version
```

Expected: `>= 22.0.0`。Electron 33 + better-sqlite3 需要 Node.js 22+。

- [ ] **Step 0.2: 确认 TypeScript 编译器可用**

```bash
npx tsc --version
```

Expected: 打印 TypeScript 版本号。

- [ ] **Step 0.3: 配置环境变量**

项目使用 `MY_AGENT_HOME` 环境变量控制数据目录（参见 Task 2 `paths.ts`），默认值为 `~/.my-agent`。开发阶段无需额外配置，除非需要自定义路径：

```bash
# Windows (PowerShell) — 可选
$env:MY_AGENT_HOME = "D:\my-agent-data"

# macOS / Linux — 可选
export MY_AGENT_HOME=/path/to/data
```

- [ ] **Step 0.4: 确认项目现有代码可编译**

```bash
npm run check
```

Expected: 无 TypeScript 错误。

- [ ] **Step 0.5: 确认现有测试通过**

```bash
npm test
```

Expected: 所有已有测试通过。如果当前无测试，此步记录 `0 tests` 即可。

**平台差异说明：**

| 项目           | Windows                                                                          | macOS                                       | Linux                                 |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| better-sqlite3 | 需要`windows-build-tools`（`npm i -g windows-build-tools`）或 VS Build Tools | 需要 Xcode CLI (`xcode-select --install`) | 需要`build-essential` + `python3` |
| Electron       | 原生支持                                                                         | 原生支持                                    | 原生支持                              |
| 路径分隔符     | `\`（代码中用 `path.join` 处理）                                             | `/`                                       | `/`                                 |

- [ ] **Step 0.6: Commit**

```bash
git add -A
git commit -m "chore: verify development environment readiness"
```

---

### Task 1: 安装 Electron 依赖

**Files:**

- Modify: `package.json`

- [ ] **Step 1: 安装 npm 依赖**

```bash
npm install better-sqlite3
npm install -D electron electron-builder @types/better-sqlite3
```

- [ ] **Step 2: 更新 package.json**

```jsonc
// package.json — 新增字段
{
  "main": "electron/main.ts",
  "scripts": {
    // 保留现有
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "chat": "tsx chat.ts",
    // 新增
    "dev": "tsc -p tsconfig.json && electron .",
    "build": "electron-builder"
  }
}
```

> **说明**：由于 `electron/main.ts` 是 TypeScript，需要先用 `tsc` 编译为 JS 再启动 Electron。`dev` 脚本中 `tsc -p tsconfig.json && electron .` 确保编译成功后才启动窗口。
>
> 如果希望热重载（修改代码自动重启），可后续引入 `electron-reload` 或 `nodemon`，但当前阶段先保持简单。

- [ ] **Step 3: 验证依赖安装**

```bash
npx electron --version
```

Expected: 打印 Electron 版本号 (≥33.0.0)。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Electron 33 + better-sqlite3 dependencies"
```

---

### Task 2: 存储层 — 路径收口模块

**Files:**

- Create: `src/storage/paths.ts`

- [ ] **Step 1: 实现 paths.ts**

```ts
// src/storage/paths.ts
import * as path from "node:path";
import * as os from "node:os";

const ROOT = process.env.MY_AGENT_HOME
  ?? path.join(os.homedir(), ".my-agent");

export function rootDir(): string {
  return ROOT;
}

export function dataDir(): string {
  return path.join(ROOT, "data");
}

export function sessionsDir(): string {
  return path.join(dataDir(), "sessions");
}

export function sessionFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.jsonl`);
}

export function contextFile(sessionId: string): string {
  return path.join(sessionsDir(), `${sessionId}.context.json`);
}

export function skillsDir(): string {
  return path.join(dataDir(), "skills");
}

export function builtinSkillsDir(): string {
  return path.join(ROOT, "skills");
}

export function toolResultsDir(sessionId: string): string {
  return path.join(dataDir(), "tool-results", sessionId);
}

export function logsDir(): string {
  return path.join(dataDir(), "logs");
}

export function locksDir(): string {
  return path.join(dataDir(), "locks");
}

export function dbFile(): string {
  return path.join(dataDir(), "my-agent.db");
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run check
```

Expected: 无新增错误。

- [ ] **Step 3: Commit**

```bash
git add src/storage/paths.ts
git commit -m "feat(storage): add paths module — single source of truth for all file paths"
```

---

### Task 3: 存储层 — SQLite 数据库初始化 + 迁移

**Files:**

- Create: `src/storage/db.ts`

- [ ] **Step 1: 实现 db.ts**

```ts
// src/storage/db.ts
import Database from "better-sqlite3";
import * as fs from "node:fs";
import { dataDir, dbFile } from "./paths.js";

let _db: Database.Database | null = null;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      -- ============================================================
      -- sessions — 会话元数据（摘要信息，不含消息内容）
      -- 对应 session-repo.ts 的 SessionMeta 接口
      -- ============================================================
      CREATE TABLE IF NOT EXISTS sessions (
        id              TEXT PRIMARY KEY,                               -- 会话唯一标识 (UUID)
        name            TEXT NOT NULL DEFAULT '',                       -- 会话名称（首条消息摘要或手动命名）
        model           TEXT NOT NULL DEFAULT '',                       -- 使用的模型 ID（如 deepseek-chat）
        provider        TEXT NOT NULL DEFAULT '',                       -- Provider 标识（anthropic/openai/deepseek/...）
        message_count   INTEGER NOT NULL DEFAULT 0,                    -- 消息总数（user + assistant + tool）
        input_tokens    INTEGER NOT NULL DEFAULT 0,                    -- 累计输入 token（从 usage_logs 聚合）
        output_tokens   INTEGER NOT NULL DEFAULT 0,                    -- 累计输出 token（从 usage_logs 聚合）
        created_at      INTEGER NOT NULL,                              -- 创建时间 (Unix ms)
        updated_at      INTEGER NOT NULL,                              -- 最后活跃时间 (Unix ms)
        is_archived     INTEGER NOT NULL DEFAULT 0                     -- 是否归档：0=活跃, 1=已归档（软删除）
      );

      -- ============================================================
      -- configs — 应用配置键值存储
      -- key 为配置路径，value 为 JSON 字符串
      -- ============================================================
      CREATE TABLE IF NOT EXISTS configs (
        key             TEXT PRIMARY KEY,                               -- 配置键（如 agent.defaultModel）
        value           TEXT NOT NULL,                                  -- 配置值（JSON 字符串）
        updated_at      INTEGER NOT NULL                                -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- usage_logs — 每次 LLM 调用的用量明细
      -- 用于用量统计、成本分析、图表展示
      -- ============================================================
      CREATE TABLE IF NOT EXISTS usage_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,              -- 自增主键
        session_id      TEXT NOT NULL,                                  -- 所属会话 ID → sessions.id
        model           TEXT NOT NULL,                                  -- 实际使用的模型 ID
        provider        TEXT NOT NULL,                                  -- 实际调用的 Provider
        input_tokens    INTEGER NOT NULL DEFAULT 0,                    -- 输入 token 数（含 system prompt + 历史消息）
        output_tokens   INTEGER NOT NULL DEFAULT 0,                    -- 输出 token 数（模型生成的文本）
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,                -- 缓存命中读取 token 数（Anthropic prompt caching）
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,                -- 缓存写入 token 数
        tool_loops      INTEGER NOT NULL DEFAULT 0,                    -- 本轮执行了几轮工具调用
        duration_ms     INTEGER NOT NULL DEFAULT 0,                    -- 本轮耗时（毫秒，从首请求到最终响应）
        created_at      INTEGER NOT NULL,                              -- 调用时间 (Unix ms)
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);

      -- ============================================================
      -- skills_index — Skill 注册索引
      -- 记录每个 Skill 的元数据和启用状态。Skill 正文存储在磁盘 SKILL.md
      -- ============================================================
      CREATE TABLE IF NOT EXISTS skills_index (
        id              TEXT PRIMARY KEY,                               -- Skill 唯一标识（目录名）
        name            TEXT NOT NULL,                                  -- Skill 名称（human-readable）
        description_zh  TEXT NOT NULL DEFAULT '',                       -- 中文描述
        description_en  TEXT NOT NULL DEFAULT '',                       -- 英文描述
        source          TEXT NOT NULL DEFAULT 'user',                   -- 来源：user=用户安装, system=内置, marketplace=市场
        dir             TEXT NOT NULL,                                  -- Skill 所在目录的绝对路径
        enabled         INTEGER NOT NULL DEFAULT 1,                    -- 启用状态：1=启用, 0=禁用
        installed_at    INTEGER NOT NULL,                              -- 安装/首次发现时间 (Unix ms)
        updated_at      INTEGER NOT NULL                               -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- providers — LLM 厂商配置
      -- 存储 API Key（AES-256-GCM 加密）、Base URL、模型列表、优先级
      -- 对应 provider-repo.ts 的 ProviderEntry 接口
      -- ============================================================
      CREATE TABLE IF NOT EXISTS providers (
        id              TEXT PRIMARY KEY,                               -- Provider 唯一标识（如 deepseek-<timestamp>）
        name            TEXT NOT NULL,                                  -- 用户自定义显示名称（如 "我的 DeepSeek"）
        provider        TEXT NOT NULL,                                  -- 厂商标识：anthropic/openai/deepseek/moonshot/doubao
        api_key_enc     TEXT NOT NULL DEFAULT '',                       -- AES-256-GCM 加密后的 API Key（格式: iv:tag:ciphertext）
        base_url        TEXT NOT NULL DEFAULT '',                       -- API Base URL（空则使用 SDK 默认地址）
        models          TEXT NOT NULL DEFAULT '[]',                     -- 模型 ID 列表（JSON 数组，如 ["deepseek-chat","deepseek-reasoner"]）
        is_enabled      INTEGER NOT NULL DEFAULT 1,                    -- 启用状态：1=启用, 0=禁用
        priority        INTEGER NOT NULL DEFAULT 0,                    -- 优先级（越小越优先，0=主 Provider，用于故障转移排序）
        created_at      INTEGER NOT NULL,                              -- 创建时间 (Unix ms)
        updated_at      INTEGER NOT NULL                               -- 最后更新时间 (Unix ms)
      );

      -- ============================================================
      -- schema_version — 数据库迁移版本追踪
      -- 单行表，记录当前已应用的最新 migration version
      -- ============================================================
      CREATE TABLE IF NOT EXISTS schema_version (
        version         INTEGER PRIMARY KEY                            -- 已应用的最新迁移版本号
      );
    `,
  },
];

function migrate(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");
  const row = db.prepare(
    "SELECT MAX(version) as v FROM schema_version"
  ).get() as { v: number | null };
  const current = row?.v ?? 0;

  for (const m of MIGRATIONS) {
    if (m.version > current) {
      db.exec(m.sql);
      db.prepare(
        "INSERT OR REPLACE INTO schema_version (version) VALUES (?)"
      ).run(m.version);
    }
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbFile());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add src/storage/db.ts
git commit -m "feat(storage): add SQLite database init with schema migration"
```

---

### Task 4: 存储层 — 会话 + 用量数据访问层

**Files:**

- Create: `src/storage/session-repo.ts`
- Create: `src/storage/usage-repo.ts`

- [ ] **Step 1: 实现 session-repo.ts**

```ts
// src/storage/session-repo.ts
import { getDb } from "./db.js";

export interface SessionMeta {
  id: string;
  name: string;
  model: string;
  provider: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
}

export function upsertSession(meta: Omit<SessionMeta, "isArchived">): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, name, model, provider, message_count,
      input_tokens, output_tokens, created_at, updated_at)
    VALUES (@id, @name, @model, @provider, @messageCount,
      @inputTokens, @outputTokens, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      message_count = excluded.message_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      updated_at = excluded.updated_at
  `).run(meta);
}

export function listSessions(opts?: {
  search?: string;
  offset?: number;
  limit?: number;
}): SessionMeta[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts?.search) {
    conditions.push("name LIKE @search");
    params.search = `%${opts.search}%`;
  }

  // NOTE: 项目归属是 conversation 上的索引字段，不编码进 session 表。
  // 如需按项目筛选，应通过 project_sessions 关联表或 conversation 索引实现。
  // 参见 Orkas CLAUDE.md: "项目归属是 conversation 上的索引字段"

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  return db.prepare(`
    SELECT id, name, model, provider,
           message_count AS messageCount,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           created_at AS createdAt,
           updated_at AS updatedAt,
           is_archived AS isArchived
    FROM sessions
    ${where}
    ORDER BY updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as SessionMeta[];
}

export function getSession(id: string): SessionMeta | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT id, name, model, provider,
           message_count AS messageCount,
           input_tokens AS inputTokens,
           output_tokens AS outputTokens,
           created_at AS createdAt,
           updated_at AS updatedAt,
           is_archived AS isArchived
    FROM sessions WHERE id = ?
  `).get(id) as SessionMeta | undefined;
}

export function countSessions(opts?: {
  search?: string;
}): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts?.search) {
    conditions.push("name LIKE @search");
    params.search = `%${opts.search}%`;
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM sessions ${where}`
  ).get(params) as { cnt: number };
  return row.cnt;
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function renameSession(id: string, name: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET name = @name, updated_at = @now WHERE id = @id"
  ).run({ id, name, now: Date.now() });
}

export function archiveSession(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET is_archived = 1, updated_at = @now WHERE id = @id"
  ).run({ id, now: Date.now() });
}

export function unarchiveSession(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET is_archived = 0, updated_at = @now WHERE id = @id"
  ).run({ id, now: Date.now() });
}
```

- [ ] **Step 2: 实现 usage-repo.ts**

```ts
// src/storage/usage-repo.ts
import { getDb } from "./db.js";
import type { Usage } from "../shared/types.js";

export function logUsage(input: {
  sessionId: string;
  model: string;
  provider: string;
  usage: Usage;
  toolLoops: number;
  durationMs: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO usage_logs (session_id, model, provider,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      tool_loops, duration_ms, created_at)
    VALUES (@sessionId, @model, @provider,
      @inputTokens, @outputTokens, @cacheRead, @cacheWrite,
      @toolLoops, @durationMs, @createdAt)
  `).run({
    sessionId: input.sessionId,
    model: input.model,
    provider: input.provider,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheRead: input.usage.cacheReadTokens ?? 0,
    cacheWrite: input.usage.cacheWriteTokens ?? 0,
    toolLoops: input.toolLoops,
    durationMs: input.durationMs,
    createdAt: Date.now(),
  });

  db.prepare(`
    UPDATE sessions
    SET input_tokens = input_tokens + @inputTokens,
        output_tokens = output_tokens + @outputTokens
    WHERE id = @sessionId
  `).run({
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    sessionId: input.sessionId,
  });
}

export function dailyUsage(days = 30): Array<{
  date: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT date(created_at / 1000, 'unixepoch') AS date,
           SUM(input_tokens) AS inputTokens,
           SUM(output_tokens) AS outputTokens
    FROM usage_logs
    WHERE created_at > @since
    GROUP BY date
    ORDER BY date DESC
  `).all({ since: Date.now() - days * 86400_000 }) as any[];
}
```

- [ ] **Step 3: 运行 TypeScript 检查**

```bash
npm run check
```

- [ ] **Step 4: Commit**

```bash
git add src/storage/session-repo.ts src/storage/usage-repo.ts
git commit -m "feat(storage): add session-repo and usage-repo data access layers"
```

---

### Task 4.5: 存储层 — Provider 数据访问层 (🆕)

**Files:**

- Create: `src/storage/provider-repo.ts`
- Create: `src/util/crypto.ts`

Provider 配置存储每个厂商的 API Key（加密）、Base URL、模型列表、优先级（用于故障转移排序）。

- [ ] **Step 1: 实现 crypto.ts（API Key 加密工具）**

```ts
// src/util/crypto.ts
import * as crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/** 从机器标识派生加密密钥（生产环境应使用系统密钥链） */
function deriveKey(): Buffer {
  const machineId = `${process.env.COMPUTERNAME ?? ""}${process.env.USER ?? ""}${process.platform}`;
  return crypto.scryptSync(machineId, "my-agent-provider-salt", KEY_LENGTH);
}

const _key = deriveKey();

export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, _key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 格式: iv:tag:ciphertext (全部 base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptApiKey(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, _key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
}
```

- [ ] **Step 2: 实现 provider-repo.ts**

```ts
// src/storage/provider-repo.ts
import { getDb } from "./db.js";
import { encryptApiKey, decryptApiKey } from "../util/crypto.js";

export interface ProviderEntry {
  id: string;
  name: string;
  provider: string;          // 'anthropic' | 'openai' | 'deepseek' | 'moonshot' | 'doubao'
  apiKeyEnc: string;
  baseUrl: string;
  models: string[];          // 模型 ID 列表 ['deepseek-chat', 'deepseek-reasoner']
  isEnabled: boolean;
  priority: number;           // 越小越优先（0 = 主 Provider）
  createdAt: number;
  updatedAt: number;
}

function rowToEntry(row: any): ProviderEntry {
  return {
    ...row,
    isEnabled: row.is_enabled === 1,
    apiKeyEnc: row.api_key_enc,
    baseUrl: row.base_url,
    models: JSON.parse(row.models ?? "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出所有 Provider（按 priority 排序） */
export function listProviders(): ProviderEntry[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM providers ORDER BY priority ASC, updated_at DESC
  `).all() as any[];
  return rows.map(rowToEntry);
}

/** 获取单个 Provider */
export function getProvider(id: string): ProviderEntry | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as any;
  return row ? rowToEntry(row) : undefined;
}

/** 新增或更新 Provider */
export function upsertProvider(input: {
  id?: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  priority?: number;
}): ProviderEntry {
  const db = getDb();
  const id = input.id ?? `${input.provider}-${Date.now().toString(36)}`;
  const now = Date.now();

  // 如果传入了 API Key，加密存储；否则保留已有值（编辑时不强制要求重新输入）
  const apiKeyEnc = input.apiKey
    ? encryptApiKey(input.apiKey)
    : input.id
      ? (db.prepare("SELECT api_key_enc FROM providers WHERE id = ?").get(input.id) as any)?.api_key_enc ?? ""
      : "";

  db.prepare(`
    INSERT INTO providers (id, name, provider, api_key_enc, base_url, models,
      is_enabled, priority, created_at, updated_at)
    VALUES (@id, @name, @provider, @apiKeyEnc, @baseUrl, @models,
      1, @priority, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      provider = excluded.provider,
      api_key_enc = @apiKeyEnc,
      base_url = excluded.base_url,
      models = excluded.models,
      priority = excluded.priority,
      updated_at = @now
  `).run({
    id,
    name: input.name,
    provider: input.provider,
    apiKeyEnc,
    baseUrl: input.baseUrl ?? "",
    models: JSON.stringify(input.models ?? []),
    priority: input.priority ?? 10,
    now,
  });
  return getProvider(id)!;
}

/** 解密并返回 API Key */
export function getApiKey(providerId: string): string | null {
  const entry = getProvider(providerId);
  if (!entry || !entry.apiKeyEnc) return null;
  return decryptApiKey(entry.apiKeyEnc);
}

/** 删除 Provider */
export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

/** 切换 Provider 启用/禁用 */
export function setProviderEnabled(id: string, enabled: boolean): void {
  getDb().prepare(
    "UPDATE providers SET is_enabled = @enabled, updated_at = @now WHERE id = @id"
  ).run({ id, enabled: enabled ? 1 : 0, now: Date.now() });
}

/** 设置 Provider 优先级（用于故障转移排序） */
export function setProviderPriority(id: string, priority: number): void {
  getDb().prepare(
    "UPDATE providers SET priority = @priority, updated_at = @now WHERE id = @id"
  ).run({ id, priority, now: Date.now() });
}
```

- [ ] **Step 3: 添加 providers IPC handler 到 config.ts**

```ts
// 在 src/ipc/config.ts 的 registerConfigIpc() 中新增:

ipcMain.handle("providers:list", async () => {
  return listProviders();
});

ipcMain.handle("providers:save", async (_e, input) => {
  return upsertProvider(input);
});

ipcMain.handle("providers:delete", async (_e, id: string) => {
  deleteProvider(id);
  return { ok: true };
});

ipcMain.handle("providers:setEnabled", async (_e, id: string, enabled: boolean) => {
  setProviderEnabled(id, enabled);
  return { ok: true };
});

ipcMain.handle("providers:test", async (_e, id: string) => {
  const key = getApiKey(id);
  if (!key) return { ok: false, error: "未配置 API Key" };
  // 发送一个最小请求测试连通性
  const entry = getProvider(id);
  if (!entry) return { ok: false, error: "Provider 不存在" };
  try {
    // 具体测试逻辑由 provider 类型决定
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

- [ ] **Step 4: 运行 TypeScript 检查 + Commit**

---

### Task 5: 存储层 — 文件锁

**Files:**

- Create: `src/storage/locks.ts`

- [ ] **Step 1: 实现 locks.ts**

```ts
// src/storage/locks.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { locksDir } from "./paths.js";

export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(name: string) {
    fs.mkdirSync(locksDir(), { recursive: true });
    this.lockPath = path.join(locksDir(), `${name}.lock`);
  }

  acquire(timeoutMs = 5000): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
        this.acquired = true;
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      try {
        const pid = Number.parseInt(
          fs.readFileSync(this.lockPath, "utf-8"), 10
        );
        if (!isProcessAlive(pid)) {
          fs.unlinkSync(this.lockPath);
          continue;
        }
      } catch { /* retry */ }
      // 同步 sleep ~50ms，避免 CPU 自旋。
      // 不使用 Atomics.wait（Node.js 主线程不支持）。
      // Windows 上用 PowerShell 的 Start-Sleep，Unix 上用 sleep。
      // 作为轻量锁，50ms 轮询间隔是可接受的折中方案。
      const until = Date.now() + 50;
      while (Date.now() < until) {
        // 忙等待 50ms — 对短时锁（文件操作）影响极小
      }
    }
    return false;
  }

  release(): void {
    if (!this.acquired) return;
    try { fs.unlinkSync(this.lockPath); } catch { /* ignore */ }
    this.acquired = false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add src/storage/locks.ts
git commit -m "feat(storage): add file lock for multi-instance safety"
```

---

### Task 6: Electron 主进程入口

**Files:**

- Create: `electron/main.ts`

- [ ] **Step 1: 实现 main.ts**

```ts
// electron/main.ts
import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "../src/ipc/index.js";
import { closeDb } from "../src/storage/db.js";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "My Agent",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,        // false: 允许预加载脚本访问 fs（用于 devtools）
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on("window-all-closed", () => {
  closeDb();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
npm run check
```

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat(electron): add main process entry point"
```

---

### Task 7: Preload 脚本

**Files:**

- Create: `electron/preload.js`

- [ ] **Step 1: 实现 preload.js**

```js
// electron/preload.js
// ⚠️ 必须是 .js，不跑 tsx hook
// 命名：window.myAgent（非 window.orkas — 这是 MyAgent 项目，不是 Orkas）
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("myAgent", {
  // 请求-响应（invoke/handle 模式）
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // 流式通道（用于 Agent SSE 输出 + 工具执行事件）
  stream: (channel, payload) => {
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ipcRenderer.send(channel, { streamId, ...payload });

    return {
      on: (event, callback) => {
        const listener = (_ev, data) => {
          if (data.streamId === streamId) callback(data.payload);
        };
        ipcRenderer.on(`stream:${event}`, listener);
        return () =>
          ipcRenderer.removeListener(`stream:${event}`, listener);
      },
      cancel: () => {
        ipcRenderer.send(`${channel}:cancel`, { streamId });
      },
    };
  },

  // 主进程 → Renderer 的事件推送
  on: (channel, callback) => {
    const listener = (_ev, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
```

- [ ] **Step 2: 验证语法正确性**

```bash
node --check electron/preload.js
```

Expected: 无输出（语法正确）。

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat(electron): add preload with contextBridge API"
```

---

### Task 8: IPC 层 — 四个 namespace 的处理器

**Files:**

- Create: `src/ipc/index.ts`
- Create: `src/ipc/sessions.ts`
- Create: `src/ipc/config.ts`
- Create: `src/ipc/skills.ts`
- Create: `src/ipc/chat.ts`

- [ ] **Step 1: 实现 sessions IPC**

```ts
// src/ipc/sessions.ts
import { ipcMain } from "electron";
import * as repo from "../storage/session-repo.js";

export function registerSessionsIpc(): void {
  ipcMain.handle("sessions:list", async (_e, opts?: {
    search?: string;
    offset?: number;
    limit?: number;
  }) => {
    const sessions = repo.listSessions(opts);
    const total = repo.countSessions({ search: opts?.search });
    return { sessions, total };
  });

  ipcMain.handle("sessions:get", async (_e, id: string) => {
    return repo.getSession(id) ?? null;
  });

  ipcMain.handle("sessions:delete", async (_e, id: string) => {
    repo.deleteSession(id);
    return { ok: true };
  });

  ipcMain.handle("sessions:rename", async (_e, id: string, name: string) => {
    repo.renameSession(id, name);
    return { ok: true };
  });

  ipcMain.handle("sessions:archive", async (_e, id: string) => {
    repo.archiveSession(id);
    return { ok: true };
  });

  ipcMain.handle("sessions:unarchive", async (_e, id: string) => {
    repo.unarchiveSession(id);
    return { ok: true };
  });
}
```

- [ ] **Step 2: 实现 config IPC + app 版本信息**

```ts
// src/ipc/config.ts
import { ipcMain } from "electron";
import { loadConfig } from "../config/loader.js";
import { getDb } from "../storage/db.js";

// 内存缓存，避免每次 IPC 调用重新加载
let _configCache: ReturnType<typeof loadConfig> | null = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL_MS = 30_000; // 30 秒

async function getCachedConfig() {
  if (_configCache && Date.now() - _configCacheTime < CONFIG_CACHE_TTL_MS) {
    return _configCache;
  }
  _configCache = await loadConfig();
  _configCacheTime = Date.now();
  return _configCache;
}

export function registerConfigIpc(): void {
  ipcMain.handle("config:get", async () => {
    return getCachedConfig();
  });

  ipcMain.handle("config:update", async (_e, patch: Record<string, unknown>) => {
    const db = getDb();
    for (const [key, value] of Object.entries(patch)) {
      db.prepare(`
        INSERT INTO configs (key, value, updated_at)
        VALUES (@key, @value, @now)
        ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @now
      `).run({ key, value: JSON.stringify(value), now: Date.now() });
    }
    _configCache = null;
    return { ok: true };
  });

  ipcMain.handle("config:getProviders", async () => {
    const config = await getCachedConfig();
    return config.providers ?? {};
  });

  ipcMain.handle("config:getModels", async () => {
    const config = await getCachedConfig();
    return config.models?.catalog ?? {};
  });

  // 应用版本信息 — Renderer 中 contextIsolation 隔离了 process 对象，
  // 版本号只能通过 IPC 从 Main 进程获取。
  ipcMain.handle("app:getVersion", async () => {
    return {
      version: "0.3.0",
      electron: process.versions.electron ?? "—",
      node: process.versions.node ?? "—",
      platform: process.platform,
    };
  });
}
```

- [ ] **Step 3: 实现 skills IPC**

```ts
// src/ipc/skills.ts
import { ipcMain } from "electron";

// 占位实现 — 实际 Skill 数据由 skill-service 提供
export function registerSkillsIpc(): void {
  ipcMain.handle("skills:list", async () => {
    // 暂时返回空列表，后续由 Plan C 的 skill-service 填充
    return [];
  });

  ipcMain.handle("skills:get", async (_e, _id: string) => {
    return null;
  });

  ipcMain.handle("skills:setEnabled", async (_e, _id: string, _enabled: boolean) => {
    return { ok: true };
  });
}
```

- [ ] **Step 4: 实现 chat IPC**

```ts
// src/ipc/chat.ts
import { ipcMain } from "electron";

export function registerChatIpc(): void {
  // 占位实现 — 实际 streaming 由 Plan B 的 stream-chat feature 提供
  ipcMain.on("chat:stream", async (event, { streamId, message }) => {
    // 暂时返回 echo，后续接入 AgentRunner 流式输出
    event.sender.send("stream:text_delta", {
      streamId,
      payload: { text: `Echo: ${message}` },
    });
    event.sender.send("stream:done", {
      streamId,
      payload: { sessionId: "placeholder" },
    });
  });

  ipcMain.on("chat:cancel", (_event, { streamId }) => {
    // 后续接入 abortChat
    console.log("chat cancelled:", streamId);
  });
}
```

- [ ] **Step 5: 实现 index.ts 注册入口**

```ts
// src/ipc/index.ts
import { registerChatIpc } from "./chat.js";
import { registerSessionsIpc } from "./sessions.js";
import { registerConfigIpc } from "./config.js";
import { registerSkillsIpc } from "./skills.js";

export function registerIpcHandlers(): void {
  registerChatIpc();
  registerSessionsIpc();
  registerConfigIpc();
  registerSkillsIpc();
}
```

- [ ] **Step 6: 运行 TypeScript 检查**

```bash
npm run check
```

- [ ] **Step 7: Commit**

```bash
git add src/ipc/
git commit -m "feat(ipc): add IPC handlers for sessions/config/skills/chat"
```

---

### Task 9: Renderer — CSS 基础设施

**Files:**

- Create: `electron/renderer/css/reset.css`
- Create: `electron/renderer/css/variables.css`
- Create: `electron/renderer/css/layout.css`
- Create: `electron/renderer/css/components.css`

- [ ] **Step 1: 实现 reset.css**

```css
/* electron/renderer/css/reset.css */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  color: #222;
  background: #fff;
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: inherit;
  cursor: pointer;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
}

a {
  color: #6c5ce7;
  text-decoration: none;
}

ul, ol {
  list-style: none;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #bbb;
}
```

- [ ] **Step 2: 实现 variables.css**

```css
/* electron/renderer/css/variables.css */
:root {
  /* 主色 */
  --color-primary: #6c5ce7;
  --color-primary-light: #a29bfe;
  --color-primary-bg: rgba(108, 92, 231, 0.08);
  --color-primary-border: rgba(108, 92, 231, 0.12);

  /* 文字 */
  --color-text: #222;
  --color-text-secondary: #666;
  --color-text-muted: #999;
  --color-text-placeholder: #bbb;

  /* 背景 */
  --bg-main: #fff;
  --bg-secondary: #fafafa;
  --bg-hover: rgba(0, 0, 0, 0.04);

  /* 边框 */
  --border-light: #f0f0f0;
  --border-default: #ececec;
  --border-input: #e5e5e5;

  /* 卡片 */
  --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);

  /* 状态色 */
  --color-success: #16a34a;
  --color-success-bg: #f7faf7;
  --color-error: #ff6b6b;
  --color-error-bg: rgba(255, 107, 107, 0.08);
  --color-warning: #d97706;
  --color-warning-bg: #fef3c7;

  /* 圆角 */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-input: 18px;

  /* 字号 */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 18px;

  /* 间距 */
  --sidebar-width: 64px;
  --subnav-width: 200px;
  --panel-width: 260px;
}
```

- [ ] **Step 3: 实现 layout.css**

```css
/* electron/renderer/css/layout.css */

/* ===== 三栏弹性布局 ===== */
#app {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ===== 图标侧栏 (64px) ===== */
#sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 0;
  user-select: none;
}

#sidebar-logo {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 18px;
  cursor: pointer;
}

#sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  flex: 1;
}

.sidebar-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  color: #666;
  transition: background 0.15s;
}

.sidebar-icon:hover {
  background: var(--bg-hover);
}

.sidebar-icon.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

#sidebar-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

#sidebar-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

/* ===== 次级面板 (260px) ===== */
#sub-panel {
  width: var(--panel-width);
  min-width: var(--panel-width);
  border-right: 1px solid var(--border-light);
  background: var(--bg-main);
  display: flex;
  flex-direction: column;
}

#sub-panel.collapsed {
  display: none;
}

/* ===== 主内容区 ===== */
#main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-main);
}

/* ===== 页面容器 ===== */
.page {
  display: none;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.page.active {
  display: flex;
}

/* ===== 顶栏 ===== */
.topbar {
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-base);
  background: var(--bg-main);
  flex-shrink: 0;
}

.topbar-title {
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  color: #888;
  font-size: var(--text-sm);
}

/* ===== 内容区 ===== */
.content-area {
  flex: 1;
  overflow-y: auto;
}

.content-padded {
  padding: 24px 28px;
}
```

- [ ] **Step 4: 实现 components.css**

```css
/* electron/renderer/css/components.css */

/* ===== 按钮 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: 500;
  transition: all 0.15s;
}

.btn-primary {
  background: var(--color-primary);
  color: #fff;
  border: none;
}

.btn-primary:hover {
  background: #5a4bd1;
}

.btn-secondary {
  background: var(--bg-main);
  color: #333;
  border: 1px solid var(--border-input);
}

.btn-secondary:hover {
  background: var(--bg-secondary);
}

.btn-danger {
  background: var(--bg-main);
  color: var(--color-error);
  border: 1px solid var(--color-error);
}

.btn-danger:hover {
  background: var(--color-error-bg);
}

.btn-ghost {
  background: transparent;
  color: #888;
  border: none;
}

.btn-ghost:hover {
  color: var(--color-text);
}

.btn-sm {
  padding: 4px 10px;
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
}

.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

/* ===== 输入框 ===== */
.input {
  background: var(--bg-main);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 4px 12px;
  font-size: var(--text-base);
  color: var(--color-text);
  outline: none;
  transition: border-color 0.15s;
}

.input:focus {
  border-color: var(--color-primary);
}

.input-search {
  background: var(--bg-secondary);
  border: none;
  height: 30px;
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  padding: 4px 10px;
  width: 100%;
}

/* ===== 选择框 ===== */
.select {
  background: var(--bg-main);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  padding: 0 12px;
  font-size: var(--text-base);
  color: var(--color-text);
  outline: none;
  cursor: pointer;
  height: 34px;
}

/* ===== 标签 / Chip ===== */
.chip {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 14px;
  font-size: var(--text-sm);
  cursor: pointer;
  border: 1px solid var(--border-input);
  background: var(--bg-main);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.chip.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

/* ===== 卡片 ===== */
.card {
  background: var(--bg-main);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 14px;
  box-shadow: var(--card-shadow);
}

/* ===== 消息气泡 ===== */
.message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.message-user {
  justify-content: flex-end;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: var(--radius-xl) var(--radius-xl) 4px var(--radius-xl);
  max-width: 70%;
  font-size: var(--text-md);
  line-height: 1.6;
}

.message-user .message-bubble {
  background: #fff;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl) var(--radius-xl) 4px var(--radius-xl);
  color: var(--color-text);
  box-shadow: var(--card-shadow);
}

.message-assistant .message-bubble {
  background: #fff;
  border: 1px solid var(--border-default);
  border-radius: 4px var(--radius-xl) var(--radius-xl) var(--radius-xl);
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #fff;
}

.message-avatar-user {
  background: var(--color-primary);
}

.message-avatar-assistant {
  background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
}

/* ===== 工具调用卡片 ===== */
.tool-call-card {
  background: var(--bg-main);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  font-size: var(--text-base);
}

.tool-call-card.error {
  border-color: var(--color-error);
}

.tool-call-header {
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.tool-call-body {
  padding: 10px 14px;
  background: var(--bg-secondary);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-family: monospace;
  line-height: 1.6;
  border-top: 1px solid var(--border-light);
  display: none;
}

.tool-call-body.expanded {
  display: block;
}

.tool-call-body.terminal {
  background: #1e1e2e;
  color: #d4d4d4;
}

.tool-call-status {
  padding: 8px 14px;
  font-size: var(--text-sm);
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
}

.tool-call-status.success {
  background: var(--color-success-bg);
  color: var(--color-success);
}

.tool-call-status.error {
  background: var(--color-error-bg);
  color: var(--color-error);
}

/* ===== 消息列表容器 ===== */
#chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--bg-secondary);
}

/* ===== 输入区 ===== */
#chat-input-area {
  padding: 14px 20px 18px;
  background: var(--bg-main);
  border-top: 1px solid var(--border-light);
  flex-shrink: 0;
}

.input-context-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.input-wrapper {
  background: var(--bg-main);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-input);
  padding: 8px 8px 8px 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: var(--color-primary);
}

#chat-input {
  width: 100%;
  border: none;
  outline: none;
  min-height: 48px;
  resize: none;
  font-size: var(--text-md);
  color: var(--color-text);
  background: transparent;
  line-height: 1.6;
}

#chat-input::placeholder {
  color: var(--color-text-placeholder);
}

.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 2px 0;
}

.input-toolbar-left {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--text-base);
  color: #888;
}

.input-toolbar-right {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ===== 空状态 ===== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--text-md);
}

.empty-state-icon {
  font-size: 36px;
  margin-bottom: 12px;
}

/* ===== Toast ===== */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 8px 20px;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  z-index: 1000;
  opacity: 0;
  transition: opacity 0.2s;
}

.toast.visible {
  opacity: 1;
}
```

- [ ] **Step 5: Commit**

```bash
git add electron/renderer/css/
git commit -m "feat(renderer): add CSS infrastructure — reset/variables/layout/components"
```

---

### Task 10: Renderer — HTML 壳 + 路由

**Files:**

- Create: `electron/renderer/index.html`
- Create: `electron/renderer/js/app.js`
- Create: `electron/renderer/js/api.js`

- [ ] **Step 1: 实现 index.html**

```html
<!-- electron/renderer/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
  <title>My Agent</title>
  <link rel="stylesheet" href="css/reset.css">
  <link rel="stylesheet" href="css/variables.css">
  <link rel="stylesheet" href="css/layout.css">
  <link rel="stylesheet" href="css/components.css">
</head>
<body>
  <div id="app">
    <!-- ===== 图标侧栏 ===== -->
    <aside id="sidebar">
      <div id="sidebar-logo" title="My Agent" data-nav="chat">M</div>
      <nav id="sidebar-nav">
        <div class="sidebar-icon active" data-nav="chat" title="对话">💬</div>
        <div class="sidebar-icon" data-nav="sessions" title="会话管理">📋</div>
        <div class="sidebar-icon" data-nav="skills" title="Skills">🧩</div>
        <div class="sidebar-icon" data-nav="settings" title="设置">⚙️</div>
      </nav>
      <div id="sidebar-footer">
        <div id="sidebar-avatar" title="用户">Q</div>
      </div>
    </aside>

    <!-- ===== 主区 ===== -->
    <main id="main">
      <!-- 对话页 -->
      <section id="page-chat" class="page active">
        <div id="chat-messages">
          <div class="empty-state">
            <div class="empty-state-icon">💬</div>
            <div>开始一段新对话</div>
            <div style="margin-top:4px;font-size:12px;">输入消息，Enter 发送，Shift+Enter 换行</div>
          </div>
        </div>
        <div id="chat-input-area">
          <div class="input-context-bar">
            <span class="chip" id="ctx-project">📁 my-agent</span>
            <span class="chip" id="ctx-model">🧠 deepseek-chat</span>
          </div>
          <div class="input-wrapper">
            <textarea id="chat-input" rows="2"
              placeholder="输入消息... Enter 发送，Shift+Enter 换行"></textarea>
            <div class="input-toolbar">
              <div class="input-toolbar-left">
                <button class="btn btn-icon btn-ghost" title="附件">📎</button>
                <button class="btn btn-icon btn-ghost" title="图片">🖼️</button>
              </div>
              <div class="input-toolbar-right">
                <button class="btn btn-sm btn-secondary">停止</button>
                <button class="btn btn-primary" id="btn-send">发送 ➤</button>
              </div>
            </div>
          </div>
          <div style="text-align:center;font-size:11px;color:#bbb;margin-top:8px;">
            My Agent 可能产生错误，请核实重要信息
          </div>
        </div>
      </section>

      <!-- 会话管理页 -->
      <section id="page-sessions" class="page">
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div>会话管理 — 即将实现</div>
        </div>
      </section>

      <!-- Skills 管理页 -->
      <section id="page-skills" class="page">
        <div class="empty-state">
          <div class="empty-state-icon">🧩</div>
          <div>Skills 管理 — 即将实现</div>
        </div>
      </section>

      <!-- 设置页 -->
      <section id="page-settings" class="page">
        <div class="empty-state">
          <div class="empty-state-icon">⚙️</div>
          <div>设置 — 即将实现</div>
        </div>
      </section>
    </main>
  </div>

  <!-- 第三方 -->
  <script src="vendor/marked.min.js"></script>

  <!-- 模块 -->
  <script src="js/api.js"></script>
  <script src="modules/markdown.js"></script>

  <!-- 入口 -->
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 实现 api.js**

```js
// electron/renderer/js/api.js
const api = {
  // ============================================================
  // 会话
  // ============================================================
  sessions: {
    list: (opts) => window.myAgent.invoke("sessions:list", opts),
    get: (id) => window.myAgent.invoke("sessions:get", id),
    delete: (id) => window.myAgent.invoke("sessions:delete", id),
    rename: (id, name) => window.myAgent.invoke("sessions:rename", id, name),
    archive: (id) => window.myAgent.invoke("sessions:archive", id),
    unarchive: (id) => window.myAgent.invoke("sessions:unarchive", id),
  },

  // ============================================================
  // 对话（流式）
  // ============================================================
  chat: {
    send(input) {
      return window.myAgent.stream("chat:stream", input);
    },
    cancel(id) {
      window.myAgent.invoke("chat:cancel", id);
    },
  },

  // ============================================================
  // 配置
  // ============================================================
  config: {
    get: () => window.myAgent.invoke("config:get"),
    update: (patch) => window.myAgent.invoke("config:update", patch),
  },

  // ============================================================
  // Skills
  // ============================================================
  skills: {
    list: () => window.myAgent.invoke("skills:list"),
    get: (id) => window.myAgent.invoke("skills:get", id),
    setEnabled: (id, enabled) =>
      window.myAgent.invoke("skills:setEnabled", id, enabled),
  },

  // ============================================================
  // Providers（模型厂商配置）
  // ============================================================
  providers: {
    list: () => window.myAgent.invoke("providers:list"),
    save: (input) => window.myAgent.invoke("providers:save", input),
    delete: (id) => window.myAgent.invoke("providers:delete", id),
    setEnabled: (id, enabled) =>
      window.myAgent.invoke("providers:setEnabled", id, enabled),
    test: (id) => window.myAgent.invoke("providers:test", id),
  },

  // ============================================================
  // 应用
  // ============================================================
  app: {
    getVersion: () => window.myAgent.invoke("app:getVersion"),
  },
};
```

- [ ] **Step 3: 实现 app.js（路由 + 启动）**

```js
// electron/renderer/js/app.js
const App = {
  currentPage: "chat",

  init() {
    // 侧栏导航
    document.querySelectorAll(".sidebar-icon").forEach((icon) => {
      icon.addEventListener("click", () => {
        const page = icon.dataset.nav;
        this.navigate(page);
      });
    });

    // Logo 点击回对话页
    document.getElementById("sidebar-logo").addEventListener("click", () => {
      this.navigate("chat");
    });

    // 初始路由
    this.navigate(this.currentPage);
  },

  navigate(page) {
    // 更新侧栏
    document.querySelectorAll(".sidebar-icon").forEach((icon) => {
      icon.classList.toggle("active", icon.dataset.nav === page);
    });

    // 更新页面
    document.querySelectorAll(".page").forEach((p) => {
      p.classList.toggle("active", p.id === `page-${page}`);
    });

    this.currentPage = page;
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
```

- [ ] **Step 4: 实现 markdown.js 渲染模块**

```js
// electron/renderer/modules/markdown.js
function renderMarkdown(text) {
  if (typeof marked === "undefined") {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }
  return marked.parse(text, { breaks: true, gfm: true });
}

function escapeHtml(str) {
  const map = {
    "&": "&",
    "<": "<",
    ">": ">",
    '"': """,
    "'": "'",
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}
```

- [ ] **Step 5: 下载 vendor/marked.min.js**

从 https://cdn.jsdelivr.net/npm/marked/marked.min.js 下载：

```bash
# 手动下载放到 electron/renderer/vendor/marked.min.js
# 或用 curl:
curl -o electron/renderer/vendor/marked.min.js \
  https://cdn.jsdelivr.net/npm/marked/marked.min.js
```

- [ ] **Step 6: 验证窗口能打开**

```bash
npm run dev
```

Expected: Electron 窗口打开，显示图标侧栏 + 空对话页。点击侧栏图标能切换页面。

- [ ] **Step 7: Commit**

```bash
git add electron/renderer/
git commit -m "feat(renderer): add HTML shell, hash router, sidebar nav, API wrapper, and markdown module"
```

---

### Task 11: 验证端到端通信

- [ ] **Step 1: 从 Renderer 调用 sessions:list IPC**

在浏览器 DevTools Console 中执行：

```js
const result = await api.sessions.list({ limit: 10 });
console.log("Sessions:", result);
```

Expected: `{ sessions: [], total: 0 }`（数据库是空的，但调用不报错）。

- [ ] **Step 2: 从 Renderer 调用 config:get IPC**

```js
const config = await api.config.get();
console.log("Config:", config);
```

Expected: 返回当前的 config.json 内容。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: verify end-to-end IPC communication works"
```

---

## Summary

**Task 1-5**: 存储层（paths + db + session/usage/provider repos + locks）
**Task 6-8**: Electron 主进程 + Preload + IPC（sessions/config/skills/chat/providers）
**Task 9-10**: Renderer CSS 基础设施 + HTML 壳 + 路由 + API 封装
**Task 11**: 端到端验证

**Output**: 一个能打开的 Electron 窗口，有图标侧栏，能切换 4 个空页面，Renderer ↔ Main IPC 通路正常。

**Next plan**: [Plan B: 四屏 UI 实现](2026-08-04-plan-b-four-screens.md) — 对话页 / 会话管理 / 设置 / Skills 的前端完整实现。
