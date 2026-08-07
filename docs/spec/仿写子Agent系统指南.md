# 仿写 子Agent 系统 — 从零构建指南

> **承接**：[`仿写Agent框架指南.md`](./仿写Agent框架指南.md) **第三阶段**（路径 / 沙箱 / 存储 / 锁 / Session 持久化）完成后，进入本指南。  
> **对应源码**：`src/main/features/group_chat/{bus,state,router}.ts`、`src/main/model/core-agent/session-store.ts`、`src/main/util/locks.ts`、`src/main/prompts/chat_commander.md`。  
> **设计蓝图**：[`ARCHITECTURE.md`](./ARCHITECTURE.md) §7（群聊编排）、[`core-agent/11-session-kind-and-actors.md`](./core-agent/11-session-kind-and-actors.md)（Session Kind / Actor）；Agent 规格素材见 [`agent/Agent智能体组成.md`](./agent/Agent智能体组成.md)。  
> **本文做什么**：把「my-agent 还不支持子 Agent」补成可动手的仿写路径——读 Orkas → 自己写 → 测通。  
> **本文不做什么**：不复制业务代码；不展开群聊 bus 的可见性切片 / plan executor 全量；不展开 Connector、`inputs` 表单、marketplace 派发。

---

## 学习策略

与 Agent / Skill 指南相同：**逐个模块边学边做，不要全看完再动手。**

每个模块的节奏：

1. 读 Orkas 源码（30–60 分钟）
2. 关掉源码，凭理解自己写（1–2 小时）
3. 跑通测试，对比差异

**正文写全量；任务分阶段验收。** 先 S1 闭环，再 S2 产品层，最后 S3 对齐 Orkas。

---

## Orkas 源码位置

本文档中 `src/main/features/group_chat/`、`src/main/model/core-agent/` 等路径均相对于 Orkas 仓库根目录：

```
D:\studyspace\源码学习\Orkas\
```

> 若你的本地路径不同，全文替换为实际路径即可。每个模块的第一步"读 Orkas 源码"都在此目录下找对应文件。

---

## 前置条件（第三阶段必须已完成）

| 前置模块 | 用途 |
|----------|------|
| 第二阶段 Runner（`runStream` 主循环） | 子 Agent 就是**再跑一遍同一个 Runner**，只是换 session / system prompt |
| `paths.ts` 路径收口 | `userLocalSessionFile` 等 ephemeral 会话路由 |
| `storage.ts` 原子写 + JSONL | worker 会话落盘、`appendJsonlAtomic` 行号 |
| `session-store.ts` kind 正则 + cloud/local 路由 | 新增 `gworker` kind 走 local（短暂会话） |
| `util/locks.ts` 信号量 | `dispatchSlots` 嵌套调度并发边界 |
| 第四阶段工具（可并行） | worker 要干活：`read_file` / `bash` / `web_search` 等 |
| Skill 指南（可并行） | worker 的能力说明书（`## Available skills` 对 worker 同样注入） |

第三阶段结束时，my-agent 已有持久化与路径闸、锁与 Session 持久化；**缺的是「把任务拆出去给另一个 LLM 回合跑」的编排能力**——本指南补上。

> Agent 指南里 **第四阶段（工具）**、**Skill 指南（S1–S2）** 可与本指南并行。子 Agent 的第一版（S1）只需要 Runner + 会话隔离 + 一个工具，即可跑通闭环。

---

## 项目骨架扩展

在既有 `my-agent/` 上增加：

```
my-agent/
├── src/
│   ├── shared/ …          # 已有
│   ├── config/ …          # 已有
│   ├── providers/ …       # 已有
│   ├── tools/ …           # 已有（read_file / bash）
│   ├── agent/ …           # 已有 runner（runStream）
│   ├── paths.ts           # 第三阶段
│   ├── storage.ts         # 第三阶段
│   ├── session-store.ts   # 第三阶段（增补 gworker kind）
│   ├── util/
│   │   ├── locks.ts       # 第三阶段（增补 dispatchSlots）
│   │   └── path-sandbox.ts
│   └── orchestration/     # ← 本指南新增
│       ├── actor.ts       # Actor 类型 + session id builder（S1）
│       ├── dispatch.ts    # runNestedDispatch + 结果回传（S1）
│       ├── workflow.ts    # WORKER_WORKFLOW 合成提示（S1）
│       ├── tools.ts       # run_worker / dispatch_to / hand_off_to（S1→S2）
│       ├── queue.ts       # 中断引导 drainSteerInto（S1.8）
│       ├── router.ts      # @ 解析 / resolveRecipients / 楼层（S2）
│       └── roster.ts      # members 名册（S2）
├── fixtures/
│   └── orchestration/     # 测试用 agent.json / 会话树
├── test/
└── …
```

> 目录名 `orchestration/` 对应 Orkas 的 `src/main/features/group_chat/`。my-agent 没有群聊 UI，但「派发 → 子回合 → 结果交回」的编排逻辑就是 Orkas 群聊 bus 的核心子集。

---

## 完整依赖图（子 Agent 子系统）

```
                    ┌──────────────────────────┐
                    │  agent/runner (runStream) │  同一 Runner 复用
                    └────────────┬─────────────┘
                ┌────────────────┼──────────────────┐
                │                │                  │
         ┌──────┴──────┐ ┌───────┴──────┐  ┌───────┴──────┐
         │ orchestration│ │ session-store│  │ util/locks   │
         │  dispatch    │ │  gworker kind│  │ dispatchSlots│
         └──────┬──────┘ └──────┬───────┘  └──────┬───────┘
                │               │                 │
                └───────────────┼─────────────────┘
                                │
                       ┌────────┴────────┐
                       │ orchestration/  │  Actor + WORKER_WORKFLOW
                       │ workflow + tools│  + 结果回传协议
                       └────────┬────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
       ┌──────┴──────┐  ┌──────┴──────┐  ┌───────┴──────┐
       │ paths.ts    │  │ storage.ts  │  │ agent.json   │  ← S2
       │ 会话路由     │  │ JSONL 落盘  │  │ 规格读取       │
       └─────────────┘  └─────────────┘  └──────────────┘
```

**关键不变式：** 子 Agent **不是**「给另一个进程发消息等回复」。它是**同进程内的嵌套 LLM 回合**——父回合的工具循环里，子回合同步跑完，结果以工具结果形式交回。

---

# 📐 仿写路线图

| 阶段 | 目标 | 产出 | 验收一句话 |
|------|------|------|------------|
| **S0** | 概念纠偏 | 心智模型 | 能向别人讲清「子 Agent ≠ 工具调用 / 异步队列」 |
| **S1** | 核心闭环 | 匿名 `run_worker` + 中断引导 | 主 Agent 发一条 `run_worker`，worker 跑完把完整结果原样交回；用户回合内纯文本消息被折叠、附件单独跑 |
| **S2** | 产品层 | 命名 agent + 三派发工具 + 路由 | `dispatch_to` / `hand_off_to` / `run_worker(to)`；`@` 路由与楼层 |
| **S3** | 全量对齐 | fan-out、错误语义、大结果、可见性 | 行为与 Orkas 文档矩阵一致 |

---

# S0：概念纠偏（动手前必读）

## S0.1 一句话定义

**子 Agent = 主 Agent（指挥官）在回合内派出、跑一整轮独立 LLM 回合、把完整结果当工具结果交回的「嵌套运行」。**

```
主 Agent 回合（工具循环）
  ├─ tool_use: run_worker({ task })
  ├─ 构造 Actor(kind:'worker') + 合成 WORKER_WORKFLOW 提示
  ├─ 开新 session：gworker-<cid>-<workerId>（短暂、隔离）
  ├─ 子回合：同一个 runStream，独立上下文、独立工具循环
  ├─ 子回合完整结果 → <worker-result> 当工具结果交回
  └─ 主 Agent 继续：读结果、综合、决定下一步
```

关键点：**子回合阻塞在父回合的工具调用内**。主 Agent 发完 `run_worker`，等子 Agent 跑完拿到结果，才继续自己的下一轮 LLM 调用。没有异步消息、没有"给别的进程发任务"。

## S0.2 子Agent vs Skill vs Tool

| | SDK Tool | Skill | 子 Agent |
|---|---|---|---|
| 本质 | 进程内函数 | 说明书 + 可选脚本 | 完整 LLM 回合 |
| 是否自主推理 | ❌ | ❌（调用方读说明书） | ✅ 自己推理 |
| 独立上下文 | ❌ | ❌ | ✅ 独立 session |
| 成本 | 0 | 读正文 tokens | 一整个回合 tokens |
| 返回 | 结构体 | 脚本输出 | 文本 + 文件引用 |
| 何时用 | 已知的确定性操作 | 方法论 / 脚本化能力 | 需要推理的子任务、批量上下文清洗 |

**Agent 也不是"工具"**（见 [`agent/README.md`](./agent/README.md) 一句话）：`agent.json` 是面向派发与系统提示的**规格**；真正干活靠内置 tools + `skill_list` 指向的技能。子 Agent 能力把「能派发出去的 Agent」从概念变成运行时。

## S0.3 七条硬决策（写错架构就返工）

### 1. 嵌套运行是同步的

Orkas 早期是「子回合 → 回合结束排空 → 异步 worker → 结果回传再唤醒父回合」（分阶段异步）；后来演进成 **G8d 进程内同步嵌套**：子回合直接跑在父回合的工具调用里，回传就是工具结果。少一套唤醒/排空状态机，快、简单、可测试。

```
✅ runNestedDispatch：父工具循环内同步 await 子回合，返回 <worker-result>
❌ 给"另一个 agent"发消息、然后异步等它的下一轮回复
```

### 2. session 隔离是底线

每个 actor（指挥官 / 命名 agent / 匿名 worker）有自己的 session：`gconv-<cid>` / `gmember-<cid>-<agentId>` / `gworker-<cid>-<workerId>`。kind 由**系统写死**（builder），不是 LLM 给的；解析用已知 kind 白名单正则，长的优先。

子 Agent **绝不复用父 session**——否则子回合的上下文污染主上下文，大任务直接炸 token 预算。

### 3. 并发用信号量，不用锁，且独立于全局槽

- `dispatchSlots`（默认 4，`ORKAS_MAX_DISPATCH_CONCURRENCY` 可覆盖）限制同时跑的嵌套回合数。
- **故意跳过 `globalSlots`**：父回合已持全局槽，再嵌套获取同一把锁会**死锁**。
- 调度工具**只有指挥官持有**（worker / agent 没有调度工具）→ 无重入 → 无死锁。
- 带超时的 acquire：超时后必须释放 `acquirePromise`，否则 mutex 泄漏。

### 4. abort 必须级联

子 AbortController 链接父信号：用户停止主任务，所有嵌套子回合一起停。子回合异常分类：**父中止 → `<worker-error aborted="true">`**，主 Agent 知道"用户停了，别重试"。

### 5. 匿名 worker 无身份，命名 agent 有名分

| | 匿名 worker（`kind:'worker'`） | 命名 agent（`kind:'agent'`） |
|---|---|---|
| 来源 | `run_worker` 不传 `to` | `@` 提及 / `dispatch_to` / `hand_off_to` / `run_worker(to)` |
| 名册 | **不注册** | `ensureAgentMember` 自动入册 |
| 气泡 | 无（流被抑制） | 有（自己的可见回复） |
| 结果 | verbatim 交回指挥官 | 可见回复 + 结果交回（dispatch）或直接交付（hand_off） |
| session | `gworker-…`（短暂） | `gmember-…`（可恢复） |

**用户永远输入不出 `kind:'worker'`**。worker 只能由指挥官工具现场构造。

### 6. 回传协议要机器可读

主 Agent 必须能区分「成功 / 失败 / 中止 / 阻塞表单」，所以回传不是裸文本，而是带标签的负载：

```
<worker-result from="Worker">…完整结果…<files>…</files></worker-result>
<worker-error from="Worker" aborted="true">…错误信息…</worker-error>
```

### 7. 回传分两层：同步 vs 异步入队

子 Agent **不全是一个机制**——它有两种回传路径：

| 路径 | 触发场景 | 数据形态 | 父回合怎么拿到结果 |
|------|----------|----------|---------------------|
| **同步（in-process）** | `dispatch_to` / `run_worker` / 命名 `run_worker(to)` | 工具结果 `<worker-result>` 块 | 同一次 LLM 调用的 `tool_result` 通道；指挥官继续想下一步 |
| **异步入队（resume）** | `hand_off_to` + `resume`，或 agent `<handback />` / 表单提交 | 一条新消息 `Orchestration resume from @<agent>.` 进指挥官队列 | 指挥官被新消息唤醒跑下一轮 |

G8d 把"调度 → 异步 worker → 完成 → 唤醒父回合"演进成"进程内同步嵌套"。**默认全走同步**，只有 handback 那种 agent 真要自己接管发言权、和用户来回好几轮才需要异步入队账本（`OrchestrationLedger`）。所以：

- **绝大多数情况**：同步 `await runNestedDispatch`；LLM 工具结果直接继续
- **特例**：handback / 表单挂起；`_enqueueOrchestrationResumeFromAgent` 再入队一条消息唤醒指挥官

直觉修正（动手前先打破）：

- ❌「派发子 Agent 就是异步入队消息、然后等回复」——**主路径不是这样**
- ✅「派发子 Agent 就是工具调用内部同步 await，结果是 tool_result」——**绝大多数是这样**

---

# S1：核心闭环（my-agent 首次具备子 Agent）

**目标：** 主 Agent 的工具数组里出现 `run_worker` → 派匿名 worker → worker 用独立 session 跑一轮 → 完整结果以 `<worker-result>` 交回 → 主 Agent 综合。

**S1 模块总览：**

| # | 模块 | 产出文件 | 你需要定义的 |
|---|------|----------|--------------|
| S1.1 | Actor 类型 + session id | `orchestration/actor.ts` | `Actor`、`genWorkerId`、`buildGworkerSessionId` |
| S1.2 | Session kind 增补 | `session-store.ts` + `paths.ts` | `gworker` 进白名单 + ephemeral 路由 |
| S1.3 | Worker 合成提示 | `orchestration/workflow.ts` | `WORKER_WORKFLOW` |
| S1.4 | `run_worker` 工具 | `orchestration/tools.ts` | 工具定义 + `_toolError` |
| S1.5 | `runNestedDispatch` | `orchestration/dispatch.ts` | 合成 WorkerState + 复用 runStream |
| S1.6 | 结果回传协议 | `orchestration/dispatch.ts` | `<worker-result>` / `<worker-error>` |
| S1.7 | abort 级联 + `dispatchSlots` | 并入 S1.5 | AbortController 链 + 信号量 |
| S1.8 | 中断引导（interrupt-steer） | `orchestration/queue.ts` | `drainSteerInto` 四条过滤 + runner 钩子 |

**依赖：** S1.1 → S1.2 → S1.3 → S1.4 → S1.5 → S1.6 → S1.7 → S1.8（S1.6 / S1.7 与 S1.5 同文件同时做；S1.8 在 worker loop 落地后补上）

---

## S1.1 Actor 类型与 session id builder

**对应源码：** `src/main/features/group_chat/state.ts`（`Actor` / `COMMANDER_ID` / `buildGworkerSessionId`）

### 类型

```ts
// src/orchestration/actor.ts
export type ActorKind = 'commander' | 'user' | 'agent' | 'worker';

export interface Actor {
  kind: ActorKind;
  /** commander / user 为保留角色；worker 用 genId12()；agent 用真实 agent_id */
  id: string;
  name?: string;
  joined_at: string;
}

export const COMMANDER_ID = 'commander';
export const USER_ID = 'user';
export const RESERVED_IDS: ReadonlySet<string> = new Set([COMMANDER_ID, USER_ID]);
```

### session id builder

kind 由 builder 写死进字符串开头，之后只按前缀解析：

```ts
export function buildGconvSessionId(cid: string): string {
  return `gconv-${cid}`;
}
export function buildGmemberSessionId(cid: string, agentId: string): string {
  return `gmember-${cid}-${agentId}`;
}
export function buildGworkerSessionId(cid: string, workerId: string): string {
  return `gworker-${cid}-${workerId}`;
}

export function actorSessionId(cid: string, actor: Actor): string {
  if (actor.kind === 'commander') return buildGconvSessionId(cid);
  if (actor.kind === 'agent') return buildGmemberSessionId(cid, actor.id);
  if (actor.kind === 'worker') return buildGworkerSessionId(cid, actor.id);
  throw new Error(`actor ${actor.kind}/${actor.id} has no session`);
}
```

### my-agent 适配

S1 若还没有"对话/会话归属"概念，`cid` 可直接用**父 session 的归属 id**（如主 session id）或 `genId12()` 生成的 run id。**S3 再对齐 `gworker-<cid>-<workerId>` 命名**。命名不变式现在就要立住：`<kind>-<tail>`，kind 是首段、永远不是任意前缀。

### 验收

- `actorSessionId(cid, {kind:'worker', id:'abc'})` → `gworker-<cid>-abc`
- `kind` 未知时抛错

**代码量：** ~40 行。

---

## S1.2 Session kind 增补（承接 3.4）

**对应源码：** `src/main/model/core-agent/session-store.ts`（`KNOWN_KINDS_RE` / `EPHEMERAL_KINDS` / `resolveSessionPath`）

在第三阶段 `session-store.ts` 中把 `gworker` 加进两处（**正则备选长前缀在前**）：

```ts
const EPHEMERAL_KINDS = ['extract-img', 'reflect', 'memory-extract', 'anon', 'gworker'] as const;
const KNOWN_KINDS_RE =
  /^(gmember|gworker|gconv|memory-extract|extract-img|reflect|skill|agent|anon|cli)(?:-|$)/;
```

路由逻辑不变：

```ts
export function resolveSessionPath(userId: string, sessionId: string): string {
  if (!KNOWN_KINDS_RE.test(sessionId)) throw new Error(`invalid session id ...`);
  return isEphemeralSessionId(sessionId)
    ? userLocalSessionFile(userId, sessionId)   // gworker → local（短暂）
    : cloudSessionFileFor(userId, sessionId);   // gconv / gmember → cloud（可恢复）
}
```

### 语义对照（写进文档注释）

| kind | 谁创建 | 落盘 | 生命周期 |
|------|--------|------|----------|
| `gconv` | 对话主会话 | `cloud/sessions/` | 与对话同生命周期 |
| `gmember` | 命名 agent 回合 | `cloud/sessions/` | 与对话同生命周期 |
| `gworker` | 匿名 worker 回合 | `local/sessions/` | 短暂，7 天 mtime GC |

`gworker` 无需手工删除：`sessions_sweep` 按 mtime GC 短暂会话（第三阶段 §3.4.4 已有）。

### my-agent 适配

S1 若还没有 `cloud/local` 双树，可以全部走 `local/sessions/`；但**必须**在注释里写明 Orkas 的语义，S3 对齐时再拆。

### 验收

- `isEphemeralSessionId('gworker-x')` → `true`；`'gconv-x'` → `false`
- `resolveSessionPath` 对未知前缀抛错
- 主会话与 worker 会话写进**不同**的 jsonl 文件

**代码量：** session-store 增补 ~15 行；paths 增补 ~10 行。

---

## S1.3 Worker 合成提示 WORKER_WORKFLOW

**对应源码：** `src/main/features/group_chat/bus.ts`（`WORKER_WORKFLOW` 常量，通过 `buildAgentInGroupSystemPrompt` 鸭子类型复用 agent-in-group 提示模板）

匿名 worker 没有 `agent.json`，但提示模板读 `workflow` 字段——所以**合成**一个最小 agent 配置即可，不用新写一套提示文件：

```ts
// src/orchestration/workflow.ts
export const WORKER_WORKFLOW = [
  'You are an ephemeral worker spun up by the commander to complete ONE bounded sub-task — you are the commander\'s hands, not an independent specialist.',
  'The task is in the incoming message. Do it end to end using your available tools (files, shell, web, library, etc.).',
  'There is no user in this turn: never ask a question, request input, or emit a form — if something is ambiguous, make the most reasonable assumption and state it in your result.',
  'Your reply is handed back to the commander verbatim (not shown to anyone else), so return the COMPLETE result it needs to act on. Put large artifacts in files and reference their paths; keep the reply itself focused on the result and any pointers.',
].join(' ');
```

四条规则各管一件事：

| 规则 | 目的 |
|------|------|
| 一句话边界（ONE bounded sub-task / 是手不是专家） | 防止 worker 超范围发挥 |
| 无用户：不要提问、不要表单 | worker 无头，问题只能自己假设并说明 |
| 结果 verbatim 交回、要完整 | 父 Agent 拿到的必须是可行动的结果 |
| 大工件落文件、回复聚焦 | 防止大结果撑爆父上下文 |

### 提示注入

```ts
const systemPrompt = await buildWorkerSystemPrompt({
  agent_id: actor.id,          // worker 的 id
  name: actor.name || 'Worker',
  description: 'Ephemeral sub-task worker spun up by the commander.',
  workflow: WORKER_WORKFLOW,
  interactive: false,
});
```

### 踩坑

- **不要给 worker 单独发明一套"后台工人提示词"**——复用同一套 agent-in-group 模板 + workflow 注入，行为一致、少一套要维护的提示。
- worker 的可用工具**默认与主 Agent 相同**，但**不含调度工具**（见 S0.3 #3）。

### 验收

- worker 的 system prompt 含「no user」「handed back to the commander verbatim」
- 不含 `dispatch_to` / `run_worker` / `hand_off_to` 工具

**代码量：** ~30 行（含 builder）。

---

## S1.4 `run_worker` 工具定义

**对应源码：** `src/main/features/group_chat/bus.ts`（`buildCommanderExtraTools` 中的 `run_worker`）

`run_worker` 是**只给主 Agent（指挥官）**注入的调度工具，声明在 `extraTools` 层。S1 只做匿名分支（`to` 可省略），命名分支 S2 接：

```ts
// src/orchestration/tools.ts
import { genId12, nowIso } from '../storage';
import { runNestedDispatch } from './dispatch';

export function buildDispatchTools(state: { uid: string; cid: string }): AgentTool[] {
  const tools: AgentTool[] = [];

  tools.push({
    name: 'run_worker',
    executionMode: 'parallel',
    description: [
      'Run a bounded sub-task and get its FULL result handed back to YOU (the commander) within this same call, so you can read it, synthesise, and decide the next step — the in-loop coordinator pattern.',
      'Use this for a sub-task you own: a bounded job whose output you will build on, or heavy scanning whose bulk you do not want to keep in your own context.',
      'Omit `to` to spin up a fresh anonymous worker (your own hands).',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Optional. A named agent when you need that specialist\'s output back. Omit for an anonymous worker.' },
        task: { type: 'string', description: 'Sub-task instruction, sent verbatim to the worker.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const toRaw = String(input?.to || '').trim();
      const task = String(input?.task || '').trim();
      if (!task) return _toolError('`task` is required');

      if (!toRaw) {
        // 匿名临时 worker — 指挥官自己的双手：同步进程内跑，结果直接是工具结果
        const workerActor: Actor = { kind: 'worker', id: genId12(), name: 'Worker', joined_at: nowIso() };
        const result = await runNestedDispatch(state, ctx?.signal, workerActor, task);
        return { content: result };
      }
      // to 分支 → S2.4
      // ...
    },
  });

  return tools;
}

function _toolError(error: string): { content: string; isError: true } {
  return { content: JSON.stringify({ ok: false, error }), isError: true };
}
```

### 注入条件

```ts
// agent/runner.ts 组装工具时
if (isCommanderSession(sessionId)) {           // 只有 gconv 这类主会话
  allTools.push(...buildDispatchTools(state));
}
```

**S1 就要立住的约束：** `run_worker` 只在**主会话**出现。worker 自己是拿不到调度工具的（S0.3 #3）。

### 验收

- 主会话工具列表含 `run_worker`；worker 会话工具列表不含
- 空 `task` → `_toolError`，不派发

**代码量：** ~60 行。

---

## S1.5 `runNestedDispatch` 最小实现

**对应源码：** `src/main/features/group_chat/bus.ts`（`runNestedDispatch`，3401 起）

这是整个子 Agent 的心脏。S1 版剥掉「命名 agent 名册/可见性气泡」，只留核心路径：

```ts
// src/orchestration/dispatch.ts
async function runNestedDispatch(
  state: { uid: string; cid: string },
  parentSignal: AbortSignal | undefined,
  actor: Actor,
  task: string,
  attachments?: string[],
): Promise<string> {
  // 1. abort 级联：子 AbortController 跟随父信号
  const ac = new AbortController();
  if (parentSignal) {
    if (parentSignal.aborted) ac.abort();
    else parentSignal.addEventListener('abort', () => ac.abort(), { once: true });
  }

  // 2. 合成一次性 WorkerState —— 不进 state.workers，
  //    静止/中止枚举/调度器都忽略它（短暂分班，不是排班 worker）
  const w: WorkerState = {
    uid: state.uid, cid: state.cid, actor,
    running: true, abortController: ac,
    /* … 其余字段置空 … */
  };

  // 3. 组装 LLM 回合负载：带路由信封，收件人看到明确上下文
  const payload = composeLlmTurnPayload(state.uid, COMMANDER_ID, {
    id: genId12(), ts: nowIso(), from: COMMANDER_ID, to: [actor.id], text: task,
  });

  const item: QueueItem = {
    actor,
    turnId: genId12(), msgId: genId12(), fromActorId: COMMANDER_ID,
    llmPayload: payload, nested: true,
    ...(attachments && attachments.length ? { attachments } : {}),
  };

  // 4. 并发边界：dispatchSlots（独立额度，跳过 globalSlots 防死锁）
  const [, releaseDispatch] = await dispatchSlots.acquire();
  try {
    const r = await runActorTurn(state, w, item, Date.now());
    return classifyWorkerOutcome(actor, r, ac);
  } finally {
    releaseDispatch();
  }
}
```

### `runActorTurn`（子回合执行）

my-agent 版可大幅简化——复用第二阶段 Runner 的 `runStream`：

```ts
async function runActorTurn(state, w, item, turnStartedAt) {
  const { uid, cid, actor } = w;
  const sessionId = actorSessionId(cid, actor);

  // S1：worker 分支——合成提示；S2：agent 分支——读 agent.json
  const systemPrompt = (actor.kind === 'worker')
    ? await buildWorkerSystemPrompt({ /* S1.3 */ })
    : await buildAgentSystemPrompt(await loadAgent(actor.id));   // S2

  // 首轮重放（S2/S3 细化）：worker 第一次跑时，把主会话的可见摘要
  // 作为 <group-chat-history> 前缀注入，让它有上下文
  let messageText = item.llmPayload;
  if (!sessionExists(sessionId)) {
    const slice = await readVisibleSlice(uid, cid, actor.id);   // S3 可见性
    const replay = buildReplayPrefix(slice, item.msgId);
    if (replay.prefix) messageText = `${replay.prefix}${item.llmPayload}`;
  }

  // 复用主 Runner：同一个 runStream，换 session + system prompt + signal
  const result = await runStream({
    sessionId,                 // gworker-<cid>-<wid>，独立隔离
    messageText,
    systemPrompt,
    signal: w.abortController?.signal,
    // 注意：不注入调度工具（S1.4 已保证）
  });
  return classifyTurnResult(result);   // → ActorTurnResult
}
```

### my-agent 适配要点

1. **复用同一个 Runner 实例/函数**，不要为 worker 新建一套 run loop。S1 唯一的差异是：session id、system prompt、`signal`、`withoutDispatchTools`。
2. **worker 的 session 从磁盘构造**：`getSession(sessionId)` 首次访问会建文件；子回合结束时文件留在 `local/sessions/` 供排查，7 天 GC。
3. **首轮重放先做简化版**：S1 可以直接注入「主会话最近 N 条消息的紧凑摘要」，S3 再对齐可见性切片。若 S1 不注入，至少要把 `task` 原样送达。

### 踩坑

- **合成 WorkerState 千万别塞进 `state.workers`**——否则 abort 枚举 / 静止判定会把"临时分班"当"排班 worker"处理，出现幽灵 worker。
- 子回合的 `composeLlmTurnPayload` 必须用 `<msg from="commander" to="...">` 信封——子回合要知道自己是谁、任务来自谁。别把裸 task 字符串直接塞进去。
- `dispatchSlots` 的 acquire **必须带超时**（`acquireWithTimeout`），超时后释放 `acquirePromise`（第三阶段 §3.3.3 的不变量）。

### 验收

| 场景 | 期望 |
|------|------|
| 主会话调 `run_worker({task})` | 工具结果包含 worker 完整回复 |
| worker 会话文件存在且与主会话不同 | `local/sessions/gworker-<cid>-<wid>.jsonl` |
| worker 会话第一轮含 `<group-chat-history>`（若做重放） | 前缀注入 |
| worker 被中止 | 工具结果带 `aborted="true"` |

**代码量：** S1 精简版 `dispatch.ts` + `runActorTurn` ~200 行（Orkas 全量含可见性/表单 ~500+ 行）。

---

## S1.6 结果回传协议

**对应源码：** `src/main/features/group_chat/bus.ts`（`buildWorkerResultPayload` / `buildWorkerErrorPayload` / `buildWorkerAbortPayload`）

子回合的结果不是裸文本，而是**分类后的负载**：

```ts
function buildWorkerResultPayload(
  workerName: string,
  text: string,
  produced?: string[],        // worker 声称产出的文件路径（S3 细化）
  form?: unknown,             // 阻塞表单（S3 可选）
): string {
  const files = produced && produced.length
    ? `\n<files>\n${produced.join('\n')}\n</files>` : '';
  const blocked = form
    ? `\n<blocked-on-form form_id="${...}" agent_id="${...}" />` : '';
  return [
    `<worker-result from="${escapeXmlAttr(workerName)}">`,
    text && text.trim() ? text : '(no textual reply)',
    `${blocked}${files}</worker-result>`,
  ].join('\n');
}

function buildWorkerErrorPayload(workerName, errorText, opts?: { aborted?: boolean }): string {
  const message = String(errorText || '').trim() || 'Worker failed without an error message.';
  const abortedAttr = opts?.aborted ? ' aborted="true"' : '';
  return [
    `<worker-error from="${escapeXmlAttr(workerName)}"${abortedAttr}>`,
    escapeXmlText(message),
    `</worker-error>`,
  ].join('\n');
}
```

### 分类逻辑（`classifyWorkerOutcome`）

| 情况 | 回传 | 主 Agent 该怎么做 |
|------|------|-------------------|
| 正常完成 | `<worker-result>` | 读完整结果，综合 / 下一步 |
| 回合抛异常 | `<worker-error>` | 视作子任务失败 / 部分完成，可重试或改路由 |
| 父/子信号中止 | `<worker-error aborted="true">` | **用户停了任务，不重试、不重派**，干净收尾 |
| 完成但带 `errText` | `<worker-error>` + Partial result | 部分结果可能仍可用 |
| 产出文件 | `<worker-result>` 内 `<files>` | 按路径引用，不搬全文进上下文 |

### 主 Agent 提示词里的语义（写进 commander prompt）

```
If a dispatch result contains <worker-error ...>, treat that sub-run as failed or partial, not empty.
If it has aborted="true", the user stopped the task: do not retry or re-dispatch it; end cleanly.
```

### 验收

- 成功 → 含 `<worker-result from=…>`；文本为空时有 `(no textual reply)`
- 异常 → `<worker-error>`；XML 特殊字符被转义
- 中止 → `<worker-error aborted="true">`

**代码量：** ~40 行。

---

## S1.7 abort 级联与 `dispatchSlots`

**对应源码：** `src/main/util/locks.ts`（`dispatchSlots`）、`src/main/features/group_chat/bus.ts`（`runNestedDispatch` 中 abort 链）

### abort 级联

```ts
const ac = new AbortController();
if (parentSignal) {
  if (parentSignal.aborted) ac.abort();                       // 父已中止 → 立即中止
  else parentSignal.addEventListener('abort', () => ac.abort(), { once: true });
}
```

- 父信号传给 `runStream` 的 `signal`。
- **一次组中止级联到所有嵌套回合**——主 Agent 停了，所有并行 worker 一起停。

### `dispatchSlots`（第三阶段 §3.3 扩展）

在 `util/locks.ts` 补信号量：

```ts
import { Semaphore } from 'async-mutex';

// 嵌套调度并发上限；默认 4，环境变量可覆盖
const DISPATCH_CONCURRENCY = Number(process.env.ORKAS_MAX_DISPATCH_CONCURRENCY ?? '4');
export const dispatchSlots = new Semaphore(DISPATCH_CONCURRENCY);
```

两个不变量（写进注释）：

1. **跳过 `globalSlots`**：父回合已持全局槽，嵌套再拿同一把锁 → 死锁。嵌套运行用独立额度，容量 4 而非 10（每次嵌套 = 完整 LLM 回合，比父循环贵）。
2. **只有指挥官调度**：worker / agent 无调度工具 → 永不重入 → 信号量安全。

### 带超时获取

```ts
const [, release] = await acquireWithTimeout(dispatchSlots, 30_000);
// 超时抛 'lock acquire timeout'，acquireWithTimeout 内部必须释放 acquirePromise
```

### 验收

- 同一回合发 2 个 `run_worker`，并发数被 `dispatchSlots` 上限夹住（打桩验证 acquire 次数）
- 主任务 abort，嵌套 worker 的 `runStream` 收到 abort 信号并退出
- 无释放泄漏（重复调用后信号量额度恢复）

**代码量：** locks 增补 ~10 行；abort 链已含在 S1.5。

---

## S1.8 中断引导：用户在回合内发的消息去哪了

**对应源码：**
- 队列过滤：`bus.ts` 的 `drainSteerInto`（导出函数，[bus.ts:1637-1657](src/main/features/group_chat/bus.ts#L1637-L1657)）
- LLM 流调用方：`bus.ts:2265` 透传 `drainSteer: () => drainSteerInto(w, actor)`，**仅顶层 turn 才有**（嵌套子运行故意不接）
- Runner 工具循环边界：`core-agent/src/agent/runner.ts:1626` 的 `foldSteer`，**每提交完一个 tool_result、下次 LLM 调用之前** 排空
- Runner 终末路径：`runner.ts:1031` 的 `terminalSteer`，**模型决定不调任何工具时**也排空（避免 steer 留在已结束的 turn 里被后续重放）

### 心智模型

```
用户发送消息 ─┬─> w.queue（push，wake worker）
             │
             ▼
worker 跑 actor.runTurn ─┬─> 每轮 tool loop：foldSteer() → 排空 → 折进 session
                          │
                          └─> 终末：terminalSteer() → 闭合 turn → 开新 turn
```

主 Agent 跑回合中途，用户可以发新消息。**纯文本消息会被排空、折进当前回合的 LLM 上下文**——agent 下一轮 LLM 调用立刻看到用户的最新输入，而不是"等当前回合跑完再启动一个后续回合"。

### 折叠 vs 留在队列的过滤规则

`drainSteerInto` 的判断条件（[bus.ts:1637-1657](src/main/features/group_chat/bus.ts#L1637-L1657)）：

```ts
for (let i = 0; i < w.queue.length; ) {
  const q = w.queue[i];
  if (
    !q.nested                          // ① 不是嵌套子运行的入队（用户不能@worker）
    && q.fromActorId === USER_ID       // ② 只折叠用户消息
    && q.actor.id === actor.id         // ③ 收件人 = 当前正在跑的 actor（楼层匹配）
    && !(q.attachments && q.attachments.length)   // ④ 没有附件
  ) {
    folded.push(q.llmPayload);
    w.queue.splice(i, 1);
  } else {
    i += 1;
  }
}
```

四条规则**全部满足**才折叠进当前回合，否则留在 queue 里单独跑。逐条理由：

| # | 条件 | 为什么不满足会被踢出 |
|---|------|----------------------|
| ① | `!nested` | 嵌套子运行（worker）用户无法直接 @；它们不入队也不被 steer |
| ② | `fromActorId === USER_ID` | 指挥官 / agent 入队的消息是业务流，不是用户输入，不该折叠 |
| ③ | `actor.id === 当前 actor` | 收件人匹配的才折叠——切换楼层时旧消息继续等新 actor |
| ④ | `attachments.length === 0` | **带附件的消息留在队列单独跑**——见下 |

### 为什么带附件的用户消息要单独跑

`runActorTurn` 在跑回合前要组装**三件副作用**（[bus.ts:1773-1830](src/main/features/group_chat/bus.ts#L1773-L1830)）：

1. **`<attachments>` 清单块**（绝对路径 + 类型 + 跳过原因）拼进 payload
2. **图片字节**走 `turnImages` 并排进视觉模型
3. **`<conversation-attachment-index>` 会话级附件索引**注入（让 agent 能恢复之前上传的文件）

如果把带附件的消息直接折叠进 session 当 user message，**这三件副作用都会跳过**——LLM 只看到一行文件名，看不到清单、看不到图、恢复不到旧文件。这对纯文本无影响，对附件是大坑。

所以**约定**：附件消息永远是独立回合，必须跑完 `runActorTurn` 才能组装副作用。

### 折叠的时机（不是字节级实时插入）

`foldSteer` 是**工具循环边界**调用，不在 LLM 流中间打断：

```
[tool_result 已落 session]
        ↓
foldSteer() ← drainSteerInto() 把 queue 里符合条件的 user message 折进来
        ↓
[下一次 LLM call]   ← 模型看到的是「原 task + 工具结果 + 用户新消息」
```

也就是说：用户在 LLM "调工具 + 等结果" 期间发的消息，**等下一次模型想"调什么工具"时才插进来**。模型已经在等工具结果时不会被打断。

终末路径同理：模型决定不再调工具（要给最终答案）时，terminalSteer 把 steer 闭合 turn、当**新一轮 tracked turn** 起跑——避免 steer 留在已结束 turn 里被后续重放（[runner.ts:1024-1037](src/core-agent/src/agent/runner.ts#L1024-L1037)）。

### my-agent 适配

S1 就要立住：

1. **worker map 留一个顶层 FIFO queue**：每个 cid 一个
2. **runner 工具循环结尾 + 终末** 各调一次 `drainSteerInto(w, actor)`，把符合条件的有界 user message 折进 session
3. **filter 严格按 Orkas 四条规则**：缺一就把消息单独跑
4. **附件消息绝不被折叠**——它是 round-trip 副作用的载体

S1.8 的 mock：`runActorTurn` 跑着的时候，发一条纯文本 → 下一轮 LLM 调用里看到这条；发一条带附件的 → 当前回合跑完后启动一个新回合处理附件。

### 验收

- 顶层 turn 工具循环边界调 `drainSteerInto`：纯文本 user message 折进 session；附件 user message 留在队列
- 嵌套子运行（worker）没有 `drainSteer` 回调：用户发消息不会被折叠到子回合
- 用户 `@写作助手` 切楼层：原指挥官的 queue 里如果还有未消费的 user message，仍由指挥官消费；新消息由 agent 消费
- 终末路径：模型给最终答案前也排空一次，steer 落进新 turn 不污染旧 turn

**代码量：** ~40 行（含过滤 + runner 钩子）。

---

## S1 总验收清单

- [ ] `gworker` 进 session kind 白名单，落 `local/sessions/`
- [ ] 主会话有 `run_worker` 工具，worker 会话没有
- [ ] `run_worker({task})` → `<worker-result>` 含完整回复
- [ ] worker 会话文件独立存在
- [ ] 中止级联：主 abort → 子 `runStream` 停止 → `aborted="true"`
- [ ] `dispatchSlots` 并发上限与超时释放测过
- [ ] **中断引导（interrupt-steer）**：纯文本 user 折叠进当前 turn；附件 / 非 user / 非本 actor 留在队列
- [ ] **嵌套子运行无 `drainSteer`**：worker 跑着时用户消息不会被折叠到子回合
- [ ] 文档/注释写明：嵌套同步、session 隔离、dispatch 只归指挥官

**过线标准：** 模拟「主 Agent 发 `run_worker` → worker 用 `read_file`/`bash` 干完 → 结果原样交回 → 主 Agent 读结果继续」整条链路，无需改 Runner 主循环结构。

---

# S2：产品层

**目标：** 命名 agent（读 `agent.json`）、名册与路由、三派发工具齐全、附件沿调度链下传——接近可给真实用户用的子 Agent 产品面。

---

## S2.1 命名 agent 规格读取

**素材：** [`agent/Agent智能体组成.md`](./agent/Agent智能体组成.md)（字段表 + LearningTutor 实例）

`run_worker(to)` / `dispatch_to` / `hand_off_to` 的目标是**命名 agent**——它有自己的 `agent.json`。S2 先实现「读到规格 + 注入 workflow」：

```ts
// src/orchestration/agent-spec.ts
export interface AgentSpec {
  agent_id: string;
  name: string;
  description_zh?: string;
  description_en?: string;
  workflow?: string;          // 注入 worker 系统提示的分步程序
  skill_list?: string[];      // 技能白名单三态（缺失/[]/非空）
  inputs?: AgentInput[];      // 启动表单（S3 可选）
  interactive?: boolean;      // 楼层锚定（S3 可选）
}

export async function loadAgent(agentId: string): Promise<AgentSpec | null> {
  const file = agentSpecFile(activeUid(), agentId);   // 走 paths.ts
  const raw = await readJson<Partial<AgentSpec>>(file);
  // 校验 + 回填：id 段断言（防 path.join 穿越）；name 缺失回退 agent_id
  return normalizeAgentSpec(raw);
}
```

### workflow 注入（对齐 Agent 指南 §3.3）

```ts
const systemPrompt = await buildAgentSystemPrompt(spec, {
  name: spec.name,
  workflow: (spec.workflow || '').trim() || '(not provided)',
  interactive: spec.interactive === true,
  working_dir: conversationWorkspace,
});
```

设计要点（沿 LearningTutor 实例的结论）：

- `workflow` 是**注入 system prompt 的分步程序**，不是展示散文。
- 派发匹配看 `description_*`（`Commander 派发时几乎只看 description`）；`workflow` / `skill_list` / `inputs` 在派发瞬间不可见。
- **不要**在 workflow 里硬编码其他 agent 的展示名——用角色 / skill 引用。

### `skill_list`（白名单求交）

worker 的 Available skills 需与 `agent.skill_list` 求交（三态：缺失=不过滤；`[]`=零技能；非空=严格子集）。实现复用 Skill 指南的 registry（跨指南协作点）。

### 验收

- `loadAgent` 对含 `/` `\` `..` 的 agent_id 抛错
- `workflow` 缺失时提示占位 `(not provided)`，不崩
- 两个同名不同 id 的 agent 能被分别加载

**代码量：** ~150 行（含校验）。

---

## S2.2 名册与 Actor 赋出

**对应源码：** `src/main/features/group_chat/state.ts`（`addMember` / `ensureAgentMember`）、`docs/core-agent/11-session-kind-and-actors.md` §2

### 名册 `members.json`

```json
{
  "version": 1,
  "actors": [
    { "kind": "commander", "id": "commander", "name": "Commander", "joined_at": "..." },
    { "kind": "user", "id": "user", "name": "User", "joined_at": "..." },
    { "kind": "agent", "id": "a83d30d995fd", "name": "写作助手", "joined_at": "..." }
  ]
}
```

- 种子：`commander` + `user`（`RESERVED_IDS`）。
- **匿名 worker 永不入册**（S0.3 #5）。
- 命名 agent：`dispatch_to` / `hand_off_to` / 命名 `run_worker` 在**调度瞬间** `ensureAgentMember`——名册是"这个对话实际见过谁"，不是全局 agent 目录。

### Actor 赋出对照

| Actor.kind | 何时写入 | 怎么触发 |
|------------|----------|----------|
| `user` | 种子 | 每次发消息 |
| `commander` | 种子 | 默认收件人 / `@commander` |
| `agent` | `@` 解析后 / 调度工具 | `@某助手`、`dispatch_to`、`hand_off_to`、`run_worker(to)` |
| `worker` | 工具现场构造 | **无直接入口**；匿名 `run_worker` |

### 验收

- 调度后命名 agent 出现在名册；匿名 worker 不出现在名册
- 名册成员 `name` 修改后，`@` 解析跟随新名

**代码量：** ~120 行。

---

## S2.3 路由：`@` 提及与楼层

**对应源码：** `src/main/features/group_chat/router.ts`（`parseMentions` / `resolveRecipients`）

my-agent 没有群聊 UI，但 S2 至少要有「主会话里 `@agent` 指名派发」的用户体验。实现简化版路由：

### `parseMentions`（语义按 fromKind 分叉）

| `fromKind` | 行为 |
|------------|------|
| `user` | 全文扫描 `@token`（去掉引用行 `> …`）→ 是调度信号 |
| `commander` | **返回 `[]`**——指挥官散文里的 `@A` 是 Markdown 装饰，不是派发信号；派发只走工具 |
| `agent` | 只认 `@commander` / `@用户` 等保留别名（向上升级） |

```ts
const TOKEN_CLASS = '[A-Za-z0-9_一-鿿-]+';
const RESERVED_ALIASES = ['指挥官', 'commander', '用户', 'user'];

export function parseMentions(text, opts?: { fromKind?: ActorKind }): string[] {
  // 引用行剥离 → fromKind 分叉 → 正则扫描 → 去重
}
```

### `resolveRecipients`（简化版）

解析顺序（对齐 Orkas）：

1. 已是保留 id / 名册 id → 直接收
2. 别名：`指挥官`→commander，`用户`→user
3. 名册 agent 展示名（小写去空格）
4. 全局已启用 agent 名表
5. 否则 `unknown`，再按字面 `agent_id` 查库

默认路由（无 `@` 时）：用户 → `active_recipient`（楼层，若还是名册 agent）否则指挥官；指挥官 / agent 回消息 → 用户。

### 楼层 `active_recipient`

`state.json` 存「当前对话对象」：用户 `@写作助手` 后楼层钉在该 agent，之后纯文本直达它；`@commander` 或 UI 选回则重置。

| 状态 | 用户输入 | 实际收件人 |
|------|----------|------------|
| 楼层在指挥官 | `再改一下` | 指挥官 |
| 楼层在写作助手 | `再改一下` | 写作助手 |
| 楼层在写作助手 | `@commander 我回来了` | 指挥官，重置楼层 |

### 验收

| 场景 | 期望 |
|------|------|
| 用户 `@写作助手 帮我改` | `to=[写作助手]`，楼层钉住 |
| 用户无 `@`、楼层在写作助手 | `to=[写作助手]` |
| 指挥官正文 `@A` | **不派发**（`to` 不变） |
| `@不存在的名字` | 回退指挥官 |
| 用户 `@commander` | 楼层重置回指挥官 |

**代码量：** 简化版 `router.ts` ~200 行。

---

## S2.4 `run_worker(to)` 与 `dispatch_to`

**对应源码：** `src/main/features/group_chat/bus.ts`（`run_worker` / `dispatch_to` 工具体）

### 三种派发的本质区别（先立心智再写码）

| 工具 | 谁拥有结果 | 指挥官是否留下 | 用户可见 |
|------|-----------|---------------|----------|
| `run_worker`（匿名） | 指挥官独占，verbatim 交回 | 留下综合 | 否 |
| `run_worker(to)`（命名） | 指挥官独占（专用专家的私有输入） | 留下综合 | 否（作为**私人输入**） |
| `dispatch_to` | 指挥官 + agent 自己发可见回复 | 留下，必须能说出**下一个具体动作** | 是（agent 气泡） |
| `hand_off_to` | agent 交付给用户 | **回合结束**，不重复摘要 | 是（agent 气泡即答案） |

### `run_worker(to)` 命名分支

```ts
const resolvedId = await resolveDispatchTarget(cid, toRaw);   // name → id（S2.1/2.3 映射）
if (!resolvedId) return _toolError('unknown agent');
if (resolvedId === COMMANDER_ID || resolvedId === USER_ID) {
  return _toolError('run_worker target must be an agent (not commander / user)');
}
const namedAgent = await loadAgent(resolvedId);
const namedActor: Actor = { kind: 'agent', id: resolvedId, name: namedAgent?.name || resolvedId, joined_at: nowIso() };
await ensureAgentMember(uid, cid, resolvedId, namedActor.name);   // 入册
const namedResult = await runNestedDispatch(state, ctx?.signal, namedActor, task);
return { content: namedResult };
```

### `dispatch_to`

```ts
{
  name: 'dispatch_to',
  executionMode: 'parallel',
  description: [
    'Run a single named agent and get its FULL result back so you can do MORE work on it — you stay in the loop and then synthesize.',
    'Use this ONLY when you can name a concrete NEXT action you will take this same turn after the agent replies — another dispatch, a tool call, or a synthesis that combines its result with at least one other distinct result.',
    'If the only thing left is to deliver the agent\'s reply, you have no next action — do NOT use this; `hand_off_to` it instead.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      message: { type: 'string', description: 'Dispatch text, sent verbatim to the target.' },
    },
    required: ['to', 'message'],
  },
  async execute(input, ctx) {
    // 校验 → resolveDispatchTarget → 禁止 commander/user
    // → ensureAgentMember → runNestedDispatch(..., 'process')
    // → return { content: result }
  },
}
```

### Commander prompt 里的程序化测试（写进提示词）

`dispatch_to` 前必须能回答「agent 回复后我这一轮**具体的下一步**是什么？」：

- 能说出另一个派发 / 工具调用 / 两个以上结果的综合 → `dispatch_to`
- 只剩下把回复交给用户 → `hand_off_to`
- 通用有界子任务、我要独占结果 → `run_worker`

### 验收

- 同名 agent 用 name 和 id 都能派发；`commander`/`user` 被拒绝
- `dispatch_to` 后主 Agent 上下文里有 agent 完整结果
- 未知名 → `_toolError`，不派发、不入册

**代码量：** 两工具 ~200 行。

---

## S2.5 `hand_off_to`

**对应源码：** `src/main/features/group_chat/bus.ts`（`hand_off_to` 工具体）

交付型派发：agent 的回复**就是答案**，指挥官回合结束、不再综合重复。

```ts
{
  name: 'hand_off_to',
  // 不 parallel：handoff 是回合的最后一个动作（它 endTurn）
  description: [
    'DELIVER a single agent\'s result to the user: the agent answers directly and its own bubble stands as the answer — you do NOT repeat, re-format, or re-bless it, and your turn ends here.',
    'This is the DEFAULT whenever the agent\'s reply is itself what the user asked for — a post, report, analysis, review, diagnosis.',
    'Do any prep first, then hand off as your final action.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      message: { type: 'string', description: 'Task text, sent verbatim to the agent.' },
    },
    required: ['to', 'message'],
  },
  async execute(input, ctx) {
    // 校验 → resolveDispatchTarget → 禁止 commander/user
    // → ensureAgentMember
    // → runNestedDispatch(..., 'final')
    // → 若 agent.interactive === true：setActiveRecipient(agentId)（楼层交给它）
    // → return { content: JSON.stringify({ ok: true, handed_off_to: resolvedId }), endTurn: true }
  },
}
```

两个关键语义：

1. **不重复摘要**——`hand_off_to` 存在的意义就是消灭「转发 + 复述」的冗余回合。
2. **楼层移动规则**——一次性（非交互）agent 的 handoff **不挪楼层**（控制权回指挥官）；`interactive` agent 交接后 `setActiveRecipient`，用户追问直达它，直到 handback / `@commander`。

### 验收

- `hand_off_to` 后主回合以 `endTurn` 结束，不产生"总结"回合
- `interactive` agent 交接后，纯文本用户消息直达该 agent
- agent 回复 `<handback />` 或用户 `@commander` 后楼层归位

**代码量：** ~80 行。

---

## S2.6 附件沿调度链下传

**对应源码：** `src/main/features/group_chat/bus.ts`（`runNestedDispatch` 的 `attachments` 参数、`plan_executor` 的 `initial_attachments`）

用户这一轮上传的文件要跟着派发走：

```ts
const result = await runNestedDispatch(
  state, ctx?.signal, actor, task,
  currentTurnAttachments,   // 当前主回合的附件名列表
);
```

子回合收到附件后：

1. 组装 `<attachments>` 清单块（绝对路径 + 类型）拼进 payload；
2. 图片字节随 `images` 并排传给视觉模型；
3. 会话级附件索引让 agent 能恢复之前上传的文件。

**不变式：文件字节沿调度链传递，不落库复制**（附件目录只有一个副本）。

### 验收

- 主会话带附件派发 → worker 的 payload 含 `<attachments>` 清单
- worker 能 `read_file` 到该附件路径（沙箱根含附件目录）

**代码量：** ~60 行。

---

## S2 总验收清单

- [ ] `loadAgent` 校验 + workflow 注入
- [ ] 名册：调度自动入册；匿名 worker 不入册
- [ ] `@` 路由矩阵测过（楼层 / 别名 / 未知）
- [ ] 三派发工具语义测过（in-loop / 交付 / 私有输入）
- [ ] `hand_off_to` 后无冗余总结回合
- [ ] 附件沿调度链可读
- [ ] `skill_list` 对命名 agent 生效（与 Skill 指南协作）

---

# S3：全量对齐 Orkas

**目标：** fan-out 并行、错误恢复语义、大结果溢出、可见性切片、挂起编排、单一调度原语。

---

## S3.1 并行 fan-out

**对应源码：** `runner.ts` 的 `partitionToolBatches` + `run_worker` 的 `executionMode: 'parallel'`

多条独立 `run_worker` 在**同一条模型回复里一起发出** → 工具批次并行执行 → 结果一起交回 → 指挥官综合：

```
Command: "分别总结这三篇论文"
  → 模型一条回复里 emit 3 个 run_worker 调用（同一批）
  → runner 并行执行（上限 8；实际并发被 dispatchSlots=4 夹住）
  → 3 个 <worker-result> 一起进上下文
  → 指挥官综合
```

**为什么并行而不是串行**：串行等一轮结果再发下一个 = 慢、贵、上下文污染；Orkas 的 commander prompt 明确要求「独立的 N 个同形状任务 → 一条回复里全部发出」。

### 与 Runner 批次划分的衔接

第二阶段 Runner 已按工具声明 `executionMode` 分「并行批 / 串行批」。`run_worker` / `dispatch_to` 声明 `parallel`，`hand_off_to` 声明串行（它是回合最后一个动作）。

### 验收

- 3 个并行 `run_worker` 总耗时 ≈ 单个的耗时（受 dispatchSlots 限制时合理放宽）
- 并行 dispatch 的结果互不串线（各自 session 独立）

---

## S3.2 错误语义与恢复

**对应源码：** `src/main/prompts/chat_commander.md`（worker-error 处理段）

主 Agent 对子回合结果的四种态度（写进 commander prompt）：

| 回传 | 语义 | 指挥官动作 |
|------|------|-----------|
| `<worker-result>` | 成功 | 读、综合、下一步 |
| `<worker-error>` | 失败 / 部分 | 有用则带标注使用；否则重试 / 改路由 / 带标注作答 |
| `<worker-error aborted="true">` | 用户中止 | **不重试不重派**，干净收尾 |
| `<files>` 引用 | 大工件落文件 | 按路径读，不搬全文 |

**手账式原则**（Orkas 经验）：

```
The handback is the worker's full reply, verbatim — read it; never relay a summary or act on "based on its findings".
```

### 验收

- 注入 worker 抛错的 fixture，主 Agent 收到 `<worker-error>` 并按提示恢复
- 注入 `aborted="true"`，主 Agent 不重试

---

## S3.3 大结果溢出

**对应源码：** `src/main/util/tool-result-cap.ts`、`cloud/sessions/<sid>.tool-results/`（tool_result_search / tool_result_read_chunk）

worker 的结果可能撑爆父上下文。两级防线：

1. **worker 侧**（prompt 约定）：大工件写文件、回传路径——这是第一道、也最省。
2. **宿主侧**（工具结果 cap）：超大工具结果转存 `tool-results/` 目录，主 Agent 用 `tool_result_search` / `tool_result_read_chunk` 按需读。

my-agent S3 至少做第 1 级 + 一个简单 cap（超过阈值转存、主 Agent 拿到引用路径）。S3 可选做 `tool_result_*` 检索工具。

### 验收

- worker 写大文件 → 主 Agent 用 `read_file` 读路径，而非全文注入
- 超 cap 的工具结果被截断 + 转存引用

---

## S3.4 可见性切片

**对应源码：** `src/main/features/group_chat/visibility.ts`（`isVisibleTo`）、`docs/ARCHITECTURE.md` §7.2

每个 actor 只看到与自己相关的消息：

| actor | 可见 |
|-------|------|
| commander | 全部 |
| user | 主 jsonl |
| agent X | `from == X` 或 `to` 含 X 或 `mentions` 含 X |
| worker | **绝不能读完整 jsonl**；会话重建靠 `readSlice` / `buildReplayPrefix` |

worker 的上下文来源是「可见切片 → `<group-chat-history>` 前缀」，不是全量历史。这既是隐私边界也是 token 卫生。

### 验收

- worker 第一轮注入的历史只含它相关消息
- 无可见性的消息不会进入 worker session

---

## S3.5 挂起编排（orchestration ledger / resume）

**对应源码：** `state.ts`（`OrchestrationLedger`）、`bus.ts`（`_setFormWaitLedgerFromWorkerResult` / `_enqueueOrchestrationResumeFromAgent`）

`interactive` agent 在派发中向用户要信息（`inputs` 表单）时，指挥官的任务被**挂起**：

```
指挥官 dispatch_to(agent, { message, resume: "表单提交后我要做的事" })
  → agent 发出 <agent-input-form> 阻塞
  → ledger: { status: 'waiting_for_form', blocked_on: 'agent_form', resume_instruction }
  → 用户提交表单 → 路由回 agent → agent 完成
  → 唤醒指挥官按 resume 继续
```

S3 可选实现（依赖 S2.1 的 `inputs`）。若 my-agent 暂不做表单，**跳过 ledger，只保留注释**——不要为没需求的状态机先造轮子。

### 验收（若实现）

- 表单阻塞时状态为 `waiting_for_form`；提交后按 `resume_instruction` 恢复指挥官
- `aborted` 打断时 ledger 标记 `interrupted`，不假恢复

---

## S3.6 群聊总线对齐：单一调度原语

**对应源码：** `docs/ARCHITECTURE.md` §7.1

Orkas 的硬约束：**所有分派最终进 `bus.enqueue`**（用户发送、指挥官 `dispatch_to`、计划步骤、handoff），不开平行调度路径。

my-agent S3 的编排层应收敛为：

```
所有入口（用户消息 / run_worker / dispatch_to / hand_off_to）
  → enqueue(recipients 解析) → 写主 jsonl → 写可见切片 → 唤醒 actor 回合
```

S1–S2 的 `runNestedDispatch` 是"进程内同步路径"（不进队列）；S3 若要支持「异步多轮 + 恢复」再引入队列形态。**先保证一条路径跑通，再谈队列。**

---

## S3 总验收清单

- [ ] 并行 fan-out 测过（3 个并发 worker）
- [ ] 错误/中止语义在 commander prompt 与代码两侧都对齐
- [ ] 大结果 cap + 文件引用
- [ ] 可见性切片：worker 只读切片不读全量
- [ ] （可选）表单挂起 + resume
- [ ] 调度路径单一化，无平行 enqueue

---

# 测试矩阵（跨阶段）

## 单元

- Actor：session id builder / kind 校验
- session-store：`gworker` 白名单 + ephemeral 路由
- payload：`<worker-result>` / `<worker-error>` 分类与 XML 转义
- 路由：`parseMentions` 按 fromKind 分叉、`resolveRecipients` 顺序、楼层
- locks：`dispatchSlots` 上限、`acquireWithTimeout` 释放不变量

## 集成

- `run_worker` → worker 会话创建 → 结果交回
- 命名 agent：`loadAgent` → workflow 注入 → `dispatch_to` / `hand_off_to`
- 附件下传 → worker `read_file`
- abort 级联：主停止 → 子回合停止
- 并行 fan-out：3 worker 并发 + dispatchSlots 夹住

## 安全

- agent_id 段断言（防路径穿越）
- `run_worker` 目标禁止 `commander`/`user`
- worker 拿不到调度工具（无重入）
- 可见性：worker 不读全量历史

**原则（对齐 Agent / Skill 指南）：** 测不变量、恢复、并发、跨层契约、文本陷阱；不测纯 getter / 仅类型包装。

---

# 常见坑汇总

| # | 坑 | 正确做法 |
|---|-----|----------|
| 1 | 把子 Agent 当异步消息队列 | 进程内同步嵌套；结果就是工具结果 |
| 2 | worker 复用父 session | 每个 actor 独立 session（gworker/gmember） |
| 3 | dispatchSlots 里再拿 globalSlots | 嵌套运行独立额度，跳过全局槽防死锁 |
| 4 | 超时后不释放 acquirePromise | mutex 泄漏，下个调用永远拿不到 |
| 5 | abort 不级联 | 子 AbortController 链接父信号 |
| 6 | 给 worker 也注入调度工具 | 调度权只在指挥官；worker 无工具 → 无重入 |
| 7 | 结果回传用裸文本 | `<worker-result>` / `<worker-error aborted>` 机器可读 |
| 8 | 匿名 worker 进名册 | `kind:'worker'` 现场构造，不入册 |
| 9 | `hand_off_to` 后还综合一遍 | 交付型派发 endTurn，消灭冗余摘要 |
| 10 | 用展示名当 agent_id | 展示名 name 映射到不透明 id；提示标 internal read id |
| 11 | worker 首轮无上下文 | 可见切片 → `<group-chat-history>` 前缀重放 |
| 12 | 大结果全文进父上下文 | 落文件 + 引用路径 / 工具结果 cap |
| 13 | 为 worker 发明独立提示模板 | 复用 agent-in-group 模板 + workflow 注入 |
| 14 | worker 出错当成功 | `<worker-error>` 按失败/部分处理；`aborted` 不重试 |
| 15 | 把附件消息也折进当前 turn | 折叠跳过附件清单/图片字节/会话级索引——附件永远是独立回合 |
| 16 | 用户发消息就启动新回合 | 纯文本 user 折叠进当前 turn（工具循环边界）；让 agent 即时纠偏 |
| 17 | 嵌套子运行也给 `drainSteer` | 用户不能直接 @ worker；子运行没这钩子 |

---

# 建议节奏

| 阶段 | 参考天数 | 产出 |
|------|----------|------|
| S0 | 0.5 day | 概念过关（六条硬决策） |
| S1 | Day 1–3 | Actor → session kind → workflow → `run_worker` → `runNestedDispatch` → **🎉 子 Agent 闭环** → S1.8 中断引导 |
| S2 | Day 4–7 | agent.json、名册、路由、三派发工具、附件链 |
| S3 | Week 2+ | fan-out、错误语义、可见性、ledger、总线单一化 |

可与 Agent 指南第四阶段（工具目录/bash）与 Skill 指南并行；**S1.4/S1.5 依赖 Runner 与基础工具已可用**。

---

# 附录 A：Orkas 源码对照

| 主题 | 路径 |
|------|------|
| 嵌套派发（runNestedDispatch） | `src/main/features/group_chat/bus.ts` |
| 三派发工具（run_worker / dispatch_to / hand_off_to） | `src/main/features/group_chat/bus.ts`（`buildCommanderExtraTools`） |
| Actor / session builder / 名册 | `src/main/features/group_chat/state.ts` |
| 路由（@ 提及 / resolveRecipients / 楼层） | `src/main/features/group_chat/router.ts` |
| 可见性切片 | `src/main/features/group_chat/visibility.ts` |
| Session kind 白名单 / ephemeral | `src/main/model/core-agent/session-store.ts` |
| dispatchSlots | `src/main/util/locks.ts` |
| **中断引导 drainSteerInto** | `src/main/features/group_chat/bus.ts`（filter）+ `src/core-agent/src/agent/runner.ts`（foldSteer/terminalSteer 钩子） |
| Commander prompt（worker-error 语义） | `src/main/prompts/chat_commander.md` |
| agent-in-group 提示（worker 鸭子类型） | `src/main/prompts/chat_agent_in_group.md` |
| 群聊编排总览 | `docs/ARCHITECTURE.md` §7 |
| Session Kind / Actor 门控 | `docs/core-agent/11-session-kind-and-actors.md` |
| agent.json 规格素材 | `docs/agent/Agent智能体组成.md` |

---

# 附录 B：术语表

| 术语 | 含义 |
|------|------|
| 指挥官 | 主 Agent；唯一持有调度工具的 actor |
| 子 Agent | 被派发出去、跑独立 LLM 回合的 actor（命名 agent 或匿名 worker） |
| 匿名 worker | `run_worker` 不传 `to` 现场构造的临时子回合；不入册、无气泡 |
| 命名 agent | 有 `agent.json` 的角色；`@` 或派发工具指派 |
| 嵌套运行 | 子回合同步跑在父回合工具调用内，结果当工具结果交回 |
| gworker | 匿名 worker 的 session kind（短暂、local、7 天 GC） |
| gmember | 命名 agent 的 session kind（可恢复） |
| dispatchSlots | 嵌套调度并发信号量（默认 4） |
| **drainSteerInto** | 排空队列中可折叠的 user message，工具循环边界调用 |
| **interrupt-steer（G9）** | 用户在 actor 跑回合时发的纯文本消息被折进当前 turn；附件 / 非本 actor / 非 user 留在队列 |
| `<worker-result>` | 子回合成功回传负载 |
| `<worker-error aborted="true">` | 子回合中止回传负载 |
| 楼层 active_recipient | 无 `@` 时用户消息的默认收件人 |
| 名册 | 当前对话的 actor 名单（members.json） |

---

# 附录 C：给 AI 的阶段任务索引

按阶段粘贴给 AI 执行（每个阶段独立可验收）：

| 阶段 | 任务 |
|------|------|
| S1.1–S1.2 | Actor 类型 + session id builder；`gworker` 进 kind 白名单 + ephemeral 路由 |
| S1.3 | `WORKER_WORKFLOW` + worker 系统提示 builder |
| S1.4 | `run_worker` 工具（匿名分支）+ 只注入主会话 |
| S1.5–S1.7 | `runNestedDispatch`：abort 级联 + dispatchSlots + 复用 runStream |
| S1.6 | `<worker-result>` / `<worker-error>` 回传协议 |
| S1.8 | **中断引导**：`drainSteerInto` 四条过滤规则 + 工具循环/终末钩子 + 附件单独跑 |
| S2.1–S2.2 | agent.json 规格读取 + 名册 |
| S2.3 | `parseMentions` / `resolveRecipients` / 楼层 |
| S2.4–S2.5 | `dispatch_to` / `hand_off_to` / `run_worker(to)` |
| S2.6 | 附件沿调度链下传 |
| S3.1–S3.4 | fan-out、错误语义、大结果 cap、可见性切片 |
| S3.5–S3.6 | （可选）挂起编排；调度路径单一化 |
| 测试 | 本文「测试矩阵」 |

---

# 附录 D：S1 最小可运行脚本（自检）

```bash
# 1. 在 my-agent 主会话注入 run_worker 工具
# 2. 发一条任务：
#    "用 bash 统计当前目录文件数，原样回报"
# 3. 期望工具结果形如：

<worker-result from="Worker">
  共 42 个文件（含子目录）。
  <files>...</files>
</worker-result>

# 4. 检查 worker 会话文件已创建：
#    <data-root>/<uid>/local/sessions/gworker-<cid>-<wid>.jsonl
# 5. 主会话上下文里能看到 worker 的完整回复，且主会话 jsonl 与 worker 不是同一文件。
```

Runner 侧确认：`run_worker` 只出现在主会话工具列表；worker 会话不含调度工具。

# 附录 E：S1.8 中断引导自检脚本

```bash
# 1. 让主 Agent 跑一个长任务（比如 dispatch_to 命名 agent）
# 2. 在 agent 跑着的工具循环里，连续发两条消息：
#    (a) 纯文本："顺便帮我看下 /tmp 有什么大文件"     # 期望：被折叠进同一 turn 的下一轮 LLM 调用
#    (b) 带附件："分析这个 csv" + 一个 .csv 文件        # 期望：留在 queue，等当前 turn 跑完独立跑
# 3. 检查 agent 后续 LLM 调用的 prompt：
#    - (a) 已折进 user message 序列
#    - (b) 不在上下文里、单独一个回合处理（含 <attachments> 清单）
# 4. 检查日志：bus 写 'interrupt-steer: folding N queued user message(s)'
```

# 附录 F：常见 Q&A 索引

| 问题 | 章节 |
|------|------|
| 子 Agent 是异步还是同步？ | S0.3 #1 + #7 |
| 子 Agent 怎么把结果"交回"给主 Agent？ | S0.3 #6 + S1.6；handback 路径见 S3.5 |
| 子 Agent 跑着时用户能打断吗？ | S1.8 |
| 带附件的消息为什么单独跑？ | S1.8（"为什么带附件的用户消息要单独跑"） |
| 子 Agent 会被并发限制吗？ | S0.3 #3；S1.7 |
| worker 收尾会被清理吗？ | S0.3 #5；S1.7 |
| 编排账本（OrchestrationLedger）什么时候用？ | S0.3 #7；S3.5 |
| `run_worker` / `dispatch_to` / `hand_off_to` 怎么选？ | S2.4 + S2.5 |

---

**下一步：** 打开第三阶段已完成的 my-agent，从 **S1.1 Actor 类型** 开始仿写；每完成一节打勾 S1 总验收，再进入 S2。子 Agent 与 Skill 指南可并行推进——worker 会用技能时，两者就串起来了。
