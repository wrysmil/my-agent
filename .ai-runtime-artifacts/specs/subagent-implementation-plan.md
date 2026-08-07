# 子 Agent 系统 — my-agent 实现方案

> **基于：** [`docs/spec/仿写子Agent系统指南.md`](../../docs/spec/仿写子Agent系统指南.md)
> **适配对象：** `my-agent` 项目（`d:\studyspace\project\my-agent`）
> **适配原则：** 复用已有 Runner/Session/Lock/Skill 基础设施，不照搬 Orkas 群聊架构；简化名册/路由/楼层等 UI 层概念，聚焦「嵌套派发 → 独立回合 → 结果交回」核心链路。

---

## 1. 现状盘点

### 1.1 已有基础设施（可直接复用）

| 模块                                             | 位置                                                                              | 子 Agent 场景复用方式                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AgentRunner.runStream()`                      | [src/agent/runner.ts](../../src/agent/runner.ts)                                   | 嵌套子回合的核心引擎：换 session + systemPrompt + signal 即可跑子回合                                           |
| `AgentRunner.runStream` 的 `drainSteer` 钩子 | runner.ts:1051-1082                                                               | 已实现`drainSteer`/`foldSteer`/`terminalSteer` 三件套，子回合只需**不传** `drainSteer` 即天然隔离 |
| `Session`                                      | [src/agent/session.ts](../../src/agent/session.ts)                                 | 子回合创建独立 Session 实例，不同文件落盘                                                                       |
| `SessionStore` + kind 系统                     | [src/storage/session-store.ts](../../src/storage/session-store.ts)                 | 扩展`KNOWN_KINDS_RE` 添加 `gworker`，子回合走 ephemeral 路由                                                |
| `defineTool` 工厂                              | [src/tools/base.ts](../../src/tools/base.ts)                                       | 调度工具（`run_worker` 等）直接用 `defineTool` 定义                                                         |
| `BUILTIN_TOOLS`                                | [src/tools/builtin.ts](../../src/tools/builtin.ts)                                 | 子 Agent 的工具集 = 基础工具 - 调度工具，直接过滤                                                               |
| `buildSystemPrompt`                            | [src/prompts/system-prompt-builder.ts](../../src/prompts/system-prompt-builder.ts) | worker 的 system prompt 复用同一套组装逻辑                                                                      |
| `buildDefaultSystemPrompt`                     | system-prompt-builder.ts:322                                                      | worker 无模板时的 fallback                                                                                      |
| `sessionLock` / `fileEditLock`               | [src/storage/locks.ts](../../src/storage/locks.ts)                                 | 新增`dispatchSlots` 信号量，复用 `async-mutex`                                                              |
| `assertPathSegment`                            | [src/storage/paths.ts](../../src/storage/paths.ts)                                 | actor id / agent_id 段断言                                                                                      |
| `PersistentSession`                            | [src/agent/persistent-session.ts](../../src/agent/persistent-session.ts)           | 子回合的 JSONL 落盘                                                                                             |
| `SkillSpec` / loader                           | [src/skills/](../../src/skills/)                                                   | 命名 agent 的`skill_list` 过滤                                                                                |

### 1.2 与 Orkas 的关键差异（影响架构决策）

| 差异点            | Orkas                                             | my-agent                                     | 本文对策                                                                              |
| ----------------- | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Session kind 体系 | `gconv`/`gmember`/`gworker` 三套            | 当前仅`gconv`/`cli`/`anon`/`extract` | **只加 `gworker`**，不引入 `gmember`（没有"群聊持久成员"的需求）            |
| 存储路由          | `cloud/sessions/` vs `local/sessions/` 双树   | 统一`~/.my-agent/sessions/` 单树           | ephemeral 标记不靠路径分区，靠`isEphemeralSession()` 白名单                         |
| 锁系统            | `Semaphore`（`async-mutex`）+ `globalSlots` | `Mutex`（`async-mutex`），无全局槽       | 新增`dispatchSlots`（`Semaphore`），独立于现有的 `sessionLock`/`fileEditLock` |
| 群聊 UI           | 有（楼层/气泡/名册）                              | 无                                           | **不做**路由/楼层/名册/`@` 解析。S2 仅做到"按 agent_id 指定目标"              |
| 回传入队          | `bus.enqueue` 统一入队                          | 无群聊 bus                                   | **不走队列**，结果直接当 `tool_result` 返回                                   |
| 工具注册          | Commander prompt 里声明                           | Runner 构造时通过`tools` 数组注入          | 在`AgentRunner` 构造阶段按 session kind 过滤工具                                    |
| 中断引导          | `drainSteerInto` 四条过滤规则                   | Runner 已内置`drainSteer`/`foldSteer`    | **直接复用**，子回合不传 `drainSteer` 即可                                    |

### 1.3 明确不做的事

- ❌ 名册（`members.json`）与 `ensureAgentMember` — 没有群聊，没有"对话成员"概念
- ❌ `parseMentions` / `resolveRecipients` / 楼层 `active_recipient` — 没有 UI，@ 提及无意义
- ❌ `dispatch_to` / `hand_off_to` 的 UI 气泡与可见性切片 — 没有群聊视图
- ❌ `OrchestrationLedger` / `resume` / 表单挂起 — 不需要交互式表单
- ❌ `cloud/local` 双树存储 — 当前单树足够
- ❌ `gmember` session kind — 不持久化 agent 成员身份
- ❌ `interactive` agent 的楼层交接 — 无 UI

---

## 2. 总体架构

### 2.1 核心数据流

```
主 Agent 回合（AgentRunner.runStream）
  │
  ├─ LLM 返回 tool_use: run_worker({ task: "统计仓库文件数" })
  │
  ├─ execute(run_worker) 被 Runner 的工具循环调用
  │    │
  │    ├─ 1. 构造 Actor { kind: "worker", id: genWorkerId() }
  │    ├─ 2. 合成 systemPrompt（WORKER_WORKFLOW + 模板渲染）
  │    ├─ 3. 创建子 Session（sessionId = gworker-{cid}-{workerId}）
  │    ├─ 4. 构造子 AgentRunner（不含调度工具）
  │    ├─ 5. dispatchSlots.acquire() → 并发边界
  │    ├─ 6. await runner.runStream({ message: task, signal: childSignal })
  │    │       └─ 子回合完整执行：LLM 推理 → 工具调用 → 循环 → 最终结果
  │    ├─ 7. 分类结果 → <worker-result> / <worker-error aborted="true">
  │    ├─ 8. dispatchSlots.release()
  │    └─ 9. return { content: <worker-result>...</worker-result> }
  │
  └─ 主 Agent 收到 tool_result，读结果，继续推理
```

### 2.2 新增/修改文件清单

```
my-agent/
├── src/
│   ├── orchestration/           # 新增：编排模块
│   │   ├── actor.ts             # Actor 类型 + session id builder
│   │   ├── dispatch.ts          # runNestedDispatch + 结果分类
│   │   ├── tools.ts             # buildDispatchTools (run_worker)
│   │   ├── workflow.ts          # WORKER_WORKFLOW 常量 + buildWorkerSystemPrompt
│   │   └── agent-spec.ts        # 命名 agent 规格读取（S2）
│   ├── storage/
│   │   ├── session-store.ts     # 修改：KNOWN_KINDS_RE 新增 gworker
│   │   ├── locks.ts             # 修改：新增 dispatchSlots (Semaphore)
│   │   └── paths.ts             # 可能需新增 genId12 快捷函数
│   └── agent/
│       └── runner.ts            # 修改：构造时按 isCommanderSession 注入调度工具
├── test/
│   └── orchestration/           # 新增：子 Agent 测试
└── fixtures/
    └── orchestration/           # 新增：测试用 agent.json / 预期结果
```

### 2.3 Runner 复用策略（关键设计决定）

**子 Agent 不是"新建一个 AgentRunner 实例"**。因为：

- `AgentRunner` 构造时需要 `CoreAgentConfig`、`ProviderRegistry`、完整工具集
- 子回合需要**相同的基础设施**（provider、配置、基础工具）但**不同的 session 和工具过滤**

采用 **`runNestedDispatch` 函数** 方案：

- 接收主 Runner 的 `providers`、`config` 引用
- 内部创建独立的 `Sessid ssadas dson`（指定 `gworker-*` sessionId）
- 过滤掉调度工具后的工具列表传给子 Runner
- 子 Runner 通过 `new AgentRunner({ ..., session: workerSession, tools: filteredTools })` 创建

**为什么不用同一个 Runner 实例换 session？**
`AgentRunner` 的 session 在构造时绑定，无法中途替换。而"创建轻量子 Runner"的开销可忽略（Session 对象创建 + 工具数组过滤，均无 I/O）。

---

## 3. S1：核心闭环

**目标：** `run_worker({task})` → worker 独立 session 跑完 → `<worker-result>` 交回 → 主 Agent 继续。

### 3.1 Actor 类型与 session id builder

**文件：** `src/orchestration/actor.ts`（新建）

```ts
// ---- Actor 类型 ----

export type ActorKind = "commander" | "user" | "agent" | "worker";

export interface Actor {
  kind: ActorKind;
  id: string;               // commander/user 为保留字；worker 用 genWorkerId()
  name?: string;
}

export const COMMANDER_ID = "commander";
export const USER_ID = "user";

// ---- Session ID builder ----

/** 主会话（commander） */
export function buildGconvSessionId(cid: string): string {
  return `gconv-${cid}`;
}

/** 匿名 worker 会话 */
export function buildGworkerSessionId(cid: string, workerId: string): string {
  return `gworker-${cid}-${workerId}`;
}

/** 按 Actor 路由到对应 session id */
export function actorSessionId(cid: string, actor: Actor): string {
  if (actor.kind === "commander") return buildGconvSessionId(cid);
  if (actor.kind === "worker") return buildGworkerSessionId(cid, actor.id);
  // agent kind 保留给 S2
  throw new Error(`actor ${actor.kind}/${actor.id} has no session`);
}

// ---- 辅助 ----

let _workerSeq = 0;
/** 生成短 worker id（6 位 hex + 递增序号，保证同毫秒不碰撞） */
export function genWorkerId(): string {
  const ts = Date.now().toString(36).slice(-4);
  const seq = (++_workerSeq).toString(36);
  return `w${ts}${seq}`;
}
```

**关键适配：**

- 不引入 `gmember`（没有命名 agent 持久身份）
- `genWorkerId()` 代替 Orkas 的 `genId12()` — my-agent 没有全局 id 生成器，就地实现
- `cid`（conversation id）S1 直接用**主 session 的 sessionId** 或 `run_worker` 工具执行上下文中的 `runId`

### 3.2 Session kind 增补

**文件：** `src/storage/session-store.ts`（修改）

修改两处：

```ts
// 1. EPHEMERAL_KINDS 新增 "gworker"
const EPHEMERAL_KINDS = ["anon", "extract", "gworker"] as const;

// 2. KNOWN_KINDS_RE 新增 gworker（长前缀在前）
const KNOWN_KINDS_RE = /^(gconv|gworker|cli|anon|extract)(?:-|$)/;

// 3. SessionKind 联合类型新增
export type SessionKind = "gconv" | "cli" | "anon" | "extract" | "gworker";
```

`session-store.ts` 的 `SessionStore.create()` 方法中 kind 校验列表同步新增 `"gworker"`。

GC 逻辑无需改动 — `sweepEphemeralSessions()` 遍历 `EPHEMERAL_KINDS` 白名单，`gworker` 自动纳入 7 天清理。

**语义对照（写进注释）：**

| kind                  | 谁创建                     | 生命周期          |
| --------------------- | -------------------------- | ----------------- |
| `gconv`             | 对话主会话                 | 手动删除          |
| `cli`               | 命令行一次性会话           | 手动删除          |
| `anon`              | 匿名临时                   | 7 天 GC           |
| `extract`           | 提取任务                   | 7 天 GC           |
| **`gworker`** | **匿名 worker 回合** | **7 天 GC** |

### 3.3 Worker 合成提示

**文件：** `src/orchestration/workflow.ts`（新建）

```ts
/**
 * 匿名 worker 的分步程序（注入 system prompt）。
 *
 * 四条规则：
 * 1. 边界约束 — 完成一件事，是手不是脑
 * 2. 无用户 — 不提问、不表单、自己做假设
 * 3. 结果完整 — verbatim 交回指挥官
 * 4. 大工件落文件 — 防撑爆父上下文
 */
export const WORKER_WORKFLOW = [
  "You are an ephemeral worker spun up by the commander to complete ONE bounded sub-task — " +
  "you are the commander's hands, not an independent specialist.",

  "The task is in the incoming message. Do it end to end using your available tools " +
  "(files, shell, web, search, etc.).",

  "There is no user in this turn: never ask a question, request input, or emit a form — " +
  "if something is ambiguous, make the most reasonable assumption and state it in your result.",

  "Your reply is handed back to the commander verbatim (not shown to anyone else), " +
  "so return the COMPLETE result it needs to act on. Put large artifacts in files and " +
  "reference their paths; keep the reply itself focused on the result and any pointers.",
].join(" ");
```

**system prompt 构建：**

```ts
import { buildDefaultSystemPrompt } from "../prompts/system-prompt-builder.js";

export function buildWorkerSystemPrompt(params: {
  name?: string;
  workingDir?: string;
}): string {
  // 方案 A（S1 推荐）：复用 buildDefaultSystemPrompt 的 fallback 模板，
  // 在稳定区末尾追加 WORKER_WORKFLOW
  const base = buildDefaultSystemPrompt(
    "Always respond in Chinese. Use Chinese for all explanations and communications.",
  );
  return [
    base,
    "",
    "## Worker constraints",
    WORKER_WORKFLOW,
  ].join("\n");
}
```

**关键适配：**

- 不复用 Orkas 的 `agent-in-group` 模板（my-agent 没有群聊概念）
- 直接用 `buildDefaultSystemPrompt`（已有的 fallback），追加 worker 约束
- S2 命名 agent 时再切换到完整模板体系（`buildSystemPrompt` + `workflow` 字段注入）
- worker 的工具列表 = `BUILTIN_TOOLS` 过滤掉调度工具 → 在 dispatch 层处理

### 3.4 `run_worker` 工具定义

**文件：** `src/orchestration/tools.ts`（新建）

```ts
import { defineTool, type AgentTool } from "../tools/base.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import type { Actor } from "./actor.js";
import { genWorkerId } from "./actor.js";
import type { AgentRunner } from "../agent/runner.js";

/**
 * 构建调度工具集（仅注入主会话）。
 *
 * 当前仅含 `run_worker`；S2 追加 `run_worker(to)` 命名分支。
 */
export function buildDispatchTools(opts: {
  /** 主 Runner 引用，用于嵌套调用 runStream */
  getRunner: () => AgentRunner;
  /** 主会话 ID（用于构造子 session id） */
  cid: string;
  /** 工作目录 */
  workingDir?: string;
  /** 父 abort signal */
  signal?: AbortSignal;
}): AgentTool[] {
  return [
    defineTool({
      name: "run_worker",
      executionMode: "parallel",
      description: [
        "Run a bounded sub-task and get its FULL result handed back to YOU (the commander) " +
        "within this same call, so you can read it, synthesise, and decide the next step — " +
        "the in-loop coordinator pattern.",
        "Use this for a sub-task you own: a bounded job whose output you will build on, " +
        "or heavy scanning whose bulk you do not want to keep in your own context.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "Sub-task instruction, sent verbatim to the worker.",
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      async execute(input, ctx) {
        const task = String(input.task || "").trim();
        if (!task) return { content: "run_worker: `task` is required", isError: true };

        const workerActor: Actor = {
          kind: "worker",
          id: genWorkerId(),
          name: "Worker",
        };

        const { runNestedDispatch } = await import("./dispatch.js");
        const result = await runNestedDispatch({
          cid: opts.cid,
          actor: workerActor,
          task,
          parentSignal: ctx.signal ?? opts.signal,
          getRunner: opts.getRunner,
          workingDir: ctx.workingDir ?? opts.workingDir,
        });

        return { content: result };
      },
    }),
  ];
}

/**
 * 从工具集中移除调度工具（worker/命名 agent 使用此过滤后的列表）。
 */
export function withoutDispatchTools(tools: AgentTool[]): AgentTool[] {
  const dispatchNames = new Set(["run_worker", "dispatch_to", "hand_off_to"]);
  return tools.filter((t) => !dispatchNames.has(t.name));
}
```

**注入规则：**

- 在主 Runner 构造时，如果 session kind 标记为主会话（`isCommanderSession(sessionId)`），追加 `buildDispatchTools()`
- 默认不注入 — 子 Runner 构造时不传调度工具即可

### 3.5 `runNestedDispatch` 核心实现

**文件：** `src/orchestration/dispatch.ts`（新建）

```ts
import { Semaphore } from "async-mutex";
import type { Actor } from "./actor.js";
import { actorSessionId } from "./actor.js";
import { buildWorkerSystemPrompt } from "./workflow.js";
import { withoutDispatchTools } from "./tools.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import { Session } from "../agent/session.js";
import { AgentRunner } from "../agent/runner.js";
import { SessionStore } from "../storage/session-store.js";

// ============================================================
// dispatchSlots — 嵌套调度并发上限
// ============================================================

const DISPATCH_CONCURRENCY = Number(
  process.env.MY_AGENT_MAX_DISPATCH_CONCURRENCY ?? "4",
);
export const dispatchSlots = new Semaphore(DISPATCH_CONCURRENCY);

// ============================================================
// runNestedDispatch
// ============================================================

export async function runNestedDispatch(opts: {
  cid: string;
  actor: Actor;
  task: string;
  parentSignal?: AbortSignal;
  getRunner: () => AgentRunner;
  workingDir?: string;
  /** 附件路径（S2） */
  attachments?: string[];
}): Promise<string> {
  // 1. abort 级联
  const ac = new AbortController();
  if (opts.parentSignal) {
    if (opts.parentSignal.aborted) ac.abort();
    else {
      opts.parentSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }
  }

  // 2. 构建 session id
  const sessionId = actorSessionId(opts.cid, opts.actor);
  const sessionStore = new SessionStore();

  // 3. 构建 system prompt
  const systemPrompt = buildWorkerSystemPrompt({
    name: opts.actor.name || "Worker",
    workingDir: opts.workingDir,
  });

  // 4. 准备工具集（基础工具 - 调度工具）
  const workerTools = withoutDispatchTools(BUILTIN_TOOLS);

  // 5. 组装 task 信封
  const messageText = buildWorkerTaskEnvelope(opts.actor, opts.task, opts.attachments);

  // 6. 并发边界：dispatchSlots
  const [, release] = await dispatchSlots.acquire();
  try {
    // 7. 创建子 session + runner + 执行
    const workerSession = new Session();
    const workerRunner = new AgentRunner({
      config: opts.getRunner()["config"],       // 复用主配置
      providers: opts.getRunner().getProviders(),
      tools: workerTools,
      session: workerSession,
      disableTools: false,
    });

    // 8. 执行子回合
    const result = await workerRunner.run({
      message: messageText,
      systemPrompt,
      signal: ac.signal,
      workingDir: opts.workingDir,
    });

    // 9. 分类结果
    return classifyWorkerOutcome(opts.actor, result, ac.signal.aborted);

  } finally {
    release();
  }
}

// ============================================================
// 辅助
// ============================================================

/** 构建 worker 的 task 信封（让 worker 知道自己是谁、任务来自谁） */
function buildWorkerTaskEnvelope(
  actor: Actor,
  task: string,
  attachments?: string[],
): string {
  const lines = [
    `<task from="commander" to="${escapeXml(actor.id)}">`,
    task,
    `</task>`,
  ];
  if (attachments?.length) {
    lines.push(
      "",
      "<attachments>",
      ...attachments.map((a) => `  ${a}`),
      "</attachments>",
    );
  }
  return lines.join("\n");
}

/** 分类 worker 执行结果 */
function classifyWorkerOutcome(
  actor: Actor,
  result: { text: string; meta?: { error?: { message: string } } },
  aborted: boolean,
): string {
  const name = escapeXml(actor.name || actor.id);

  // abort → worker-error
  if (aborted) {
    return buildWorkerErrorPayload(name, result.text || "Worker aborted.", true);
  }

  // runner 错误
  if (result.meta?.error) {
    return buildWorkerErrorPayload(name, result.meta.error.message);
  }

  // 成功
  return buildWorkerResultPayload(name, result.text);
}

function buildWorkerResultPayload(name: string, text: string): string {
  const body = text?.trim() ? text : "(no textual reply)";
  return `<worker-result from="${name}">\n${body}\n</worker-result>`;
}

function buildWorkerErrorPayload(
  name: string,
  message: string,
  aborted = false,
): string {
  const abortedAttr = aborted ? ' aborted="true"' : "";
  const body = escapeXml(message || "Worker failed without an error message.");
  return `<worker-error from="${name}"${abortedAttr}>\n${body}\n</worker-error>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "'");
}
```

**关键适配：**

- 不使用 `WorkerState` 注册表（Orkas 的 `state.workers`）— 子回合是纯函数内临时变量
- 不走 `runActorTurn` 间接层 — 直接在 `runNestedDispatch` 内创建 Runner 并调用 `run()`
- 不注入首轮重放/可见切片 — S1 直接送达 task，S3 再补
- `dispatchSlots` 使用 `Semaphore`（my-agent 的 `Mutex` 不适合并发计数场景）
- `getRunner()["config"]` 不是好设计 — 这是 S1 的权宜之计。更好的做法是 `runNestedDispatch` 接收 `config` + `providers` 引用而非 Runner 本身。下文 §3.6 讨论改进。

### 3.6 Runner 注入调度工具

**文件：** `src/agent/runner.ts`（修改）

最小改动方案：在 `AgentRunner` 构造时，按 session kind 决定是否注入调度工具。

```ts
// 在 constructor 末尾，工具注册循环之后：
// （新增）
if (!opts.disableTools && this.session.getSessionId()) {
  const kind = sessionKindOf(this.session.getSessionId());
  if (kind === "gconv" || kind === "cli") {
    // 主会话 → 注入调度工具
    const dispatchTools = buildDispatchTools({
      getRunner: () => this,
      cid: this.session.getSessionId()!,
      workingDir: process.cwd(),
    });
    for (const tool of dispatchTools) {
      this.tools.set(tool.name, tool);
    }
  }
}
```

**但这依赖 `session-store.ts` 的 `sessionKindOf`，可能造成循环依赖。** 更干净的方案：

**方案 B（推荐）：在 Runner 构造后，由调用方显式注入**

```ts
// cli/menu.ts 或测试中：
const runner = new AgentRunner({ config, tools: BUILTIN_TOOLS });

// 主会话显式注入调度工具
if (isCommanderSession(sessionId)) {
  const dispatchTools = buildDispatchTools({
    getRunner: () => runner,
    cid: sessionId,
  });
  for (const tool of dispatchTools) {
    runner.addTool(tool);
  }
}
```

**采用方案 B**——保持 Runner 纯净，由上层决定工具注入策略。

### 3.7 abort 级联

已在 `runNestedDispatch` 中实现：

- 子 `AbortController` 链接父 `AbortSignal`
- 父已中止 → 子立即中止（不等 LLM 调用）
- 子 Runner 的 `run()` 传入 `ac.signal`
- Runner 内部在工具循环中检查 `params.signal?.aborted`（已实现）
- 用户停止主任务 → 所有嵌套子回合一起停

### 3.8 中断引导（interrupt-steer）

**无需新增代码**。my-agent 的 Runner 已经实现了完整的 `drainSteer`/`foldSteer`：

```
// 已有机制（runner.ts）：
// 1. AgentRunParams.drainSteer 回调（由调用方提供）
// 2. foldSteer() — 工具循环边界排空
// 3. terminalSteer() — 模型无工具调用时排空并启动新 turn
```

子 Agent 的隔离由**不传 `drainSteer` 回调**天然保证：

- 主 Runner 构造时传入 `drainSteer` → 用户消息可折叠进主回合
- 子 Runner 构造时不传 `drainSteer` → 子回合永远收不到用户消息

这与 Orkas 的"嵌套子运行无 `drainSteer` 回调"逻辑完全一致。

---

## 4. S2：命名 Agent

**目标：** 按 `agent_id` 指定目标 worker，读取 `agent.json` 规格并注入 workflow/skill_list。

### 4.1 Agent 规格定义

**文件：** `src/orchestration/agent-spec.ts`（新建）

```ts
/**
 * Agent 规格（从 agent.json 读取）。
 *
 * 路径：{dataRoot}/agents/{agent_id}/agent.json
 */
export interface AgentSpec {
  agent_id: string;
  name: string;
  description_zh?: string;
  description_en?: string;
  /** 分步程序（注入 worker system prompt） */
  workflow?: string;
  /** 技能白名单：缺失=全部可用，[] = 零技能，非空 = 仅这些 */
  skill_list?: string[];
}

/**
 * 加载并校验 agent 规格文件。
 *
 * 安全：对 agent_id 做段断言（防路径穿越）。
 */
export async function loadAgentSpec(agentId: string): Promise<AgentSpec | null> {
  assertPathSegment(agentId, "agent_id");

  const filePath = path.join(dataRoot(), "agents", agentId, "agent.json");
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<AgentSpec>;
    return normalizeAgentSpec(raw, agentId);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function normalizeAgentSpec(raw: Partial<AgentSpec>, agentId: string): AgentSpec {
  if (raw.agent_id && raw.agent_id !== agentId) {
    throw new Error(`agent_id mismatch: file says "${raw.agent_id}", expected "${agentId}"`);
  }
  return {
    agent_id: agentId,
    name: raw.name || agentId,
    description_zh: raw.description_zh,
    description_en: raw.description_en,
    workflow: raw.workflow,
    skill_list: raw.skill_list,
  };
}
```

### 4.2 `run_worker(to)` 命名分支

在 `tools.ts` 的 `run_worker` 工具中追加 `to` 参数的命名分支：

```ts
// 在 execute 函数内，task 校验之后：
const toRaw = String(input?.to || "").trim();

if (toRaw) {
  // S2：命名 agent 路径
  const spec = await loadAgentSpec(toRaw);
  if (!spec) return _toolError(`Unknown agent: "${toRaw}"`);
  if (toRaw === "commander" || toRaw === "user") {
    return _toolError("run_worker target must be an agent, not commander/user");
  }

  const namedActor: Actor = { kind: "agent", id: spec.agent_id, name: spec.name };
  const namedResult = await runNestedDispatch({
    cid: opts.cid,
    actor: namedActor,
    task,
    parentSignal: ctx.signal ?? opts.signal,
    getRunner: opts.getRunner,
    workingDir: ctx.workingDir ?? opts.workingDir,
    agentSpec: spec,   // 传递给 dispatch 层用于构建 system prompt
  });
  return { content: namedResult };
}
```

### 4.3 命名 agent 的 system prompt

`runNestedDispatch` 根据是否传入 `agentSpec` 切换 system prompt 构建策略：

```ts
const systemPrompt = opts.agentSpec
  ? buildNamedAgentSystemPrompt(opts.agentSpec, opts.workingDir)
  : buildWorkerSystemPrompt({ name: opts.actor.name, workingDir: opts.workingDir });
```

命名 agent 的 prompt 使用完整的 `buildSystemPrompt()` + `workflow` 注入 + `skill_list` 过滤：

```ts
function buildNamedAgentSystemPrompt(
  spec: AgentSpec,
  workingDir?: string,
): string {
  const assembly = buildSystemPrompt({
    name: spec.name,
    workingDir,
  });

  // 追加 workflow 分步程序
  const workflowBlock = spec.workflow
    ? `\n\n## Workflow\n\n${spec.workflow}`
    : "\n\n## Workflow\n\n(not provided)";

  return assembly.systemPrompt + workflowBlock;
}
```

---

## 5. S3：质量对齐（简化）

### 5.1 fan-out 并行

`run_worker` 已声明 `executionMode: "parallel"`。Runner 的 `partitionToolBatches` 会在模型同时发出多个 `run_worker` 时自动并行执行。`dispatchSlots`（默认 4）夹住实际并发数。

**无需额外代码**。

### 5.2 错误语义

Commander prompt 注入 worker-error 处理段（追加到主 system prompt）：

```
If a tool result contains <worker-error ...>, treat that sub-run as failed or partial.
If it has aborted="true", the user stopped the task: do not retry or re-dispatch; end cleanly.
```

实现方式：在 `buildDispatchTools` 调用方的 system prompt 尾部追加此段。

### 5.3 大结果溢出

- **第一道防线：** worker 的 prompt 已要求"大工件写文件、回传路径"
- **第二道防线（可后续实现）：** 在 `classifyWorkerOutcome` 中检查 `result.text.length`，超过阈值则截断并追加 `…[truncated, see worker session gworker-* for full output]`

### 5.4 可见性切片

S1/S2 **不做**。子回合不注入历史上下文（仅送达 task 信封）。S3 如需，再实现简化版：取主 session 最近 N 轮摘要作为 `<conversation-context>` 前缀注入。

---

## 6. S1 最小实现步骤

### Step 1：Actor + session id（30 行）

文件：`src/orchestration/actor.ts` → 见 §3.1

### Step 2：Session kind 增补（5 行修改）

文件：`src/storage/session-store.ts` → 见 §3.2

### Step 3：Worker 合成提示（40 行）

文件：`src/orchestration/workflow.ts` → 见 §3.3

### Step 4：`run_worker` 工具（80 行）

文件：`src/orchestration/tools.ts` → 见 §3.4

### Step 5：`runNestedDispatch`（150 行）

文件：`src/orchestration/dispatch.ts` → 见 §3.5

### Step 6：注入调度工具 + 验收测试

- CLI 入口（`src/cli/`）在创建 Runner 后检测是否为 commander session，是则 `addTool` 调度工具
- 编写测试：`test/orchestration/dispatch.test.ts`

---

## 7. 测试策略

### 7.1 单元测试

| 测试点                              | 验证内容                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| `actorSessionId`                  | `gworker-<cid>-<id>` 格式；未知 kind 抛错                         |
| `genWorkerId`                     | 连续 N 次调用不重复                                                 |
| `isEphemeralSession("gworker-x")` | →`true`                                                          |
| `sessionKindOf("gworker-x")`      | →`"gworker"`                                                     |
| `buildWorkerSystemPrompt`         | 含 "ephemeral worker"、"no user"、"verbatim" 关键词                 |
| `withoutDispatchTools`            | 过滤后不含`run_worker`                                            |
| `buildWorkerResultPayload`        | 含`<worker-result from="...">`，空 text → `(no textual reply)` |
| `buildWorkerErrorPayload`         | 含`<worker-error>`，aborted=true → `aborted="true"`            |
| `classifyWorkerOutcome`           | abort/error/success 三分支                                          |

### 7.2 集成测试

| 测试点                                  | 验证内容                                                                |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `run_worker` 工具在主会话可用         | `runner.addTool(dispatchTool)` 后 `tools.has("run_worker")` → true |
| `run_worker` 工具在 worker 会话不可用 | 子 runner 的`tools.has("run_worker")` → false                        |
| 完整闭环                                | `run_worker({task: "echo hello"})` → 返回 `<worker-result>`        |
| abort 级联                              | 主 AbortController.abort() → worker run 返回 aborted 结果              |
| dispatchSlots 上限                      | 5 并发 → 第 5 个等待，第 4 个完成后第 5 个开始                         |
| worker session 文件创建                 | `gworker-*.jsonl` 文件存在且与主 session 不同                         |

---

## 8. 常见坑（my-agent 特别版）

| #  | 坑                                         | my-agent 对策                                                 |
| -- | ------------------------------------------ | ------------------------------------------------------------- |
| 1  | 把子 Agent 当异步消息                      | 同步`await runner.run()`，结果当 `tool_result`            |
| 2  | worker 复用父 session                      | 每个子回合`new Session()`，独立 JSONL                       |
| 3  | `dispatchSlots` 用 `Mutex`             | 用`Semaphore`（`async-mutex` 提供，计数信号量 ≠ 互斥锁） |
| 4  | 子 Runner 注入调度工具                     | `withoutDispatchTools()` 过滤                               |
| 5  | abort 不级联                               | 子 AbortController 链接父 signal                              |
| 6  | 结果回传用裸文本                           | `<worker-result>` / `<worker-error aborted="true">`       |
| 7  | `agent_id` 路径穿越                      | `assertPathSegment`（已有）                                 |
| 8  | `run_worker` 目标 `commander`/`user` | S2 命名分支显式拒绝保留 id                                    |
| 9  | worker 的`drainSteer` 回调               | **不传** — 子 Runner 不应收到用户消息                  |
| 10 | 大结果撑爆父上下文                         | worker prompt 约束 + S3 截断                                  |

---

## 9. 建议节奏

| 阶段              | 预计工时     | 产出                                                           |
| ----------------- | ------------ | -------------------------------------------------------------- |
| S1.1–S1.3        | 1h           | Actor + Session kind + WORKER_WORKFLOW                         |
| S1.4–S1.6        | 2h           | `run_worker` 工具 + `runNestedDispatch` + 回传协议         |
| S1 测试           | 1h           | 单元 + 集成测试                                                |
| **S1 闭环** | **4h** | **🎉 主 Agent 发 run_worker → worker 跑完 → 结果交回** |
| S2                | 3h           | agent.json 加载 +`run_worker(to)` + skill_list 过滤          |
| S3                | 按需         | fan-out 测试、错误恢复、大结果 cap                             |

---

## 附录 A：依赖图（my-agent 版）

```
                    ┌──────────────────────────┐
                    │  agent/runner (AgentRunner)│  同一 Runner 类复用
                    └────────────┬─────────────┘
                ┌────────────────┼──────────────────┐
                │                │                  │
         ┌──────┴──────┐ ┌───────┴──────┐  ┌───────┴──────┐
         │ orchestration│ │ session-store│  │ storage/locks│
         │  dispatch    │ │  +gworker    │  │ dispatchSlots│
         │  + tools     │ │  kind        │  │ (Semaphore)  │
         └──────┬──────┘ └──────────────┘  └──────────────┘
                │
         ┌──────┴──────┐
         │ orchestration│  workflow + actor
         │ workflow     │  + 回传协议
         └──────┬──────┘
                │
    ┌───────────┼───────────┐
    │           │           │
┌───┴───┐ ┌────┴────┐ ┌───┴──────┐
│Session│ │BUILTIN_ │ │ prompts/ │
│(new)  │ │TOOLS    │ │ builder  │
└───────┘ └─────────┘ └──────────┘
```

## 附录 B：关键类型速查

```ts
// Actor
type ActorKind = "commander" | "user" | "agent" | "worker";
interface Actor { kind: ActorKind; id: string; name?: string; }

// Session ID
gconv-{cid}            // 主会话
gworker-{cid}-{wid}    // 匿名 worker

// 调度工具
run_worker({ task: string, to?: string }) → ToolResult

// 回传协议
<worker-result from="Worker">...text...</worker-result>
<worker-error from="Worker" aborted="true">...msg...</worker-error>

// 并发控制
dispatchSlots: Semaphore(4)
```

---

**下一步：** 按 §6 的 Step 1–6 逐文件实现，每步跑通后再进行下一步。
