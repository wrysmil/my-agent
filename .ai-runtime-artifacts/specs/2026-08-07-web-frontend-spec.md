---
title: Web 前端 — 把数字彩菜单 CLI 升级为本地浏览器界面
date: 2026-08-07
artifact: spec
route: superpowers:brainstorming
skills:
  - brainstorming
  - frontend-ui-engineering
  - api-and-interface-design
  - ui-ux-pro-max
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - docs/spec/仿写Agent前端框架指南.md
  - .ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md
created_at: 2026-08-07
status: draft
approved: false
---

# Web 前端 — 把数字彩菜单 CLI 升级为本地浏览器界面

> 本文为 my-agent 项目的设计与方案 spec。  
> 起点：`docs/spec/仿写Agent前端框架指南.md`（基于 Orkas 的 Electron Renderer 架构）。  
> 约束：**不**引入桌面软件（Electron / Tauri / Blink 等），改用**纯浏览器**前端 + 本地 Node HTTP 服务。  
> **代码改动尚未开始**，需通过本 spec 审批 + 后续 writing-plans 阶段生成的实施计划批准后才进入实现。

---

## 1. 背景与目标

### 1.1 现状

- `chat.ts` 是**纯 CLI** 入口：通过 `node:readline` 读取数字彩菜单选项，按 ⑥ 选项循环主菜单 / 设置子菜单 / Agent 管理子菜单 / 对话主循环。
- `src/storage/providers-store.ts` / `src/storage/session-store.ts` / `src/agent/persistent-session.ts` / `src/agent/runner.ts` 已经是**进程内纯 JS 模块**，可直接被 HTTP 路由处理器复用，**不需要任何代码改动**。
- `src/skills/`、`src/orchestration/`、`src/providers/` 同理：导出类型稳定（`AgentRunner.runStream()` 返回 `AsyncIterable<AgentRunEvent>`），可直接嵌入到异步迭代器 → SSE 推送管道。
- 用户当前使用流程：克隆 → `npm install` → `npm run chat` → 看菜单 → ① 开始对话。**所有交互都在终端**。
- `docs/spec/仿写Agent前端框架指南.md`（本文启动时在 IDE 中打开）给出了一套基于 Orkas `src/renderer/` 的「经典 `<script>` 标签 + contextBridge + IPC」前端架构，但那是 **Electron** 路线（需要打包桌面 App）。

### 1.2 用户故事

- **故事 1（核心）：** 用户启动 `npm run web`，浏览器自动打开 `http://localhost:5173`，看到和 CLI 一样的数字彩菜单（彩色 ① ⑥），但能用鼠标点击、键盘上下箭头选择，结果完全等价于 CLI 的 ① ⑥。
- **故事 2：** 用户在「设置模型提供商」页面用表单修改当前 provider 的 Key / URL / Model，回车提交，写入 `~/.my-agent/providers.json`，CLI 端的同一份文件同时生效。
- **故事 3：** 用户在「对话」页面输入"写一个 hello world"，立即看到 DeepSeek 模型流式吐字（token 增量），中途可点击「■ 停止」按钮中止流。
- **故事 4：** 用户点击侧边栏的历史会话列表，切回 7 天前的对话，能看到当时的完整 user / assistant 消息流（含 `assistant` 文本与 `🔧 calculator` 工具卡片混合展示）。
- **故事 5：** 用户进入「子 Agent 管理」面板，看到仓库内置（fixtures/orchestration/agents/）和用户自定义（`~/.my-agent/agents/`）的所有子 Agent，能查看 description / workflow 摘要。

### 1.3 目标

1. 提供**本地 Web 前端**：浏览器打开 `http://localhost:5173` 即用，**完全复用** `src/` 现有逻辑。
2. 保持与 CLI 的**状态文件兼容**：providers.json / sessions/*.jsonl / agents/ 用户目录两边共享，**不需要迁移**。
3. 用 **vanilla HTML / CSS / JS**（无构建工具 / 无框架）实现，遵循 `仿写Agent前端框架指南` § 「Renderer 架构」的分层规范。
4. 流式聊天用 **SSE**（Server-Sent Events）实现，对应 `AgentRunEvent` schema 的逐事件推送。
5. 提供**对等的 CLI 命令**：`npm run web` 启动服务 + 自动打开浏览器；老 CLI 入口 `npm run chat` 完全不动。

### 1.4 非目标（YAGNI）

- **不**做生产部署（无 HTTPS、无认证、无远程访问）—— 这是单机本地工具，只监听 `127.0.0.1`。
- **不**用 React / Vue / Svelte —— 与指南 §「关键约束」一致：「只用经典 `<script>` 标签，不用 TypeScript / JSX / bundler」。
- **不**重新实现 providers / sessions / agents 的存储层 —— `ProvidersStore` / `SessionStore` 已经是异步 API，直接 `import` 即可。
- **不**做多用户、多标签页并发写隔离 —— `SessionStore` 已有 `PersistentSession` 内部锁。
- **不**引入 Express / Fastify 等大框架 —— 见 § 4 技术栈选择。
- **不**改 `AgentRunner` 主体实现 —— 仅在 server 路由层包一层 `AsyncIterable → SSE` 适配器。
- **不**重写为 WebSocket / gRPC —— SSE 已能满足单向流需求。

---

## 2. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器 (Chrome / Safari / Firefox)                          │
│  http://localhost:5173                                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  web/index.html + web/style.css + web/js/*.js       │   │
│  │  (vanilla — 经典 <script> 标签顺序加载)              │   │
│  │                                                     │   │
│  │   js/shared/  →  js/state/  →  js/components/  →    │   │
│  │   js/features/  →  js/app.js                        │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│                       │  fetch() + EventSource              │
└───────────────────────┼─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Node 进程 (单一进程，两种入口并存)                            │
│                                                             │
│   bin/my-agent-web.ts (新)                                  │
│     ├─ http.createServer (127.0.0.1:5173)                   │
│     ├─ 静态文件服务  → web/*  (无 bundler)                    │
│     ├─ REST 路由     → 直接复用 src/storage/* 模块           │
│     ├─ SSE 端点      → 包装 runner.runStream()               │
│     └─ open localhost:5173 (仅 dev)                         │
│                                                             │
│   chat.ts (现有)       ✅ 一字不改                             │
│                                                             │
│   共享模块 (src/)*      ✅ 完全复用                             │
│     ├─ storage/providers-store.ts                           │
│     ├─ storage/session-store.ts                             │
│     ├─ agent/runner.ts                                      │
│     ├─ orchestration/tools.ts (dispatch 子 Agent)            │
│     ├─ skills/loader.ts                                     │
│     └─ cli/menu.ts (渲染函数可被 HTTP 路由调用)               │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 双入口并存策略

| 命令 | 行为 | 进程 | 端口 |
| --- | --- | --- | --- |
| `npm run chat` | 数字彩菜单 CLI（**完全不动**） | 终端独占 stdin | — |
| `npm run web`  | 启动 HTTP 服务 + 打开浏览器 | 后台 Node 进程 | 5173 |
| 两个同时启动 | ✅ **互不冲突** —— 各自读相同 `~/.my-agent/`，最后写入者覆盖 |

读多写少的并发场景下没问题，因为：
- `ProvidersStore.save()` 用 `atomicWrite`（`src/storage/jsonl.ts`），不会半写。
- `SessionStore` 通过 `PersistentSession` 内部文件锁序列化 `appendAsync`。

### 2.2 模块职责表

| 模块 | 职责 | 不做什么 |
| --- | --- | --- |
| `web/index.html` | 入口 HTML，两栏布局骨架，挂 `<script>` 标签 | 不做路由、不做逻辑 |
| `web/style.css`  | 全局样式 + 6 色数字彩菜单配色（与 `src/cli/io.ts` ANSI 一致：青/绿/黄/蓝/紫/红） | 不做 JS |
| `web/js/shared/utils.js` | `escapeHtml` / 颜色 / 时间格式化 | 不依赖外部 |
| `web/js/shared/api.js` | `apiFetch(url, opts)` — `fetch` 包装，统一错误处理 | 不做视图 |
| `web/js/shared/i18n.js` | 极简：当前仅中文，key → 字符串字典（暂留扩展点） | 不做动态语言切换 |
| `web/js/state/state.js` | `currentView` / `currentCid` / `conversations[]` / `pendingConvs` | 不持久化（用 localStorage 缓存最后视图） |
| `web/js/components/sidebar.js` | Logo + 6 个主菜单按钮 + 会话列表 + 设置入口 | 不做对话 |
| `web/js/components/panels.js` | 5 个 panel DOM 骨架与 `setView()` 切换 | 不做数据 |
| `web/js/features/menu.js` | 数字彩菜单的渲染（接收主菜单 6 项内容，渲染为彩色卡片网格） | 不做其他视图 |
| `web/js/features/chat.js` | 消息流渲染（含 text_delta / tool_delta / tool_end 卡片） + SSE 消费 | 不做会话管理 |
| `web/js/features/providers.js` | Provider 列表 / 编辑表单 / 切换 / 启用禁用 / 删除 | 不做对话 |
| `web/js/features/agents.js` | 子 Agent 列表 / 详情查看 | 不做创建 / 不做编辑 |
| `web/js/features/sessions.js` | 会话列表 / 新建 / 加载 / 删除 | 不做消息 |
| `web/js/app.js` | 启动：`bootApp()` 三阶段流水线 | — |
| `bin/my-agent-web.ts` | HTTP server：静态文件 + REST + SSE | 不做 UI |
| `web/server/routes/*.ts` | 按域划分的 HTTP 处理器（`/api/providers` `/api/sessions` 等） | 不做 UI |

---

## 3. 数据设计

### 3.1 后端 HTTP API 表面

> 所有响应统一封装 `{ ok: true, data: ... }` 或 `{ ok: false, error: { kind, message } }`。

#### 3.1.1 Provider 域（直接映射 `ProvidersStore`）

| 方法 + 路径 | 入参 | 返回 | 对应 CLI 菜单项 |
| --- | --- | --- | --- |
| `GET /api/providers` | — | `{ providers: ProviderConfigEntry[], activeId: string }` | ① 列出所有 |
| `GET /api/providers/active` | — | `{ provider: ProviderConfigEntry }` | ④ 查看当前（F-S-0，`/provider` 命令） |
| `PUT /api/providers/active` | `{ id }` | `{ ok }` | ③ 切换当前 |
| `PATCH /api/providers/active/model` | `{ model: string }` | `{ provider: ProviderConfigEntry }` | `/model <name>` 命令（F-S-1） |
| `POST /api/providers` | `ProviderConfigEntry` (完整对象) | `{ provider }` | 新建（CLI 无直接对应；表单走 `POST`） |
| `PUT /api/providers/:id` | `Partial<ProviderConfigEntry>` | `{ provider }` | ② 修改当前 |
| `POST /api/providers/:id/toggle` | — | `{ enabled }` | ④ 启用 / 禁用 |
| `DELETE /api/providers/:id` | — | `{ ok }` | ⑤ 删除 |

#### 3.1.2 Session 域

| 方法 + 路径 | 入参 | 返回 / 行为 |
| --- | --- | --- |
| `GET /api/sessions` | query: `archived?: boolean`, `limit?: number (1-200, 默认 50)`, `offset?: number (默认 0)` | `{ sessions: [{ id, name, messageCount, lastTs, archived }] }` |
| `POST /api/sessions` | `{ kind?: "gconv"\|"cli" }` | `{ session: { id } }` |
| `GET /api/sessions/:id/history` | — | `{ messages: SerializedMessage[] }`（从 `PersistentSession.getAllMessages()` 序列化） |
| `DELETE /api/sessions/:id` | — | `{ ok }` |
| `POST /api/sessions/:cid/compact` | `{ confirm?: boolean }`（首次 false 仅取估算；用户点按钮后 true 触发实际压缩） | `{ tokensBefore, tokensAfter, durationMs, summary? }`（F-S-2，依赖 § 3.1.5 API 扩展） |

**Zod schema**（[src/web/server/validators/sessions.ts](src/web/server/validators/sessions.ts) 草案）：

```ts
export const ListSessionsQuerySchema = z.object({
  archived: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const CompactRequestSchema = z.object({
  confirm: z.boolean().optional(),
});
```

#### 3.1.3 Chat 流（**核心**）

| 方法 + 路径 | 入参 | 行为 |
| --- | --- | --- |
| `POST /api/sessions/:id/messages/stream` | `{ text, systemPrompt? }` | **SSE**：`Content-Type: text/event-stream`；每个 `AgentRunEvent` 序列化为 SSE `data:` 行；最后发 `event: done` + `data: { type: "done", result: AgentRunResult }` |
| `POST /api/sessions/:id/messages/abort` | — | 给对应 `streamId` 的 SSE 流发 abort：通过服务端 `_liveStreams.get(streamId)` 找到 controller，触发 `ctrl.abort()`；`runner.runStream({ signal })` 内置响应 → DeepSeek 流式连接断开。**注意**：`AgentRunner` 实例没有 `abort()` 实例方法 — 中止通道是 `AbortSignal` 参数传 `runStream()`。 |

**SSE 事件映射**（`AgentRunEvent` → SSE `data:` JSON）：

```
data: {"type":"text_delta","text":"你"}
data: {"type":"text_delta","text":"好"}
data: {"type":"tool_delta","name":"calculator","id":"t_1","inputDelta":"{\"exp"}
data: {"type":"tool_delta","id":"t_1","inputDelta":"ression\":\"2+3\"}"}
data: {"type":"tool_end","id":"t_1","name":"calculator","result":"5","isError":false}
data: {"type":"text_delta","text":"等于 5"}
data: {"type":"done","result":{"ok":true,"usage":{...}}}
```

前端 `EventSource` 收到后按 `type` 分发：
- `text_delta` → push 到当前 assistant 气泡的 `textContent` 末尾
- `tool_delta` → 累积 `inputDelta`；首次带 `name` 时创建工具卡片（在气泡中显示 `<icon> <name>(...) <累计JSON>`）
- `tool_end` → 把对应卡片标记为成功或错误 + 填充 `result`（`✅` / `❌` 状态）
- `done` → 关闭当前流，触发 UI 恢复输入框可用

#### 3.1.4 Agent / Skill 域

| 方法 + 路径 | 返回 |
| --- | --- |
| `GET /api/agents` | `{ agents: [{ id, source: "builtin"|"user", name, description_zh, description_en, skill_list }] }` |
| `GET /api/agents/:id` | `{ spec: AgentSpec }`（完整 spec，含 workflow） |
| `GET /api/skills` | `{ skills: SkillSpec[] }` |
| `GET /api/skills/:id` | `{ skill: { name, id, body } }` |

#### 3.1.5 `/compact` 服务端实现：AgentRunner API 扩展

> **Finding 修复：** 当前 `src/agent/runner.ts` 仅暴露 `runStream()` 和 `run()`，**没有 `compact()` 公开方法**（`prepareContextBeforeModelCall` 是 `private async *`，[src/agent/runner.ts:1037](src/agent/runner.ts#L1037)）。`POST /api/sessions/:cid/compact` 端点要可实现，必须在 F-S-2 之前先扩展 `AgentRunner` 公开 API。

**扩展内容（落到 § 7.1 **B8a**：**

1. **`AgentRunner.compactNow(cid: string): Promise<{ tokensBefore: number; tokensAfter: number; durationMs: number; summary?: string }>`**
   - 内部复用 `prepareContextBeforeModelCall` 逻辑（提取为可复用函数 `compactContextInternal`）
   - 必须接受 `AbortSignal`（与 `runStream` 一致）
   - 抛出 `AlreadyCompactingError`（自定义）当同一 cid 上有 in-flight 流时

2. **`Session.getTokenEstimate(): { used: number; limit: number; ratio: number }`**
   - 在 `Session` / `PersistentSession` 上加只读访问器（[src/agent/session.ts](src/agent/session.ts) + [src/agent/persistent-session.ts](src/agent/persistent-session.ts)）
   - 内部计算 `tokenizer.encode(getAllMessages()).length` + 模型 `contextWindow`
   - 供 `/compact` Modal 在「立即压缩」按钮触发**前**展示当前用量（**不依赖 runner 的 `context_status` 事件**，因为该事件实际不被发出 —— 见 Finding 6）

3. **路由 handler `POST /api/sessions/:cid/compact`：**
   - 同步步骤 1 取当前 `getTokenEstimate()` → 立即返回给前端（`{ used, limit, ratio, willCompact: true }`）→ 前端 Modal 显示
   - 用户点击「立即压缩」→ 第二次请求（同端点，body 加 `{ confirm: true }`）→ 调 `runner.compactNow(cid)`
   - 两次请求间用 `cid → Mutex` 串行化（防与 runner 自动 compaction 竞态 —— 见 § 9 风险表新增条目 R-22）

**为什么不复用 `runStream`：** `runStream` 走完整模型调用 + SSE，调用成本高；`compact()` 只需内部 tokenizer + summarizer，不发模型请求（除非使用 summarization LLM，本期用启发式摘要 + 截断策略）

### 3.2 前端状态

延续指南 § 1.5「全局状态管理」分层约定：

```js
// web/js/state/state.js
let currentView = 'main-menu'; // 'main-menu' | 'chat' | 'providers' | 'agents' | 'view' | 'settings'
let currentCid = null;          // 当前会话 id（view='chat' 时有效）
let conversations = [];         // 会话列表（侧边栏数据源）
let pendingConvs = new Map();   // cid → { abortController }
const messageQueues = new Map();// cid → [{ text }, ...]（FIFO，防并发）
```

**无虚拟 DOM**，直接 `innerHTML`（用户文本经 `escapeHtml`）+ `classList.toggle('active')`。

### 3.3 持久化（浏览器侧）

| Key | 用途 |
| --- | --- |
| `my-agent.lastView` | `{ view, cid }` — 刷新后恢复 |
| `my-agent.apiBase` | `http://localhost:5173`（默认；可改远程） |
| `my-agent.theme` | `"dark" \| "light" \| "system"`（默认 `system`；由 `/theme` 命令切，详见 § 5.4.1） |
| `my-agent.sidebarWidth` | 数字（默认 260） |

**主题三态语义：**

- `dark` — 始终深色主题
- `light` — 始终浅色主题
- `system` — 跟随 OS `prefers-color-scheme` 媒体查询（变更时自动切换；首次访问默认）

**不存** API Key / 历史会话 —— 这些属于服务端文件系统。

### 3.4 API 契约与错误协议（强制）

> 严格遵循 `api-and-interface-design` skill：**契约先行、错误一致、扩展优于修改、边界验证**。

#### 3.4.1 统一响应壳

```ts
// 成功
{ ok: true, data: T }

// 失败
{
  ok: false,
  error: {
    code: "VALIDATION_ERROR",       // 机器可读，固定枚举
    message: "API Key 不能为空",      // 人可读，i18n 友好
    details?: Record<string, unknown>, // 字段级错误详情（表单回填用）
    requestId: "req_3f8a..."         // 服务端日志关联 ID
  }
}
```

**HTTP 状态码映射（固定）：**

| Status | 含义 | 触发示例 |
| --- | --- | --- |
| 200 | 成功 | — |
| 204 | 成功（无 body） | DELETE 成功 |
| 400 | 请求体 JSON 解析失败 | malformed JSON |
| 404 | 资源不存在 / 路径不存在 | `:id` 不存在 |
| 409 | 资源冲突（重复 / active 悬空） | 删除当前 active provider 无回退 |
| 422 | 业务校验失败 | Base URL 非 `https?://` 开头 |
| 429 | 速率限制（仅 messages/stream） | 同会话 < 1s 内连发 |
| 500 | 服务端异常 | runner 抛错 |
| 503 | 服务不可用 | 启动期 / 关停期 |

#### 3.4.2 错误码枚举（`ApiErrorCode`）

```ts
type ApiErrorCode =
  // 通用
  | "INVALID_JSON"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"           // body > 1MB
  | "RATE_LIMITED"
  | "INTERNAL"
  // Provider 域
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DUPLICATE_ID"
  | "PROVIDER_INVALID_BASE_URL"
  | "PROVIDER_INVALID_TYPE"
  | "PROVIDER_API_KEY_EMPTY"
  | "PROVIDER_ACTIVE_NOT_DELETABLE" // 删除时若无回退
  | "MODEL_NOT_FOUND"               // /model <name> 中 name 不在当前 provider.defaultModel 候选列表
  // Session 域
  | "SESSION_NOT_FOUND"
  | "SESSION_CORRUPT_FILE"
  // Chat 域
  | "CHAT_SESSION_BUSY"            // 同会话已有 in-flight 流
  | "CHAT_ABORTED"                 // 用户主动 abort
  | "CHAT_RUNNER_ERROR"
  | "CHAT_INVALID_EVENT"           // SSE 序列化失败
  // Agent / Skill 域
  | "AGENT_NOT_FOUND"
  | "AGENT_SPEC_INVALID_JSON"
  | "SKILL_NOT_FOUND"
  ;
```

#### 3.4.3 验证在边界（Zod schemas）

后端 `src/web/server/validators/`：

```ts
// providers.ts
export const ProviderUpsertSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  name: z.string().min(1).max(64),
  type: z.literal("deepseek"),
  apiKey: z.string().max(256), // 允许空字符串
  baseUrl: z.string().url().regex(/^https?:\/\//).refine(s => !s.endsWith('/'), "no trailing slash"),
  defaultModel: z.string().min(1).max(64),
  enabled: z.boolean(),
});
```

每个路由 handler 第一行 `Schema.safeParse` — 失败 422 + `details` 字段级回填到前端表单。

#### 3.4.4 扩展优先（Open Extension Points）

| 操作 | 预留扩展位 |
| --- | --- |
| Provider `baseUrl` | v2 可加 `extraHeaders` / `customModels`（新增字段，非破坏性） |
| Session `kind` | 已经预留 `"gconv" \| "cli" \| "anon" \| "extract" \| "gworker"` 枚举；新增合法值时旧客户端不报错 |
| Agent `source` | 已预留 `"builtin" \| "user" \| "marketplace"`；v2 新增合法值旧客户端 ignore |

**禁止**删除字段（删除字段 = 破坏性变更，必须走版本号 `/api/v2`）。

#### 3.4.5 版本（隐式 v1）

本项目对外契约简单，**隐式 v1**：
- 路径不含版本（`/api/providers` 非 `/api/v1/providers`）。
- 任何破坏性改动时引入 `/api/v2/...`，老路由标 `Deprecated:` 头保留至少 6 个月。
- 新字段全 optional，**必须**用 camelCase。

#### 3.4.6 限流 vs FIFO 协同

**机制分层（不冲突）：**

| 层 | 机制 | 触发 | 服务端动作 |
| --- | --- | --- | --- |
| **FIFO 消息队列** | 同会话消息排队发送 | 第一条流未 done 时用户按「发送」 | 入队 `messageQueues.get(cid)` 尾部，**自动**在前一条 done 后发送 |
| **In-flight 单连接保护** | 服务端拒绝 cid 上的并发流 | 服务端发现同 cid 上次流未 done | 返回 `429 CHAT_SESSION_BUSY` + `Retry-After: <msUntilDone>`（建议下次自动重连时间） |
| **防误触冷却**（可选 YAGNI） | 按钮 1s 内 disabled | 用户 1s 内连点两次 | 客户端拦截；服务端**不**做 |

```ts
// 示例：服务端 messages/stream handler 的并发判断
const exists = listLiveStreamsForCid(input.cid).some(id => _liveStreams.get(id)?.controller);
if (exists) {
  throw new HttpError(429, "CHAT_SESSION_BUSY",
    { retryAfterMs: estimateRemainingMs() });
}
```

- **客户端责任**：消息串行（把新 send 入队 `messageQueues`，**不**直接发起 fetch）。
- **服务端责任**：并发保护（429 + Retry-After）；流生命周期由 AbortSignal 管理（§ 6.1）。
- **优先级**：FIFO > 429。**不会**因为 429 丢消息——如果用户连点，第二条入 FIFO 队列，**不会**触发服务端 429（因为客户端不立即发起第二条 fetch）。

> **旧版 spec 模糊「1s cooldown + 429 + Retry-After: 1」同时存在的写法已废除**：本节统一为 in-flight 单连接 + FIFO 串行，不再保留 1s 时间窗限流（避免与 FIFO 串行重复）。

#### 3.4.7 幂等性

| 操作 | 幂等保证 |
| --- | --- |
| `PUT /api/providers/:id` | 多次 PUT 同 body = 单次效果 ✅ |
| `DELETE /api/sessions/:id` | 已删除返回 204 ✅ |
| `POST /api/sessions` | 每次新建返回新 id（**非**幂等，因为这就是创建） |
| `POST /api/sessions/:id/messages/stream` | 不做幂等（流天然不可重放）；客户端用 `requestId` 去重 |

---

## 4. 技术栈选择

### 4.1 后端

| 选择 | 决策 | 理由 |
| --- | --- | --- |
| HTTP server | **Node 内置 `http`** （`http.createServer`） | 与现有 0 运行时依赖原则一致；不引 Express / Fastify；路由用 `URL.pathname` + method 字典分发 |
| 流式 | **SSE** (`text/event-stream`) | 浏览器 `EventSource` 原生支持；与 `AsyncIterable<AgentRunEvent>` 是 1:1；无需 WebSocket |
| 启动 | `tsx bin/my-agent-web.ts`（沿用现有 `tsx` 工具链） | 0 新增依赖 |
| 端口 | `process.env.MY_AGENT_WEB_PORT ?? 5173` | — |
| 自动打开浏览器 | `node:child_process.exec('open http://localhost:5173')` (macOS) / `xdg-open` (Linux) / `start` (Windows) | 仅在无 `CI` 环境 |

### 4.2 前端

| 选择 | 决策 | 理由 |
| --- | --- | --- |
| 框架 | **vanilla HTML/CSS/JS** | 严格遵循 `仿写Agent前端框架指南` §「关键约束」 |
| 加载方式 | **经典 `<script>` 标签顺序加载**（`<script src="./js/shared/utils.js"></script>` → ... → `<script src="./js/app.js"></script>`） | 与 `Orkas/src/renderer/index.html` 一致 |
| 模块通信 | **全局变量**（顶层 `let`/`const`/`function`） | 与指南 §「全局变量模块通信」一致 |
| Markdown 渲染 | 内置 `marked.js`（v12+，约 30 KB minified，手动放 `web/js/vendor/`，**不走 npm**） | 消息中代码块 / 列表需要 Markdown |
| XSS 防护 | **DOMPurify** v3（v3，约 20 KB minified，同样手动放 `web/js/vendor/`） | 指南 § 4.1 明确要求 |
| 样式 | 单 `style.css` + CSS 变量（`--menu-color-1: #16a34a` 等 6 色） | 数字彩菜单配色直接来自 `src/cli/io.ts` 的 ANSI 映射 |
| 自动刷新 | 浏览器热重载？**否**（与零依赖原则一致） | 用户手动 Cmd-R |

### 4.3 **不**引入的依赖

- ❌ 无 React / Vue / Svelte / Solid
- ❌ 无 Vite / Webpack / esbuild（但允许**可选**：`npm run web:dev` 走 `vite dev` 单文件模式，简化 CSS 热重载；运行时仍是 `web/*` 静态文件）
- ❌ 无 Express / Fastify / Hono / Koa
- ❌ 无 TypeScript 编译产物（前端纯 JS）
- ❌ 无 npm 包替代 — DOMPurify / marked 都是**手动放到 `web/js/vendor/`** 的 minified 文件（与指南 § 项目骨架 一致）

### 4.4 视觉设计系统（Design System）

> 通过 ui-ux-pro-max 检索 + 与项目既有 CLI 风格对齐，得到「**Code Dark + Run Green**」配方。**Dark mode 优先**（符合开发者偏好，对应终端用户），light mode 作为可选切换。

#### 4.4.1 调色板（Tokens）

**Dark（默认）**

| Token | Hex | 用途 |
| --- | --- | --- |
| `--bg-base` | `#0F172A` slate-900 | 应用背景 |
| `--bg-surface` | `#1E293B` slate-800 | 侧边栏 / 卡片背景 |
| `--bg-elevated` | `#334155` slate-700 | 浮层 / 下拉 / 工具卡片 |
| `--text-primary` | `#F8FAFC` slate-50 | 主要文字（对比 ≥ 12:1） |
| `--text-secondary` | `#CBD5E1` slate-300 | 次要文字（对比 ≥ 7:1） |
| `--text-muted` | `#64748B` slate-500 | 弱化文字（对比 ≥ 4.6:1） |
| `--border-default` | `#334155` slate-700 | 默认描边 |
| `--border-subtle` | `#1E293B` slate-800 | 次级描边 |
| `--accent-primary` | `#22C55E` green-500 | 主操作 / 启用态 / CTA |
| `--accent-primary-hover` | `#16A34A` green-600 | 悬停态 |
| `--accent-run` | `#10B981` emerald-500 | 流式光标 / 「运行中」动效 |
| `--danger` | `#EF4444` red-500 | 删除 / 错误 / 禁用 |
| `--warning` | `#F59E0B` amber-500 | 警告 / Key 缺失 |
| `--focus-ring` | `#38BDF8` sky-400 | 键盘焦点环（满足 3:1 对比） |

**6 色数字彩菜单（深色适配版）— 与 `src/cli/io.ts` `menuColor(i)` 一致：**

```css
:root {
  --menu-color-1: #22D3EE;  /* ① 青色 cyan-400 */
  --menu-color-2: #4ADE80;  /* ② 绿色 green-400 */
  --menu-color-3: #FACC15;  /* ③ 黄色 yellow-400 */
  --menu-color-4: #60A5FA;  /* ④ 蓝色 blue-400 */
  --menu-color-5: #C084FC;  /* ⑤ 紫色 purple-400 */
  --menu-color-6: #F87171;  /* ⑥ 红色 red-400 */
}
```

> 6 色统一亮度（Tailwind `-400` 级），保证 dark 背景上的对比度全部 ≥ 7:1。

**Light（可选切换）**

| Token | Hex |
| --- | --- |
| `--bg-base` | `#FFFFFF` |
| `--bg-surface` | `#F8FAFC` slate-50 |
| `--bg-elevated` | `#FFFFFF` + `box-shadow` |
| `--text-primary` | `#0F172A` slate-900 |
| `--text-secondary` | `#334155` slate-700 |
| `--text-muted` | `#64748B` slate-500 |
| `--border-default` | `#E2E8F0` slate-200 |
| `--accent-primary` | `#16A34A` green-600 |

**主题三态实现（与 § 3.3 / § 5.4.1 对齐）：**

```css
/* dark 模式（user 显式选 dark → 必命中） */
:root[data-theme="dark"] {
  --bg-base: #0F172A;
  /* ... dark tokens（与 system 模式 OS=dark 相同） */
}

/* light 模式（user 显式选 light → 必命中） */
:root[data-theme="light"] {
  --bg-base: #FFFFFF;
  /* ... light tokens（与 system 模式 OS=light 相同） */
}

/* system 模式（user 选 system → 由 data-system-theme 二级属性决定）：
   - OS=dark → 命中 dark token
   - OS=light → 命中 light token
   这是 system 模式的核心：CSS 选择器嵌套双属性条件 */
:root[data-theme="system"][data-system-theme="dark"] {
  --bg-base: #0F172A;
  /* ... dark tokens */
}
:root[data-theme="system"][data-system-theme="light"] {
  --bg-base: #FFFFFF;
  /* ... light tokens */
}
```

**注意事项：**
- `:root:not([data-theme])[data-system-theme="..."]` 不再使用——`data-theme` 始终有值（默认 `"system"`），从启动时 F0 `applyTheme` 设上；不再依赖「未设 → 退化」。
- `:root[data-theme="dark"]` 与 `:root[data-theme="system"][data-system-theme="dark"]` 两块 token 必须保持完全一致（dark token 集中、light token 集中），避免重复定义漂移。
- 实际落地时建议把每块完整 token 列表（14 个）写明，避免遗漏。

切换与持久化：

- `<html data-theme="dark|light|system">` 三态属性；F0 `web/js/shared/theme.js` 启动时读 `localStorage['my-agent.theme']` 设值
- **首次访问默认 `system`**（与 § 3.3 一致；OS 暗色偏好的开发者直接看 dark，OS 亮色偏好的直接看 light）
- `system` 模式 = `:root[data-theme="system"]` + `:root[data-system-theme="dark|light"]`（由 `matchMedia('(prefers-color-scheme: dark)')` 动态设置）

**F0 `shared/theme.js` system 模式 + Safari < 14 polyfill（落实 § 9 R-26）：**

```js
// web/js/shared/theme.js — F0 设计系统层
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (matches) => root.setAttribute("data-system-theme", matches ? "dark" : "light");
    apply(mql.matches);
    root.setAttribute("data-theme", "system");
    // 监听 OS 主题切换（Safari 14+ / Chrome / Firefox）
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", (e) => apply(e.matches));
    } else if (typeof mql.addListener === "function") {
      // Safari < 14 polyfill（已废弃 API，但 Safari 13 仍支持）。
      // 注意：MediaQueryList.addListener() 仅接受 1 个 callback 参数。
      // 旧版 spec 误写 mql.addListener(mql, cb)，把 mql 当 callback 注册会导致
      // OS 切换时 TypeError: mql is not a function（v3.2 Reviewer Critical 修复）。
      mql.addListener((e) => apply(e.matches));
    }
    // 都不支持时：取一次快照后不再监听（最差降级 —— 用户在系统偏好切换后需手动 /theme）
  } else {
    root.setAttribute("data-theme", theme);
    root.removeAttribute("data-system-theme");
  }
}
```

**为什么必须 `data-theme="system"` + `data-system-theme="dark|light"` 双属性：** CSS 选择器嵌套（`:root[data-theme="system"][data-system-theme="dark"]`）让暗 / 亮 token 在同一 CSS 文件内共存，避免切换时 inline style；保证 § 6.6 CSP `'unsafe-inline'` 不需要。

#### 4.4.2 字体（Typography）

| 角色 | 字体 | 字号 / 行高 | 字重 |
| --- | --- | --- | --- |
| `body` | **IBM Plex Sans** | 14px / 1.5 | 400 |
| `body-strong` | IBM Plex Sans | 14px / 1.5 | 500 |
| `heading-sm` | IBM Plex Sans | 16px / 1.4 | 600 |
| `heading-md` | IBM Plex Sans | 20px / 1.3 | 600 |
| `heading-lg` | IBM Plex Sans | 24px / 1.25 | 700 |
| `mono` | **JetBrains Mono** | 13px / 1.55 | 400 |
| `mono-strong` | JetBrains Mono | 13px / 1.55 | 600 |
| `digit` | JetBrains Mono | 28px / 1.2 | 700（数字菜单 ①～⑥） |

**字体加载：**

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
/>
```

**为何 mono 用于数字：** mono 字符宽度恒定，**避免 ①～⑥ 数字与后面文字错位**（比 CLI 终端更整齐但保持 mono 美学）。

#### 4.4.3 间距尺度（Spacing Scale）

0.25rem 倍数系统，**不用任意 px**：

```
0  4   8   12  16  24  32  48  64  96
0  1   2   3   4   6   8   12  16  24
```

CSS 变量：`--space-1: 0.25rem` ... `--space-6: 1.5rem` ... `--space-12: 3rem`。

**侧边栏宽度：** `--sidebar-width: 260px`（与 spec § 5.2 一致，可在 200-400 区间拖拽）。

**侧边栏与主内容间距：** `var(--space-6) = 24px`（**不**用 32px —— 太大显松散，参考 ui-ux-pro-max 「oversized padding 浪费视口」反模式）。

#### 4.4.4 圆角（Border Radius）

```
xs: 4px    /* tag, badge */
sm: 6px    /* button, input */
md: 8px    /* card */
lg: 12px   /* modal */
xl: 16px   /* hero panel */
```

**不是 `rounded-2xl` 到处用**（ui-ux-pro-max 明确反模式）。卡片默认 `md`，输入框 `sm`，不做全圆胶囊。

#### 4.4.5 动效（Motion）

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 按钮 hover 颜色过渡 | 150ms | `ease-out` |
| 卡片 hover 边框色 | 200ms | `ease-out` |
| View 切换淡入 | 200ms | `ease-in-out` |
| Modal 缩放进入 | 220ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Toast 滑入 | 200ms | `ease-out` |
| 文字光标闪烁（流式） | 1.1s | `steps(1)` |
| 数字菜单 hover 边框 | 150ms | — |

**全站统一** `prefers-reduced-motion: reduce` 时全部降级到 0ms。

#### 4.4.6 图标系统

- **不**用 emoji（spec § 2.2 已写；ui-ux-pro-max 明确反模式）。
- 用 **Lucide Icons**（与 shadcn/ui 一致、npm 上不依赖、自己 inline SVG 即可）：约 30 个够用。
- 全部 24×24 viewBox，`stroke-width: 2`，`stroke: currentColor`。
- 存储：`web/js/shared/icons.js` 提供 `iconHtml(name, size)`（与仿写指南 § 1.2 `uiIconHtml` 同模式）。
- 必备：send / stop / plus / trash-2 / settings / message-square / history / users / sparkles / zap / search / x / check / chevron-right / chevron-down / loader-2 / alert-triangle。

#### 4.4.7 布局原则

- **主要内容区** max-width 1400px（与 `max-w-7xl` 等价但显式数值），不允许更宽——避免大屏废弃空间。
- **侧边栏 fixed 260px**，**不**做可隐藏（避免破坏导航肌理）。
- **对话页** 双栏：消息流（flex-1） + 右侧可选「上下文」面板（默认收起，避免第一屏太挤）。
- **数字彩菜单主页** Bento Grid：6 项拆为 4 + 2（左大右小的 2 列布局，第一项突出，其余均匀）。

#### 4.4.8 组件库（约 12 个手写组件，零依赖）

| 组件 | 实现要点 |
| --- | --- |
| `Button` | `variant: primary / secondary / ghost / danger` × `size: sm / md / lg`；focus-visible ring；disabled 时 50% opacity + `cursor-not-allowed` |
| `Card` | `bg-surface` + `border` + `radius-md`；hover 边色加深 |
| `Input` / `Textarea` | `:focus-visible` 切换 `--focus-ring` + 边色；error 时 `--danger` |
| `Modal` | `<dialog>` 元素 + focus trap；ESC 关闭；backdrop 点击关闭（可配） |
| `Toast / Snackbar` | 全局单例，4 队列上限，FIFO；类型 `info / success / warning / danger`；自动关闭 4s（hover 暂停） |
| `Spinner` | 1.5s 旋转，**仅**用于不可中断操作；其他用 skeleton |
| `Skeleton` | 用户消息流加载 / 会话列表加载 / Agent 列表加载 |
| `EmptyState` | 大图标 + 标题 + 副标题 + 操作按钮（4.4.9 强约束） |
| `ErrorState` | 与 EmptyState 同布局，文案区分（具体错误） |
| `Tabs` | 键盘可达，`role="tablist"` + `aria-selected` |
| `Tooltip` | 仅文本说明，hover 200ms 显示；不**做**弹窗交互 |
| `ConfirmDialog` | `await uiConfirm({ title, message, confirmLabel, danger })` Promise<boolean> |
| `DropdownMenu` | 上下方向自适应（getBoundingClientRect 边界检测） |
| `MenuCard`（6 色数字彩菜单专用） | 大数字（左） + 标题 + 描述 + 右箭头；hover 时背景 `bg-elevated`；focus-visible ring `--menu-color-N` |

#### 4.4.9 空/加载/错误状态三态（强制约束）

每个有数据的组件（路由 / panel / 列表）**必须**显式处理：

| 状态 | 表现 |
| --- | --- |
| Loading | `Skeleton`（脉冲骨架）—— **不**用 spinner 代替骨架（spinner 仅限不可中断的后台操作） |
| Empty | `EmptyState`（大图标 + 标题 + 1 句话描述 + 1 个 CTA） |
| Error | `ErrorState`（红色图标 + 错误类型 + 「重试」按钮） |

**对话面板首次加载**：`Skeleton` 占 3 条消息；**用户消息发送**：`Button` 立即 disabled + 转 `■ 停止`（Optimistic UI）。

### 4.5 与指南 § 项目骨架 的对齐映射

| 指南骨架（Orkas Renderer） | my-agent Web 实施 | 说明 |
| --- | --- | --- |
| `src/renderer/index.html` | `web/index.html` | 完全对齐 |
| `src/renderer/style.css` | `web/style.css` | 完全对齐 |
| `src/main/preload.js` (contextBridge) | **跳过**（HTTP 直接 fetch，浏览器 CORS 不限制同源） | — |
| `src/renderer/modules/ipc-shim.js` | **不需要**（Web 直接 `fetch('/api/...')`，无 URL→channel 路由） | — |
| `src/renderer/modules/state.js` | `web/js/state/state.js` | 完全对齐 |
| `src/renderer/modules/i18n.js` | `web/js/shared/i18n.js`（极简版，单语言，无 `sendSync` 启动） | — |
| `src/renderer/modules/icons.js` | `web/js/shared/icons.js`（**暂缓**，先用 emoji 占位） | YAGNI |
| `src/renderer/modules/agents.js` | `web/js/features/agents.js` | 对齐 |
| `src/renderer/modules/skills.js` | **不实现**（CLI 尚无 skill CRUD UI，只读展示走 `/api/skills`） | YAGNI |
| `src/renderer/modules/conversation.js` | `web/js/features/chat.js` | 对齐（消息流渲染 + SSE 消费） |
| `src/renderer/modules/marketplace.js` | **不实现**（本项目无 marketplace） | YAGNI |
| `src/renderer/modules/boot.js` | `web/js/app.js`（简化版：单阶段即可，~500ms 启动） | — |

---

## 5. UI / 交互规范

### 5.1 数字彩菜单 6 色映射（**Dark 优先**，与 CLI 完全对齐）

| 数字 | CLI ANSI | Dark Web Token | Light Web Token | Tailwind |
| --- | --- | --- | --- | --- |
| ① | `\x1b[36m` 青色 | `--menu-color-1` `#22D3EE` | `#0891B2` | cyan-400 / cyan-600 |
| ② | `\x1b[32m` 绿色 | `--menu-color-2` `#4ADE80` | `#16A34A` | green-400 / green-600 |
| ③ | `\x1b[33m` 黄色 | `--menu-color-3` `#FACC15` | `#CA8A04` | yellow-400 / yellow-600 |
| ④ | `\x1b[34m` 蓝色 | `--menu-color-4` `#60A5FA` | `#2563EB` | blue-400 / blue-600 |
| ⑤ | `\x1b[35m` 紫色 | `--menu-color-5` `#C084FC` | `#9333EA` | purple-400 / purple-600 |
| ⑥ | `\x1b[31m` 红色 | `--menu-color-6` `#F87171` | `#DC2626` | red-400 / red-600 |
| ⑦+ | 循环回 ① | — | — | — |

> 复用 `src/cli/io.ts` 的 `menuColor(i)` 逻辑：`(i - 1) % 6 + 1`。
> Dark 配色统一用 `-400` 级（高亮饱和）；Light 配色用 `-600` 级（保证 4.5:1 对比）。
> 前端 `utils.js#menuColorHex(i, theme)` 同步此映射（**按主题切换 token**）。

### 5.2 主页面布局（Bento Grid 主菜单）

```
┌────────────────────────────────────────────────────────────────────┐
│  my-agent-web                                          ⚙ 设置      │  ← 顶栏
├──────────────┬─────────────────────────────────────────────────────┤
│              │                                                     │
│  🏠 主菜单   │   ┌─ 当前面板 ──────────────────────────────────┐    │
│  💬 对话     │   │                                             │    │
│  📚 历史     │   │   数字彩菜单 / 会话消息流 / 设置表单 /       │    │
│  ⚙ 提供商    │   │   子Agent 列表...                            │    │
│  🤖 子Agent  │   │                                             │    │
│              │   └─────────────────────────────────────────────┘    │
│  ──── 会话 ──│                                                     │
│  • 会话 A    │                                                     │
│  • 会话 B    │                                                     │
│              │                                                     │
└──────────────┴─────────────────────────────────────────────────────┘
```

### 5.3 主菜单视图（与 `src/cli/menu.ts` 1:1 对应 — Bento Grid）

```
┌────────────────────────────────────────────────────────────────────┐
│  my-agent-web                       🌙/☀ 主题    ⚙ Provider 设置   │  ← 顶栏（h-14, sticky）
├──────────────┬─────────────────────────────────────────────────────┤
│              │                                                     │
│  侧边栏      │   ┌─ 当前: deepseek (DeepSeek) ✅ [启用]  v1.0.0  ┐ │  ← 状态条（亮黄缺失警示）
│              │   └──────────────────────────────────────────────┘ │
│  🏠 主菜单   │                                                     │
│  💬 对话     │   ┌──────────────────────────┬────────────────────┐ │
│  📚 历史     │   │ ①                        │ ②                  │ │
│              │   │ 开始对话                 │ 加载历史对话       │ │
│  ─────       │   │ 创建一个新会话           │ 恢复已有的会话     │ │
│  会话列表    │   │ 大号青色 digit + hover    │ 绿色               │ │
│  ▸ gconv-…  │   └──────────────────────────┴────────────────────┘ │
│  ▸ gconv-…  │   ┌──────────────┬──────────────┬─────────────────┐ │
│  ▸ gconv-…  │   │ ③            │ ④            │ ⑤               │ │
│  + 新会话    │   │ 设置提供商    │ 查看当前     │ 子 Agent 管理    │ │
│              │   │ 黄色         │ 蓝色         │ 紫色            │ │
│  ─────       │   └──────────────┴──────────────┴─────────────────┘ │
│  ⚙ 设置      │   ┌────────────────────────────────────────────────┐│
│              │   │ ⑥ 退出                                       ││
│  ⏻ 退出      │   │ 红色全宽卡片                                 ││
│              │   └────────────────────────────────────────────────┘│
└──────────────┴─────────────────────────────────────────────────────┘
```

**主菜单卡片细节（每个 `MenuCard`）：**

```
┌─────────────────────────────────────────┐
│  ①                                      │ ← JetBrains Mono 28px digit，使用 menu-color-1
│  开始对话                                │ ← IBM Plex Sans 16px font-medium
│  创建一个新会话，与 DeepSeek 模型对话     │ ← IBM Plex Sans 13px text-secondary
│                                  →      │ ← Lucide chevron-right icon
└─────────────────────────────────────────┘
       ↑ bg-surface，边框 var(--menu-color-N)/40，hover 时边框 var(--menu-color-N)
```

**交互：**

| 维度 | 行为 |
| --- | --- |
| Hover | 边框由 40% 不透明 → 100%；transform: translateY(-1px)；shadow: `0 4px 12px rgba(0,0,0,0.25)` |
| 键盘 Tab | 顺序聚焦「⑥ → ② → ③ → ④ → ⑤ → ① → 侧边栏项」（DOM 顺序，DOM 顺序 = tab 顺序） |
| 键盘 Enter | 同点击 |
| 点击 | `setView(card.view)` + 触发 `viewTransition()` 200ms 淡入新 panel |
| ⑥ 退出 | 弹 ConfirmDialog「确认退出 Web 界面？关闭窗口后服务在后台继续运行」 |

### 5.4 对话视图（与 `chat.ts:runChat()` 1:1）

```
┌────────────────────────────────────────────────────────┐
│  Session: gconv-a3f8e1c2b4d5        [↻ 新对话]  [■ 停止] │
├────────────────────────────────────────────────────────┤
│                                                        │
│  👤 写一个 hello world                                 │
│                                                        │
│  🤖 你好！这里是一个简单的 Hello World 程序：               │
│     ```python                                         │
│     print("Hello, World!")                            │
│     ```                                                │
│                                                        │
│     [tool] get_current_time({"timezone":"Asia/…"})    │
│            [OK] Asia/Shanghai 当前时间: 2026/8/7 ...    │
│                                                        │
│  👤 那 React 版本呢？                                   │
│                                                        │
│  🤖 ▌ (光标闪烁等待流式)                                  │
│                                                        │
├────────────────────────────────────────────────────────┤
│  [文本输入框 — 多行]      [↑ 上一条]   [Cmd+⏎ 发送]      │
│  💡 输入 / 查看斜杠命令                                   │
└────────────────────────────────────────────────────────┘
```

> ASCII 中图标用文本占位（`[tool]` `[OK]`）；实际渲染按 § 4.4.6 全部用 Lucide SVG，**无 emoji**。

**交互规则：**

- **Enter** = 换行，**Cmd/Ctrl + Enter** = 发送（避免回车误触）。可配置切换。
- **点击「发送」** = 触发 SSE 连接 + 排队进入 `messageQueues`（FIFO）。
- **点击「■ 停止」 / `Cmd/Ctrl + .`** = `fetch().body.cancel()` + `navigator.sendBeacon` 触发服务端 abort（联动 runner AbortSignal，见 § 6.1）。
- **多轮**：恢复会话后，左侧滚动到顶；新消息追加到底部，自动滚动跟随。
- **历史会话切换**：右侧渐隐 → 重新加载 `/api/sessions/:id/history`。
- **以 `/` 开头的输入** 走客户端拦截，详见 § 5.4.1。

### 5.4.1 Slash 命令（与 CLI 数字菜单对齐 + Web 独有补充）

> 保留 CLI「数字 + 中文菜单」的对话风格 —— Web 端通过**客户端拦截**（绝大多数命令）+ **服务端扩展端点**（少量需要服务端状态的命令）实现。**零依赖、零 API Key / 模型调用消耗**。
>
> **关于「与 CLI 对齐」的说明：** CLI 实际入口是 [src/cli/menu.ts](src/cli/menu.ts) 的 6 项数字菜单（`mainMenuChoices = ["start","history","settings","view","agents","quit"]`），**不存在 `chat.ts:478-523`**（仓库无此文件，无 slash 命令）。本节 18 条 slash 命令是 Web 端的**新增**能力，按「CLI 主菜单覆盖 + Web 独有补充」组织。

**CLI 主菜单 6 项 → Web slash / 侧边栏覆盖映射：**

| CLI 数字菜单 | Web 触发方式 | 实现位置 |
| --- | --- | --- |
| ① 开始对话 | `/new` / `/clear` | § 5.4.1 Slash 命令 |
| ② 加载历史对话 | `/history` + 侧边栏会话列表 | § 5.4.1 + § 5.6 |
| ③ 设置模型提供商 | **侧边栏 `⚙ 设置` 入口**（YAGNI：slash 重复收益小，且 `/model` 已能切模型） | § 5.5 Provider 设置视图 |
| ④ 查看当前提供商 | `/provider` | § 5.4.1 |
| ⑤ 子 Agent 管理 | `/agents` + 侧边栏 `🤖 Agents` | § 5.4.1 + § 5.7 |
| ⑥ 退出 | `/quit` / `/exit` | § 5.4.1 |

**客户端拦截流程：**

```
用户输入框 content = "/"
  ↓
parseSlash(content)
  ├─ 命中 ? → 拦截：不发送 SSE，弹出对应 UI（Toast / Modal / Dialog）
  └─ 未命中 → 当作普通 user 消息发往 /api/sessions/:cid/messages/stream
```

**完整命令表（18 条；覆盖 CLI 主菜单 6 项 + Web 端独有补充）：**

| 命令 | 实现 | 行为 | 触发 UI |
| --- | --- | --- | --- |
| `/help` | 客户端 | 弹出命令帮助弹窗（与 `Cmd/Ctrl+/` 共享同一 Modal） | Modal |
| `/quit` | 客户端 | 弹 ConfirmDialog「退出 Web 模式？服务在后台继续运行」；确认后 `window.close()` | ConfirmDialog |
| `/exit` | 客户端 | 同 `/quit`（别名） | ConfirmDialog |
| `/clear` | **客户端+服务端** | POST `/api/sessions`（`kind=gconv`）→ 等返回 → `setView('chat', newCid)` + 把旧 cid 移入「已归档」（不删除文件，可在侧边栏「已归档」分组恢复） | 上下文消息 + 焦点切新会话 |
| `/new` | 客户端 | `/clear` 的语义化别名（CLI 主菜单 1「开始对话」对应） | 同 `/clear` |
| `/save` | 客户端 | Toast info 显示当前 cid，附「复制到剪贴板」按钮（`navigator.clipboard.writeText(cid)`） | Toast |
| `/history` | 客户端 | 弹 Modal 列出已归档会话（前 50 条，按 updatedAt desc），点击切回（对应 CLI 主菜单 2） | Modal（列表 + 切换） |
| `/tools` | 客户端 | 弹 Modal 列出 `allTools`（已加载到前端 cache）+ 工具描述前 80 字 | Modal（只读列表） |
| `/skills` | 客户端 | 弹 Modal 列出已加载 skills + description_zh | Modal（只读列表） |
| `/skill <id>` | **客户端+服务端** | GET `/api/skills/:id` → 弹 Modal 显示 Skill 完整 SKILL.md（含 body，Markdown 渲染 + DOMPurify） | Modal（只读内容） |
| `/agents` | 客户端 | 弹 Modal 列出 builtin + user agents（对应 CLI 主菜单 5）；点击 `/agent <id>` 查看 spec | Modal（列表 + 跳转） |
| `/provider` | 客户端 | 弹 Modal 显示当前 active provider（id / name / baseUrl / defaultModel / 启用状态）+ 「切换」按钮跳 Provider 设置页 | Modal（只读 + 跳转） |
| `/model <name>` | **客户端+服务端** | PATCH `/api/providers/active/model`（body=`{ model }`）→ Toast success 显示新模型；404 → Toast `MODEL_NOT_FOUND`；422 → Toast `INVALID_JSON` | Toast / Modal |
| `/compact` | **客户端+服务端** | 弹 CompactModal：先 POST `/api/sessions/:cid/compact { confirm: false }` 拉 `Session.getTokenEstimate()` 显示当前 `used / limit / ratio`；用户点「立即压缩」→ 同端点 `{ confirm: true }` → 服务端调 `AgentRunner.compactNow()`，返回 `{ tokensBefore, tokensAfter, durationMs }` | Modal（操作 + Toast） |
| `/retry` | 客户端 | 重发最后一条 user 消息（无需服务端）；若没有则 Toast warning「没有可重试的消息」 | 复用普通发送流 |
| `/copy` | 客户端 | `navigator.clipboard.writeText(lastAssistantText)`，catch `NotAllowedError` 时回退 `document.execCommand('copy')` 或 Toast「请手动复制」；无消息则 Toast warning | Toast |
| `/theme` | 客户端 | 循环切换 `dark → light → system → dark`，写入 `localStorage['my-agent.theme']`（命名空间前缀，与 § 3.3 / F0 `shared/theme.js` 一致），F0 通过 `CustomEvent('my-agent-theme-change')` 监听并更新 CSS 变量；`system` 模式监听 `prefers-color-scheme`；Toast 显示新主题名 | Toast |
| `/usage` | 客户端 | 弹 Modal 显示当前会话累计 token 用量（累加自 `done.result.usage`）+ 各模型占比（按 provider.model 分组）；新会话未开始时提示「尚无用量」；Modal 顶部固定提示「**数据仅本机，不外传**」（仅 localhost 单用户，不脱敏但显式标注） | Modal（统计 + Toast） |
| 未知命令 `/xxx` | 客户端 | Toast warning 提示「未知命令 /xxx，输入 /help 查看」+ 输入框字符保留 | Toast |

**客户端拦截实现（`web/js/features/slash.js`）：**

```js
const SLASH_COMMANDS = {
  // ── 帮助 / 退出 ──
  "/help":    { kind: "help",     requiresArgs: false },                          // 默认 false，可省略
  "/quit":    { kind: "quit",     requiresArgs: false },
  "/exit":    { kind: "quit",     requiresArgs: false },                          // 别名
  // ── 会话管理 ──
  "/clear":   { kind: "clear",    requiresServer: true },
  "/new":     { kind: "clear",    requiresServer: true },                         // 别名
  "/save":    { kind: "save",     requiresArgs: false },
  "/history": { kind: "history",  requiresArgs: false },
  // ── 工具 / Skill / Agent ──
  "/tools":   { kind: "tools",    requiresArgs: false },
  "/skills":  { kind: "skills",   requiresArgs: false },
  "/skill":   { kind: "skill",    requiresArgs: true,  requiresServer: true, argName: "id" },
  "/agents":  { kind: "agents",   requiresArgs: false },
  // ── Provider / Model ──
  "/provider":{ kind: "provider", requiresArgs: false },
  "/model":   { kind: "model",    requiresArgs: false, optionalArgs: true,        // 缺参走 Modal
                requiresServer: true, argName: "name" },
  // ── 对话内实用工具 ──
  "/compact": { kind: "compact",  requiresServer: true },                        // Modal 内含 POST 按钮
  "/retry":   { kind: "retry",    requiresArgs: false },
  "/copy":    { kind: "copy",     requiresArgs: false },
  "/theme":   { kind: "theme",    requiresArgs: false },
  "/usage":   { kind: "usage",    requiresArgs: false },
};

async function tryHandleSlash(cid, text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return false;

  // 解析命令 + 参数
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const def = SLASH_COMMANDS[cmd];
  if (!def) {
    toast.warning(`未知命令 ${cmd}，输入 /help 查看`);
    return true; // 拦截但不执行
  }

  const arg = rest.join(" ").trim();
  if (def.requiresArgs && !arg) {
    toast.warning(`用法：${cmd} <${def.argName}>`);
    return true;
  }
  // optionalArgs=true：参数缺失走 Modal 形态，参数存在走直接执行形态
  if (def.optionalArgs && arg === "") {
    return dispatchSlashKind(def.kind, cid, null);
  }

  return dispatchSlashKind(def.kind, cid, arg || null);
}

async function dispatchSlashKind(kind, cid, arg) {
  switch (kind) {
    // 帮助 / 退出
    case "help":     openHelpModal(); return true;
    case "quit":     await promptQuitAndClose(); return true;
    // 会话管理
    case "clear":    await clearContext(cid); return true;            // → POST /api/sessions
    case "save":     showSaveToast(cid); return true;
    case "history":  openHistoryModal(cid); return true;
    // 工具 / Skill / Agent
    case "tools":    openToolsModal(); return true;
    case "skills":   openSkillsModal(); return true;
    case "skill":    await openSkillModal(arg); return true;          // → GET /api/skills/:id
    case "agents":   openAgentsModal(); return true;
    // Provider / Model
    case "provider": openProviderModal(); return true;
    case "model":
      if (arg) await switchModel(arg);                                // → PATCH /api/providers/active/model
      else openProviderModal();                                       // 无参：弹 Modal
      return true;
    // 对话内实用工具
    case "compact":  openCompactModal(cid); return true;              // Modal 内含「立即压缩」按钮
    case "retry":    await retryLastMessage(cid); return true;
    case "copy":     copyLastAssistant(cid); return true;
    case "theme":    cycleTheme(); return true;
    case "usage":    openUsageModal(cid); return true;
    default:
      // 兜底：未知 kind 不应到达此处（SLASH_COMMANDS 已过滤），但开发期可能扩展时漏掉
      console.error("[slash] unknown kind:", kind);
      toast.error("命令处理异常，请刷新页面");
      return true;
  }
}
```

**`/clear` 时序图：**

```
chat.js                    apiFetch                      SessionStore
   │                          │                              │
   │── POST /api/sessions ───>│                              │
   │   (kind=gconv)           │── sessionStore.create() ───>│
   │                          │<─ { id: "gconv-aaa..." } ────│
   │<─ { ok, data } ──────────│                              │
   │                                                            │
   │── setView('chat', newCid)                                     │
   │── clearInput()                                                │
   │── toast.success('新会话已创建')                                 │
```

**`/help` Modal 内容（运行时按需折叠分组，分类标签可点击展开）：**

```
┌─ 命令帮助 ──────────────────────────────────────────────┐
│                                                          │
│ ── 会话管理 ──                                            │
│   /new        新建会话（同 /clear）                       │
│   /clear      新建会话并切换                              │
│   /save       显示当前 session ID                        │
│   /history    列出已归档会话                              │
│                                                          │
│ ── 工具 / Skill / Agent ──                                │
│   /tools      列出可用工具                                │
│   /skills     列出所有 Skill                              │
│   /skill <id> 查看 Skill 详细内容                         │
│   /agents     列出所有子 Agent                            │
│                                                          │
│ ── Provider / Model ──                                    │
│   /provider   显示当前 provider 信息                      │
│   /model <n>  切换当前 provider 的模型（无参则打开设置）   │
│                                                          │
│ ── 对话内实用工具 ──                                      │
│   /compact    查看上下文用量 + 触发手动压缩               │
│   /retry      重发最后一条消息                            │
│   /copy       复制最后一条 assistant 回复                 │
│   /theme      切换主题（dark → light → system）           │
│   /usage      显示当前会话 token 用量统计                 │
│                                                          │
│ ── 帮助 / 退出 ──                                         │
│   /help       显示此帮助                                  │
│   /quit       退出 Web 界面                                │
│   /exit       同 /quit                                    │
│                                                          │
│ ── 全局快捷键 ──                                          │
│   Cmd/Ctrl + K    快速跳转                                │
│   Cmd/Ctrl + ⏎    发送消息                                │
│   Cmd/Ctrl + .    停止当前生成                            │
│   Cmd/Ctrl + B    折叠侧边栏                              │
│   ↑ / ↓          主菜单卡片焦点切换                       │
│   1 ~ 6          直接选中主菜单项                         │
│                                                          │
│                                            [关闭]         │
└──────────────────────────────────────────────────────────┘
```

**新增命令的端点约定（与 § 3 路由表保持一致）：**

| 命令 | 复用端点 | 新增端点 | 备注 |
| --- | --- | --- | --- |
| `/new` | POST `/api/sessions` | — | `/clear` 的语义化别名，复用完全相同的处理函数 |
| `/history` | GET `/api/sessions?archived=true&limit=50` | — | 复用 `getSessions` 的 query 参数 |
| `/agents` | GET `/api/agents` | — | 复用现有端点 |
| `/provider` | GET `/api/providers/active` | — | 仅展示用 |
| `/model <name>` | — | **PATCH `/api/providers/active/model`** | body `{ model: string }`；200 → Toast success；404 → 「未知模型」Toast |
| `/compact` | — | **POST `/api/sessions/:cid/compact`** | 触发即时压缩；返回新 `tokensAfter`；SSE 仍按原样推送 `compaction` 事件 |
| `/retry` | POST `/api/sessions/:cid/messages/stream` | — | 客户端从 history 拿最后一条 user 文本，重发 |
| `/copy` | — | — | 纯客户端 `navigator.clipboard.writeText` |
| `/theme` | — | — | 纯客户端切 `localStorage['my-agent.theme']` + 改 `<html data-theme>`；通过 `CustomEvent('my-agent-theme-change')` 通知 F0 |
| `/usage` | — | — | 纯客户端累计 `done.result.usage` 到内存，**会话切换时清零**（防长会话内存增长，见 § 9 风险表 R-23） |

**降级与边界：**

- **空消息** `/` 单独一键不发送（不弹 toast，避免烦扰）。
- **消息中包含 `/`**（非开头）走普通 SSE，例如「代码注释 / 示例」不会被拦截。
- **Tab 自动补全**：输入 `/` 后按 Tab 不补全（YAGNI；保留为增强项）。
- **历史消息中的 `/clear` 等命令字面量**：回放 `getHistory` 时**不会**触发，渲染为字面文本（仅 input 框当下输入拦截）。
- **`/model` 无参**：降级为「打开 provider 设置 Modal」，避免歧义（多个 provider 时「切换到哪个」未指定）。
- **`/theme` 主题值枚举**：`dark` / `light` / `system`；CSS 变量在 `:root[data-theme="..."]` 选择器下切换；`system` 模式监听 `prefers-color-scheme`。**主题切换不影响 CSP**（仅改 `<html data-theme>` + CSS 变量，不引入 inline style，§ 6.6 `'unsafe-inline'` 不需要）。
- **`/retry` 无最后一条**：Toast warning「没有可重试的消息」。
- **`/copy` 无 assistant 消息**：Toast warning「尚无可复制内容」。
- **`/copy` clipboard 权限拒绝**：`navigator.clipboard.writeText` 在非 secure context（http://非 localhost）或用户拒绝权限时抛 `NotAllowedError`。catch 后回退到 `document.execCommand('copy')`（已废弃但仍可用）；若仍失败则 Toast「请手动复制（Ctrl/Cmd+C）」。
- **`/history` 列表 > 50 条**：HistoryModal 内显示「查看更多」按钮 → 调 `GET /api/sessions?limit=200&offset=50`，分页加载。
- **`/usage` 内存策略**：客户端只累计**当前会话**的 `done.result.usage`（按 `provider.model` 分组到内存 Map）；**切换 cid 或关闭页面时清零**（`window.beforeunload` + `setView('chat', newCid)` 钩子）。长会话按 usage 事件增量累加，单条记录体积 ≤ 100B，1000 轮 ≈ 100KB（可接受）。
- **`/agent <id>`（v2 残留已清理）**：`/agents` Modal 内点击 entry → 直接调 `openAgentDetailModal(id)`（复用 SkillDetailModal 的逻辑），**不**是独立 slash 命令。SLASH_COMMANDS 字典无 `/agent` key。

**F18 WU 落地清单（10 个 Modal + 1 个 slash 入口 + 1 个 theme + 2 个服务端端点）：**

前端组件（11 个新文件）：

- `web/js/features/slash.js`（含 `tryHandleSlash` / `dispatchSlashKind` / `SLASH_COMMANDS` 字典 — 18 条）
- `web/js/components/HelpModal.js`（`/help` + `Cmd/Ctrl+/` 共享，分组可折叠）
- `web/js/components/HistoryModal.js`（`/history` 列表 + 分页 + 切换）
- `web/js/components/ToolsModal.js`（`/tools` 只读列表，工具描述前 80 字）
- `web/js/components/SkillsModal.js`（`/skills` 只读列表，description_zh）
- `web/js/components/SkillDetailModal.js`（`/skill <id>` 完整 SKILL.md 渲染）
- `web/js/components/AgentsModal.js`（`/agents` 列表 + 点击 entry → 详情 Modal）
- `web/js/components/ProviderModal.js`（`/provider` 只读 + 跳设置页）
- `web/js/components/CompactModal.js`（`/compact` 用量展示 + 「立即压缩」按钮）
- `web/js/components/UsageModal.js`（`/usage` token 统计）
- `web/js/features/theme.js`（`/theme` 循环切换 + `prefers-color-scheme` 监听；与 F0 `web/js/shared/theme.js` 共享 `my-agent.theme` storage key，职责切分见 § 5.4.1 注 2）

服务端端点（2 个，落到 § 7.1 **B8**）：

- **F-S-1** `PATCH /api/providers/active/model`（body=`{ model }`）
- **F-S-2** `POST /api/sessions/:cid/compact`（body=`{}`，返回 `{ tokensBefore, tokensAfter, durationMs }`）

单测：

- `slash.test.js`（每条命令各 case：`空消息 / 参数缺失 / 未知命令 / 命中 / 服务端失败 / clipboard 权限拒绝 / theme 三态循环`）

**注 1：** `/agent <id>` 不是独立命令 —— `/agents` Modal 内点击 entry 触发 SkillDetailModal 复用逻辑（路径 `/agents/<id>` → `GET /api/agents/:id`），见 [src/cli/agent-menu.ts](src/cli/agent-menu.ts) `showAgentDetail` 的 Web 移植。

**注 2（F0 vs F18 theme.js 职责切分）：**

| 路径 | 职责 | 调用关系 |
| --- | --- | --- |
| `web/js/shared/theme.js`（F0 设计系统层） | 启动时从 `localStorage['my-agent.theme']` 读值，初始化 `<html data-theme="...">`；监听 `prefers-color-scheme` 变化（在 `system` 模式下） | 启动入口 `app.js` 第一步调用 |
| `web/js/features/theme.js`（F18 `/theme` 命令层） | 循环切换 dark → light → system → dark，写回同一 key；通过 `CustomEvent('my-agent-theme-change')` 通知 F0 | F0 监听该事件并重设 CSS 变量 |

### 5.5 Provider 设置视图（与 `provider-menu.ts` 1:1）

```
┌─ Provider 设置 ─────────────────────────────────────────┐
│ 当前: deepseek (DeepSeek) [启用]                          │
│                                                         │
│ [表格]                                                  │
│ ID       名称        类型       默认模型    启用   操作  │
│ deepseek DeepSeek    deepseek   deepseek…  ✓     切换  │
│ other    OtherAI     deepseek   chat-3.5    ✗     启用  │
│                                                         │
│ 选 1-6:                                                 │
│  ① 新建提供商                                           │
│  ② 编辑当前                                             │
│  ③ 切换当前                                             │
│  ④ 启用 / 禁用                                          │
│  ⑤ 删除当前                                             │
│  ⑥ 返回主菜单                                           │
│                                                         │
│ [编辑表单（② 触发时弹出 inline）]                          │
│   显示名称 [DeepSeek]                                    │
│   API Key  [***xxx]                                     │
│   Base URL [https://api.deepseek.com/v1]                │
│   默认模型 [deepseek-chat]                              │
│   [✓] 启用                                              │
│                                       [取消]  [保存]    │
└─────────────────────────────────────────────────────────┘
```

> 表格中 `✓` `✗` 是 ASCII 占位；实际渲染用 Lucide icon (`check` / `x`)。

### 5.6 Agent 管理视图（与 `agent-menu.ts` 1:1）

```
┌─ 子 Agent 管理 ─────────────────────────────────────────┐
│ 内置 Agent                                              │
│   - coder      代码实现 Agent (内置)                     │
│   - reviewer   代码审查 Agent                            │
│   - implementer 轻量文档 / chore Agent                   │
│                                                         │
│ 用户 Agent                                              │
│   - (暂无 — 将 agent.json 放入 ~/.my-agent/agents/)    │
│                                                         │
│ 点 ID 进入详情：                                         │
│   coder  →  Workflow (前 3 行):                          │
│              1. 分析用户需求                              │
│              2. 设计实现方案                              │
│              ...                                        │
│              技能: 全部                                  │
└─────────────────────────────────────────────────────────┘
```

### 5.7 全站键盘快捷键（全局可监听）

| 快捷键 | 行为 | 范围 |
| --- | --- | --- |
| `Cmd/Ctrl + K` | 打开快速跳转（搜索侧边栏菜单 / 会话 / Agent） | 全局 |
| `Cmd/Ctrl + Enter` | 在输入框中发送消息 | chat 视图 |
| `Cmd/Ctrl + .` | 停止当前生成 | chat 视图 |
| `Cmd/Ctrl + /` | 打开快捷键 + 斜杠命令帮助弹窗（与 `/help` 共享） | 全局 |
| `Cmd/Ctrl + B` | 折叠侧边栏（只保留图标列宽 64px） | 全局 |
| `Esc` | 关闭最上层 Modal / ConfirmDialog / Toast 队列 | 全局 |
| `↑` / `↓` | 主菜单卡片间移动焦点 | main-menu 视图 |
| `1`～`6` | 直接选中对应项 | main-menu 视图（键盘映射与 CLI 1:1） |
| `Tab` / `Shift+Tab` | 焦点切换 | 全局，**focus-visible ring 始终可见** |

**冲突处理：** 在 `<input>` / `<textarea>` 内禁用上述非 Enter/Esc 快捷键（`stopPropagation` + 输入态判断）。

### 5.8 跨页面交互系统

#### 5.8.1 Toast / Snackbar

- 单一全局实例（`window.toast`），4 队列上限 FIFO；新 toast 入队尾部。
- 样式：右下角 fixed，距底部 `var(--space-4)` + `var(--space-4)` 右；宽度 360px。
- 类型 + 颜色 + 图标：

| 类型 | icon（Lucide） | 边色 | 背景 |
| --- | --- | --- | --- |
| `info` | info | sky-400 | slate-800 |
| `success` | check-circle-2 | green-400 | slate-800 |
| `warning` | alert-triangle | amber-400 | slate-800 |
| `danger` | x-circle | red-500 | slate-800 |

- 自动关闭 4s；hover 暂停倒计时；点 × 立即关闭。
- 键盘：`Tab` 在队列内跳转，`Enter` 触发 primary action（toast 可带 1 个 action 按钮）。
- `aria-live="polite"` + `role="status"`（`danger` 用 `role="alert"`）。

#### 5.8.2 ConfirmDialog

```js
const ok = await uiConfirm({
  title: "删除会话",
  message: `确认删除会话 "${session.name}"？文件将从 ~/.my-agent/sessions/ 移除。`,
  confirmLabel: "删除",
  cancelLabel: "取消",
  danger: true,  // 红色主按钮
});
```

- 使用原生 `<dialog>` 元素，focus trap；ESC 关闭。
- 主按钮 `<button autofocus>` —— Enter 直接确认。
- `danger: true` 时按钮 `--danger` 色 + 「Delete」「Remove」等强动词。
- 用法：`await uiConfirm(...)` Promise<boolean>。

#### 5.8.3 Modal

- 居中遮罩（`bg-black/60 backdrop-blur-sm`）。
- 进入动效：scale 0.95 → 1，opacity 0 → 1，220ms。
- 关闭动效：反向，180ms。
- ESC + 背景点击关闭（可配 `dismissible: false` 强制显式按钮）。
- 焦点管理：open 时第一个 focusable 元素获得焦点；close 时焦点回到触发元素（`previousActiveElement`）。

#### 5.8.4 Skeleton / Spinner / Optimistic UI

| 场景 | 组件 |
| --- | --- |
| 会话列表首次加载 | 3 个 skeleton 行（左侧头像 + 2 行文字） |
| Agent 列表首次加载 | 6 个 skeleton 卡片（方形图 + 2 行文字） |
| Skill 详情首次加载 | 文本 skeleton（8 行） |
| Provider 表格首次加载 | 行 skeleton |
| 流式生成中 | 文字光标 `<span class="caret">▌</span>` + 0.6s 闪烁 |
| 不可中断操作（如文件保存） | Spinner（仅此一处） |
| 「发送」按钮按下后 | 立即 disabled + 显示「排队中」或「生成中」状态文字 |

#### 5.8.5 焦点管理

- 主内容切换 panel 时，**焦点移动到 panel 第一标题**（`<h1 tabindex="-1">` + `.focus()`）——屏幕阅读器可朗读。
- Modal 打开时，`previousActiveElement = document.activeElement`；关闭时恢复。
- 任何「自动 focus 到 input」操作都用 `.focus({ preventScroll: true })`避免跳动。

### 5.9 可访问性（WCAG 2.1 AA 强约束）

> `frontend-ui-engineering` skill 的强制要求：**没有任何 AI 风的「一带而过」**，每条 a11y 都必须落地。

| 项目 | 要求 |
| --- | --- |
| 颜色对比 | 文字 ≥ 4.5:1，大字 ≥ 3:1（spec § 4.4.1 已验证） |
| 焦点可见 | 所有 focusable 元素 `:focus-visible` ring 必须明显，`--focus-ring` 3:1 对比 |
| 语义 HTML | `<button>` / `<a>` / `<nav>` / `<main>` / `<aside>` / `<section aria-labelledby>` 正确使用 |
| ARIA 标签 | 所有 icon-only button `aria-label`；表单 input `for` + `<label>`；状态用 `aria-live` |
| 键盘可达 | Tab 顺序 = DOM 顺序；无 `tabindex` ≥ 1；Modal 内 focus trap |
| 跳过链接 | 顶栏 `Skip to main content` 隐藏但 Tab 第一个元素可访问 |
| 替代文本 | 没有 `<img>` 装饰图（用 SVG 用 `aria-hidden`）；有内容的图必须有 `alt` |
| 动效降级 | `@media (prefers-reduced-motion: reduce)` 全站 0ms |
| 屏幕阅读器测试 | VoiceOver (macOS Safari) 与 NVDA (Windows Firefox) 至少各跑 1 次手动验证 |
| 错误反馈 | 表单错误同时 visual + `aria-invalid="true"` + `aria-describedby` 指向错误文案 |

**键盘快捷键 + 斜杠命令帮助弹窗：** `Cmd/Ctrl + /` 触发；列出 spec § 5.7 + § 5.4.1 所有快捷键与命令。

### 5.10 错误 / 异常 UI（细化）

| 场景 | 表现 |
| --- | --- |
| 后端 404 | 顶栏红色横幅：`接口不存在：<method> <path>` + 「查看 API 文档」按钮 |
| 后端 422（表单校验） | Modal 内联显示字段错误（红色边框 + 下方红字 + 焦点移到首个错误字段）；用 `error.details` 字段级回填 |
| 后端 409（重复 / 删 active） | Modal 显示具体冲突原因（如「无法删除当前激活 provider — 先切换到其他 provider」） |
| 后端 429（in-flight 已有流） | Toast warning「当前会话已有生成在运行，等待完成后可发送下一条」+ 自动重试队列（FIFO） |
| 后端 5xx | Toast danger「服务异常：<code> <message>」 + 「重试」按钮（重发上次的请求） |
| SSE 连接中断（fetch body 异常 done） | 当前 assistant 气泡底部插入「连接已断开」Banner + 「重试发送」按钮（手动重发最后文本，**不自动**） |
| API Key 为空 | 顶部固定黄色 banner「当前 provider 缺少 API Key — 点此进入设置」；点主菜单 ① 同样引导 |
| ProviderStore / SessionStore 文件损坏 | 弹 Modal「配置文件已备份至 .bak-<ts>，已恢复默认。新设置请保存。」 |
| 浏览器关闭时 SSE 未关闭 | `beforeunload` 事件触发 `navigator.sendBeacon('/api/sessions/:id/messages/abort')` |
| `~/.my-agent/sessions/<id>.jsonl` 损坏 | 删除按钮 hover 时提示「该会话文件已损坏，强删将一并清理」 |

> 错误 UI 文字描述不使用 emoji 图标（与 § 4.4.6 「无 emoji」政策一致）；所有视觉信号用 Lucide SVG。

---

## 6. 关键实现细节

### 6.1 SSE 适配器（`src/web/server/sse.ts`）

> 这是**唯一需要新写的与现有模块交互的「胶水」**。规格：每个事件必须带 `seq`，便于客户端中断重连后去重。

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { AgentRunner } from "../../agent/runner.js";
import type { AgentRunEvent } from "../../agent/types.js";
import type { AgentRunParams } from "../../agent/types.js";

/**
 * 单条流返回一个 SSE streamId（用于重连 / 取消）。
 * abort 通道：每条流持有自己的 `AbortController`；
 * `_liveStreams.set(streamId, { controller, cid })`；
 * /api/sessions/:cid/messages/abort 通过 streamId 取 controller，调用 `ctrl.abort()`，
 * 联动 `runner.runStream({ signal })`（`AgentRunParams.signal`，src/agent/types.ts:??），
 * 进而触发 DeepSeek 流式连接断开、工具调用终止（runner.ts:597-645）。
 *
 * ⚠️ **没有 `runner.abort()` 这种实例方法** —— 中止通道就是 AbortSignal。
 */
const _liveStreams = new Map<string, { controller: AbortController; cid: string }>();

export function abortStream(streamId: string): boolean {
  const entry = _liveStreams.get(streamId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

export function listLiveStreamsForCid(cid: string): string[] {
  return [..._liveStreams.entries()]
    .filter(([, { cid: c }]) => c === cid)
    .map(([id]) => id);
}

export async function streamAgentRun(
  res: ServerResponse,
  runner: AgentRunner,
  input: { message: string; systemPrompt?: string; model?: string; cid: string },
): Promise<void> {
  // 1. 在 writeHead 前生成 streamId（header 携带）
  const streamId = randomUUID();
  res.setHeader("X-Stream-Id", streamId);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let seq = 0;
  let clientGone = false;
  const controller = new AbortController();
  _liveStreams.set(streamId, { controller, cid: input.cid });

  // 心跳：每 15s 写一条注释行防中间代理超时
  const heartbeat = setInterval(() => {
    if (clientGone) return;
    try { res.write(`: ping ${Date.now()}\n\n`); }
    catch { clientGone = true; clearInterval(heartbeat); }
  }, 15_000);

  res.on("close", () => { clientGone = true; clearInterval(heartbeat); _liveStreams.delete(streamId); });

  try {
    // 首个事件必须是 `start`（含 streamId & cid，seq=0），便于客户端严格按协议处理
    res.write(`event: start\ndata: ${JSON.stringify({ streamId, cid: input.cid, seq: 0 })}\n\n`);

    const params: AgentRunParams = {
      message: input.message,
      systemPrompt: input.systemPrompt,
      model: input.model,
      signal: controller.signal,  // 联动 abort 通道
    };

    for await (const ev of runner.runStream(params)) {
      if (clientGone) break;
      const wrapped = { seq: ++seq, ...ev };
      res.write(`id: ${seq}\ndata: ${JSON.stringify(wrapped)}\n\n`);
      // flush（防止 Node buffer）
      const sock = (res as any).socket;
      if (sock && typeof sock.flush === "function") sock.flush();
      else if (typeof (res as any).flush === "function") (res as any).flush();
    }

    // 终止事件一定是 done（按 `api-and-interface-design`「discriminated unions」）
    if (!clientGone) {
      res.write(`event: done\ndata: ${JSON.stringify({ ok: true, seq: ++seq })}\n\n`);
    }
  } catch (err) {
    if (!clientGone) {
      const errBody = {
        seq: ++seq,
        type: "error",
        ok: false,
        error: {
          code: "CHAT_RUNNER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      };
      res.write(`event: error\ndata: ${JSON.stringify(errBody)}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    _liveStreams.delete(streamId);
    try { res.end(); } catch { /* ignore */ }
  }
}
```

**Client 端 `Cmd+.` 停止流程：**

```
用户点击「■ 停止」/ 按 Cmd+.
  ↓
1. fetch reader.cancel() （关 SSE）
2. POST /api/sessions/:cid/messages/abort  { streamId }
   ├─ 服务端 _liveStreams.get(streamId).controller.abort()
   │     └─ runner.runStream 内部 signal listener 触发
   │           ├─ 正在执行的工具被中断（runner.ts:597-645）
   │           └─ DeepSeek SSE 连接断开
   └─ 对应 cid 立即可发下一条（FIFO 出队）
```

**SSE 事件契约（每个事件必须）：**

```
id: 1                                    ← seq（递增；客户端去重用）
event: start | text_delta | tool_delta | tool_start | tool_progress | tool_end
       | retry | provider_fallback | context_status | compaction
       | done | error | ping
data: {"seq":1,"type":"...",...payload}  ← JSON；type 必须在 data 内
```

**事件枚举与 `AgentRunEvent` 对齐声明（v3 § 6.1 修复 Finding 5/6）：**

| 事件 | 来源（[src/agent/types.ts](src/agent/types.ts)） | 当前 runner 实际 yield？ | 客户端处理 |
| --- | --- | --- | --- |
| `start` | 协议层（sse.ts 生成） | ✅（sse.ts 主动） | 标记流开始 + 显示 streamId |
| `text_delta` | `AgentRunEvent.type: "text_delta"` | ✅（runner.ts:1500+） | appendDelta |
| `tool_delta` | `type: "tool_delta"` | ✅（runner.ts:1580+） | accumulateToolDelta |
| **`tool_start`** | `type: "tool_start"`（[types.ts:629-641](src/agent/types.ts#L629)） | ✅（runner.ts:1608/1619/1678/1762） | **创建工具卡片 + 填充完整 `input` 对象**（v3 之前遗漏） |
| `tool_progress` | `type: "tool_progress"` | ✅（工具主动 emit） | updateToolProgress |
| `tool_end` | `type: "tool_end"` | ✅（runner.ts:1750+） | finalizeToolCard |
| `retry` | `type: "retry"` | ❌ runner 类型定义存在但**当前实现不 yield** | 预留 showStatusChip |
| `provider_fallback` | `type: "provider_fallback"` | ❌ 同上 | 预留 showStatusChip |
| `context_status` | `type: "context_status"`（[types.ts:732](src/agent/types.ts#L732)） | ❌ **当前实现不 yield**（Finding 6） | 预留 showStatusChip；`/compact` Modal **不依赖**此事件，改用 `Session.getTokenEstimate()`（见 § 3.1.5） |
| `compaction` | `type: "compaction"` | ❌ 当前实现不 yield（自动 compaction 内部完成，不通知流） | 预留 showStatusChip；`/compact` Modal 在响应体返回后自行显示新 `tokensAfter` |
| `done` | 协议层（runner 终止后由 sse.ts 补） | ✅（runner 隐含终止） | markBubbleDone |
| `error` | 协议层（catch 块生成） | ✅（sse.ts catch） | showErrorInBubble |
| `ping` | 协议层（心跳注释行） | ✅（sse.ts 15s interval） | 不 dispatch，仅保活 |

**客户端去重策略：**

```js
// fetch reader chunk → SSE parser buffer
const parser = {
  buf: "",
  done: false,
  seenMaxSeq: 0,
};
function feed(chunk) {
  parser.buf += chunk;
  let idx;
  while ((idx = parser.buf.indexOf("\n\n")) !== -1) {
    const block = parser.buf.slice(0, idx);
    parser.buf = parser.buf.slice(idx + 2);
    const ev = parseSseBlock(block); // {id, event, data}
    if (ev.id !== undefined && ev.id <= parser.seenMaxSeq) continue; // 去重
    parser.seenMaxSeq = Math.max(parser.seenMaxSeq, ev.id ?? 0);
    dispatch(ev);
  }
}
```

**为什么不自动重连：** LLM token 已消耗，重连会双倍扣费。客户端显示「↻ 重试发送」按钮让用户决定。

### 6.2 HTTP 路由分发（极简）

> 不引框架。`bin/my-agent-web.ts` 里一个 `tryServeStatic()` + 一个 `_matchRoute(method, pathname)` 字典，与 `仿写Agent前端框架指南` § 2.2 的路由表思路一致。

```ts
const ROUTES: Array<[string, string, RegExp | string, Handler]> = [
  // Provider 域
  ["GET",    "/api/providers",                 "/api/providers",            listProviders],
  ["GET",    "/api/providers/active",          "/api/providers/active",     getActiveProvider],    // F-S-0
  ["POST",   "/api/providers",                 "/api/providers",            upsertProvider],
  ["PUT",    "/api/providers/:id",             /^\/api\/providers\/([^/]+)$/,            updateProvider],
  ["POST",   "/api/providers/:id/toggle",      /^\/api\/providers\/([^/]+)\/toggle$/,   toggleProvider],
  ["DELETE", "/api/providers/:id",             /^\/api\/providers\/([^/]+)$/,            deleteProvider],
  ["PUT",    "/api/providers/active",          "/api/providers/active",     setActiveProvider],
  ["PATCH",  "/api/providers/active/model",    "/api/providers/active/model", patchActiveModel],   // F-S-1

  // Session 域
  ["GET",    "/api/sessions",                  "/api/sessions",             listSessions],
  ["POST",   "/api/sessions",                  "/api/sessions",             createSession],
  ["GET",    "/api/sessions/:id/history",      /^\/api\/sessions\/([^/]+)\/history$/,    getHistory],
  ["DELETE", "/api/sessions/:id",              /^\/api\/sessions\/([^/]+)$/,             deleteSession],
  ["POST",   "/api/sessions/:cid/compact",     /^\/api\/sessions\/([^/]+)\/compact$/,    compactSession],   // F-S-2

  // Chat 流
  ["POST",   "/api/sessions/:id/messages/stream", /^\/api\/sessions\/([^/]+)\/messages\/stream$/, postMessageStream],
  ["POST",   "/api/sessions/:id/messages/abort",  /^\/api\/sessions\/([^/]+)\/messages\/abort$/,  abortMessage],

  // Agent / Skill
  ["GET",    "/api/agents",                   "/api/agents",               listAgents],
  ["GET",    "/api/agents/:id",               /^\/api\/agents\/([^/]+)$/, getAgent],
  ["GET",    "/api/skills",                   "/api/skills",               listSkills],
  ["GET",    "/api/skills/:id",               /^\/api\/skills\/([^/]+)$/, getSkill],
];
```

### 6.3 启动入口（`bin/my-agent-web.ts`）

```ts
#!/usr/bin/env tsx
import { loadConfig } from "../src/config/loader.js";
import { ProvidersStore } from "../src/storage/providers-store.js";
import { SessionStore } from "../src/storage/session-store.js";
import { startServer } from "../src/web/server/index.js";
import { openBrowser } from "../src/web/server/open-browser.js";

const config = await loadConfig("./config.json");
const providersPath = path.join(
  process.env.MY_AGENT_HOME ?? path.join(os.homedir(), ".my-agent"),
  "providers.json",
);
const providersStore = await ProvidersStore.load(providersPath);
const sessionsStore = new SessionStore();
const port = Number(process.env.MY_AGENT_WEB_PORT ?? 5173);

const server = await startServer({ config, providersStore, sessionsStore, port });
console.log(`🌐 my-agent Web 已启动: http://localhost:${port}`);

if (process.env.CI !== "1") {
  await openBrowser(`http://localhost:${port}`);
}

// 优雅退出
process.on("SIGINT", async () => {
  await server.close();
  sessionsStore.closeAll();
  console.log("👋 再见！");
  process.exit(0);
});
```

### 6.4 前端 SSE 客户端（`web/js/features/chat.js` 核心片段）

```js
// 单条消息一个 stream 实例；AbortController 用于停止
async function sendMessageStream(cid, text) {
  // 1. 排队（FIFO，防并发请求导致 runner 串台）
  const queue = messageQueues.get(cid) ?? [];
  queue.push({ text, enqueuedAt: Date.now() });
  messageQueues.set(cid, queue);

  if (queue.length > 1) {
    // 已在生成中：toast 提示排队位置
    toast.info(`已排队：当前还有 ${queue.length - 1} 条`);
    return;
  }

  await drainQueue(cid);
}

async function drainQueue(cid) {
  while (messageQueues.get(cid)?.length) {
    const { text } = messageQueues.get(cid).shift();
    await actuallySend(cid, text);
  }
}

async function actuallySend(cid, text) {
  const assistantBubble = createAssistantBubble();
  const ctrl = new AbortController();
  pendingConvs.set(cid, { ctrl });
  showStopButton(ctrl); // 显示 ■ 停止

  const res = await fetch(`/api/sessions/${encodeURIComponent(cid)}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Request-Id": crypto.randomUUID() },
    body: JSON.stringify({ text }),
    signal: ctrl.signal,
  });

  if (!res.ok) {
    // 失败 → 渲染 ErrorState 在 assistant bubble 里
    const body = await safeJson(res);
    showErrorInBubble(assistantBubble, body?.error ?? { code: "INTERNAL", message: `HTTP ${res.status}` });
    pendingConvs.delete(cid);
    hideStopButton();
    return;
  }
  if (!res.body) {
    showErrorInBubble(assistantBubble, { code: "INTERNAL", message: "Empty response" });
    return;
  }

  // 解析 SSE（严格按 event / id / data 三行组）
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const parser = { buf: "", seenMaxSeq: 0 };
  let streamDone = false;
  let gotStart = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.buf += dec.decode(value, { stream: true });

      let idx;
      while ((idx = parser.buf.indexOf("\n\n")) !== -1) {
        const block = parser.buf.slice(0, idx);
        parser.buf = parser.buf.slice(idx + 2);

        const ev = parseSseBlock(block); // {id, event, data}
        if (ev.id !== undefined && ev.id <= parser.seenMaxSeq) continue;
        parser.seenMaxSeq = Math.max(parser.seenMaxSeq, ev.id ?? 0);

        if (ev.event === "start") {
          gotStart = true;
          // 显示 streamId 在 UI 角落（小字，开发态可见）
          if (window.__DEBUG__) console.log("[sse] start", ev.data);
          continue;
        }
        const data = JSON.parse(ev.data);
        dispatchSseEvent(assistantBubble, ev.event, data);
        if (ev.event === "done") { streamDone = true; break; }
        if (ev.event === "error") {
          showErrorInBubble(assistantBubble, data.error ?? { code: "INTERNAL", message: "stream error" });
          streamDone = true; break;
        }
      }
      if (streamDone) break;
    }
  } catch (err) {
    if (err.name === "AbortError") {
      showBannerInBubble(assistantBubble, "已停止生成");
    } else {
      showErrorInBubble(assistantBubble, { code: "INTERNAL", message: String(err) });
    }
  } finally {
    pendingConvs.delete(cid);
    hideStopButton();
    sendBtn().disabled = false;
  }
}

function dispatchSseEvent(bubble, eventType, data) {
  switch (eventType) {
    case "text_delta":
      appendDelta(bubble, data.text);
      break;
    case "tool_delta":
      accumulateToolDelta(bubble, data);
      break;
    case "tool_start":                          // v3 修复 Finding 5
      createToolCard(bubble, data);             // data: { name, id, input: object }
      break;
    case "tool_progress":
      updateToolProgress(bubble, data);
      break;
    case "tool_end":
      finalizeToolCard(bubble, data);
      break;
    case "compaction":
    case "context_status":
    case "provider_fallback":
    case "retry":
      showStatusChip(bubble, eventType, data);  // 当前 runner 不发，留兜底
      break;
    case "done":
      markBubbleDone(bubble);
      break;
    default:
      // 未知事件类型：开发态 console.warn，生产态静默（不阻断 UI）
      if (window.__DEBUG__) console.warn("[sse] unknown event", eventType, data);
      break;
  }
}

// SSE block 解析（按行拆分）
function parseSseBlock(block) {
  const lines = block.split("\n");
  let id, event, data = "";
  for (const line of lines) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim() + "\n";
    else if (line.startsWith(":")) continue; // comment / ping
  }
  if (data.endsWith("\n")) data = data.slice(0, -1);
  return { id, event: event ?? "message", data };
}
```

**停止按钮（Cmd/Ctrl + . 也触发）：**

```js
function stopCurrentStream() {
  const pending = pendingConvs.get(currentCid);
  if (!pending) return;
  pending.ctrl.abort();              // 客户端 fetch 取消
  navigator.sendBeacon(              // 服务端也立即知道
    `/api/sessions/${currentCid}/messages/abort`,
    new Blob([JSON.stringify({})], { type: "application/json" })
  );
}
```

> 替代方案：用浏览器原生 `EventSource`（仅 GET，body 用 POST 需 fetch + ReadableStream）。  
> **本次选 fetch + ReadableStream + AbortController**：POST 可带 body + 可中止 + 与 `/api/sessions/:cid/messages/stream` 一致。  
> 兼容性：Chrome / Edge / Firefox / Safari 全部支持 `ReadableStream`（>= 2020）。

### 6.5 CORS / 同源

- 因为所有静态文件 + API 都来自 `127.0.0.1:5173`，**完全同源**，无需 CORS 配置。
- 若用户改用远程端口（如 `MY_AGENT_WEB_PORT=8080`）仍同源。
- 若以后想跨域访问远程 my-agent 服务（不推荐），才需 `Access-Control-Allow-Origin`。

### 6.6 路径穿越防御 + 安全

- 后端所有路径参数过 `assertPathSegment()`（已存在于 `src/storage/paths.ts`）。
- 前端在处理用户输入的 ID 时，URL-encode 一次：`encodeURIComponent(cid)`。
- 浏览器端安全清单：
  - **CSP**（`Content-Security-Policy`）头：服务端写死 `default-src 'self'; style-src 'self' fonts.googleapis.com; font-src fonts.gstatic.com; connect-src 'self'; script-src 'self'; img-src 'self' data:;`
  - **不**使用 `eval`、`Function(...)`、`innerHTML` 含未净化内容（用户文本用 `textContent`，Markdown 走 DOMPurify）
  - API Key **不**写入 localStorage / sessionStorage / IndexedDB；表单态仅在内存中
  - 第三方依赖（DOMPurify / marked）使用 SRI hash：`<script integrity="sha384-..." crossorigin="anonymous">`

### 6.7 AgentRunner 流式消费的「匿名 stream」注意事项

- `runner.runStream()` 是 `AsyncIterable`，一次性消费。多个并发请求需要 **每个请求一个 `AgentRunner` 实例**（一个会话一个 runner 实例，与 `chat.ts:runChat()` 同模式）。
- 当前会话若正在流式（pending），新消息进入 `messageQueues` FIFO。
- 服务器侧 `streamAgentRun` 的 race：若用户发送前已有流在生成，服务端 429 + `Retry-After: 1`，客户端 toast.warning。
- 同会话多 tab 浏览器：两个 tab 都连 5147 时 streamId 不同；不会冲突，但 `PersistentSession` 写文件由 `SessionStore` 串行化保护。

---

## 7. 实施工作分解（建议 WU，等待 writing-plans 阶段确认）

### 7.1 后端 WU

| WU | 内容 | 产出 | 依赖 | 估时 |
| --- | --- | --- | --- | --- |
| **B1** | HTTP 服务器骨架：`bin/my-agent-web.ts` + `src/web/server/index.ts`；静态文件服务；CSP 头；端口和环境变量；CORS（默认同源零配置） | 两文件 + 单测 | — | S |
| **B2** | Provider 域 6 个 REST 接口（无新逻辑，仅 `ProvidersStore` 包装）+ Zod schema 校验 + 错误码映射 | `routes/providers.ts` + `validators/providers.ts` + 单测 | B1 | S |
| **B3** | Session 域 4 个 REST 接口 + Chat 流端点（**带 seq 编号、心跳、X-Stream-Id 头的事件协议**） + AbortController 在 server 侧 / `_liveStreams` 管理 | `routes/sessions.ts` + `routes/messages.ts` + `src/web/server/sse.ts` + 单测 | B1 + chat.ts 已知 | M |
| **B4** | Agent / Skill 域 4 个 GET 接口 | `routes/agents.ts` + `routes/skills.ts` + 单测 | B1 | S |
| **B5** | 自动打开浏览器（macOS / Linux / Windows 三平台分支） | `open-browser.ts` | B1 | XS |
| **B6** | 端到端冒烟测试（手动 `npm run web` + curl 调 6 个域 + SSE 流验证） | 文档 + 手测 | B1-B5 | S |
| **B7** | 统一错误处理器：`src/web/server/errors.ts`（按 `ApiErrorCode` → HTTP status + body 映射；含新错误码 `MODEL_NOT_FOUND`） | 一文件 + 单测 | B2 | XS |
| **B8** | 新增 3 个 REST 端点 + AgentRunner API 扩展（Finding 1-3 修复）：<br>① `GET /api/providers/active` (F-S-0)<br>② `PATCH /api/providers/active/model` (F-S-1)<br>③ `POST /api/sessions/:cid/compact` (F-S-2)<br>+ `AgentRunner.compactNow(cid)` 公开方法（F-S-2 前置）<br>+ `Session.getTokenEstimate()` 只读访问器<br>+ cid-mutex 串行化（防 § 9 R-22 竞态） | 3 个 handler + 1 个 AgentRunner 扩展 + 1 个 Session 扩展 + 单测 | B3 | M |

### 7.2 前端 WU（无任何构建，纯手写）

| WU | 内容 | 产出 | 依赖 | 估时 |
| --- | --- | --- | --- | --- |
| **F0** | **设计系统落地**：`web/style.css` 完整 tokens（颜色 / 字体 / 间距 / 圆角 / 阴影 / 动效）+ 字体 @import + dark/light 主题切换 | `web/style.css` + `web/js/shared/theme.js` | — | M |
| **F1** | `web/index.html` 骨架（包含 Skip to main 链接、ARIA landmark） | 一文件 | — | S |
| **F2** | `web/js/vendor/` 手动放入 DOMPurify / marked 的 minified 文件 + SRI 完整性校验 | 两文件 + `README.md` 注明版本来源 / SRI 来源（用 `https://www.srihash.org/`） | — | XS |
| **F3** | `shared/utils.js`（`escapeHtml`, `menuColorHex(i, theme)`, 时间格式化）+ `shared/api.js`（`apiFetch`，统一错误解码 + SRI）+ `shared/i18n.js`（单语言，预留双语） | 三文件 + 单测 | F0, F2 | S |
| **F4** | `shared/icons.js`（~30 Lucide 内联 SVG，按需打包，与仿写指南 § 1.2 同模式） | 一文件 + 单测 | — | S |
| **F5** | `state/state.js`（状态 + `setView()` + `messageQueues` + theme persistence） | 一文件 + 单测 | F3 | S |
| **F6** | `components/` 通用组件：`Button` / `Card` / `Input` / `Modal` / `Toast` / `Skeleton` / `EmptyState` / `ErrorState` / `Tabs` / `Tooltip` / `ConfirmDialog` / `DropdownMenu` / `MenuCard` | 13 个文件 + 单测 | F0, F3 | L |
| **F7** | `components/sidebar.js` + `components/panels.js`（5 个 panel DOM 骨架 + view 切换 + focus 管理） | 两文件 | F6, F5 | S |
| **F8** | `features/menu.js`（Bento Grid 主菜单 + 6 色 MenuCard + 键盘 1-6 + ↑↓ 选择） | 一文件 + 单测 | F6, F7 | M |
| **F9** | `features/providers.js`（表格 + 编辑表单 + 6 项功能封装 + 422 字段错误回填 + 键盘 Esc 取消） | 一文件 + 单测 | F6 + B2 已可用 | M |
| **F10** | `features/sessions.js`（侧边栏会话列表 + 加载/删除/新建 + 日期桶分组） | 一文件 + 单测 | F5 + B3 部分 | S |
| **F11** | `features/chat.js`（消息流渲染 + SSE 消费 + Markdown + 工具卡片 + 重连 banner + Cmd+. abort） | 一文件 + 单测 | F2, F4, F5, F6 + B3 | L |
| **F12** | `features/agents.js`（子 Agent 列表 + 详情查看） | 一文件 + 单测 | B4 已可用 | S |
| **F13** | `features/skills.js`（Skill 列表 + 详情 Markdown 展示） | 一文件 + 单测 | B4 已可用 | S |
| **F14** | `features/settings.js`（主题切换 + 服务状态 + 重启按钮 + 端口信息） | 一文件 + 单测 | F5 | S |
| **F15** | `app.js` 启动流水线（极简：拉 providers 状态 → 恢复 lastView → 启动 watch 定时器） | 一文件 | F5-F14 | S |
| **F16** | 全站键盘快捷键（§ 5.7）+ 帮助弹窗（Cmd+/） | 加到 `app.js` | F15 | S |
| **F17** | 前端集体测试：浏览器手测全套 + a11y 自检（axe-core CLI，含 5 个新 Modal 覆盖）+ 视觉对比截图 | 手动验证清单 + Playwright 脚本 | F1-F16, F18 | M |
| **F18** | **Slash 命令全套**（§ 5.4.1）：<br>① `web/js/features/slash.js`（tryHandleSlash + dispatchSlashKind + SLASH_COMMANDS 字典 18 条）<br>② `web/js/components/HelpModal.js`（`/help` + `Cmd/Ctrl+/` 共享）<br>③ `web/js/components/HistoryModal.js`（`/history`）<br>④ `web/js/components/ToolsModal.js`（`/tools`）<br>⑤ `web/js/components/SkillsModal.js`（`/skills`）<br>⑥ `web/js/components/SkillDetailModal.js`（`/skill <id>`）<br>⑦ `web/js/components/AgentsModal.js`（`/agents`）<br>⑧ `web/js/components/ProviderModal.js`（`/provider`）<br>⑨ `web/js/components/CompactModal.js`（`/compact`，含立即压缩按钮 → POST /compact）<br>⑩ `web/js/components/UsageModal.js`（`/usage`）<br>⑪ `web/js/features/theme.js`（`/theme` 三态循环，与 F0 theme.js 共享 storage key）<br>⑫ `web/js/features/slash.test.js` 单测：每条命令各 case（空消息 / 参数缺失 / 未知命令 / 命中 / 服务端失败 / clipboard 权限拒绝） | 11 文件 + 单测 | F6, F11, B8 已可用 | L |

### 7.3 总依赖图

```
B1 ─┬─ B2 ───────────────────┬─ B7 ──┐
    ├─ B3 ──┬──────┐         │       │
    ├─ B4 ──┤      │         │       │
    └─ B5 ──┘      │         │       │
                  F10 ─┐     │       │
                      ├─ F15 ───┴─ F16 ──┴─ B6 后端冒烟
F0 ─┬─ F3 ─┬─ F5 ───┬─ F7 ──┬─ F8  ──┐        ├─ F17 前端冒烟
    ├─ F4 ─┤        ├───── F9 ─┤       │
    └─ F2 ─┘        ├───── F11 ┤       │
                     ├───── F12 ┤       │
                     ├───── F13 ┤       │
                     └───── F14 ─┘       │
```

**可并行窗口：** B1 完成后 B2-B5 并行；前端 F0-F4 完成后 F5-F14 可大量并行（F11 等依赖 B3 真服务跑起来）。

### 7.4 关键路径（critical path）

`F0 → F6 → F8 → F15 → F16 → F17` ≈ 6 个工作块；以及 `B1 → B3 → F11 → F15`。  
按 S=半天、M=1 天、L=2 天估时，**约 8-10 天单人完成**（含 a11y 自检 + Playwright 冒烟）。

------

## 8. 验收清单（Definition of Done）

### 8.1 功能

- [ ] `npm run web` 启动后浏览器自动打开 `http://localhost:5173`，看到 Bento Grid 6 色数字彩菜单
- [ ] 主菜单 6 项点击行为 = 对应 CLI 选项：
  - [ ] ① 开始对话：API Key 留空时弹顶部固定黄色 banner「缺 Key 引导」+ 「去设置」按钮
  - [ ] ② 加载历史对话：在会话列表 hover 显示日期桶分组
  - [ ] ③ 设置模型提供商：进入 Provider 表格 + 表单
  - [ ] ④ 查看当前提供商：渲染等价 CLI 卡片
  - [ ] ⑤ 子 Agent 管理：进入列表 + 详情面板
  - [ ] ⑥ 退出：弹 ConfirmDialog → 关闭浏览器（服务在后台继续）
- [ ] 对话页输入消息后立即看到 SSE 流式吐字（首个 token < 1.5s）
- [ ] 「■ 停止」按钮 / `Cmd/Ctrl+.` 在 200ms 内中断流
- [ ] 工具调用以 `🔧 <name>(<params>)` 卡片显示在 assistant 气泡内，✅/❌ 状态切换
- [ ] 6 色数字与 CLI `menuColor(i)` 对应：dark / light 主题下分别验证（color-pick 像素级一致）
- [ ] Provider 设置面板 6 项操作（列出/编辑/切换/启用禁用/删除/返回）等价于 `provider-menu.ts`
- [ ] 浏览器刷新后恢复到 `my-agent.lastView`（view + cid）
- [ ] `npm run chat` 同时运行**不受影响**（CLI 入口完全独立）

### 8.2 流式 / 状态 / 协议

- [ ] 同一会话内连续发送两条消息，第二条在第一条流完后才发出（FIFO），UI 显示排队位置
- [ ] 切到别的会话再回来，草稿不丢失（前端 `messageQueues` 保留）
- [ ] **SSE 协议严格按 `event: start | text_delta | ... | done | error` 命名**，每个事件含 `seq`
- [ ] **客户端 seq 去重**：模拟服务端乱序，重复 id 不重复 dispatch
- [ ] **服务端心跳 15s** 一条 `: ping` 注释行，浏览器 DevTools Network 可见
- [ ] **服务端 X-Stream-Id 响应头** 携带 UUID，浏览器关闭后 server 端 5s 内清理 `_liveStreams`
- [ ] 连接中断 UI 显示「↻ 重试发送」（**不**自动重连，避免重复扣费）
- [ ] 同 cid 第二次 send 在第一次未 done 时 → 服务端 429 + `Retry-After: 1`

### 8.2.1 Slash 命令 18 条全跑通（v3 新增，Finding 15）

每条命令各 1 case 通过（共 18 case）：

- [ ] `/help` → HelpModal 显示 5 分组
- [ ] `/quit` + `/exit` → ConfirmDialog 弹出
- [ ] `/clear` + `/new` → 新建会话并切换（旧 cid 入归档）
- [ ] `/save` → Toast 显示 cid + 复制按钮可用
- [ ] `/history` → HistoryModal 列 50 条，「查看更多」按钮分页
- [ ] `/tools` + `/skills` → Modal 只读列表渲染
- [ ] `/skill <id>` → SkillDetailModal 完整 SKILL.md（Markdown + DOMPurify）
- [ ] `/agents` → AgentsModal 列表，点击 entry 跳详情 Modal
- [ ] `/provider` → ProviderModal 显示当前 provider 信息
- [ ] `/model <name>` → PATCH 端点 200 + Toast；无效模型 → 404 + `MODEL_NOT_FOUND` Toast
- [ ] `/model`（无参）→ 降级打开 ProviderModal
- [ ] `/compact` → CompactModal 显示 `used/limit/ratio`，按钮触发 POST + 显示新 `tokensAfter`
- [ ] `/retry` → 重发最后一条 user；无消息 → Toast warning
- [ ] `/copy` → clipboard 写入；权限拒绝 → 回退 `execCommand` 或 Toast
- [ ] `/theme` → 循环 dark → light → system，CSS 变量随之更新；`my-agent.theme` localStorage 同步
- [ ] `/usage` → UsageModal 显示累计 token；会话切换时清零
- [ ] 未知命令 `/xxx` → Toast warning「未知命令 /xxx」

### 8.3 API 契约

- [ ] 响应壳统一 `{ ok: true, data }` / `{ ok: false, error: { code, message, requestId } }`
- [ ] HTTP 状态码映射固定（spec § 3.4.1）
- [ ] 业务校验走 Zod schema，失败 422 + `error.details` 字段级回填
- [ ] 隐式 v1，路径不含版本；新增字段全 optional
- [ ] 错误码枚举全 21 个在 `src/web/server/errors.ts` 注册并单测
- [ ] 所有 POST/PUT 请求体大小上限 1MB，超额返回 413 `PAYLOAD_TOO_LARGE`

### 8.4 设计系统 / 视觉 / 交互

- [ ] **Color tokens 全部落地**（spec § 4.4.1），CSS 变量化；dark / light 双主题切换
- [ ] **Typography**：JetBrains Mono 用于数字 + 代码 / IBM Plex Sans 用于正文；Google Fonts 预连接
- [ ] **Spacing scale** 0.25rem 倍数；自定义 px 值 grep 为 0（lint 强制）
- [ ] **无 AI 风格**：无紫色默认 / 无 rounded-2xl 到处 / 无线性渐变 / 无 placeholder 文案
- [ ] **图标系统**：全部 Lucide inline SVG，无 emoji 图标
- [ ] **圆角**：xs/sm/md/lg/xl 五级 token，不滥用
- [ ] **动效**：全站 `prefers-reduced-motion` 降级为 0ms
- [ ] **Bento Grid 主菜单** 视觉对齐示意（4+2 布局，①项突出）
- [ ] **空 / 加载 / 错误三态** 每个有数据的组件都处理（grep `EmptyState\|Skeleton\|ErrorState` 必有）

### 8.5 跨页面交互

- [ ] **Toast**：FIFO，最多 4 队列；aria-live；hover 暂停；4 类（info/success/warning/danger）
- [ ] **ConfirmDialog**：原生 `<dialog>` + focus trap；autofocus 主按钮；`danger: true` 染色
- [ ] **Modal**：进入退出动效 + focus 恢复到触发元素
- [ ] **键盘快捷键**（spec § 5.7）全部实现 + `Cmd/Ctrl+/` 帮助弹窗
- [ ] **焦点管理**：view 切换焦点移到 panel h1；Modal 打开 trap + 关闭恢复
- [ ] **Cmd/Ctrl+B 折叠侧边栏**（focus 切换到主内容第一项）

### 8.6 可访问性（WCAG 2.1 AA）

> 严格遵循 `frontend-ui-engineering` skill 强约束。

- [ ] **自动化扫描**：`npx @axe-core/cli http://localhost:5173` 0 critical / 0 serious issue
- [ ] **键盘可达**：仅用 Tab / Enter / Esc / 方向键可走完：启动 → 主菜单 → 进入设置 → 编辑 Provider → 保存 → 进入对话 → 发送消息 → 收到回复
- [ ] **焦点可见**：`:focus-visible` ring 始终可见，焦点拖动用 `--focus-ring`
- [ ] **Skip link**：Tab 第一个元素 `Skip to main content`
- [ ] **颜色对比**：dark 主文字 vs 背景 ≥ 12:1，次文字 ≥ 7:1，弱化 ≥ 4.6:1；light 主文字 ≥ 12:1
- [ ] **aria-live 区域**：toast + 流式 token 注入区均有 polite live region；danger toast 用 `role="alert"`
- [ ] **键盘快捷键帮助**：Cmd+/ 打开模态显示全部快捷键
- [ ] **prefers-reduced-motion**：模拟降级 → 全部动效 0ms
- [ ] **屏幕阅读器手测**：VoiceOver (macOS Safari) 跑通一整套对话流程；记录在 verification 文档

### 8.7 兼容与安全

- [ ] `~/.my-agent/providers.json` / `sessions/*` 两个入口读写完全共享
- [ ] 路径参数过 `assertPathSegment()`，payload 用 Zod + size limit
- [ ] XSS：所有用户文本经 `escapeHtml`，Markdown 经 DOMPurify 净化
- [ ] CSP 头：服务端写死 `default-src 'self'; style-src 'self' fonts.googleapis.com; ...`（spec § 6.6）
- [ ] DOMPurify / marked SRI hash 正确；篡改后浏览器拒绝加载
- [ ] API Key 不写入 localStorage / sessionStorage / IndexedDB；表单态仅内存
- [ ] ProviderStore 文件权限 0o600（Web 端写入不改变权限）

### 8.8 质量

- [ ] 后端：`tsc --noEmit` 无错误；`vitest run` 全绿；每个 REST 路由覆盖：200 / 400 / 404 / 422 / 429 / 500 各一例
- [ ] 前端：无构建工具；浏览器 DevTools console 0 error；`grep -r "rounded-2xl" web/` 为 0
- [ ] README 更新一节「Web 模式」+ 主菜单 / 对话 / 设置 三张截图
- [ ] `.ai-runtime-artifacts/verifications/2026-08-07-web-frontend-verification.md` 落盘（含 axe-core 报告 + 截图清单）
- [ ] Playwright 脚本 `test/e2e/web-smoke.spec.ts` 跑通 5 个用户旅程，CI 强制

---

## 9. 风险与权衡

| 风险 | 缓解 |
| --- | --- |
| 配置文件损坏导致数据丢失 | 损坏文件备份为 `.bak-<ts>`（沿用 chat.ts spec § 8.1） |
| Key 明文存储 | 文件 0o600；不引入加密（YAGNI）；文档提示 |
| 多 provider 切换的 `activeProviderId` 指向不存在 id | 启动时校验回退到第一个 enabled provider |
| 当前 active provider 被禁用 | 启动回退；若无 → 强制进入设置面板 |
| `AgentRunner.runStream()` 是 `AsyncIterable`，需要每请求独占一个 runner | 一个会话一个 runner 实例，与 chat.ts 同模式；并发请求 429 兜底 |
| SSE 在公司代理 / 反向代理后可能不被缓冲 | 本地 127.0.0.1 通常无问题；文档提示 |
| 浏览器流读取必须用 `fetch + ReadableStream` | 已选定 fetch 方案 |
| 用户用 `MY_AGENT_WEB_PORT=80` 等特权端口会失败 | 启动时校验：非 root 用户拒绝绑定 < 1024 端口 |
| 在 macOS Safari 上 `res.body.getReader()` 默认不解码 UTF-8（v15 修复） | Server 端 `Content-Type: text/event-stream; charset=utf-8`；文档提示 Safari < 15 不支持 |
| Web 与 CLI 同时运行争抢 ProviderStore 写锁 | `atomicWrite` 用 `wx` flag + rename，并发失败重试 |
| 前端消息累积超过几千条时 DOM 性能下降 | 当 assistant 气泡数量 > 200 时整组 replaceChildren（YAGNI 不实现，仅文档化） |
| XSS via 流式回复中含 `<script>` | 所有 `text_delta` 走 `textContent`；Markdown 走 DOMPurify；用户消息走 `escapeHtml` |
| 浏览器扩展拦截数字键 | 数字菜单也接受点击 + Enter；不强制键盘 |
| `0` runtime deps 原则被打破（marked / DOMPurify 走 vendor） | 与仿写指南 § 项目骨架一致；SRI 校验（spec § 6.6） |
| **CSP 头过严会破坏字体加载** | `style-src 'self' fonts.googleapis.com` 显式 allowlist |
| **设计系统 dark token 优先** 用户首次访问可能不习惯 OS 决定的主题 | 提供主题切换按钮（顶栏）+ 首次访问时 1 秒 onboarding 气泡提示「主题跟随系统，可在设置切换」 |
| **a11y axe 扫描** 在某些 Modal 内嵌套发现 focus 错误 | Modal 用原生 `<dialog>` 解决（自动 focus trap） |
| **SRI hash 校验**：升级 vendor 时必须同步更新 hash | 在 `web/js/vendor/README.md` 写明「升级步骤：1) 下载 → 2) 生成 sha384 hash → 3) 写入 `<script integrity>` 4) 测试」 |
| **同会话多 tab**：两个 tab 都连 server 时 `PendingSession` 文件锁竞态 | `PersistentSession` 已有内部锁；streamId 不同不冲突 |
| **同会话 second-abort**：用户连点「停止」多次 | 服务端 `cancel` 函数幂等；前端按钮 disabled 状态机 |
| **`MessageChannel` / `SharedWorker`？否**：YAGNI，单 tab 足够；多 tab 串行由 server 端限流处理 | — |
| **R-22** **`/compact` 与 runner 自动 compaction 竞态**（v3 新增，Finding 10）：手动触发 `/compact` 时若同时收到 runner 内部 `prepareContextBeforeModelCall` 的自动压缩请求（[src/agent/runner.ts:1037](src/agent/runner.ts#L1037)），两次压缩可能交错导致 `compactionControl.attemptedFingerprints` 重复或丢摘要 | § 7.1 **B8** 引入 cid-mutex（`Promise` 队列）串行化所有 compress 操作；前端 `/compact` Modal 在 `cid` 有 in-flight 流时 disable「立即压缩」按钮 |
| **R-23** **`/usage` 内存增长**（v3 新增，Finding 16）：长会话累计 `done.result.usage` Map 持续增长，理论无上限 | § 5.4.1 `/usage` 行明确「会话切换时清零」；单条记录 ≤ 100B，1000 轮 ≈ 100KB 在可接受范围（不再单独治理） |
| **R-24** **`/history` 大列表性能**（v3 新增，Finding 17）：单次拉 200 条会话 + 每条 entry 含 `messageCount` 字段，加载卡顿 | § 5.4.1 分页：默认 50 条，「查看更多」追加；分页用 query `?limit=200&offset=50` 复用 § 3.1.2 GET /api/sessions |
| **R-25** **`/copy` clipboard 权限失败**（v3 新增，Finding 18）：`navigator.clipboard.writeText` 在非 secure context 或用户拒绝时抛 `NotAllowedError` | § 5.4.1 降级：catch 后回退 `document.execCommand('copy')`；仍失败 Toast「请手动复制」 |
| **R-26** **`/theme` 三态 `system` 模式首次访问 OS 切换延迟**（v3 新增，Finding 7 衍生）：`system` 模式依赖 `matchMedia('(prefers-color-scheme: dark)').addEventListener`，Safari < 14 不支持 addEventListener 仅支持 addListener | § 4.4.1 + F0 `shared/theme.js` 加 polyfill：检测无 `addEventListener` 时降级为 `addListener`（已废弃但 Safari < 14 支持） |

---

## 10. References 检查

- [x] `harness-kit/entrypoints/HARNESS-PLATFORM-ENTRY.md`：项目背景 + Harness 规则
- [x] `harness-kit/core/routing.md`：路由判定（本文为 spec 阶段）
- [x] `AGENTS.md`：Harness 覆盖层
- [x] `docs/spec/仿写Agent前端框架指南.md`：前端架构蓝本（Orkas → 本项目适配）
- [x] `.ai-runtime-artifacts/specs/2026-08-05-cli-menu-and-provider-config.md`：CLI 数字彩菜单 spec（本文 6 选项与之 1:1 对应）
- [x] `chat.ts`：被复用的入口（`runChat()`, `discoverChatAgents()`, `loadSkillContext()`）
- [x] `src/cli/menu.ts`：主菜单渲染函数（前端 6 选项一一对应）
- [x] `src/cli/provider-menu.ts`：设置子菜单 + 表单（前端 Provider 面板对应）
- [x] `src/cli/agent-menu.ts`：子 Agent 管理菜单（前端 Agents 面板对应）
- [x] `src/cli/session-history.ts`：历史会话文本渲染（前端消息流参考其「过滤 tool 块」逻辑）
- [x] `src/agent/runner.ts` + `types.ts`：`runStream()` + `AgentRunEvent` schema（SSE 事件映射源头）
- [x] `src/agent/persistent-session.ts`：会话持久化（server 路由直接调用）
- [x] `src/storage/providers-store.ts`：provider CRUD（server 路由直接调用）
- [x] `src/storage/session-store.ts`：会话生命周期（server 路由直接调用）
- [x] `src/storage/paths.ts` + `jsonl.ts`：路径防御 + 原子写入（沿用）
- [x] `src/orchestration/tools.ts` + `dispatch.ts`：子 Agent dispatch + `onWorkerEvent` 回调（server 端组装 runner 时复用）
- [x] `src/skills/loader.ts` + `types.ts`：skill 发现与展示
- [x] `package.json`：0 运行时依赖原则确认
- [x] **NEW** `~/.claude/skills/ui-ux-pro-max/scripts/search.py --design-system`：本次 spec 配色 / 字体方案来源
- [x] **NEW** `harness-kit/references/accessibility-checklist.md`：WCAG 2.1 AA 检查清单
- [x] **NEW** `harness-kit/references/security-checklist.md`：CSP / SRI / XSS 防御
- [x] **NEW** `harness-kit/references/performance-checklist.md`：避免渲染热路径滥用
- [x] **NEW** `harness-kit/references/observability-checklist.md`：流式事件日志、SSE 重连次数、错误码分布的可观测项
- [x] **NEW** `harness-kit/references/testing-patterns.md`：SSE 流断点续传测试模式

---

## 11. Next

**（写入后须暂停，等用户明确继续 — 见 `harness-kit/core/routing.md` § 阶段门禁）**

| 用户指令 | 触发动作 |
| --- | --- |
| 「**写计划**」/「**制定实施计划**」 | 进入 plan 阶段 → `writing-plans` skill → 输出 `.ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md` |
| 「**直接实现**」/「**直接做**」 | 范围小、配置层 / 1 个面板 / 1 个 WU 可交付 → 跳过 plan，leader 直接派发 coder |
| 「**改方案**」/「**调整 XX**」 | 直接给修改意见（颜色映射 / 模块切分 / 是否做 icons / 是否做 Markdown / 端口 / 路径等），按 diff 回到 § X 修订 |
| 「**审擦**」/「**协调子 Agent 审擦**」 | 派发 reviewer 子 Agent → 产出 `*-code-review.md` → 修 → 再次审 |

**前置依赖（动手前再核一次）：**

- [x] spec 文档已落盘到 `.ai-runtime-artifacts/specs/`
- [ ] 用户已审阅本 spec
- [ ] 用户明确进入 plan 或直接实现
- [ ] 若选 plan：项目根目录 `AGENTS.md` § Next 同步更新（写 plan 的同一次回合更新）

---

## 12. 附录：变更日志（Changelog）

> 本节是 spec 演进追踪，不参与下游 plan / code 阶段；保留以备 reviewer 快速比对各版本差异。

### 12.1 本次相比上一版 spec 的关键升级

| 维度 | 升级项 |
| --- | --- |
| 设计系统 | § 4.4 新增完整 Design System（Code Dark + Run Green / JetBrains Mono + IBM Plex Sans / 0.25rem 间距 / Lucide 图标） |
| 接口协议 | § 3.4 新增 API 错误协议（22 个错误码枚举，含 `MODEL_NOT_FOUND` + 状态码映射 + Zod 边界验证 + 限流 + 幂等） |
| 流式层 | § 6.1 升级 SSE 适配器（seq 编号 + 心跳 + X-Stream-Id + 去重 + 事件对齐 `AgentRunEvent` 表） |
| 交互层 | § 5.7-5.10 新增全局键盘快捷键 / Toast / Modal / Skeleton / 焦点管理 / a11y WCAG 2.1 AA / 错误态细化 |
| 安全层 | § 6.6 新增 CSP / SRI 安全强化 |
| 工作分解 | § 7 工作分解扩到 8 后端 + 19 前端 WU（含 B8 新端点 + AgentRunner API 扩展、F18 Slash 命令全套） |
| 验收清单 | § 8 验收清单增加到 8 大类 + § 8.2.1 Slash 命令 18 条全跑通 DoD |
| 风险表 | § 9 风险表扩展到 26 条（含 R-22 compact 竞态、R-23 usage 内存、R-24 history 性能、R-25 clipboard 失败、R-26 system 模式 Safari 兼容） |
| Slash 命令 | § 5.4.1 v3.1 = v3 + Reviewer 26 项 findings 修复（详见 § 12.3） |

### 12.2 历史版本

- **v1**（同日稍早）：CLI 数字彩菜单 → Web 前端初版 spec（缺 UI 设计 / 错误协议 / SSE 升级）
- **v2**（本日 v2.0）：经过 UI 升级、slash 命令补全、子 Agent 审擦三轮迭代形成
- **v3**（本日 v3.0）：Slash 命令扩到 18 条（CLI 主菜单 6 项 + Web 独有 12 项），新增 `/model` / `/compact` 服务端端点
- **v3.1**（本日 v3.1，Reviewer 修复版）：修复 Reviewer BLOCK 的 26 项 findings（详见 § 12.3）
- **v3.2**（本日 v3.2，Reviewer 修复版 v2）：修复 v3.1 Reviewer BLOCK 的 6 项 findings（详见 § 12.4）
- **v3.3**（本日 v3.3，Reviewer 修复版 v3）：修复 v3.2 Reviewer BLOCK 的 5 项 findings（详见 § 12.5）

### 12.3 v3.1 Reviewer 26 项 findings 修复总览

详见 [2026-08-07-web-frontend-spec-v3-review.md](../reviews/2026-08-07-web-frontend-spec-v3-review.md)，本节给修复摘要：

| 编号 | 严重级别 | 修复位置 |
| --- | --- | --- |
| F-1 | Critical | § 3.1.5 新增 `/compact` 服务端实现 + AgentRunner API 扩展（`compactNow()` + `Session.getTokenEstimate()`） |
| F-2 | Critical | § 3.1.1/§ 3.1.2/§ 3.4.2/§ 6.2 新增 3 个端点 + `MODEL_NOT_FOUND` 错误码 |
| F-3 | Critical | § 7.2 新增 **F18** WU（11 文件 + 单测） |
| F-4 | Critical | § 5.4.1 删除 line 936-948 重复块 |
| F-5 | Critical | § 6.1 事件枚举 + § 6.4 dispatchSseEvent 加 `tool_start` + § 6.1 加事件对齐 `AgentRunEvent` 表 |
| F-6 | Critical | § 3.1.5 `/compact` 不依赖 `context_status` 事件，改用 `Session.getTokenEstimate()` |
| F-7 | Important | **v3.1 部分修复**（§ 3.3 + § 5.4.1）→ **v3.2 补 § 4.4.1** + `data-theme="system"` + `data-system-theme` 双属性 |
| F-8 | Important | § 5.4.1 统一 `my-agent.theme` localStorage key |
| F-9 | Important | § 5.4.1 `/compact` 改 `openCompactModal(cid)`（Modal 内含 POST 按钮） |
| F-10 | Important | § 9 风险表新增 R-22（compact 竞态 + cid-mutex 串行化） |
| F-11 | Important | § 3.1.2 GET /api/sessions 补 query 参数 + Zod schema |
| F-12 | Important | § 5.4.1 F18 落地清单补 4 个 Modal（ToolsModal/SkillsModal/SkillDetailModal/CompactModal） |
| F-13 | Important | § 5.4.1 标题改「与 CLI 数字菜单对齐 + Web 独有补充」+ 删除 chat.ts 引用 |
| F-14 | Important | § 5.4.1 新增 CLI 主菜单 6 项 → Web 触发映射表 |
| F-15 | Suggestion | § 8.2.1 新增 Slash 命令 18 条 DoD |
| F-16 | Suggestion | § 5.4.1 `/usage` 加「会话切换清零」策略 + § 9 R-23 |
| F-17 | Suggestion | § 5.4.1 `/history` 加「查看更多」分页 + § 9 R-24；**v3.2 修 typo「CompactModal」→「HistoryModal」** |
| F-18 | Suggestion | § 5.4.1 `/copy` 加 clipboard 权限回退 + § 9 R-25 |
| F-19 | Suggestion | **v3.2 补** § 5.4.1 `/usage` 行「数据仅本机，不外传」Modal 顶部提示 |
| F-20 | Suggestion | **§ 5.4.1 拆分** — 文档化拆分计划（见下） |
| F-21 | Suggestion | § 5.4.1 F18 注 2 明确 F0 vs F18 theme.js 职责切分 |
| F-22 | Suggestion | § 5.4.1 降级加 `/theme` CSP 影响注（不破 `'unsafe-inline'`） |
| F-23 | Nit | § 5.4.1 字典 `needsArgs` → `requiresArgs: false/true` 命名澄清 |
| F-24 | Nit | § 5.4.1 dispatchSlashKind 加 `default` 兜底分支 |
| F-25 | Nit | § 5.4.1 Toast `action` 支持说明（沿用 § 5.8.1 通用 Toast 接口） |
| F-26 | Nit | § 5.4.1 `/agent <id>` 残留改「/agents Modal 内点击 entry → 详情 Modal」注 1 |

### 12.4 v3.2 Reviewer 6 项 v3.1 修复遗留 findings 修复

详见 [2026-08-07-web-frontend-spec-v3.1-review.md](../reviews/2026-08-07-web-frontend-spec-v3.1-review.md)。本轮修复 2 Critical + 2 Important + 2 Suggestion：

| 编号 | 级别 | 修复位置 |
| --- | --- | --- |
| **v3.1-C1** | Critical | § 4.4.1 line 502 升级三态 + 默认 `system`（修复 § 3.3 vs § 4.4.1 默认值矛盾） |
| **v3.1-C2** | Critical | § 4.4.1 line 502+ 加 F0 `shared/theme.js` polyfill 代码块（落实 § 9 R-26） |
| **v3.1-I1** (F-7) | Important | § 4.4.1 升级到三态描述 + `data-theme="system"` + `data-system-theme` 双属性（修复 § 4.4.1 design system 段只描述 2 态） |
| **v3.1-I2** (F-19) | Important | § 5.4.1 `/usage` 行加「数据仅本机，不外传」Modal 顶部提示 |
| **v3.1-S1** (F-17) | Suggestion | § 5.4.1 line 989 typo「CompactModal」→「HistoryModal」 |
| **v3.1-S2** | Suggestion | § 7.2 F18 ⑫ slash.test.js 补完整路径 `web/js/features/slash.test.js` |

**F-20 § 5.4.1 拆分计划（v3.1 文档化，v4 执行）：**

§ 5.4.1 当前 ~250 行，建议在 v4 拆为：

```
§ 5.4.1 Slash 命令总览（CLI 映射 + 命令表 + intro）        ~50 行
§ 5.4.2 客户端拦截实现（SLASH_COMMANDS + tryHandleSlash
         + dispatchSlashKind + /clear 时序 + /help Modal） ~110 行
§ 5.4.3 服务端扩展端点（端点约定表 + /compact 流程）       ~30 行
§ 5.4.4 降级与边界 + F18 WU 落地清单                       ~60 行
```

理由：当前单节过长，diff 友好性差；拆分后每节可独立 reviewer 审查。**本期 v3.1 保留单节形式，仅在文档中记录拆分计划**，避免引入额外 diff 噪音。

### 12.5 v3.3 Reviewer BLOCK 5 项 findings 修复

详见 [2026-08-07-web-frontend-spec-v3.2-review.md](../reviews/2026-08-07-web-frontend-spec-v3.2-review.md)。本轮 v3.2 修复 v3.1 BLOCK 6 项时引入 2 项 Critical + 1 项 Important + 2 项 Suggestion，需 v3.3 补修：

| 编号 | 级别 | 修复位置 |
| --- | --- | --- |
| **v3.2-C1** | Critical | § 4.4.1 line 506-515 CSS 选择器增加 `:root[data-theme="system"][data-system-theme="dark|light"]` 双分支；旧 `:root:not([data-theme])` 退化分支删除（system 模式永远命中） |
| **v3.2-C2** | Critical | § 4.4.1 line 540 polyfill 改 `mql.addListener((e) => apply(e.matches))`（旧版 `mql.addListener(mql, cb)` 第二参数 `mql` 错位导致 Safari < 14 TypeError） |
| **v3.2-I1** | Important | § 9 line 1889 「dark mode 默认」描述改为「设计系统 dark token 优先 + 系统主题引导」以匹配 § 4.4.1 默认 `system` |
| **v3.2-S1** | Suggestion | § 4.4.1 line 550 解释文补全 CSS 选择器示例（与 v3.2-C1 一并落实） |
| **v3.2-S2** | Suggestion | § 12.5（本节）记录 v3.2 引入遗留 = v3.3 修复范围，避免下游 plan 漏掉 |

**v3.2 → v3.3 复盘：** v3.2 在抄写双属性机制时只抄了 polyfill JS 代码，未把双属性机制真正落到 CSS 选择器，导致 system 模式 CSS 变量全部 undefined。修复 v3.1 BLOCK 时必须 Read + 验证每个新增代码块，不能仅做「文本对齐」。教训：Reviewer 关注的「运行时验证」类问题（CSS 选择器、API 调用形态）必须用 WebFetch / grep 二次确认。

**v3.3 已知遗留：** § 4.4.1 的 CSS 选择器虽然补全 system 分支，但 dark / light / system 各自的 token 完整列表（14 个）未在 spec 内展开；plan/WU 阶段需对照 line 458-473 token 表逐项落地，避免实现时只搬动 `--bg-base` 等少数 token 而遗漏 `--border-default` / `--text-muted` 等。
