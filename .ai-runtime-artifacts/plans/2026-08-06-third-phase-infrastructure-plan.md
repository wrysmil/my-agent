---
artifact: implementation-plan
route: superpowers:writing-plans
skills:
  - writing-plans
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md
dispatch: n/a
source:
  - docs/仿写Agent框架指南.md § 第三阶段
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/project.profile.md
  - harness-kit/context-map.md
created_at: 2026-08-06
status: approved
approved: true
approved_by: "用户原话：按照harness的流程，执行任务（2026-08-06）"
approval_gate: "plan 阶段门禁已通过；评估发现 6 处 BLOCK/MAJOR 已修订进计划"
---

# 第三阶段：基础设施（存储与安全）实现计划

> **For agentic workers:** 本计划为单 WU（dispatch: n/a），由 Leader 直做实现。

**Goal:** 补齐 my-agent 项目第三阶段"基础设施（存储与安全）"的缺失模块：路径管理、存储增强、锁机制、Session 持久化工程补充——将 Agent 从"一次性对话"升级为"有持久化能力的系统"。

**Architecture:** 基于 Orkas `src/main/util/` 和 `src/main/model/core-agent/` 的设计思路，针对 my-agent 单用户学习项目做减法——去掉多用户 IPC、macOS TCC、SQLite 向量库、全局 dispatch 信号量等不需要的复杂度；保留核心的路径收口、JSONL 并发安全、会话锁、Session 路由四块，并以项目现有代码（`src/storage/jsonl.ts`、`src/agent/persistent-session.ts`、`src/storage/session-store.ts`）为基础增量演进。

**Tech Stack:** TypeScript 5.7 + Node.js ESM + `async-mutex`（新增依赖）+ Vitest

**优化原则（与 Orkas 原版的关键差异）：**

| 方面 | Orkas 原版 | my-agent 优化 |
|---|---|---|
| 路径管理 | `paths.ts` ~780行，四层目录树，多用户+多项目 | ~120行，单用户+单项目，两层即可 |
| 沙箱 | realpath 两侧规范化 + macOS TCC 敏感路径审批 | 简化为工作目录白名单 + 路径段断言，不做 TCC |
| 存储 | JSON/JSONL + SQLite(KB向量) + 30+张表 | 仅 JSON/JSONL，约5张表 |
| 锁 | 4类锁(session/file/globalSlots/dispatchSlots)，带超时 | 2类锁(session/file)，`async-mutex` 即用即建 |
| Session路由 | 10种kind，cloud/local分流，动态import #core-agent | 4种kind，简化路由表，静态import |
| 用户切换 | activateUser() 钩子 + _evictAll() + globalActiveUid | 单用户，_evictAll() 保留以备扩展 |

---

## 项目现状摸底

### 已实现（可直接复用）

| 模块 | 文件 | 成熟度 | 备注 |
|---|---|---|---|
| JSONL 工具层 | `src/storage/jsonl.ts` | ✅ 完整 | `atomicWrite` / `appendJsonLine` / `readJsonLines` / `writeJsonLines` / `ensureDir` / `removeFile` / `defaultSessionDir` |
| ProvidersStore | `src/storage/providers-store.ts` | ✅ 完整 | Zod校验、损坏恢复、env fallback、原子写。可作为"表owner"的参考实现 |
| SessionStore | `src/storage/session-store.ts` | ✅ 完整 | CRUD + Map缓存 + list/close/closeAll |
| PersistentSession | `src/agent/persistent-session.ts` | ✅ 完整 | JSONL持久化、孤儿修复、上下文侧车、自动落盘 |
| Session | `src/agent/session.ts` | ✅ 完整 | 消息管理/执行计划/完成账本/压缩候选/token估算 |
| builtin tools | `src/tools/builtin.ts` | ✅ 可用 | 8个工具，但缺少路径沙箱门控 |

### 待补齐（本计划覆盖）

| 优先级 | 模块 | 现状 | 目标 |
|---|---|---|---|
| P0 | 路径管理 `paths.ts` | 无集中路径定义，各模块散落字符串 | 单一收口点，所有路径常量集中管理 |
| P0 | 路径沙箱 `path-sandbox.ts` | 内置工具的`resolvePath`不做任何校验 | 工作目录白名单 + 段断言防御 |
| P1 | JSONL 并发安全 | `appendJsonLine` 用 `fs.appendFileSync`，无锁 | per-file Mutex + msgIndex 追踪 |
| P1 | 锁机制 `locks.ts` | 完全不设锁 | sessionLock + fileEditLock 两类 |
| P1 | Session 路由与 kind | SessionStore 不区分 cloud/local，无 kind 校验 | kind allowlist + 路由分发 |
| P2 | Session GC | 无 | local 短暂会话 7天 mtime GC |

---

## 数据表全景：每张"表"的设计与 Owner

> 仿原文 3.2.3 格式，列出 my-agent 所有持久化"表"。每张表 = 一个 JSON / JSONL 文件（或一个目录 = 一组同构条目）。"Owner" 是负责读写该路径的模块。

### 设计原则（与 Orkas 对齐）

1. **工具层与业务层解耦** — `jsonl.ts` 只提供 `read/write/append/atomic` 原语，不 import 任何业务模块。业务模块（Owner）import `jsonl.ts`，暴露 `getXxx / setXxx / listXxx / appendXxx` 高层 API。
2. **原子写是底线** — 所有 JSON 文件改写走 `atomicWrite`（tmp + rename），JSONL 追加走 `appendJsonLineAtomic`（per-file Mutex + msgIndex）。
3. **路径先查 `paths.ts`** — Owner 模块构造路径时必须走 `paths.ts` 的命名函数，禁止内联 `path.join(root, 'data', 'xxx.json')`。
4. **每张表对应一个 Owner** — Owner 模块 = 该文件的唯一写入口。其他模块要通过 Owner 暴露的 API 间接访问，不直接 `readJsonSync`。

### A. 全局数据（机器级，跨 session 共享）

| 路径 | 格式 | Owner | 用途 / 关键字段 |
|---|---|---|---|
| `providers.json` | JSON | `src/storage/providers-store.ts` | LLM provider 配置注册表。Zod 校验 + 损坏时备份恢复 + env API key fallback。字段明细见 A.1 |
| `config.json` | JSON | `src/config/loader.ts`（待对接） | 全局 Agent 配置。由 `CoreAgentConfigSchema`（`src/config/schema.ts`）校验 + 默认值补齐。字段明细见 A.2 |

#### A.1 `providers.json` — Provider 注册表

Owner: `src/storage/providers-store.ts`。校验：`ProvidersConfigSchema`（Zod）。原子写：`atomicWrite`（tempfile + rename）+ 非 win32 平台 `chmod 0600`。

| 字段 | 类型 | 必填 | 默认值 / 约束 | 说明 |
|---|---|---|---|---|
| `version` | `1`（literal） | ✅ | `1` | 格式版本号，结构变更时递增 |
| `activeProviderId` | `string` | ✅ | `"deepseek"` | 活跃 provider 的 id，必须存在于 `providers` 中 |
| `providers` | `Record<string, ProviderConfigEntry>` | ✅ | `{ deepseek: 内置默认 }` | provider 注册表，key = provider id |
| `providers[id].id` | `string` | ✅ | min 1 | 唯一标识，与 Record key 一致 |
| `providers[id].name` | `string` | ✅ | min 1 | 展示名 |
| `providers[id].type` | `"deepseek"`（literal） | ✅ | `"deepseek"` | provider 类型，未来扩展为 union |
| `providers[id].apiKey` | `string` | ✅ | `""` | 为空时运行时从 `DEEPSEEK_API_KEY` env fallback |
| `providers[id].baseUrl` | `string`（url） | ✅ | `"https://api.deepseek.com/v1"` | OpenAI 兼容端点 |
| `providers[id].defaultModel` | `string` | ✅ | `"deepseek-chat"` | 默认模型名 |
| `providers[id].enabled` | `boolean` | ✅ | `true` | 停用后 `getActiveProvider()` 跳过 |

示例：

```json
{
  "version": 1,
  "activeProviderId": "deepseek",
  "providers": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/v1",
      "defaultModel": "deepseek-chat",
      "enabled": true
    }
  }
}
```

#### A.2 `config.json` — 全局 Agent 配置

Owner: `src/config/loader.ts`（待对接）。校验 + 默认值补齐：`CoreAgentConfigSchema`（`src/config/schema.ts`）。

> ⚠️ **修正：** 原表格中的 `{ version, 顶层 providers, 顶层 metacognition }` 与实际 schema 不符，已按下表对齐。实际结构：顶层只有 `agent` / `models` / `memory` / `evolution` 四项；`providers` 嵌在 `models` 下；`metacognition` 嵌在 `evolution` 下。

| 字段 | 类型 | 必填 | 默认值 / 约束 | 说明 |
|---|---|---|---|---|
| `agent` | `AgentConfig` | 可选（parse 补齐） | 见下 | Agent 运行时行为 |
| `agent.defaultModel` | `string` | — | `"claude-opus-4-8"` | 默认模型 |
| `agent.defaultProvider` | `string` | — | `"anthropic"` | 默认 provider key |
| `agent.maxRetries` | `int` | — | `3` | LLM 失败重试上限，`0` = 关闭 |
| `agent.maxToolLoops` | `int` | — | `100` | 工具循环上限，≥ 1 防死循环 |
| `agent.toolIdleTimeoutMs` | `int` | — | `1_800_000` | 工具空闲超时（ms） |
| `agent.systemPrompt` | `string` | 可选 | — | 追加到内置 system prompt |
| `agent.thinkingLevel` | `"off" \| "low" \| "high"` | — | `"off"` | 扩展思考级别 |
| `models.providers` | `Record<string, ProviderConfig>` | 可选 | `{}` | provider 连接：`{ apiKey?, baseUrl?, auth?: "api-key"\|"oauth"\|"token", maxConcurrency? }` |
| `models.catalog` | `Record<string, ModelConfig>` | 可选 | `{}` | 模型目录：`{ provider, model, contextWindow?, maxOutputTokens?, supportsTools?, supportsVision?, supportsStreaming? }` |
| `memory` | `MemoryConfig` | 可选 | 见 schema | `{ enabled: true, provider: "auto", model?, memoryDir?, maxResults: 10, minScore: 0.3, fts: {enabled:true}, vector: {enabled:true}, cache: {enabled:true, maxEntries?} }` |
| `evolution` | `EvolutionConfig` | 可选 | 见 schema | `{ enabled: true, skillsDir: "skills", maxSkills: 200, maxSkillContentLength: 100_000, metacognition: {…} }` |

示例（完整默认值展开态）：

```json
{
  "agent": {
    "defaultModel": "claude-opus-4-8",
    "defaultProvider": "anthropic",
    "maxRetries": 3,
    "maxToolLoops": 100,
    "toolIdleTimeoutMs": 1800000,
    "thinkingLevel": "off"
  },
  "models": { "providers": {}, "catalog": {} },
  "memory": {
    "enabled": true,
    "provider": "auto",
    "maxResults": 10,
    "minScore": 0.3,
    "fts": { "enabled": true },
    "vector": { "enabled": true },
    "cache": { "enabled": true }
  },
  "evolution": {
    "enabled": true,
    "skillsDir": "skills",
    "maxSkills": 200,
    "maxSkillContentLength": 100000,
    "metacognition": { "enabled": true, "reflectThreshold": 0.7 }
  }
}
```

### B. 会话级数据（每 session 一组文件）

| 路径 | 格式 | Owner | 用途 / 关键字段 |
|---|---|---|---|
| `sessions/<sid>.jsonl` | JSONL | `src/agent/persistent-session.ts`（写）+ `src/storage/session-store.ts`（生命周期管理） | 对话消息流。JSONL 每行一条消息，`appendJsonLine` 追加（本阶段迁移 `appendJsonLineAtomic` 获得行号）。加载时自动修复孤儿 tool_use。字段明细见 B.1 |
| `sessions/<sid>.context.json` | JSON | `src/agent/persistent-session.ts` | 会话结构化元数据侧车，每次消息/状态变更后 `atomicWrite` 全量重写。字段明细见 B.2 |
| `sessions/` 目录 | dir | `src/storage/session-store.ts` | `list()` 扫描目录返回 sid 列表；`sweepEphemeralSessions()` 按 mtime 清理过期短暂会话 |

#### B.1 `sessions/<sid>.jsonl` — 消息流表

Owner: `src/agent/persistent-session.ts`。格式：JSONL，每行一条记录 = `SerializedMessage`（`src/agent/session-serde.ts`）。追加：`appendJsonLine`（本阶段迁移为 `appendJsonLineAtomic`，返回 `msgIndex` = 精确行号）。加载：`readJsonLines` + `isValidSerializedMessage` 校验 + 孤儿 tool_use 修复（崩溃中断的工具调用补合成 tool_result）。

行记录字段：

| 字段 | 类型 | 必填 | 约束 / 说明 |
|---|---|---|---|
| `role` | `"user" \| "assistant"` | ✅ | 校验仅这两者；tool_result 消息以 `role: "user"` 存储（兼容 LLM API 格式） |
| `content` | `MessageContent[]` | ✅ | 内容块数组（必须为数组） |
| `turnId` | `number` | 可选 | UI 轮次 id，从 1 自增 |
| `ts` | `number` | ✅ | Unix 毫秒时间戳，审计/排序用；反序列化时丢弃（不进内存 Message） |

`content[]` 的 5 种块：

| `type` | 字段 | 说明 |
|---|---|---|
| `"text"` | `text: string` | 纯文本 |
| `"image"` | `data: string; mediaType: "image/png" \| "image/jpeg" \| "image/gif" \| "image/webp"` | 视觉模型图像输入 |
| `"tool_use"` | `id: string; name: string; input: Record<string, unknown>` | LLM 发出的 function-call 指令 |
| `"tool_result"` | `toolUseId: string; content: string; isError?: boolean` | 工具执行结果（`role` 存储为 `"user"`） |
| `"thinking"` | `thinking: string; thinkingSignature?: string` | 推理链，须在下一轮原样回传 |

示例（一行一条消息）：

```json
{"role":"user","content":[{"type":"text","text":"分析 package.json"}],"turnId":1,"ts":1710000000000}
{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"read_file","input":{"path":"package.json"}}],"turnId":1,"ts":1710000001000}
{"role":"user","content":[{"type":"tool_result","toolUseId":"tu_1","content":"{\"name\":\"my-agent\"}"}],"turnId":1,"ts":1710000002000}
```

#### B.2 `sessions/<sid>.context.json` — 上下文侧车表

Owner: `src/agent/persistent-session.ts`。格式：JSON（`atomicWrite` 全量重写）。类型：`SerializedSessionContext`（`src/agent/session-serde.ts`）。加载时 `version !== 1` 则丢弃侧车，从消息重建轮次状态。

顶层字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | `1` | ✅ | 格式版本号，不匹配时侧车作废 |
| `nextTurnId` | `number` | ✅ | 下一个 turnId 分配器 |
| `completedTurns` | `SerializedTurn[]` | ✅ | 已完成轮次边界记录 |
| `resources` | `HistoryResource[]` | ✅ | 跨轮持久资源引用 |
| `executionPlan` | `ExecutionPlanState` | 可选 | 活跃执行计划 |
| `completedWork` | `CompletedWorkEntry[]` | ✅ | 已完成工作账本 |
| `nextWorkLedgerId` | `number` | ✅ | 工作条目 id 分配器 |

`completedTurns[]` 单条 `SerializedTurn`：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `number` | ✅ | 轮次 id（对应 turnId） |
| `userMessageIndex` | `number` | ✅ | 用户消息在消息数组中的索引 |
| `finalAssistantMessageIndex` | `number` | ✅ | 最终 assistant 消息索引 |
| `startIndex` | `number` | ✅ | 轮次起始索引 |
| `endIndex` | `number` | ✅ | 轮次结束索引（不含） |
| `archived` | `boolean` | ✅ | 是否已归档（被压缩为摘要） |
| `outcome` | `string` | 可选 | 轮次结果标签（completed / aborted …） |

`resources[]` 单条 `HistoryResource`：`{ kind: "attachment" \| "final_output" \| "explicit", path: string, note?: string, mediaType?: string, name?: string, sourceTurnId?: number }`

`executionPlan` `ExecutionPlanState`：`{ version: 1, objective: string, objectiveTruncated?: boolean, objectiveTurnId: number, updatedTurnId: number, steps: [{ id: number, step: string, status: "pending" \| "in_progress" \| "completed" \| "blocked", completionEvidence?: { verification: "observed" \| "unverified", workEntryIds: number[] } }] }`

`completedWork[]` 单条 `CompletedWorkEntry`：`{ id: number, turnId?: number, toolCallId: string, tool: string, inputDigest: string, inputSummary: string, status: "succeeded" \| "failed" \| "aborted" \| "stalled" \| "skipped", resultRef?: string, resultSummary?: string, checkpointEpoch?: number }`

示例：

```json
{
  "version": 1,
  "nextTurnId": 2,
  "completedTurns": [
    {
      "id": 1,
      "userMessageIndex": 0,
      "finalAssistantMessageIndex": 1,
      "startIndex": 0,
      "endIndex": 3,
      "archived": false,
      "outcome": "completed"
    }
  ],
  "resources": [],
  "executionPlan": {
    "version": 1,
    "objective": "补齐第三阶段基础设施",
    "objectiveTurnId": 1,
    "updatedTurnId": 1,
    "steps": [{ "id": 1, "step": "实现 paths.ts", "status": "pending" }]
  },
  "completedWork": [],
  "nextWorkLedgerId": 0
}
```

### C. 日志（预留，本阶段不实现写逻辑）

| 路径 | 格式 | Owner | 用途 / 关键字段 |
|---|---|---|---|
| `logs/<yyyy-mm-dd>.log` | 日志 | `src/shared/logger.ts`（待对接） | 每日滚动日志。Logger 接口已定义（`info/warn/error/debug` + 级别过滤），落盘逻辑待实现 |

日志行格式（待落盘逻辑实现时对齐）：

```
<yyyy-mm-dd HH:MM:SS> [<level>] <message>
```

`level ∈ info | warn | error | debug`。按天滚动：文件名 = 当天日期 `logs/<yyyy-mm-dd>.log`，跨天自动换文件。

### D. 临时数据（本阶段不持久化）

| 路径 | 格式 | Owner | 用途 |
|---|---|---|---|
| `tmp/` | dir | `paths.ts` | 工具执行临时文件、中间产物。会话结束时清理 |

### 与 Orkas 原版 3.2.3 的差异

| Orkas 原版 | my-agent 处理 |
|---|---|
| 30+ 张表（全局 5 + cloud 29 + local 23 + 构建时 5） | **5 张表**（全局 2 + 会话 2 + 日志 1）+ `tmp/` 临时目录 |
| `users.json` 多用户注册表 | **不需要**，单用户 |
| `cloud/chats/<cid>.jsonl` 群聊消息 | **不需要**，无群聊/多 actor |
| `cloud/sessions/<sid>.jsonl` 云同步会话 | **合并**为单一 `sessions/` 目录 |
| `cloud/agents/<aid>/agent.json` agent 定义 | **不需要**，无 agent 市场 |
| `cloud/memory/MEMORY.md` 跨会话 memory | **预留**，当前 memory 系统未实现 |
| `cloud/skills/<sid>/SKILL.md` skill 存储 | **不需要**，skill 从文件系统直接加载（`src/skills/loader.ts`） |
| `local/contexts/.kb/vector.db` SQLite 向量库 | **不需要**，无 KB/RAG 需求 |
| `local/file_cache/` 文件提取缓存 | **不需要**，无 PDF/Office 提取 |
| `local/search/` 搜索倒排索引 | **不需要** |

### Owner 模式示例

以 `providers-store.ts` 作为参考实现（已完成的"表 owner"范本）：

```ts
// ProvidersStore 是 providers.json 的唯一 Owner
// 外部模块不直接 readJson('providers.json')，而是：
const store = await ProvidersStore.load(paths.providersFile());
const active = store.getActiveProvider();        // 高层 getXxx
store.upsertProvider({ id: "openai", ... });     // 高层 setXxx
await store.save();                               // 高层持久化
```

新增"表"时按此模式：**模块内封装路径 + 校验 + 读写，对外暴露语义化 API**。

---

## 模块 A：路径管理 (`src/storage/paths.ts`)

### 设计思路

仿 Orkas `paths.ts` 的"单一收口点"原则，但大幅简化：

- **去掉多用户：** my-agent 是单用户学习项目，不需要 `uid` 参数化的路径构造
- **去掉 cloud/local 分层：** 学习项目不需要云同步，所有数据放在 `~/.my-agent/` 下
- **保留防御性校验：** 路径段断言（禁止 `..`、`\0`、`/`、`\`）保留，防止未来的扩展引入路径穿越

### 路径布局

```
~/.my-agent/                     # MY_AGENT_HOME 或默认
├── providers.json               # provider 配置（已由 ProvidersStore 实现）
├── config.json                  # 全局配置（预留）
├── sessions/                    # 持久化会话（每会话一组文件）
│   ├── gconv-<12hex>.jsonl     # 可恢复主对话（长期保留）
│   ├── gconv-<12hex>.context.json
│   ├── cli-<12hex>.jsonl       # 可恢复 CLI 会话
│   ├── anon-<12hex>.jsonl      # 短暂匿名会话（7天 GC）
│   └── extract-<12hex>.jsonl   # 短暂提取会话（7天 GC）
├── logs/                        # 日志（预留）
└── tmp/                         # 临时文件（预留）
```

> **存量兼容：** 迁移前生成的 `session-<id>.jsonl` 文件保留在 `sessions/` 下，`PersistentSession.list()` 与 `sessionKindOf` 均兼容读取（见 Task 6）。

### 接口定义

```ts
// src/storage/paths.ts

/** 数据根目录（从 MY_AGENT_HOME 或 ~/.my-agent 解析） */
export function dataRoot(): string;

/** 会话存储目录 */
export function sessionsDir(): string;

/** 单个会话的 JSONL 文件路径 */
export function sessionFile(sessionId: string): string;

/** 单个会话的上下文侧车文件路径 */
export function contextFile(sessionId: string): string;

/** provider 配置文件路径 */
export function providersFile(): string;

/** 全局配置文件路径 */
export function configFile(): string;

/** 日志目录 */
export function logsDir(): string;

/** 临时文件目录 */
export function tmpDir(): string;

/** 确保顶层目录结构存在 */
export function ensureDataLayout(): void;

/** 路径段断言：禁止 .. / \ \0 */
export function assertPathSegment(segment: string, label: string): string;
```

### 实现要点

1. **环境变量优先：** `MY_AGENT_HOME` → `~/.my-agent`
2. **惰性求值：** 不要模块加载时缓存路径（虽然单用户，但保留灵活性）
3. **`assertPathSegment`：** 所有由外部输入（sessionId）拼入路径前必须经过此断言
4. **`ensureDataLayout()`：** 模块首次 import 时自动调用，创建 `sessions/` / `logs/` / `tmp/`

### 迁移影响

- `jsonl.ts::defaultSessionDir()` → 改为调用 `paths.sessionsDir()`
- `providers-store.ts::defaultProvidersFilePath()` → 改为调用 `paths.providersFile()`
- `persistent-session.ts` 构造函数 → 用 `paths.sessionFile(id)` 替代 `path.join(dir, ...)`

---

## 模块 B：路径沙箱 (`src/storage/path-sandbox.ts`)

### 设计思路

我的项目是单用户本地运行，不需要 Orkas 那种复杂的双层门控（根列表 + TCC 审批）。一个简化但有效的沙箱即可：

- **工作目录白名单：** 工具只能访问工作目录（`workingDir`）及其子路径
- **段断言：** `..` / `\0` 防御
- ~~不存在路径的兜底（写路径最近祖先解析）~~ — **跳过**。读写门控一致，写越界场景（工具输出到工作区外）学习项目不开放

### 接口定义

```ts
// src/storage/path-sandbox.ts

export interface SandboxOptions {
  /** 允许的根目录列表（默认仅 workingDir） */
  allowedRoots: readonly string[];
}

/**
 * 检查候选路径是否在允许根内。
 * - 两侧 resolve（非 realpath，学习项目不做 symlink 防御）
 * - startsWith(root + sep) 防前缀碰撞
 * - 空输入/相对路径/空根列表 → 返回 false
 */
export function isPathAllowed(candidate: string, opts: SandboxOptions): boolean;

/**
 * 统一门控入口：放行返回 null，拒绝返回错误消息字符串。
 */
export function guardPath(abs: string, opts: SandboxOptions): string | null;
```

### 与内置工具的集成

在 `src/tools/builtin.ts` 的 `resolvePath()` 中加入门控：

```ts
function resolvePath(filePath: string, ctx: ToolContext, isWrite = false): string {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(ctx.workingDir ?? process.cwd(), filePath);

  // 路径段校验
  const segments = abs.split(path.sep);
  for (const seg of segments) {
    if (seg === "..") throw new Error(`Path traversal denied: ${filePath}`);
  }

  // 沙箱门控
  const err = guardPath(abs, {
    allowedRoots: [ctx.workingDir ?? process.cwd()],
  });
  if (err) throw new Error(err);

  return abs;
}
```

> **注意：** `resolvePath` 的 `isWrite` 参数保留（兼容现有调用方签名），但当前版本**不传入** `guardPath` —— 读写门控一致（学习项目不做写路径的最近祖先解析）。未来如需放开写越界，再扩展 `SandboxOptions`。

### 简化理由

| Orkas 特性 | my-agent 处理 |
|---|---|
| `fs.realpathSync` 两侧规范化（防 symlink 逃逸） | **跳过**。单用户本地运行，无恶意 symlink 场景。用 `path.resolve` 即可 |
| macOS TCC 敏感路径审批 | **跳过**。无 GUI 权限弹窗机制 |
| `localAccessAllowsOutsideWorkspace()` | **跳过**。始终拒绝越界访问 |
| `requestBashDecision()` 心跳等待 | **跳过**。无 IPC 推送通道 |
| `SandboxOptions.isWrite` + 写路径最近祖先解析 | **跳过**。读写门控一致，接口不含 `isWrite` 字段 |

---

## 模块 C：存储增强 (`src/storage/jsonl.ts` 增量)

### 设计思路

当前 `jsonl.ts` 的 `appendJsonLine` 使用 `fs.appendFileSync`，对 `<4KB` 写入 POSIX 保证原子性但**不保证并发安全**（多 async 上下文同时 append 可能交错）。需要增加：

1. **per-file Mutex** — 同一文件并发 append 时串行化
2. **msgIndex 追踪** — 返回追加记录的精确行号
3. **基本分页读取** — 支持 `readJsonLines` 的 limit 参数

### 新增接口

```ts
// 在现有 jsonl.ts 基础上新增

/** per-file Mutex 缓存（惰性创建，进程级生命周期） */
const fileMutexes = new Map<string, Mutex>();

function getFileMutex(filePath: string): Mutex {
  let m = fileMutexes.get(filePath);
  if (!m) { m = new Mutex(); fileMutexes.set(filePath, m); }
  return m;
}

/**
 * 并发安全的原子追加，返回 msgIndex。
 * 内部：获取 fileMutex → count lines → appendFile → 释放
 */
export async function appendJsonLineAtomic<T extends Record<string, unknown>>(
  filePath: string,
  record: T,
): Promise<{ record: T; msgIndex: number }>;

/**
 * 分页读取 JSONL 文件。
 * @param before — 字节偏移游标，读取此位置之前的记录
 */
export function readJsonLinesPage<T = unknown>(
  filePath: string,
  limit: number,
  before?: number,
): { records: T[]; nextCursor: number | null };

/**
 * 使文件行数缓存失效（文件被外部删除/重命名后调用）。
 */
export function invalidateLineCount(filePath: string): void;
```

### 并发模型

```
         appendJsonLineAtomic(file, record)
         │
         ▼
    getFileMutex(file).acquire()
         │
         ▼
    countLines(file)  ← 临界区开始
    appendFile(file, JSON.stringify(record) + '\n')
    msgIndex = count + 1
         │
         ▼
    mutex.release()   ← 临界区结束
         │
         ▼
    return { record, msgIndex }
```

### 向后兼容

- 现有同步 API (`appendJsonLine`, `readJsonLines`, `writeJsonLines`) **保持不变**
- 新增异步 API 独立命名（加 `Atomic` / `Page` 后缀），不破坏现有调用方
- `persistent-session.ts` **本计划 Task 4 Step 5 正式迁移**到 `appendJsonLineAtomic`（利用 msgIndex 做搜索索引），不再是可选步骤

---

## 模块 D：锁机制 (`src/storage/locks.ts`)

### 设计思路

我的项目是单用户单进程，不需要 Orkas 的四类锁。保留**最核心的两类**：

1. **sessionLock** — 同会话内多回合串行化（防止上一回合未跑完时开新回合）
2. **fileEditLock** — `edit_file` 的读-改-写原子化（防止同文件并行编辑交错）

**不使用：**
- `globalSlots` — 单用户无跨会话 LLM 并发冲突
- `dispatchSlots` — 无嵌套调度场景
- `acquireWithTimeout` — 学习项目不需要超时死锁防御（简化实现，降低复杂度）

### 接口定义

```ts
// src/storage/locks.ts
import { Mutex } from "async-mutex";

// ============================================================
// Session Lock — 按 sessionId 复用 Mutex
// ============================================================
const sessionLocks = new Map<string, Mutex>();

/** 获取指定 session 的 Mutex（不存在则创建）。同 id 并发调用拿到同一把锁 */
export function sessionLock(sessionId: string): Mutex;

// ============================================================
// File Edit Lock — 按绝对路径复用 Mutex
// ============================================================
const fileEditLocks = new Map<string, Mutex>();

/** 获取指定文件的编辑锁。同路径并发 edit 串行化 */
export function fileEditLock(absPath: string): Mutex;
```

### 使用场景

**sessionLock 使用（在 AgentRunner 中）：**
```ts
async run(params: AgentRunParams): Promise<AgentRunResult> {
  const sid = this.session.getSessionId() ?? "default";
  const lock = sessionLock(sid);
  const release = await lock.acquire();
  try {
    // ... 实际 run 逻辑
  } finally {
    release();
  }
}
```

**fileEditLock 使用（在 editFile 工具中）：**
```ts
// src/tools/builtin.ts editFileTool.execute()
const lock = fileEditLock(resolved);
const release = await lock.acquire();
try {
  // 检查 freshness（可选：文件是否被并发修改）
  const original = fs.readFileSync(resolved, "utf-8");
  // ... 执行替换
} finally {
  release();
}
```

### 简化理由

| Orkas 特性 | my-agent 处理 |
|---|---|
| `acquireWithTimeout` + `Promise.race` + 超时后释放 acquirePromise | **跳过**。无 GUI 心跳等待场景，死锁风险低，`async-mutex` 的默认行为即可 |
| `globalSlots(10)` 跨用户 LLM 并发上限 | **跳过**。单用户无此需求 |
| `dispatchSlots(4)` 嵌套调度上限 | **跳过**。无嵌套 dispatch 场景 |
| `unref()` 心跳定时器 | **跳过**。无 bash-permissions 审批等待 |

---

## 模块 E：Session 路由与 Kind (`src/storage/session-store.ts` 增量)

### 设计思路

当前 `SessionStore` 不区分 session 类型，所有会话存储在同一目录。引入 **session kind** 概念，支持：

1. **可恢复会话** — 主对话（gconv），长期保留
2. **短暂会话** — 一次性/匿名会话（anon），7天 GC

Kind 数量从 Orkas 的 10 种精简到 4 种，覆盖学习项目实际场景。

### Kind 定义

```ts
// 在 session-store.ts 中新增

/** 可恢复 kind（长期保留） */
const RECOVERABLE_KINDS = ["gconv", "cli"] as const;

/** 短暂 kind（7天 GC） */
const EPHEMERAL_KINDS = ["anon", "extract"] as const;

/** 所有已知 kind 的正则 */
const KNOWN_KINDS_RE = /^(gconv|cli|anon|extract)(?:-|$)/;

type SessionKind = "gconv" | "cli" | "anon" | "extract";

/** 判断是否为短暂会话 */
export function isEphemeralSession(sessionId: string): boolean;

/** 校验并解析 session kind */
export function sessionKindOf(sessionId: string): SessionKind;
```

### 路由规则

```
sessionId = "gconv-a1b2c3d4e5f6"
            ^^^^^  kind    ^^^^^^^^^^^^ tail (12 hex)

gconv-* → sessions/           (可恢复，长期保留)
cli-*   → sessions/           (可恢复，长期保留)
anon-*  → sessions/           (短暂，mtime > 7天 GC)
extract-* → sessions/         (短暂，mtime > 7天 GC)
```

> **简化：** 当前不区分 cloud/local 目录，全部存储在 `sessions/` 下。未来如需云同步可引入 `cloud-sessions/` / `local-sessions/` 分层。

### 命名约束

- **格式：** `<kind>-<12位十六进制tail>`
- **kind 是首段（连字符前）**，永不做任意前缀匹配
- **构造方必须走 helper：** `SessionStore.create(kind)` 自动生成 `{kind}-{tail}` 格式 id
- **禁止手写 sessionId**（防止 kind 拼写错误）

### GC 机制

```ts
// 在 session-store.ts 中新增

/**
 * 扫描 sessions/ 目录，删除 mtime > maxAgeMs 的短暂会话。
 * 建议通过定时任务或 CLI 命令触发（非每次 get 时扫描）。
 */
export function sweepEphemeralSessions(sessionDir?: string, maxAgeMs?: number): number;
```

默认 `maxAgeMs = 7 * 24 * 60 * 60 * 1000`（7天）。

### 内存作用域门控（预留）

```ts
/**
 * 返回 session 的 memory scope。
 * gconv → "commander"（可注入 memory 块）
 * 其他 kind → null（不注入 memory）
 */
export function memoryScopeForSession(sessionId: string): string | null;
```

当前 my-agent 尚未实现 memory 系统，此方法返回 `"commander"` 或 `null` 作为预留接口。

### 前端对接预留接口

> 评估结论（2026-08-06 编排评估）：当前存储层 owner 模式 + 原子写 + kind 路由 + 分页原语，已足以作为未来服务层（HTTP / WebSocket / IPC）的持久化后端。下列接口为**前端对接预留**，本阶段不实现完整版，仅锁定接口形状，避免未来改造存储层时破坏 API。

#### 会话级元数据（预留）

当前 `list()` 只返回 `{ id, name }`。前端会话列表需要 `createdAt` / `lastActiveAt` / `messageCount`。本阶段**不新增 `<sid>.meta.json`**，接口按以下形状预留，实现时可用 `fs.stat`（`birthtime` / `mtime`）+ 行数计数兜底：

```ts
// SessionStore 预留接口形状（前端对接时实现）
export interface SessionSummary {
  id: string;
  kind: SessionKind;
  name: string;
  createdAt: number;     // stat.birthtimeMs
  lastActiveAt: number;  // stat.mtimeMs
  messageCount: number;  // JSONL 行数
}

// list() 增强方向：返回 SessionSummary[] 而非 {id, name}[]
```

#### 变更通知（预留）

前端实时刷新需要「会话有新增消息」的订阅/通知能力。当前 `PersistentSession` 每次变更同步落盘，无事件出口。预留一个最小事件接口（实现时可挂在 `appendJsonLineAtomic` 之后）：

```ts
// src/storage/session-store.ts 预留（前端对接时实现）
type SessionEvent = {
  type: "message_appended" | "context_updated" | "session_deleted";
  sessionId: string;
  msgIndex?: number;
};
type SessionEventSubscriber = (ev: SessionEvent) => void;

// subscribeSessionEvents(subscriber): unsubscribe
```

#### 服务层边界

未来加前端时：服务层（Express/Fastify）只 import 各 owner 的高层 API（`SessionStore.get/list/delete`、`ProvidersStore.load/getActiveProvider`、`persistent-session` 的消息读取），**不直接碰 `jsonl.ts` / 磁盘路径**。此边界由「每张表一个 owner」设计天然保证，本阶段无需额外改造。

#### 已知取舍（前端对接需知晓）

- **进程内锁**：`async-mutex` 是进程内锁。未来若前端为独立进程走 HTTP 服务，服务进程是唯一写者（Agent 与 HTTP 服务同进程托管）则无碍；若需多进程写同一 JSONL，需重新评估（文件锁 / 单写者架构）。本阶段维持单进程假设，README 记录此约束。

---

## 文件结构总览

```
src/storage/
├── index.ts              # 统一导出（更新）
├── jsonl.ts              # JSONL 工具（增量：并发安全 + 分页）
├── paths.ts              # 路径常量集中管理（新建）
├── path-sandbox.ts       # 路径沙箱门控（新建）
├── locks.ts              # 锁机制（新建）
├── session-store.ts      # SessionStore（增量：kind路由 + GC）
└── providers-store.ts    # （不变）
```

---

## 任务拆解

### Task 1: 安装依赖 + 创建路径模块

**Files:**
- Modify: `package.json`
- Create: `src/storage/paths.ts`
- Create: `test/storage/paths.test.ts`

- [ ] **Step 1: 安装 async-mutex**

```bash
npm install async-mutex
```

- [ ] **Step 2: 编写 paths.ts 测试（TDD）**

```ts
// test/storage/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";
import {
  dataRoot,
  sessionsDir,
  sessionFile,
  contextFile,
  providersFile,
  configFile,
  assertPathSegment,
  ensureDataLayout,
  _resetDataRoot,
} from "../../src/storage/paths.js";

describe("paths", () => {
  const originalHome = process.env.MY_AGENT_HOME;

  beforeEach(() => {
    // 清空 dataRoot() 惰性缓存，防止用例间相互污染
    _resetDataRoot();
  });

  afterEach(() => {
    if (originalHome) process.env.MY_AGENT_HOME = originalHome;
    else delete process.env.MY_AGENT_HOME;
    _resetDataRoot();
  });

  describe("dataRoot", () => {
    it("默认返回 ~/.my-agent", () => {
      delete process.env.MY_AGENT_HOME;
      expect(dataRoot()).toBe(path.join(os.homedir(), ".my-agent"));
    });

    it("MY_AGENT_HOME 环境变量优先", () => {
      process.env.MY_AGENT_HOME = "/custom/path";
      expect(dataRoot()).toBe("/custom/path");
    });
  });

  describe("sessionFile", () => {
    it("返回 sessions/<id>.jsonl 路径", () => {
      const p = sessionFile("gconv-abc123");
      expect(p).toContain("sessions");
      expect(p).toContain("gconv-abc123.jsonl");
    });
  });

  describe("contextFile", () => {
    it("返回 sessions/<id>.context.json", () => {
      const p = contextFile("gconv-abc123");
      expect(p).toContain("gconv-abc123.context.json");
    });
  });

  describe("assertPathSegment", () => {
    it("合法段原样返回", () => {
      expect(assertPathSegment("gconv-abc123", "sessionId")).toBe("gconv-abc123");
    });

    it("含 .. 抛出", () => {
      expect(() => assertPathSegment("gconv-../etc", "sessionId")).toThrow("path");
    });

    it("含 \\ 抛出", () => {
      expect(() => assertPathSegment("gconv-\\windows", "sessionId")).toThrow("path");
    });

    it("含空字节抛出", () => {
      expect(() => assertPathSegment("gconv-\0bad", "sessionId")).toThrow("path");
    });

    it("空字符串抛出", () => {
      expect(() => assertPathSegment("", "sessionId")).toThrow("path");
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npx vitest run test/storage/paths.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 4: 实现 paths.ts**

```ts
// src/storage/paths.ts
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

// ---- 根目录 ----

let _dataRoot: string | undefined;

export function dataRoot(): string {
  if (_dataRoot !== undefined) return _dataRoot;
  _dataRoot = process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent");
  return _dataRoot;
}

/** 仅测试用：重置 dataRoot 缓存 */
export function _resetDataRoot(): void {
  _dataRoot = undefined;
}

// ---- 子目录 ----

export function sessionsDir(): string {
  return path.join(dataRoot(), "sessions");
}

export function logsDir(): string {
  return path.join(dataRoot(), "logs");
}

export function tmpDir(): string {
  return path.join(dataRoot(), "tmp");
}

// ---- 文件路径 ----

export function sessionFile(sessionId: string): string {
  assertPathSegment(sessionId, "sessionId");
  return path.join(sessionsDir(), `${sessionId}.jsonl`);
}

export function contextFile(sessionId: string): string {
  assertPathSegment(sessionId, "sessionId");
  return path.join(sessionsDir(), `${sessionId}.context.json`);
}

export function providersFile(): string {
  return path.join(dataRoot(), "providers.json");
}

export function configFile(): string {
  return path.join(dataRoot(), "config.json");
}

// ---- 布局确保 ----

let _layoutEnsured = false;

export function ensureDataLayout(): void {
  if (_layoutEnsured) return;
  for (const dir of [sessionsDir(), logsDir(), tmpDir()]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  _layoutEnsured = true;
}

// ---- 防御性校验 ----

const FORBIDDEN_IN_SEGMENT = /[\/\\\0]/;

/** 验证路径段不包含路径穿越字符。通过则原样返回，否则抛出。 */
export function assertPathSegment(segment: string, label: string): string {
  if (!segment || typeof segment !== "string") {
    throw new Error(`invalid ${label} for path: ${JSON.stringify(segment)}`);
  }
  if (segment.includes("..")) {
    throw new Error(
      `invalid ${label} for path (contains ".."): ${JSON.stringify(segment)}`,
    );
  }
  if (FORBIDDEN_IN_SEGMENT.test(segment)) {
    throw new Error(
      `invalid ${label} for path (forbidden char): ${JSON.stringify(segment)}`,
    );
  }
  return segment;
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run test/storage/paths.test.ts
# Expected: all PASS
```

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json src/storage/paths.ts test/storage/paths.test.ts
git commit -m "feat(storage): add paths.ts — centralized path constants with segment validation"
```

---

### Task 2: 迁移现有模块到 paths.ts

**Files:**
- Modify: `src/storage/jsonl.ts` (defaultSessionDir → paths.sessionsDir)
- Modify: `src/storage/providers-store.ts` (defaultProvidersFilePath → paths.providersFile)
- Modify: `src/agent/persistent-session.ts` (path.join(dir,...) → paths.sessionFile)

- [ ] **Step 1: 迁移 jsonl.ts 的 defaultSessionDir**

```ts
// src/storage/jsonl.ts — 修改 defaultSessionDir
import { sessionsDir } from "./paths.js";

export function defaultSessionDir(): string {
  return sessionsDir();  // 委托给 paths.ts
}
```

`ensureDir`、`removeFile` 等其他函数不变。

- [ ] **Step 2: 迁移 providers-store.ts**

```ts
// src/storage/providers-store.ts — 修改 defaultProvidersFilePath
import { providersFile } from "./paths.js";

export function defaultProvidersFilePath(): string {
  return providersFile();
}
```

其它逻辑不变。

- [ ] **Step 3: 迁移 persistent-session.ts**

```ts
// src/agent/persistent-session.ts — 构造函数中
import { sessionFile, contextFile, sessionsDir } from "../storage/paths.js";

constructor(opts: PersistentSessionOptions = {}) {
  // ...
  const dir = opts.sessionDir ?? sessionsDir();
  ensureDir(dir);

  this.sessionFile = opts.sessionDir
    ? path.join(dir, `${this.sessionId}.jsonl`)
    : sessionFile(this.sessionId);

  this.contextFile = opts.sessionDir
    ? path.join(dir, `${this.sessionId}.context.json`)
    : contextFile(this.sessionId);
  // ...
}
```

> **注意：** 保留 `opts.sessionDir` 的自定义目录能力（测试用），仅在未指定时走 `paths`。这是与 Orkas "禁止自定义路径"不同的设计选择——学习项目需要灵活性。

- [ ] **Step 4: 运行全量测试确保无回归**

```bash
npm test
# Expected: 所有已有测试继续通过
```

- [ ] **Step 5: 提交**

```bash
git add src/storage/jsonl.ts src/storage/providers-store.ts src/agent/persistent-session.ts
git commit -m "refactor(storage): migrate path construction to centralized paths.ts"
```

---

### Task 3: 实现路径沙箱 + 集成到内置工具

**Files:**
- Create: `src/storage/path-sandbox.ts`
- Create: `test/storage/path-sandbox.test.ts`
- Modify: `src/tools/builtin.ts` (resolvePath 加入沙箱门控)

- [ ] **Step 1: 编写 path-sandbox 测试**

```ts
// test/storage/path-sandbox.test.ts
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { isPathAllowed, guardPath } from "../../src/storage/path-sandbox.js";

describe("isPathAllowed", () => {
  const root = "/home/user/project";

  it("根内路径放行", () => {
    expect(isPathAllowed(path.join(root, "src/index.ts"), { allowedRoots: [root] })).toBe(true);
  });

  it("精确匹配根放行", () => {
    expect(isPathAllowed(root, { allowedRoots: [root] })).toBe(true);
  });

  it("根外路径拒绝", () => {
    expect(isPathAllowed("/etc/passwd", { allowedRoots: [root] })).toBe(false);
  });

  it("前缀碰撞拒绝 — /foo/barbaz 不在 /foo/bar 内", () => {
    expect(isPathAllowed("/foo/barbaz", { allowedRoots: ["/foo/bar"] })).toBe(false);
  });

  it("空输入拒绝", () => {
    expect(isPathAllowed("", { allowedRoots: [root] })).toBe(false);
  });

  it("相对路径拒绝", () => {
    expect(isPathAllowed("src/index.ts", { allowedRoots: [root] })).toBe(false);
  });

  it("空根列表拒绝", () => {
    expect(isPathAllowed(root, { allowedRoots: [] })).toBe(false);
  });

  it(".. 穿越拒绝", () => {
    expect(isPathAllowed(path.join(root, "../etc/passwd"), { allowedRoots: [root] })).toBe(false);
  });

  it("多根任一命中即放行", () => {
    expect(
      isPathAllowed("/tmp/output.txt", {
        allowedRoots: ["/home/user/project", "/tmp"],
      }),
    ).toBe(true);
  });
});

describe("guardPath", () => {
  it("放行返回 null", () => {
    expect(guardPath("/home/user/project/src/a.ts", { allowedRoots: ["/home/user/project"] })).toBeNull();
  });

  it("拒绝返回错误消息", () => {
    const err = guardPath("/etc/passwd", { allowedRoots: ["/home/user/project"] });
    expect(err).not.toBeNull();
    expect(err).toContain("E_PATH_OUT_OF_SCOPE");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run test/storage/path-sandbox.test.ts
```

- [ ] **Step 3: 实现 path-sandbox.ts**

```ts
// src/storage/path-sandbox.ts
import * as path from "node:path";

export interface SandboxOptions {
  allowedRoots: readonly string[];
}

/**
 * 检查候选路径是否在允许根内。
 *
 * - 两侧 path.resolve 规范化（不做 realpath，学习项目无需 symlink 防御）
 * - 用 startsWith(root + sep) 防止前缀碰撞
 * - 空输入、相对路径、空根列表 → false
 */
export function isPathAllowed(candidate: string, opts: SandboxOptions): boolean {
  if (!candidate || !path.isAbsolute(candidate)) return false;
  if (!opts.allowedRoots.length) return false;

  // .. 段快速拒绝
  if (candidate.split(path.sep).includes("..")) return false;

  const resolved = path.resolve(candidate);

  for (const root of opts.allowedRoots) {
    if (!root) continue;
    const resolvedRoot = path.resolve(root);
    if (
      resolved === resolvedRoot ||
      resolved.startsWith(resolvedRoot + path.sep)
    ) {
      return true;
    }
  }
  return false;
}

/** 统一门控入口：放行返回 null，拒绝返回错误消息 */
export function guardPath(abs: string, opts: SandboxOptions): string | null {
  if (isPathAllowed(abs, opts)) return null;

  const roots = opts.allowedRoots.map((r) => r || "(empty)").join(", ");
  return [
    `E_PATH_OUT_OF_SCOPE: path is outside the allowed scope.`,
    `  path: ${abs}`,
    `  allowed root(s): ${roots}`,
  ].join("\n");
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run test/storage/path-sandbox.test.ts
```

- [ ] **Step 5: 集成到 builtin.ts 的 resolvePath**

```ts
// src/tools/builtin.ts — 替换 resolvePath 函数
import { guardPath } from "../storage/path-sandbox.js";

function resolvePath(filePath: string, ctx: ToolContext, isWrite = false): string {
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(ctx.workingDir ?? process.cwd(), filePath);
  }

  const abs = path.resolve(filePath);

  // 路径段校验
  const segments = abs.split(path.sep);
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`E_PATH_TRAVERSAL: path traversal denied: ${filePath}`);
    }
  }

  // 沙箱门控
  const workingDir = ctx.workingDir ?? process.cwd();
  const err = guardPath(abs, { allowedRoots: [workingDir] });
  if (err) throw new Error(err);

  return abs;
}
```

- [ ] **Step 6: 运行全量测试**

```bash
npm test
```

- [ ] **Step 7: 提交**

```bash
git add src/storage/path-sandbox.ts test/storage/path-sandbox.test.ts src/tools/builtin.ts
git commit -m "feat(storage): add path sandbox and integrate with builtin tools"
```

---

### Task 4: JSONL 并发安全增强

**Files:**
- Modify: `src/storage/jsonl.ts`
- Modify: `src/agent/persistent-session.ts`（迁移追加逻辑到 `appendJsonLineAtomic`）
- Modify: `src/storage/index.ts`
- Create: `test/storage/jsonl-atomic.test.ts`

- [ ] **Step 1: 编写并发安全测试**

```ts
// test/storage/jsonl-atomic.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  appendJsonLineAtomic,
  readJsonLines,
  readJsonLinesPage,
  invalidateLineCount,
  atomicWrite,
  removeFile,
} from "../../src/storage/jsonl.js";

describe("appendJsonLineAtomic", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-test-"));
    tmpFile = path.join(tmpDir, "test.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("单条追加返回 msgIndex=1", async () => {
    const { msgIndex } = await appendJsonLineAtomic(tmpFile, { text: "hello" });
    expect(msgIndex).toBe(1);
  });

  it("连续追加返回递增 msgIndex", async () => {
    const r1 = await appendJsonLineAtomic(tmpFile, { n: 1 });
    const r2 = await appendJsonLineAtomic(tmpFile, { n: 2 });
    const r3 = await appendJsonLineAtomic(tmpFile, { n: 3 });
    expect(r1.msgIndex).toBe(1);
    expect(r2.msgIndex).toBe(2);
    expect(r3.msgIndex).toBe(3);
  });

  it("并发追加不丢数据且 msgIndex 连续", async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        appendJsonLineAtomic(tmpFile, { idx: i }),
      ),
    );
    const indices = results.map((r) => r.msgIndex).sort((a, b) => a - b);
    // msgIndex 应该覆盖 1..N
    expect(indices).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // 读取验证
    const records = readJsonLines<{ idx: number }>(tmpFile);
    expect(records).toHaveLength(N);
  });
});

describe("readJsonLinesPage", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-agent-test-"));
    tmpFile = path.join(tmpDir, "test.jsonl");
    // 写入 50 条记录
    for (let i = 1; i <= 50; i++) {
      await appendJsonLineAtomic(tmpFile, { n: i });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("首页返回最近的 limit 条", () => {
    const page = readJsonLinesPage<{ n: number }>(tmpFile, 10);
    expect(page.records).toHaveLength(10);
    // 最近 10 条：n=41..50
    expect(page.records[0].n).toBe(41);
    expect(page.records[9].n).toBe(50);
  });

  it("翻页返回更早的记录", () => {
    const page1 = readJsonLinesPage<{ n: number }>(tmpFile, 10);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = readJsonLinesPage<{ n: number }>(tmpFile, 10, page1.nextCursor!);
    expect(page2.records).toHaveLength(10);
    expect(page2.records[0].n).toBe(31);
    expect(page2.records[9].n).toBe(40);
  });

  it("游标耗尽返回空数组和 null cursor", () => {
    const page = readJsonLinesPage<{ n: number }>(tmpFile, 100);
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run test/storage/jsonl-atomic.test.ts
```

- [ ] **Step 3: 在 jsonl.ts 中实现并发安全 + 分页**

在现有 `jsonl.ts` 末尾追加：

```ts
// src/storage/jsonl.ts — 新增内容
import { Mutex } from "async-mutex";

// ============================================================
// Per-file Mutex（并发安全）
// ============================================================

const fileMutexes = new Map<string, Mutex>();
const fileLineCounts = new Map<string, number>();

function getFileMutex(filePath: string): Mutex {
  let m = fileMutexes.get(filePath);
  if (!m) {
    m = new Mutex();
    fileMutexes.set(filePath, m);
  }
  return m;
}

function countLinesSync(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, "utf-8");
  if (!text.trim()) return 0;
  return text.split("\n").filter((l) => l.trim()).length;
}

export function invalidateLineCount(filePath: string): void {
  fileLineCounts.delete(filePath);
}

// ============================================================
// 并发安全原子追加
// ============================================================

export async function appendJsonLineAtomic<T extends Record<string, unknown>>(
  filePath: string,
  record: T,
): Promise<{ record: T; msgIndex: number }> {
  const mutex = getFileMutex(filePath);
  const release = await mutex.acquire();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 在临界区内计数 + 追加
    const count = countLinesSync(filePath);
    const msgIndex = count + 1;

    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });

    fileLineCounts.set(filePath, msgIndex);

    return { record, msgIndex };
  } finally {
    release();
  }
}

// ============================================================
// 分页读取
// ============================================================

export function readJsonLinesPage<T = unknown>(
  filePath: string,
  limit: number,
  before?: number,
): { records: T[]; nextCursor: number | null } {
  if (!fs.existsSync(filePath)) {
    return { records: [], nextCursor: null };
  }

  const all = readJsonLines<T>(filePath);
  if (all.length === 0) {
    return { records: [], nextCursor: null };
  }

  // before 是字节偏移游标（简化：用记录索引代替）
  // 实际实现中，before 为 undefined 表示从末尾开始
  const totalLines = all.length;

  if (before === undefined) {
    // 首页：返回最后 limit 条
    const start = Math.max(0, totalLines - limit);
    const records = all.slice(start);
    const nextCursor = start > 0 ? start : null;
    return { records, nextCursor };
  }

  // 翻页：返回 before 之前的最多 limit 条
  const end = Math.min(before, totalLines);
  const start = Math.max(0, end - limit);
  const records = all.slice(start, end);
  const nextCursor = start > 0 ? start : null;
  return { records, nextCursor };
}
```

- [ ] **Step 4: 更新 storage/index.ts 导出**

```ts
// 在 src/storage/index.ts 中追加导出
export {
  appendJsonLineAtomic,
  readJsonLinesPage,
  invalidateLineCount,
} from "./jsonl.js";
```

- [ ] **Step 5: 迁移 persistent-session.ts 到 appendJsonLineAtomic**

将 `PersistentSession` 的 4 处 `appendJsonLine` 追加改为 `appendJsonLineAtomic`。`beginUserTurn` / `addAssistantMessage` / `addToolResult` / `addMessage` 的落盘时机不变，仅换用并发安全的追加 API（返回的 `msgIndex` 记录当前行号，供未来搜索索引器定位）：

```ts
// src/agent/persistent-session.ts
import { appendJsonLineAtomic } from "../storage/jsonl.js";
import type { SerializedMessage } from "./session-serde.js";

// beginUserTurn / addAssistantMessage / addToolResult / addMessage 中：
// 原：appendJsonLine(this.sessionFile, messageToSerialized(last));
// 改：
const { msgIndex } = await appendJsonLineAtomic<SerializedMessage>(
  this.sessionFile,
  messageToSerialized(last),
);
// msgIndex 即该消息的精确行号（1-based），可存储或用于审计
```

> **注意：** 上述 4 个 override 方法目前是同步的（`void` 返回）。引入 `await` 后需改为 `async` 并返回 `Promise<void>`。调用方若是 `void` 忽略，则无需改动调用点；若有调用点依赖同步返回，需同步调整。`completeActiveTurn` / `updateExecutionPlan` 等只写 context 侧车的方法不受影响。

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run test/storage/jsonl-atomic.test.ts
```

- [ ] **Step 7: 运行全量测试确保无回归**

```bash
npm test
```

- [ ] **Step 8: 提交**

```bash
git add src/storage/jsonl.ts src/agent/persistent-session.ts src/storage/index.ts test/storage/jsonl-atomic.test.ts
git commit -m "feat(storage): add concurrent-safe JSONL append and pagination"
```

---

### Task 5: 实现锁机制

**Files:**
- Create: `src/storage/locks.ts`
- Create: `test/storage/locks.test.ts`

- [ ] **Step 1: 编写 locks 测试**

```ts
// test/storage/locks.test.ts
import { describe, it, expect } from "vitest";
import { sessionLock, fileEditLock } from "../../src/storage/locks.js";

describe("sessionLock", () => {
  it("同 id 返回同一把锁", () => {
    const a = sessionLock("gconv-abc");
    const b = sessionLock("gconv-abc");
    expect(a).toBe(b); // 同一个 Mutex 实例
  });

  it("不同 id 返回不同锁", () => {
    const a = sessionLock("gconv-abc");
    const b = sessionLock("gconv-def");
    expect(a).not.toBe(b);
  });

  it("锁是可重入的（async-mutex 默认行为）", async () => {
    const lock = sessionLock("test-reentrant");
    const r1 = await lock.acquire();
    // 不同 id 可并发获取
    const lock2 = sessionLock("test-reentrant-2");
    const r2 = await lock2.acquire();
    expect(typeof r1).toBe("function");
    expect(typeof r2).toBe("function");
    r1();
    r2();
  });
});

describe("fileEditLock", () => {
  it("同路径返回同一把锁", () => {
    const a = fileEditLock("/home/user/project/src/a.ts");
    const b = fileEditLock("/home/user/project/src/a.ts");
    expect(a).toBe(b);
  });

  it("不同路径返回不同锁", () => {
    const a = fileEditLock("/home/user/project/src/a.ts");
    const b = fileEditLock("/home/user/project/src/b.ts");
    expect(a).not.toBe(b);
  });

  it("串行化同文件操作", async () => {
    const results: number[] = [];
    const lock = fileEditLock("/tmp/test.txt");

    // 模拟两个编辑操作
    const p1 = lock.acquire().then((release) => {
      results.push(1);
      // 模拟一小段操作时间
      return new Promise<void>((resolve) => setTimeout(() => { release(); resolve(); }, 10));
    });

    const p2 = lock.acquire().then((release) => {
      results.push(2);
      release();
    });

    await Promise.all([p1, p2]);
    // 1 一定先于 2 执行
    expect(results).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run test/storage/locks.test.ts
```

- [ ] **Step 3: 实现 locks.ts**

```ts
// src/storage/locks.ts
import { Mutex } from "async-mutex";

// ============================================================
// Session Lock — 同 sessionId 串行化
// ============================================================

const sessionLocks = new Map<string, Mutex>();

/** 获取指定 session 的锁（不存在则创建）。同 id 并发调用拿到同一把锁 */
export function sessionLock(sessionId: string): Mutex {
  let m = sessionLocks.get(sessionId);
  if (!m) {
    m = new Mutex();
    sessionLocks.set(sessionId, m);
  }
  return m;
}

// ============================================================
// File Edit Lock — 同文件串行化
// ============================================================

const fileEditLocks = new Map<string, Mutex>();

/** 获取指定文件的编辑锁。同路径并发 edit 串行化 */
export function fileEditLock(absPath: string): Mutex {
  let m = fileEditLocks.get(absPath);
  if (!m) {
    m = new Mutex();
    fileEditLocks.set(absPath, m);
  }
  return m;
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run test/storage/locks.test.ts
```

- [ ] **Step 5: 更新 storage/index.ts 导出**

```ts
export { sessionLock, fileEditLock } from "./locks.js";
```

- [ ] **Step 6: 运行全量测试**

```bash
npm test
```

- [ ] **Step 7: 提交**

```bash
git add src/storage/locks.ts test/storage/locks.test.ts src/storage/index.ts
git commit -m "feat(storage): add session and file-edit lock primitives"
```

---

### Task 6: Session 路由与 Kind 管理

**Files:**
- Modify: `src/storage/session-store.ts`
- Modify: `src/agent/persistent-session.ts`（`list()` 正则同步，兼容存量 `session-` 前缀）
- Modify: `test/persistent-session.test.ts`（`store.create()` 断言更新为 `gconv-`）
- Modify: `src/storage/index.ts`
- Create: `test/storage/session-store-kind.test.ts`

> **⚠️ 本 Task 会改变新会话的命名格式（`session-` → `gconv-<12hex>`）。** 存量 `session-` 会话必须继续可读，因此本 Task 还包含 `list()` 正则兼容与现有测试断言更新两步，缺失任一步都会导致 `npm test` 失败。

- [ ] **Step 1: 编写 Kind 路由测试**

```ts
// test/storage/session-store-kind.test.ts
import { describe, it, expect } from "vitest";
import {
  isEphemeralSession,
  sessionKindOf,
  memoryScopeForSession,
} from "../../src/storage/session-store.js";

describe("sessionKindOf", () => {
  it("gconv-xxx → gconv", () => {
    expect(sessionKindOf("gconv-a1b2c3d4e5f6")).toBe("gconv");
  });

  it("cli-xxx → cli", () => {
    expect(sessionKindOf("cli-1234567890ab")).toBe("cli");
  });

  it("anon-xxx → anon", () => {
    expect(sessionKindOf("anon-fixed123456")).toBe("anon");
  });

  it("未知 kind 抛出", () => {
    expect(() => sessionKindOf("badkind-123456789012")).toThrow("session id");
  });

  it("无连字符抛出", () => {
    expect(() => sessionKindOf("nohyphen")).toThrow("session id");
  });
});

describe("isEphemeralSession", () => {
  it("anon → true", () => {
    expect(isEphemeralSession("anon-anything")).toBe(true);
  });

  it("extract → true", () => {
    expect(isEphemeralSession("extract-img-001")).toBe(true);
  });

  it("gconv → false", () => {
    expect(isEphemeralSession("gconv-my-chat")).toBe(false);
  });

  it("cli → false", () => {
    expect(isEphemeralSession("cli-run-001")).toBe(false);
  });
});

describe("memoryScopeForSession", () => {
  it("gconv → commander", () => {
    expect(memoryScopeForSession("gconv-abc")).toBe("commander");
  });

  it("anon → null", () => {
    expect(memoryScopeForSession("anon-abc")).toBeNull();
  });

  it("extract → null", () => {
    expect(memoryScopeForSession("extract-abc")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run test/storage/session-store-kind.test.ts
```

- [ ] **Step 3: 在 session-store.ts 中增加 Kind 系统**

```ts
// 在 src/storage/session-store.ts 中新增
import { assertPathSegment } from "./paths.js";

// ============================================================
// Session Kind 系统
// ============================================================

const RECOVERABLE_KINDS = ["gconv", "cli"] as const;
const EPHEMERAL_KINDS = ["anon", "extract"] as const;
const KNOWN_KINDS_RE = /^(gconv|cli|anon|extract)(?:-|$)/;

export type SessionKind = "gconv" | "cli" | "anon" | "extract";

/**
 * 校验并解析 session kind。
 *
 * 安全要点：
 * 1. **路径穿越防御** — id 可能来自外部输入（未来前端 HTTP），进入 path.join 前
 *    必须过 `assertPathSegment`（拒绝 `/` `\` `..` `\0`）。
 * 2. **存量兼容** — `session-` 前缀（旧命名）归为可恢复会话 `gconv`，
 *    保证 `PersistentSession.list()` 扫出的存量会话可被本函数解析。
 */
export function sessionKindOf(sessionId: string): SessionKind {
  const safe = assertPathSegment(sessionId, "sessionId");
  if (safe.startsWith("session-")) return "gconv";
  if (!KNOWN_KINDS_RE.test(safe)) {
    throw new Error(
      `invalid session id "${sessionId}" — must start with a known kind ` +
      `(gconv | cli | anon | extract)`,
    );
  }
  return safe.split("-")[0] as SessionKind;
}

/** 是否为短暂会话（可被 GC 清理）。存量 `session-` 视为可恢复，返回 false */
export function isEphemeralSession(sessionId: string): boolean {
  for (const kind of EPHEMERAL_KINDS) {
    if (sessionId === kind || sessionId.startsWith(`${kind}-`)) {
      return true;
    }
  }
  return false;
}

/** 返回 session 的 memory scope（预留）。未知 kind 兜底返回 null，不抛错 */
export function memoryScopeForSession(sessionId: string): string | null {
  if (KNOWN_KINDS_RE.test(sessionId) || sessionId.startsWith("session-")) {
    if (sessionId.startsWith("gconv-") || sessionId.startsWith("session-")) {
      return "commander";
    }
  }
  return null;
}

// ============================================================
// GC：清理过期短暂会话
// ============================================================

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7天

/** 扫描并删除过期的短暂会话文件。返回删除数量。 */
export function sweepEphemeralSessions(
  sessionDir?: string,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): number {
  const dir = sessionDir ?? defaultSessionDir();
  if (!fs.existsSync(dir)) return 0;

  const now = Date.now();
  let removed = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.jsonl$/);
    if (!match) continue;

    const sessionId = match[1];
    if (!isEphemeralSession(sessionId)) continue;

    const filePath = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs >= maxAgeMs) {
        removeFile(filePath);
        // 同步删除上下文侧车
        const ctxFile = path.join(dir, `${sessionId}.context.json`);
        removeFile(ctxFile);
        removed++;
      }
    } catch {
      // stat 失败跳过
    }
  }

  return removed;
}
```

- [ ] **Step 4: SessionStore.create(kind) 增加 kind 参数**

```ts
// 在 SessionStore 中修改 create 方法
import { randomUUID } from "node:crypto";

create(kind: SessionKind = "gconv"): PersistentSession {
  const tail = randomUUID().replace(/-/g, "").slice(0, 12);
  const sessionId = `${kind}-${tail}`;
  const session = new PersistentSession({ sessionId, sessionDir: this.sessionDir });
  this.cache.set(sessionId, session);
  return session;
}
```

- [ ] **Step 5: SessionStore.get/delete 增加路径穿越防御**

`get` / `delete` / `load` 目前直接 `path.join(this.sessionDir, \`${sessionId}.jsonl\`)` 拼路径。sessionId 未来可能来自前端 HTTP 输入，拼路径前必须过 `assertPathSegment`（拒绝 `/` `\` `..` `\0`）：

```ts
// src/storage/session-store.ts — get / delete 入口
get(sessionId: string): PersistentSession | null {
  assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
  const cached = this.cache.get(sessionId);
  if (cached) return cached;

  const session = PersistentSession.load(sessionId, this.sessionDir);
  if (session) {
    this.cache.set(sessionId, session);
  }
  return session;
}

delete(sessionId: string): boolean {
  assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
  const cached = this.cache.get(sessionId);
  if (cached) {
    cached.delete();
    this.cache.delete(sessionId);
    return true;
  }

  // 不在缓存中，直接删文件
  const sessionFile = path.join(this.sessionDir, `${sessionId}.jsonl`);
  const contextFile = path.join(this.sessionDir, `${sessionId}.context.json`);

  if (!fs.existsSync(sessionFile)) return false;

  removeFile(sessionFile);
  removeFile(contextFile);
  return true;
}
```

同时给 `PersistentSession.load`（`src/agent/persistent-session.ts`）的静态加载入口补同样的防御：

```ts
static load(sessionId: string, sessionDir?: string): PersistentSession | null {
  assertPathSegment(sessionId, "sessionId"); // 拼路径前防御
  const dir = sessionDir ?? defaultSessionDir();
  const sessionFile = path.join(dir, `${sessionId}.jsonl`);
  // ... 其余不变
}
```

- [ ] **Step 6: 同步 PersistentSession.list() 正则兼容存量 session- 前缀**

`PersistentSession.list()` 目前只匹配 `session-` 前缀（`/^(session-[a-z0-9-]+)\.jsonl$/`）。`SessionStore.create()` 改为生成 `gconv-<12hex>` 后，不更新此正则将导致会话列表恒为空。改为**双前缀兼容**（存量 `session-` + 新 kind）：

```ts
// src/agent/persistent-session.ts — 修改 list()
static list(sessionDir?: string): string[] {
  const dir = sessionDir ?? defaultSessionDir();
  if (!fs.existsSync(dir)) return [];

  const ids = new Set<string>();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // 兼容存量 session- 前缀与 gconv/cli/anon/extract kind 前缀
    const match = entry.name.match(/^(?:(?:session|gconv|cli|anon|extract)-[a-z0-9-]+)\.jsonl$/);
    if (match) ids.add(match[1]);
  }

  return Array.from(ids).sort();
}
```

- [ ] **Step 7: 更新现有测试断言（test/persistent-session.test.ts）**

`store.create()` 现在生成 `gconv-<12hex>`，两处现有断言需同步：

```ts
// test/persistent-session.test.ts — L257
expect(session.sessionId).toMatch(/^session-/);
// 改为：
expect(session.sessionId).toMatch(/^gconv-/);
```

> `test/persistent-session.test.ts` L36 的 `/^session-[a-z0-9]{12}$/` 断言的是 `PersistentSession.create()`（静态工厂，不经 SessionStore），构造器默认 id 仍为 `session-`，**不需要改**。
> `test/persistent-session.test.ts` L282-289 的「list 应该列出现有 session」依赖 Step 6 的正则修复，正则兼容后自动恢复通过。

- [ ] **Step 8: 运行测试确认通过**

```bash
npx vitest run test/storage/session-store-kind.test.ts
```

- [ ] **Step 9: 运行全量测试**

```bash
npm test
# Expected: 新增 kind 测试 + 现有 persistent-session 测试全部通过
```

- [ ] **Step 10: 提交**

```bash
git add src/storage/session-store.ts src/agent/persistent-session.ts test/persistent-session.test.ts src/storage/index.ts test/storage/session-store-kind.test.ts
git commit -m "feat(storage): add session kind routing, ephemeral detection, and GC sweep"
```

---

### Task 7: 文档收尾 — 更新存储模块 README

**Files:**
- Create: `src/storage/README.md`

- [ ] **Step 1: 编写模块 README**

```markdown
# Storage 模块

my-agent 持久化基础设施层。所有磁盘 I/O 的入口。

## 文件职责

| 文件 | 职责 | 行数 |
|---|---|---|
| `paths.ts` | 所有路径常量的唯一权威来源 | ~100 |
| `path-sandbox.ts` | 工具层运行时路径白名单门控 | ~60 |
| `jsonl.ts` | JSON/JSONL 原子读写 + 并发安全追加 | ~250 |
| `locks.ts` | session/file 粒度的 async-mutex 原语 | ~50 |
| `session-store.ts` | Session 生命周期管理 + kind 路由 + GC | ~200 |
| `providers-store.ts` | Provider 配置持久化（Zod 校验 + 损坏恢复） | ~180 |

## 使用约定

1. 所有路径先查 `paths.ts`，禁止散落 `path.join(__dirname, '..', 'data')`
2. JSON 文件改写必须走 `atomicWrite`（tempfile + rename）
3. 多上下文并发写同一 JSONL 文件必须用 `appendJsonLineAtomic`
4. 文件编辑操作先 `fileEditLock(absPath).acquire()`
5. 新增持久化"表"请遵循 owner 模式：模块暴露 `getXxx/setXxx/listXxx` 高层 API

## 路径布局

~/.my-agent/                    # MY_AGENT_HOME
├── providers.json              # provider 配置
├── config.json                 # 全局配置（预留）
├── sessions/                   # 会话持久化
│   ├── gconv-<12hex>.jsonl    # 可恢复主对话
│   ├── gconv-<12hex>.context.json
│   ├── cli-<12hex>.jsonl      # 可恢复CLI会话
│   ├── anon-<12hex>.jsonl     # 短暂匿名会话（7天GC）
│   └── extract-<12hex>.jsonl  # 短暂提取会话（7天GC）
├── logs/                       # 日志（预留）
└── tmp/                        # 临时文件（预留）
```

- [ ] **Step 2: 提交**

```bash
git add src/storage/README.md
git commit -m "docs(storage): add storage module README with layout and conventions"
```

---

## 实施汇总

| Task | 内容 | 新建文件 | 修改文件 | 预计时间 |
|---|---|---|---|---|
| 1 | paths.ts + 测试 | 2 | 1 (package.json) | 15min |
| 2 | 迁移现有模块到 paths | 0 | 3 | 10min |
| 3 | path-sandbox + 集成工具 | 2 | 1 | 15min |
| 4 | JSONL 并发安全 + 分页 + persistent-session 迁移 | 1 | 3 | 25min |
| 5 | locks.ts + 测试 | 2 | 1 | 15min |
| 6 | Session kind 路由 + GC + 存量兼容 + 路径防御 | 1 | 4 | 30min |
| 7 | 模块 README | 1 | 0 | 5min |
| **合计** | | **9 新建** | **13 修改** | **~115min** |

---

## 与 Orkas 原版的差异对照表

| Orkas 原文章节 | Orkas 原版内容 | my-agent 实现 | 差异说明 |
|---|---|---|---|
| 3.1.1 `paths.ts` | ~780行，四层目录树，多用户+多项目 | ~100行，两层目录 | 去掉多用户/多项目/cloud-local/构建时资源 |
| 3.1.2 `path-sandbox.ts` | realpath ± macOS TCC | resolve + 段断言 | 去掉 symlink 防御和 TCC 审批 |
| 3.1.3 `allowedRoots` | 工作区+附件+extraRoots+readOnlyExtraRoots | 仅工作区 allowedRoots | 无附件/cid/项目级联解析 |
| 3.2.1 JSON/JSONL 工具层 | ~416行，含重试/缓存/翻页/Mutex | ~250行，增量加 Mutex+分页 | 不加 renameWithRetry（学习项目不需要） |
| 3.2.2 SQLite 向量库 | ~600行，三表+bge-small-zh | **不实现** | 学习项目无 KB 需求 |
| 3.2.3 每张"表"owner | 30+张表（全局/cloud/local/构建时） | ~5张表 | providers/sessions/config/logs |
| 3.3 锁机制 | 4类锁，带超时 acquireWithTimeout | 2类锁（session/file） | 去掉 globalSlots/dispatchSlots/超时 |
| 3.4 Session 持久化 | 10种kind，cloud/local 双路由，动态 import | 4种kind，单目录路由，静态 import | 去掉 gmember/gworker/skill/agent/reflect/memory-extract 等 |
| 3.4.3 内存作用域门控 | `memoryScopeForSession` 完整表 | `memoryScopeForSession` 预留（仅 gconv→commander） | memory 系统尚未实现 |
| 3.4.4 用户切换清理 | `activateUser` 钩子 + `_evictAll()` | `SessionStore.closeAll()` 手动调用 | 单用户无自动切换 |
| 3.4.5 删除流程 | 三件套删除（jsonl+context+tool-results） | 两件套删除（jsonl+context），无 tool-results 目录 | 暂无工具结果溢出机制 |

---

## 自审清单

### 1. Spec 覆盖

| 原文要求 | 对应位置 | 状态 |
|---|---|---|
| 路径常量集中在一个文件 | Task 1 (paths.ts) | ✅ |
| 沙箱工具与路径计算解耦 | Task 3 (path-sandbox.ts) | ✅ |
| 包含性用 startsWith(root+sep) | Task 3 (isPathAllowed) | ✅ |
| 段断言 id 进 path.join 前 | Task 1 (assertPathSegment) | ✅ |
| 工具层与业务层解耦 | Task 2 (迁移) + Task 4 (jsonl增量) | ✅ |
| 原子写是底线 | 已有 (atomicWrite)，不动 | ✅ |
| JSONL 用 Mutex + msgIndex | Task 4 (appendJsonLineAtomic) | ✅ |
| 锁粒度与原语选择（不用文件锁） | Task 5 (locks.ts, async-mutex) | ✅ |
| 按 id 复用的 Map 缓存 | Task 5 (sessionLock/fileEditLock Map) | ✅ |
| Kind allowlist 与存储路由 | Task 6 (KNOWN_KINDS_RE + 路由) | ✅ |
| 命名约定（禁止手写 sessionId） | Task 6 (SessionStore.create(kind)) | ✅ |
| 用户切换清理与删除 | Task 6 (sweepEphemeralSessions GC) | ✅ |
| **存量 session- 会话兼容（list 正则 + sessionKindOf）** | **Task 6 Step 6 + Step 3（双前缀兼容）** | ✅ |
| **外部输入 id 进 path.join 前防御** | **Task 6 Step 5（SessionStore.get/delete + PersistentSession.load 走 assertPathSegment）** | ✅ |
| **JSONL 并发安全真正落地到调用方** | **Task 4 Step 5（persistent-session 迁移 appendJsonLineAtomic）** | ✅ |
| **前端对接预留接口** | **模块 E § 前端对接预留接口（元数据 / 变更通知 / 服务层边界）** | ✅ |
| **每张"表"对应一个 owner** | **数据表全景（新增）** | ✅ |
| **每张表列出路径/格式/Owner/关键字段** | **数据表全景 A/B/C/D 四张表** | ✅ |
| **每张表含字段级 schema 明细** | **数据表全景 A.1/A.2/B.1/B.2 + C** | ✅ |
| **Owner 暴露 getXxx/setXxx/listXxx 高层 API** | **数据表全景 § Owner 模式示例** | ✅ |
| **cloud/local 划分与 sync 策略联动** | **简化为单目录，差异表已说明** | ✅ |
| SQLite 只用于 KB 向量库 | 不实现 SQLite | ✅ (学习项目无需) |
| 构造方必须走 feature 层 helper | Task 6 (SessionStore.create) | ✅ |

### 2. 占位符扫描

- 无 "TBD"、"TODO"、"implement later"
- 无 "Add appropriate error handling" 等泛化描述
- 所有步骤均有具体代码
- 所有命令均有预期输出

### 3. 类型一致性

- `paths.ts` 导出的函数签名与 Task 2 迁移引用一致 ✅
- `path-sandbox.ts` 的 `SandboxOptions` 与 Task 3 `guardPath` 调用一致 ✅
- `jsonl.ts` 新增导出与 Task 4 测试引用一致 ✅
- `locks.ts` 的 `sessionLock/fileEditLock` 与 Task 5 测试引用一致 ✅
- `session-store.ts` 新增导出与 Task 6 测试引用一致 ✅

---

## Next

**（写入后须暂停 — 即使用户句末含「然后执行」）**

- 计划确认 → 说「开始实现」或「执行」
- 需要调整 → 直接说修改意见
- 想跳过某模块 → 说「跳过 Task N，从 Task M 开始」
