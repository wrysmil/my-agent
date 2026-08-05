# Session 存储实现 & Orkas 技能搬运计划

> 日期：2026-08-02 | 基于 Orkas 源码调研

---

## 一、当前状态分析

### 1.1 Session 现状

| 维度 | 当前状态 | 差距 |
|------|---------|------|
| 消息管理 | ✅ 完整（add/begin/getMessages） | — |
| 执行计划 | ✅ 完整（plan anchor/update/clear） | — |
| 工作账本 | ✅ 完整（recordCompletedWork） | — |
| **持久化** | ❌ 无（纯内存） | 进程退出即丢失 |
| **Session ID** | ❌ `getSessionId()` 返回 `undefined` | 无法多 session 管理 |
| **序列化** | ❌ 无 `toJSON`/`fromJSON` | 无法保存/恢复 |
| **上下文压缩** | ❌ 全部 stub（返回 null） | 长对话会撑爆上下文窗口 |
| **轮次归档** | ❌ `completeActiveTurn()` 是空方法 | 无法追踪完成状态 |
| **历史资源** | ❌ `addHistoryResource()` 是空。方法 | 附件无法跨轮次 |

### 1.2 当前 chat.ts 的问题

```ts
const session = new Session();  // 纯内存，退出丢失
// /clear 命令也只是重建 session，历史无法恢复
```

---

## 二、Session 存储方案（仿 Orkas PersistentSession）

### 2.1 总体架构

```
Session (现有，纯内存)
  └── PersistentSession (新增，继承 Session)
        ├── JSONL 消息文件：~/.my-agent/sessions/<id>.jsonl
        └── Context 侧车文件：~/.my-agent/sessions/<id>.context.json
```

### 2.2 存储格式

#### 消息文件 (`<session_id>.jsonl`)

每行一个 JSON 对象，代表一条消息：

```json
{"role":"user","content":[{"type":"text","text":"帮我算 123*456"}],"turnId":1,"ts":1728000000000}
{"role":"assistant","content":[{"type":"text","text":"好的，让我用计算器算一下"}],"turnId":1,"ts":1728000000123}
{"role":"assistant","content":[{"type":"tool_use","id":"call_1","name":"calculator","input":{"expression":"123*456"}}],"turnId":1,"ts":1728000000456}
{"role":"user","content":[{"type":"tool_result","toolUseId":"call_1","content":"123*456 = 56088"}]"turnId":1,"ts":1728000000789}
```

- `role`: `"user"` | `"assistant"`
- `content`: `MessageContent[]`（与现有类型完全兼容）
- `turnId`: 轮次序号
- `ts`: Unix 毫秒时间戳（新增字段，可选，用于排序/审计）

#### Context 侧车文件 (`<id>.context.json`)

单 JSON 对象，存储无法从消息反推的结构化状态：

```json
{
  "version": 1,
  "nextTurnId": 5,
  "completedTurns": [
    {"id": 1, "userMessageIndex": 0, "finalAssistantMessageIndex": 3, "archived": false}
  ],
  "executionPlan": { "version": 1, "objective": "...", "steps": [...] },
  "completedWork": [...],
  "nextWorkLedgerId": 42,
  "resources": [],
  "historySummary": null,
  "summaryThroughTurnId": 0
}
```

### 2.3 文件系统布局

```
~/.my-agent/
├── sessions/
│   ├── <session_id>.jsonl          # 消息日志
│   ├── <session_id>.context.json   # 结构化上下文
│   └── ...
└── config.json                     # 可选的全局配置
```

存储目录优先级：
1. `MY_AGENT_HOME` 环境变量
2. `~/.my-agent/`（默认）

### 2.4 PersistentSession 类设计

```ts
class PersistentSession extends Session {
  private sessionId: string;
  private sessionFile: string;
  private contextFile: string;

  constructor(opts: {
    sessionId?: string;        // 不传则自动生成
    sessionDir?: string;       // 默认 ~/.my-agent/sessions/
    createIfMissing?: boolean; // 默认 true
  });

  // ---- 生命周期 ----
  static load(sessionId: string, sessionDir?: string): PersistentSession;
  static create(sessionDir?: string): PersistentSession;
  async close(): Promise<void>;     // 刷新并关闭
  async delete(): Promise<void>;    // 删除文件

  // ---- 重写父类方法（自动落盘） ----
  beginUserTurn(content): number;   // + appendToDisk
  addAssistantMessage(content): void; // + appendToDisk
  addToolResult(...): void;         // + appendToDisk
  addMessage(...): void;            // + appendToDisk
  completeActiveTurn(outcome?): void; // + writeContext
  updateExecutionPlan(update): ExecutionPlanState; // + writeContext
  recordCompletedWork(input): CompletedWorkEntry;  // + writeContext

  // ---- 序列化（新增） ----
  toJSON(): SerializedSessionState;
  static fromJSON(data: SerializedSessionState): PersistentSession;

  // ---- Session ID ----
  getSessionId(): string;  // 返回实际 ID
}
```

### 2.5 写入策略

| 操作 | 策略 | 理由 |
|------|------|------|
| 单条消息追加 | `fs.appendFileSync` + 手动 fsync | 原子性（<4KB 写入 POSIX 保证），JSONL 天然支持追加 |
| Context 侧车 | tempfile + rename | 原子替换，避免写入中途崩溃导致文件损坏 |
| 全量重写 | tempfile + rename | 仅在 compact 或 heal 时触发 |

### 2.6 加载与修复

```
loadFromDisk()
  ├── 逐行解析 JSONL → 调用 super.addMessage() 重建内存状态
  ├── 加载 .context.json → restoreContextState()
  ├── healOrphanToolUses() → 修复中断的工具调用（补充 tool_result 占位）
  └── 如有修复 → flushToDisk() 重写 JSONL
```

**Tool 协议修复场景：** 如果进程在上一次工具执行中途崩溃，JSONL 中可能存在孤立的 `tool_use` 块（有调用无结果）。加载时自动检测并合成 `isError: true` 的 tool_result 占位。

### 2.7 Session 管理器

```ts
class SessionStore {
  private cache: Map<string, PersistentSession>;
  private sessionDir: string;

  constructor(sessionDir?: string);
  get(sessionId: string): Promise<PersistentSession>;     // 懒加载 + 缓存
  create(): Promise<PersistentSession>;                    // 新建
  list(): Promise<string[]>;                               // 列出现有 session
  delete(sessionId: string): Promise<void>;                // 删除 + 清理缓存
  close(sessionId: string): Promise<void>;                 // 刷新 + 移除缓存
}
```

### 2.8 chat.ts 改造

```ts
// 改造前
const session = new Session();

// 改造后
const store = new SessionStore();
let session = await store.create();  // 新建持久化 session
// 或恢复
// let session = await store.get("saved-session-id");

// /clear → 关闭旧 session + 创建新 session
// /save → 输出 session ID 供下次恢复
// /list → 列出所有已保存 session
// /load <id> → 切换到指定 session
```

---

## 三、实施阶段

### Phase 1：基础持久化（核心）

**目标：** Session 可以保存到磁盘并恢复，chat.ts 重启后能继续对话。

| 任务 | 预估工作量 | 产出 |
|------|-----------|------|
| 1.1 定义 `SerializedSessionState` 类型 | 小 | `src/agent/session-serde.ts` |
| 1.2 实现 `PersistentSession` 类 | 中 | `src/agent/persistent-session.ts` |
| 1.3 实现 JSONL 读写 + 原子写入工具 | 小 | `src/storage/jsonl.ts` |
| 1.4 实现 `SessionStore` 管理器 | 小 | `src/storage/session-store.ts` |
| 1.5 chat.ts 改造（持久化 + 命令） | 小 | `chat.ts` |
| 1.6 单元测试（序列化/反序列化/修复） | 中 | `test/persistent-session.test.ts` |

### Phase 2：上下文压缩（进阶）

**目标：** 长对话自动压缩历史，防止上下文窗口溢出。

| 任务 | 产出 |
|------|------|
| 2.1 实现历史归档（HistoryArchive） | `src/agent/compaction.ts` |
| 2.2 LLM 摘要生成（调用 provider 生成压缩摘要） | 同上 |
| 2.3 `getMessagesForModel()` 注入摘要 | `session.ts` 方法重写 |
| 2.4 压缩触发阈值配置（默认 82% 上下文窗口） | `config.json` |

### Phase 3：多 Session 管理 + CLI 交互

**目标：** 完整的 session 生命周期管理，chat.ts 支持多会话切换。

| 任务 | 产出 |
|------|------|
| 3.1 `/save` `/load` `/list` `/delete` 命令 | `chat.ts` |
| 3.2 Session 列表展示（名称、日期、消息数） | `chat.ts` |
| 3.3 自动命名（首条消息摘要） | `SessionStore` |

---

## 四、可搬运的 Orkas 技能/工具清单

### 4.1 优先级矩阵

| 优先级 | 组件 | 类型 | 搬运难度 | 依赖 |
|--------|------|------|---------|------|
| 🔴 P0 | Session 持久化 | 基础设施 | 中 | 无 |
| 🟡 P1 | `web_search` | 工具 | 低 | 无 |
| 🟡 P1 | `web_fetch` | 工具 | 低 | 无 |
| 🟡 P1 | `read_file` | 工具 | 低 | 无 |
| 🟡 P1 | `write_file` | 工具 | 低 | 无 |
| 🟡 P1 | `edit_file` | 工具 | 低 | `read_file` |
| 🟡 P1 | `bash` | 工具 | 中 | 安全沙箱 |
| 🟡 P1 | `list_files` | 工具 | 低 | 无 |
| 🟡 P1 | `search_files` / `grep_files` | 工具 | 低 | 无 |
| 🟡 P1 | Skill 基础设施 | 框架 | 中 | 无 |
| 🟢 P2 | `chat_search` / `chat_read` | 工具 | 中 | Session 持久化 |
| 🟢 P2 | `cross_session_memory` | 工具 | 高 | 向量存储 |
| 🟢 P2 | 系统 `coding` Skill | 技能 | 低 | Skill 基础设施 |
| ⚪ P3 | `create_artifact` | 工具 | 高 | HTML 渲染宿主 |
| ⚪ P3 | Office/PDF 工具 | 工具 | 极高 | OfficeCLI 引擎 |

### 4.2 P1 工具详情

#### web_search / web_fetch

- **来源：** Orkas `core-agent/src/tools/web-search.ts` + `web-fetch.ts`
- **实现方式：** 内置回退搜索 + 可插拔搜索 API（Tavily/Serper/Brave）
- **输入 Schema：**
  - `web_search`: `{ query: string, maxResults?: number }`
  - `web_fetch`: `{ url: string, extractContent?: boolean }`
- **搬运策略：** 简化版 — 先只做 `web_fetch`（Node.js 原生 fetch），`web_search` 需要第三方 API key，可后续接入

#### 文件工具组

- **来源：** Orkas `core-agent/src/tools/builtin.ts`
- **搬运策略：** 参照 Orkas 的 `defineTool` schema 定义，用本项目已有的 `defineTool` 重写实现
- **注意：** `edit_file` 的 `old_string → new_string` 替换逻辑可以直接搬运 Orkas 的核心算法

#### bash

- **来源：** Orkas `core-agent/src/tools/builtin.ts`
- **搬运策略：** 使用 `child_process.exec` / `spawn`，需要：
  - 超时控制
  - 输出截断（防止撑爆上下文）
  - 工作目录隔离
  - 环境变量沙箱

#### Skill 基础设施

- **来源：** Orkas `core-agent/src/skills/`
- **核心组件：**
  - `SkillSpec` 类型 — skill 的元数据描述
  - `SkillLoader` — 从目录扫描 `SKILL.md` 文件，解析 YAML frontmatter
  - `skill_search` 工具 — 让 agent 自己搜索可用的 skill
- **设计理念：** Skill 是 markdown 文件，不是代码。Agent 通过工具调用加载 skill 内容到上下文
- **搬运策略：**
  1. 移植 `SkillSpec` 类型 + `SkillLoader`
  2. 实现 `skill_search` 工具（扫描 + 关键词匹配）
  3. 在 system prompt 中注入可用 skill 列表

### 4.3 不建议搬运的

| 组件 | 原因 |
|------|------|
| VideoStudio / UIDesigner / DeepResearcher 等 Agent | 垂直领域专用，依赖大量内部 API |
| Office 工具组（docx/xlsx/pptx） | 依赖 OfficeCLI 二进制引擎（数 MB） |
| PDF 工具（markdown_to_pdf 等） | 依赖内部渲染引擎 |
| generate_image | 需要图像生成 API 配置，复杂度高 |
| interactive_cli_* | 交互式 CLI 需要终端模拟宿主，本阶段用不上 |
| Connector 工具（MCP） | 需要完整的 MCP 协议栈 |
| Knowledge Base 工具（kb_*） | 需要向量数据库 + embedding 基础设施 |
| metacognition / project_tasks / project_instructions | Orkas 平台专用概念，通用性低 |

---

## 五、推荐执行顺序

```
Phase 1: Session 持久化（本计划重点）
  │
  ├── 1.1 SerializedSessionState 类型
  ├── 1.2 JSONL 读写工具
  ├── 1.3 PersistentSession 类
  ├── 1.4 SessionStore 管理器
  ├── 1.5 chat.ts 改造
  └── 1.6 单元测试
  │
  ▼
Phase 2: 基础工具搬运（增强 agent 能力）
  │
  ├── web_fetch（网络抓取）
  ├── read_file / write_file / edit_file（文件操作）
  ├── list_files / search_files / grep_files（文件搜索）
  ├── bash（命令执行）
  └── 单元测试
  │
  ▼
Phase 3: Skill 基础设施
  │
  ├── SkillSpec 类型 + SkillLoader
  ├── skill_search 工具
  └── 系统 coding Skill（编码规范）
  │
  ▼
Phase 4: 上下文压缩（长对话支持）
  │
  ├── 历史归档 + LLM 摘要生成
  ├── 活跃检查点
  └── 压缩触发阈值
  │
  ▼
Phase 5: 高级特性
  │
  ├── chat_search / chat_read（历史搜索）
  ├── cross_session_memory（跨会话记忆）
  └── 多 session 管理 CLI
```

---

## 六、关键设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 存储格式 | JSONL | 人类可读、追加友好、逐行恢复、与 Orkas 兼容 |
| 消息序列化 | 直接 JSON.stringify Message | 与现有类型完全兼容，无需额外转换层 |
| Context 侧车 | 独立 JSON 文件 | 结构化状态不应混入消息流；单独文件支持原子替换 |
| Session ID 格式 | `session-<nanoid(12)>` | 短且唯一，比 Orkas 的 `<kind>-<tail>` 更简单（本项目无需 kind 区分） |
| 存储位置 | `~/.my-agent/sessions/` | 用户数据目录标准做法，支持环境变量覆盖 |
| 写入时机 | 每次消息追加立即 fsync | 保证崩溃安全；性能影响可忽略（对话场景消息频率低） |
| 加载策略 | 懒加载 + LRU 缓存 | 避免启动时加载所有历史 session |

---

## 七、风险与注意事项

1. **JSONL 大文件读取：** 长对话可能积累数千条消息，需要测试 >100MB JSONL 文件的加载性能。必要时可为大文件引入分页加载（仅加载最近 N 轮）。
2. **并发写入：** 当前 chat.ts 是单用户、单进程模型，无并发问题。如果未来支持多 Agent 并行，需要引入文件锁。
3. **向后兼容：** `PersistentSession` 继承 `Session`，现有 `AgentRunner` 代码无需修改（它只依赖 `Session` 接口）。
4. **工具搬运边界：** `bash` 和 `write_file` 涉及本地执行权限，需要在 chat.ts 中加入用户确认机制（参照 Orkas 的 `localExec` 权限门控）。
