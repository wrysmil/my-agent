# 子 Agent S1 核心闭环 — 执行调度

> **源 plan：** [subagent-implementation-plan.md](../specs/subagent-implementation-plan.md)  
> **阶段：** S1（核心闭环：`run_worker` → worker 独立回合 → `<worker-result>` 交回）  
> **平台：** Claude Code（`orchestration` skill → `dispatcher-workflow.md`）  
> **日期：** 2026-08-07

---

## 前置条件

- [x] spec 已批准（`subagent-implementation-plan.md` 在 specs/）
- [x] 用户已说「开始实现」（本消息：「根据这个文档进行任务编排然后实」）

## 执行图

### GROUP-1（并行 — 无依赖，3 个 WU）

```
WU-01: actor.ts 新建           ─┐
WU-02: session-store.ts 修改   ─┼─→ GROUP-1 并行
WU-03: workflow.ts 新建        ─┘
```

| WU | 描述 | 文件 | 依赖 | wu_type | agent_role |
|----|------|------|------|---------|------------|
| WU-01 | Actor 类型 + session id builder | `src/orchestration/actor.ts` (新) | 无 | feature | implementer |
| WU-02 | Session kind 增补 gworker | `src/storage/session-store.ts` (改) | 无 | feature | implementer |
| WU-03 | WORKER_WORKFLOW + buildWorkerSystemPrompt | `src/orchestration/workflow.ts` (新) | 无 | feature | implementer |

### GROUP-2（GROUP-1 完成后 — tools + dispatch 紧耦合，1 个 WU）

| WU | 描述 | 文件 | 依赖 | wu_type | agent_role |
|----|------|------|------|---------|------------|
| WU-04 | buildDispatchTools + run_worker + runNestedDispatch + withoutDispatchTools | `src/orchestration/tools.ts` (新) + `src/orchestration/dispatch.ts` (新) | WU-01, WU-02, WU-03 | feature | coder |

### GROUP-3（GROUP-2 完成后 — 集成 + 测试，1 个 WU）

| WU | 描述 | 文件 | 依赖 | wu_type | agent_role |
|----|------|------|------|---------|------------|
| WU-05 | 集成注入 + 单元测试 | `src/agent/runner.ts` (改) + `test/orchestration/` (新) | WU-01–WU-04 | feature | coder |

---

## WU 详细规格

### WU-01: actor.ts

**目标：** 创建 Actor 类型定义与 session id builder

**允许文件：**
- `src/orchestration/actor.ts`（新建）

**禁止：** 改其他任何文件

**Done criteria：**
- `ActorKind` 联合类型：`"commander" | "user" | "agent" | "worker"`
- `Actor` 接口：`{ kind, id, name? }`
- `COMMANDER_ID` / `USER_ID` 常量
- `buildGconvSessionId(cid)` → `gconv-{cid}`
- `buildGworkerSessionId(cid, workerId)` → `gworker-{cid}-{workerId}`
- `actorSessionId(cid, actor)` — 按 kind 路由到 session id（agent kind 抛错）
- `genWorkerId()` — 短 id 生成器（基于 Date.now() + 递增序号）

**Skills：** 无（纯数据结构 + 工具函数，Tier 0 级别）

**验证：** `npx tsc --noEmit` 通过

---

### WU-02: session-store.ts

**目标：** 在 SessionKind 系统中新增 `gworker` 类型

**允许文件：**
- `src/storage/session-store.ts`（修改）

**修改点：**
1. `EPHEMERAL_KINDS` 新增 `"gworker"`
2. `KNOWN_KINDS_RE` 新增 `gworker`（长前缀在前）→ `/^(gconv|gworker|cli|anon|extract)(?:-|$)/`
3. `SessionKind` 联合类型新增 `"gworker"`
4. `create()` 方法 kind 校验列表新增 `"gworker"`
5. `sessionKindOf()` 错误消息新增 gworker
6. 注释：补充 kind 语义对照表（`gworker` → 匿名 worker 回合，7 天 GC）

**禁止：** 改其他任何文件、修改 GC 逻辑（`sweepEphemeralSessions` 无需改动）

**Done criteria：**
- `isEphemeralSession("gworker-xxx-yyy")` → `true`
- `sessionKindOf("gworker-xxx-yyy")` → `"gworker"`
- `SessionStore.create("gworker")` 不抛错

**Skills：** 无（单文件小改）

**验证：** `npx tsc --noEmit` 通过

---

### WU-03: workflow.ts

**目标：** 创建匿名 worker 的分步程序常量与 system prompt 构建函数

**允许文件：**
- `src/orchestration/workflow.ts`（新建）

**内容：**
1. `WORKER_WORKFLOW` 常量 — 4 条规则（边界约束 / 无用户 / 结果完整 / 大工件落文件）
2. `buildWorkerSystemPrompt(params)` — 复用 `buildDefaultSystemPrompt` + 追加 Worker constraints

**禁止：** 改其他任何文件

**Done criteria：**
- `WORKER_WORKFLOW` 含 "ephemeral worker"、"no user"、"verbatim" 关键词
- `buildWorkerSystemPrompt()` 返回非空字符串，含 "Worker constraints" 段
- 不引入 `agent-in-group` 等群聊概念

**Skills：** 无（常量 + 简单函数）

**验证：** `npx tsc --noEmit` 通过

---

### WU-04: tools.ts + dispatch.ts

**目标：** 实现 `run_worker` 工具 + `runNestedDispatch` 核心调度引擎

**允许文件：**
- `src/orchestration/tools.ts`（新建）
- `src/orchestration/dispatch.ts`（新建）

**tools.ts 内容：**
1. `buildDispatchTools(opts)` — 构建调度工具集（当前仅 `run_worker`），返回 `AgentTool[]`
2. `run_worker` 工具：`executionMode: "parallel"`，`inputSchema: { task: string }`，execute 中动态 import dispatch
3. `withoutDispatchTools(tools)` — 过滤掉调度工具（`run_worker`, `dispatch_to`, `hand_off_to`）

**dispatch.ts 内容：**
1. `dispatchSlots` — `Semaphore(MY_AGENT_MAX_DISPATCH_CONCURRENCY ?? 4)`
2. `runNestedDispatch(opts)` — 核心嵌套调度函数：
   - abort 级联（子 AbortController 链接父 signal）
   - 构建 session id（`actorSessionId`）
   - 构建 system prompt（`buildWorkerSystemPrompt`）
   - 过滤工具（`withoutDispatchTools(BUILTIN_TOOLS)`）
   - 并发边界（`dispatchSlots.acquire()`）
   - 创建子 Session + 子 AgentRunner + 执行 `runner.run()`
   - 结果分类（`classifyWorkerOutcome`）
3. 辅助函数：
   - `buildWorkerTaskEnvelope` — `<task from="commander" to="...">` 信封
   - `classifyWorkerOutcome` — abort/error/success 三分支
   - `buildWorkerResultPayload` / `buildWorkerErrorPayload` — XML 回传协议
   - `escapeXml` — XML 转义

**关键适配（vs Orkas）：**
- 不走 `WorkerState` 注册表
- 不走 `runActorTurn` 间接层
- 子 Agent 不注入首轮重放/可见切片
- `getRunner()["config"]` 改为接收 `config` + `providers` 引用

**禁止：** 改其他任何文件；引入群聊概念；使用 `runStream`（S1 用 `run`，等信号量+同步交回）

**Done criteria：**
- `run_worker` 工具可在主 Runner 注册
- `withoutDispatchTools` 过滤后不含 `run_worker`
- `runNestedDispatch` 创建独立子 session
- 结果按 `<worker-result>` / `<worker-error>` XML 协议包装
- dispatchSlots 正确限制并发（Semaphore 非 Mutex）
- abort 信号正确级联

**Skills：** `source-driven-development`（Step 0 扫描 `src/agent/runner.ts`、`src/tools/base.ts`、`src/tools/builtin.ts`、`src/agent/session.ts`、`src/storage/locks.ts`）+ `incremental-implementation`

**验证：** `npx tsc --noEmit` 通过

---

### WU-05: 集成注入 + 单元测试

**目标：** 在 CLI 入口注入调度工具 + 编写覆盖 S1 全部模块的单元测试

**允许文件：**
- `src/agent/runner.ts`（可选修改：加 `addTool` 已存在，无需改动 runner 本身）
- `test/orchestration/actor.test.ts`（新建）
- `test/orchestration/dispatch.test.ts`（新建）
- `test/orchestration/tools.test.ts`（新建）

**runner.ts 策略：** 检查现有 `addTool` 方法和 constructor — 确认无需修改 Runner 核心，集成点在上层（CLI 入口）。S1 集成测试直接在测试文件中构造 Runner + addTool。

**测试覆盖：**

`actor.test.ts`：
- `actorSessionId` 各 kind 格式
- `genWorkerId` 连续调用不重复
- 非 worker/commander kind 抛错

`dispatch.test.ts`：
- `buildWorkerResultPayload` 含 `<worker-result from="...">`
- `buildWorkerErrorPayload` 含 `<worker-error>` + `aborted="true"`
- `classifyWorkerOutcome` 三分支
- `escapeXml` 转义正确性
- `withoutDispatchTools` 过滤后不含 `run_worker`

`tools.test.ts`：
- `run_worker` 工具在主 Runner 可用
- `run_worker` 工具在子 Runner 不可用
- dispatchSlots 上限测试（5 并发 → 第 5 个等待）

**禁止：** 改 Runner 核心逻辑（不做破坏性变更）

**Done criteria：**
- `npx tsc --noEmit` 通过
- `npx vitest run` 全部通过
- 新增测试文件 ≥ 3 个

**Skills：** `source-driven-development` + `test-driven-development`

**验证：** `npx tsc --noEmit && npx vitest run`

---

## 并发策略

```
GROUP-1 (并行, 3 WU):
  WU-01 ─┬─ 并行
  WU-02 ─┤
  WU-03 ─┘
         │
         ▼ (GROUP-1 全部完成)
GROUP-2 (1 WU):
  WU-04 ← 依赖 WU-01,02,03 的类型定义
         │
         ▼ (GROUP-2 完成)
GROUP-3 (1 WU):
  WU-05 ← 依赖 WU-01~04 全部代码
```

## 风险与回滚

- **循环依赖风险：** tools.ts ↔ dispatch.ts。对策：tools.ts 用 dynamic `import()` 打破循环
- **Runner 兼容：** `AgentRunner.run()` 返回 `AgentRunResult`（含 `text: string` + `meta`），子回合直接取 `result.text`
- **回滚：** 删除 `src/orchestration/` 目录 + 还原 `session-store.ts` 改动即可

## Next

用户确认后进入实现阶段：
1. WorktreeInit
2. GROUP-1 并行派发 3 个 implementer
3. GROUP-2 派发 1 个 coder
4. GROUP-3 派发 1 个 coder + test-engineer
5. 尾盘：collective-test + code-review
