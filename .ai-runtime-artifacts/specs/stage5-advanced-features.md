# 阶段5：高级特性 — 实现文档

> 基于 [仿写Agent框架指南](../../docs/spec/仿写Agent框架指南.md) 第五阶段，结合项目当前状态编写。
> 第五阶段模块**不要求全部做完**，按实际需求挑选。本项目定位为 CLI/学习型 Agent 框架，
> 因此在 Memory 作用域门控、多 Provider fallback、Skill 市场平台等方面做了适配性简化。

---

## 〇、总体现状

| 子模块 | 指南对应 | 本项目状态 | 代码位置 |
|---|---|---|---|
| 5.1 上下文压缩 | §5.1 | 🟡 **框架就绪 / 逻辑空壳** — 常量、类型、收敛检测全部就位，`prepareContextBeforeModelCall` 为 no-op stub | [runner.ts:1044-1054](../../src/agent/runner.ts#L1044) |
| 5.2 循环检测 | §5.2 | 🟢 **已完整实现** — 精确重复 + 近重复两级检测、签名算法、nudge 注入均在 `executeToolLoop` 中 | [runner.ts:1494-1565](../../src/agent/runner.ts#L1494) |
| 5.3 Memory 系统 | §5.3 | 🔴 **未实现** — 无 `cross_session_memory` 工具、无 `features/memory.ts`、无 § 分隔文件存储 | — |
| 5.4 Skill 系统 | §5.4 | 🟡 **部分实现** — loader + prompt 注入完成；`view_skill` 工具、触发匹配、编辑块解析缺失 | [src/skills/](../../src/skills/) |
| 5.5 执行计划 | §5.5 | 🟡 **部分实现** — Session 类型 + 基础 CRUD 完成；`manage_execution_plan` 工具、`replace_objective`、reconciliation 缺失 | [session.ts:196-577](../../src/agent/session.ts) |
| 5.6 多 Provider 轮转 | §5.6 | 🔴 **未实现** — 仅有基础 ProviderRegistry（前缀匹配路由），无 rotating-provider、冷却、首事件门控 | [registry.ts](../../src/providers/registry.ts) |

**优先级建议：** 5.2（已完成）→ 5.5（补齐工具）→ 5.1（补齐压缩逻辑 + 手动压缩命令）→ 5.4（补齐调用链路）→ 5.6 → 5.3

---

## CLI 菜单与命令集成

阶段5 的高级特性需要在两处用户界面中体现：**主菜单**（数字菜单）和**对话内命令**（`/` 前缀）。

### 当前主菜单（6 项）

```
🤖 My Agent — 主菜单
  ① 开始对话
  ② 加载历史对话
  ③ 设置模型提供商
  ④ 查看当前提供商
  ⑤ 子Agent管理
  ⑥ 退出
```

### 当前对话命令（`/help`）

```
/quit, /exit    退出
/clear          清空上下文（新建 session）
/save           显示当前 session ID
/tools          列出所有工具（按分组）
/skills         列出所有 Skill
/skill <id>     查看 Skill 详细内容
/mode [mode]    查看/切换 Bash 执行模式
/gc             手动清理过期工具结果
/help           显示此帮助
```

### 阶段5 新增命令映射

阶段5 引入的新能力需要三条新对话命令 + `view_skill` 工具注册：

| 新特性 | 对话命令 | 工具（模型可调用） | 说明 |
|---|---|---|---|
| 5.1 上下文压缩 | **`/compact`** | ❌ 不需要工具（Runner 内部） | 手动触发上下文压缩，显示前后 token 对比 |
| 5.4 Skill 调用 | **`/skill <id>`**（已有） | 🆕 **`view_skill`** 工具 | 已有 `/skill` 命令供用户查看；新增 `view_skill` 让模型也能在对话中加载 skill 指令 |
| 5.5 执行计划 | **`/plan`** | 🆕 **`manage_execution_plan`** 工具 | 查看当前执行计划状态；模型可通过工具更新计划 |
| 5.6 Provider 轮转 | **`/provider [name]`** | ❌ 不需要工具（基础设施层） | 查看/手动切换当前 provider；自动 fallback 对模型透明 |

### 更新后的 `/help` 输出

```
┌─────────────────────────────────────────────┐
│  /quit, /exit    退出                        │
│  /clear          清空上下文（新建 session）     │
│  /save           显示当前 session ID          │
│  /tools          列出所有工具（按分组）         │
│  /skills         列出所有 Skill               │
│  /skill <id>     查看 Skill 详细内容           │
│  /plan           查看当前执行计划              │
│  /compact        手动触发上下文压缩             │
│  /provider [name] 查看/切换 Provider           │
│  /mode [mode]    查看/切换 Bash 执行模式        │
│  /gc             手动清理过期工具结果           │
│  /help           显示此帮助                    │
└─────────────────────────────────────────────┘
```

### 主菜单是否扩展

主菜单保持 6 项不变。理由：
- 高级特性（压缩、执行计划、Provider 切换）是**对话内操作**，不是独立入口
- `view_skill` 是 LLM 工具，用户通过 `/skill` 命令直接查看
- 主菜单保持简洁，避免选项膨胀

### 对应 chat.ts 改动点

| 命令 | chat.ts 改动 |
|---|---|
| `/compact` | 新增 `case "/compact"` → `runner.compactNow()` → 输出 `🧹 压缩前: X tokens → 压缩后: Y tokens (节省 Z%)` |
| `/plan` | 新增 `case "/plan"` → `runner.getSession().getExecutionPlan()` → 格式化输出步骤列表 |
| `/provider [name]` | 新增 `case "/provider"` → 无参数时显示当前 provider 信息；有参数时切换（需确认） |
| `view_skill` 工具 | `chat.ts` 中实例化 `createViewSkillTool(skillLoader)` → `allTools.push()` + `registerCatalogEntry()` |

### 数字菜单序号逻辑

当前 `runMainMenu` 的 `switch` 按 `"1"`→`"start"`, `"2"`→`"history"`, ... `"6"`→`"quit"` 硬映射，新增选项需要修改 menu.ts：
- **本次不改 menu.ts**，高级能力全部走对话内 `/` 命令
- 如果后续需要拆出独立入口（如 "⑦ 高级设置"），再扩展

---

## 一、5.2 循环检测（已完整实现）

### 1.1 实现概述

循环检测在第二阶段 Runner 构建时一并完成，是本项目**最早落地的高级特性**。当前实现完整覆盖：

- **精确重复检测：** `toolCallSignature()` — 对 key 排序的 JSON 参数 + 工具名，`\x00` 分隔
- **近重复检测：** `normalizedToolCallSignature()` — 剥离 `request_id`/`timestamp` 等易变字段后签名
- **两级阈值：** `LOOP_WARN=3`（nudge）、`LOOP_HARD=5`（终止）；近重复 `NEAR_DUP_LOOP_WARN=6`
- **Nudge 注入：** 通过 `pendingRequestControls` 注入到下一轮 LLM 调用的请求控制消息中
- **收敛 Nudge：** `shouldNudgeSpinConvergence()` + `buildSpinConvergenceNudge()` — 压缩次数多时提示读盘

### 1.2 核心代码路径

```
executeToolLoop() (runner.ts:1461)
  ├─ 5a. 死循环检测 (L1494-1565)
  │   ├─ toolCallSignature(call) → 精确签名
  │   ├─ normalizedToolCallSignature(call) → 近重复签名
  │   ├─ LOOP_HARD 触发 → 立即终止，返回部分结果
  │   └─ LOOP_WARN / NEAR_DUP_LOOP_WARN → 注入 nudge
  ├─ 5g. 收敛 Nudge 检查 (L1838-1868)
  │   ├─ shouldNudgeToolLoopLimit() → 工具循环软上限提醒
  │   └─ shouldNudgeSpinConvergence() → 旋转收敛提醒
  └─ ...
```

### 1.3 与指南的差异

| 指南描述 | 本项目实现 | 说明 |
|---|---|---|
| 精确重复签名 `toolCallSignature` | ✅ 一致 — `stableToolInputJson` + WeakSet 防循环引用 + key 排序 | 直接移植自 Orkas |
| 近重复签名 `normalizedToolCallSignature` | ✅ 一致 — `stripVolatileArgs` + `VOLATILE_ARG_KEY_RE` | 直接移植自 Orkas |
| `LOOP_WARN=3`, `LOOP_HARD=5`, `NEAR_DUP_LOOP_WARN=6` | ✅ 一致 | 相同阈值 |
| 在 Runner 主循环的工具执行后比对 | ✅ 一致 — `executeToolLoop` 阶段 5a | 相同检测点 |
| nudge 只发一次 (`loopWarned`) | ✅ 一致 — `loopState.warnedForStreak` / `normState.warnedForStreak` | 防重复注入 |

**结论：** 循环检测模块无需额外工作，已完整实现且与指南一致。

---

## 二、5.5 执行计划管理（部分实现，需补齐工具层）

### 2.1 已建成

| 组件 | 状态 | 位置 |
|---|---|---|
| `ExecutionPlanStepStatus` 类型（`pending/in_progress/completed/blocked`） | ✅ | [session.ts:44-48](../../src/agent/session.ts#L44) |
| `ExecutionPlanStep` / `ExecutionPlanState` 类型 | ✅ | [session.ts:56-94](../../src/agent/session.ts#L56) |
| `getExecutionPlan()` / `ensureExecutionPlanAnchor()` | ✅ | [session.ts:403-426](../../src/agent/session.ts#L403) |
| `updateExecutionPlan()` 基本实现 | ✅ | [session.ts:437-450](../../src/agent/session.ts#L437) |
| `clearExecutionPlan()` | ✅ | [session.ts:457-459](../../src/agent/session.ts#L457) |
| Runner 提前完成拒绝（unfinished plan steps 检测） | ✅ | [runner.ts:1295-1310](../../src/agent/session.ts#L1295) |
| `unfinishedExecutionPlanStepLabels()` | ✅ | [runner.ts:534-541](../../src/agent/session.ts#L534) |

### 2.2 缺失项

#### 2.2.1 `manage_execution_plan` 工具（核心缺口）

Session 已有 `updateExecutionPlan()` / `clearExecutionPlan()`，但没有注册为模型可调用的工具。
模型目前**无法在对话中主动创建或更新执行计划**——Runner 只是在启动时惰性锚定了一个空计划。

**需要做的事：**

1. **新建 `src/tools/execution-plan.ts`**，实现 `createExecutionPlanTool(controller)`：
   - 工具名：`manage_execution_plan`
   - action：`update` / `clear`（不是 `create`/`add_steps` 等多个 op）
   - `update` action 含 `replace_objective` 布尔标志（仅在用户发出新指令时可用）
   - `plan` 数组：`{step: string, status: "pending"|"in_progress"|"completed"|"blocked"}`
   - 步骤上限 `maxItems: 12`，单步文本上限 `maxLength: 180`
   - `explanation` 可选字段，上限 500 字符

2. **Controller 接线：** 在 Runner 构造时将 `updateExecutionPlan` / `clearExecutionPlan` 桥接到工具实例：
   ```ts
   // runner.ts 构造器内
   const planTool = createExecutionPlanTool({
     update: (update) => this.session.updateExecutionPlan(update),
     clear: () => this.session.clearExecutionPlan(),
   });
   // 注入工具列表
   ```

3. **工具目录注册：** 在 [catalog.ts](../../src/tools/catalog.ts) 中新增：
   ```ts
   { name: "manage_execution_plan", group: "meta",
     summary: "Maintain durable milestones for long tasks." }
   ```

#### 2.2.2 `replace_objective` 安全校验

当前 `session.updateExecutionPlan` 是**无条件替换**。需要增加：

- **用户指令摘要追踪：** `objectiveUserMessageDigest` — 锚定时的用户文本摘要（hash 或前 N 字符）
- **`replace_objective` 校验：** 仅当 `latestUserDigest !== plan.updatedUserMessageDigest` 时允许
- **用户中途 steer 处理：** 追加新指令到 objective（`"[Newer user instruction — authoritative]\n\n<新文本>"`）

#### 2.2.3 Reconciliation 机制

当前 `updateExecutionPlan` **全量替换**步骤列表。需要增加：

- **步骤不可删除/重命名：** 同一条用户指令下，已有步骤的 `step` 文本必须原样保留
- **completed 不可回退：** 已完成步骤的 status 变更被拒绝
- **仅允许：** 更新 status + 追加新步骤

**实现策略（简化版）：** 本项目不实现完整的 `reconcileExecutionPlanSteps()`（Orkas 中最复杂的函数之一），
而是通过**工具 description 中的约束 prompt** 让模型自行遵守规则——这是"prompt 约束"代替"代码约束"的折中方案，适合学习框架的定位。

**但保留两条最低成本代码级校验（各 ~5 行），防止模型数据静默损坏：**
- **completed 不可回退：** `if (prev.status === "completed" && newStatus !== "completed") → reject`
- **步骤文本不可变：** `if (prev.step !== newStep) → reject`
- 其余约束（不可删除、不可重命名、不可跳过）走 prompt 约束。

#### 2.2.4 Reconciliation 提示注入

Runner 当前不做 reconciliation 提示注入。需要：

- 在 `getMessagesForModel()` 或 Runner 的消息构建阶段，
  比较 `latestUserDigest !== plan.updatedUserMessageDigest`
- 不相等时注入提示：
  > Reconciliation required: a newer user instruction exists.
  > The latest user message overrides this plan;
  > update or clear it before continuing substantive work.

#### 2.2.5 `.context.json` 侧车（已实现，无需额外工作）

**本项目与 Orkas 一致，已通过 `.context.json` 侧车持久化执行计划：**

- `persistent-session.ts:88-90`：构造时创建 `contextFile(ctxFile)` 侧车路径
- `persistent-session.ts:210`：`writeContextToDisk()` 序列化 `executionPlan: this.getExecutionPlan()`
- `persistent-session.ts:232-234`：`loadContextFromDisk()` 恢复 `executionPlan`
- `persistent-session.ts:402-417`：`updateExecutionPlan` / `clearExecutionPlan` 已 override 自动落盘

**结论：持久化层已完成，执行计划在 session 重载后自动恢复。实现路线图中删除此条。**

### 2.3 用户侧查看：`/plan` 命令

除了让模型通过工具管理计划，用户也需要在对话中随时查看当前执行计划。

```
👤 /plan
📋 当前执行计划 (2/5 完成)
────────────────────────────────────────────
  ✅ 1. 分析 src/ 目录结构
  ✅ 2. 识别所有 TypeScript 文件
  🔄 3. 统计代码行数和模块依赖关系
  ⏳ 4. 生成代码质量报告
  ⏳ 5. 输出重构建议
────────────────────────────────────────────
```

**实现（chat.ts）：**
```ts
case "/plan":
  const plan = runner.getSession().getExecutionPlan();
  if (!plan || plan.steps.length === 0) {
    console.log("📋 当前没有执行计划（模型尚未创建）\n");
  } else {
    const done = plan.steps.filter(s => s.status === "completed").length;
    console.log(`📋 当前执行计划 (${done}/${plan.steps.length} 完成)`);
    console.log("─".repeat(44));
    for (const step of plan.steps) {
      const icon = { pending: "⏳", in_progress: "🔄", completed: "✅", blocked: "🚫" }[step.status];
      console.log(`  ${icon} ${step.id}. ${step.step}`);
    }
    console.log("─".repeat(44) + "\n");
  }
  continue;
```

### 2.4 实现清单（优先级排序）

| # | 任务 | 预估代码量 | 难度 |
|---|---|---|---|
| 1 | 新建 `src/tools/execution-plan.ts` — `createExecutionPlanTool()` | ~120 行 | 中 |
| 2 | catalog.ts 注册 `manage_execution_plan` 条目 | ~3 行 | 低 |
| 3 | Runner 构造器接线 — controller → session 桥接 | ~10 行 | 低 |
| 4 | Session 增加 `replace_objective` 校验 + digest 追踪 | ~40 行 | 中 |
| 5 | Runner 增加 reconciliation 提示注入（`getMessagesForModel` 附近） | ~30 行 | 中 |
| 6 | chat.ts 新增 `/plan` 命令 | ~30 行 | 低 |

---

## 三、5.1 上下文压缩（框架就绪，需补齐压缩逻辑）

### 3.1 已建成

| 组件 | 状态 | 位置 |
|---|---|---|
| `CONTEXT_COMPACTION_SYSTEM_PROMPT` — 压缩专用 system prompt | ✅ | [runner.ts:248-257](../../src/agent/runner.ts#L248) |
| `CONTEXT_COMPACTION_TRIGGER_RATIO = 0.82` | ✅ | [runner.ts:135](../../src/agent/runner.ts#L135) |
| `MIN_COMPACTION_EPOCHS_PER_RUN = 3` | ✅ | [runner.ts:143](../../src/agent/runner.ts#L143) |
| `MIN_COMPACTION_SAVINGS_RATIO = 0.1` | ✅ | [runner.ts:160](../../src/agent/runner.ts#L160) |
| `CompactionControl` 类型（fingerprints, epochs, maxEpochs...） | ✅ | [runner.ts:262-271](../../src/agent/runner.ts#L262) |
| `compactionRunCaps()` — 从 toolLoops 计算压缩预算 | ✅ | [runner.ts:569-576](../../src/agent/runner.ts#L569) |
| `buildSpinConvergenceNudge()` — 旋转收敛提示 | ✅ | [runner.ts:474-489](../../src/agent/runner.ts#L474) |
| `shouldNudgeSpinConvergence()` | ✅ | [runner.ts:440-450](../../src/agent/runner.ts#L440) |
| Session `getPendingHistoryArchive()` | 🟡 | 返回 null（stub） |
| Session `applyHistorySummary()` | 🟡 | 空方法（stub） |
| Session `getPendingActiveCheckpoint()` | 🟡 | 返回 null（stub） |
| Session `applyActiveCheckpointSummary()` | 🟡 | 空方法（stub） |
| `prepareContextBeforeModelCall()` | 🟡 | no-op stub（注释 "Phase 4 实现"） |

### 3.2 缺失项

#### 3.2.1 `prepareContextBeforeModelCall` 实际逻辑

当前是空的 async generator（[runner.ts:1045-1054](../../src/agent/runner.ts#L1045)）。需要实现：

```
prepareContextBeforeModelCall():
  1. 第一层 — 历史摘要：
     candidate = session.getPendingHistoryArchive()
     if candidate && rawTokens > HISTORY_THRESHOLD (12K):
       summary = await summarizeContextMessages(candidate.messages)
       if savings >= minimumValidatedCompactionSavings(before):
         session.applyHistorySummary(summary.text, candidate.turnIds)
         yield compaction event
  2. 第二层 — 活动检查点：
     candidate = session.getPendingActiveCheckpoint()
     if candidate && tokens > ACTIVE_THRESHOLD (18K):
       summary = await summarizeContextMessages(candidate.messages)
       // shrink 循环：摘要超长则迭代压缩
       session.applyActiveCheckpoint(summary.text, epoch)
       yield compaction event
```

#### 3.2.2 `summarizeContextMessages` 方法

Runner 需要新增一个私有方法：用压缩专用 system prompt 调 LLM 生成摘要。
关键参数：`provider.complete()`（非流式）、`reasoning: "minimal"`。

#### 3.2.3 Session 侧压缩候选生成

- `getPendingHistoryArchive()` 需要实际返回已完成轮次的消息 + 估算 token 数
- `getPendingActiveCheckpoint()` 需要返回当前轮的工具调用/结果组 + token 估算
- `applyHistorySummary()` 需要用摘要文本替换旧轮次消息
- `applyActiveCheckpoint()` 需要用检查点替换当前轮的工具交互组

### 3.3 手动压缩命令：`/compact`

除了 Runner 在 token 超阈值时**自动触发**压缩，还需要支持用户**主动压缩**——通过对话中的 `/compact` 命令。

**动机：**

- 自动压缩的触发阈值是 82% 上下文窗口，用户可能在达到阈值前就感觉对话太长、响应变慢
- 用户完成一个大阶段后（如"好的，文件读写模块做好了"），可以手动压缩来释放上下文
- 手动压缩给用户**可见的控制感**——看到 token 从 50K 降到 8K，直观理解压缩效果

**命令设计：**

```
👤 /compact
🧹 上下文压缩中…
   📊 压缩前: ~52,340 tokens (128 条消息, 7 轮)
   📊 压缩后: ~8,120 tokens (摘要 1,200 tokens + 尾部 6,920 tokens)
   ✅ 节省 84.5% (44,220 tokens)
```

**实现要点：**

1. **Runner 新增 `compactNow()` 方法：**
   ```ts
   // runner.ts
   async compactNow(): Promise<CompactionResult> {
     const before = this.session.estimateModelTokens();
     // 强制执行一轮 prepareContextBeforeModelCall 的完整逻辑
     // 不论 token 是否达到自动阈值
     const summary = await this.summarizeContextMessages({...});
     this.session.applyHistorySummary(summary.text, candidate.turnIds);
     const after = this.session.estimateModelTokens();
     return { before, after, summary: summary.text };
   }
   ```

2. **chat.ts 新增 `/compact` case：**
   ```ts
   case "/compact":
     const result = await runner.compactNow();
     console.log(`🧹 上下文压缩完成`);
     console.log(`   📊 压缩前: ~${result.before.toLocaleString()} tokens`);
     console.log(`   📊 压缩后: ~${result.after.toLocaleString()} tokens`);
     const pct = ((1 - result.after / result.before) * 100).toFixed(1);
     console.log(`   ✅ 节省 ${pct}% (${(result.before - result.after).toLocaleString()} tokens)`);
     continue;
   ```

3. **防抖前提 — 需要重构 `CompactionControl` 作用域：** 当前 `CompactionControl` 在 `runner.ts:1140` 于 `runWithProvider` 内部创建，是 **per-run 局部变量**（经 `executeToolLoop` 传入），不是 Runner 类成员。`/compact`（两次 run 之间执行）无法访问该结构。**必须将 `CompactionControl`（至少 `attemptedFingerprints`）提升为 Runner 实例级字段**，`runWithProvider` 复用它；否则手动/自动压缩去重会失效，`/compact` 可对同一状态无限重复压缩。

4. **与自动压缩的关系：** `/compact` 执行后更新 `attemptedFingerprints`，自动压缩不会再对同一状态重复触发。两者共享提升后的 Runner 实例级 `CompactionControl`。

### 3.4 本项目适配策略

**简化项：**

| Orkas 特性 | 本项目处理 |
|---|---|
| `minimumValidatedCompactionSavings` = `max(64, min(6000, before*10%))` | 🟡 **计划保留** — 常量 `MIN_COMPACTION_SAVINGS_RATIO` 已定义，计算函数待实现 |
| 指纹防抖（`attemptedFingerprints`） | 🟡 **计划保留** — `CompactionControl` 类型已定义，需提升为 Runner 实例字段（见 §3.3 #3） |
| `claimCompactionCandidate()` 预算检查 | 🟡 **计划保留** — 类型已有 `maxEpochs`/`maxAttempts`，校验函数待实现 |
| 两层压缩（历史摘要 + 活动检查点） | ✅ 保留 — 核心架构 |
| 收敛 nudge 软提示 | ✅ 保留 — 已实现 |
| shrink 循环（活动检查点超长迭代压缩） | 🟡 **简化** — 最多 2 次 shrink，不实现完整的 `MAX_SHRINKS` 循环 |
| 历史摘要固定标题模板（Durable user goals...） | 🟡 **简化** — 使用简洁的中文提示模板 |
| `compactSession()` 旧版全会话压缩 | ❌ **跳过** — 本项目从一开始就有 turn-tracking |
| **🆕 手动压缩命令 `/compact`** | **本项目独有** — Orkas 无此功能；CLI 下用户可直接控制压缩时机 |

**实现优先级：** 在补齐 5.5（执行计划工具）之后再做压缩逻辑——执行计划能为压缩提供"已完成/未完成"的结构化信息，让摘要更准确。

---

## 四、5.4 Skill 系统（部分实现，需补齐调用链路）

### 4.1 已建成

| 组件 | 状态 | 位置 |
|---|---|---|
| `SkillSpec` / `SkillContent` 类型 | ✅ | [src/skills/types.ts](../../src/skills/types.ts) |
| `parseFrontmatter()` — YAML frontmatter 解析（轻量，不依赖 js-yaml） | ✅ | [src/skills/loader.ts:82-154](../../src/skills/loader.ts#L82) |
| `SkillLoader` — 目录扫描 + mtime 缓存 + 去重 | ✅ | [src/skills/loader.ts:189-320](../../src/skills/loader.ts#L189) |
| `buildAvailableSkillsBlock()` — `## Available skills` 块生成 | ✅ | [src/skills/prompt.ts](../../src/skills/prompt.ts) |
| 描述语言选择（`pickDescription`） | ✅ | [src/skills/types.ts:45-48](../../src/skills/types.ts#L45) |
| System prompt 中的 Skill 菜单注入 | ✅ | 通过 `system-prompt-builder.ts` 调用 `buildAvailableSkillsBlock` |

### 4.2 缺失项

#### 4.2.1 `view_skill` 工具（核心缺口）

模型需要能**主动调用工具获取 SKILL.md 正文**。当前 Skill 菜单注入到 system prompt 后，
模型知道"有哪些 skill 可用"，但**没有工具去加载完整指令**。

**需要做的事：**

1. **新建 `src/tools/view-skill.ts`**：
   ```ts
   // view_skill 工具 — 按需加载完整 SKILL.md 正文
   createViewSkillTool(loader: SkillLoader) → AgentTool
   ```
   - 工具名：`view_skill`
   - 参数：`id: string`（skill 的内部 read id）
   - 行为：`SkillLoader.load(spec)` → 返回 `spec.body`（完整指令正文）
   - 错误处理：id 不存在返回友好错误信息

2. **catalog.ts 注册：** `{ name: "view_skill", group: "meta", summary: "Load the full instructions for a skill by its internal read id." }`

3. **Runner 接线：** 在 Runner 构造时将 `view_skill` 注入工具列表

4. **⚠️ 同步改写 `src/skills/prompt.ts`：** 当前 skill 菜单块指示模型用 `read_file(<ROOT>/<id>/SKILL.md)` 加载指令（`prompt.ts:65-70`）。新增 `view_skill` 工具后必须同步改写该提示——改为 `view_skill(<id>)`，否则模型会收到两条矛盾的取指令路径。**此改动是实现前置条件，遗漏则模型行为不可预测。**

#### 4.2.2 触发匹配（可选）

指南中的 `triggers` 关键词匹配机制——当用户输入命中某个 skill 的 triggers 时，
系统提示"应当 invoke 这个 skill"。

**本项目策略：** 不实现自动触发匹配。skill 调用完全交给模型判断——模型在 system prompt 中
看到了 skill 菜单和描述，自行决定何时调用 `view_skill`。这避免了复杂的 NLP 匹配逻辑，
也更灵活。

#### 4.2.3 Skill 编辑块（不适用）

指南中的 `<<<skill-file path=...>...</skill-file>` 编辑块语法适用于 **skill 创作平台**，
本项目作为 CLI 学习框架，skill 文件由用户直接在文件系统中编辑，不需要 LLM 驱动的编辑块。

#### 4.2.4 Skill 指令执行

`view_skill` 返回完整指令后，模型应该：
1. 阅读指令正文
2. 按照指令步骤执行（使用现有工具 `read_file`、`write_file`、`bash` 等）
3. 不需要特殊的 "skill executor"——skill 指令就是给模型的自然语言步骤

**不需要做的事：**
- ❌ skill 沙箱（在子进程中隔离执行）— 这是 Orkas 的安全需求，CLI 框架不适用
- ❌ skill marketplace 浏览/安装 — 非本期需求
- ❌ skill 组件启用/禁用 UI — 非本期需求

### 4.3 实现清单

| # | 任务 | 预估代码量 | 难度 |
|---|---|---|---|
| 1 | 新建 `src/tools/view-skill.ts` — `createViewSkillTool()` | ~60 行 | 低 |
| 2 | catalog.ts 注册 `view_skill` 条目 | ~3 行 | 低 |
| 3 | Runner/cli 接线 — 实例化 SkillLoader → 注入 view_skill 工具 | ~15 行 | 低 |

---

## 五、5.6 多 Provider 轮转（重新设计）

> **与原指南的核心差异：** Orkas 的 `rotating-provider.ts` 面向「桌面应用 + 多 API key + 自动无感 fallback」场景。
> 本项目是 CLI 学习框架，用户通常只有 1-2 个 API key，场景完全不同。
> 因此**不做 Orkas 式的自动轮转**，改为**配置驱动的 fallback 链 + 对话内手动切换**。

### 5.1 设计理念

Orkas 的自动轮转有三个前提，本项目**不满足**：

| Orkas 前提 | 本项目现实 |
|---|---|
| 用户拥有多个不同 vendor 的付费 API key | 通常只有 1-2 个 key（如 DeepSeek + 可选 OpenAI） |
| 需要在 UI 中无感切换，用户不感知 | CLI 下用户就是操作者，手动切换完全可接受 |
| 需要冷却管理、归档标签改写等复杂状态 | 学习框架无需生产级 SLA 管理 |

**本项目的轮转应该是：简单、可见、用户可控。**

### 5.2 三层 Provider 策略

```
┌─────────────────────────────────────────────────────────────┐
│ 第 1 层：对话内手动切换  /provider [name]                     │
│   👤 用户主动操作，立即生效，下一轮对话使用新 provider          │
│   适用：DeepSeek 欠费了 → 切到 OpenAI 继续                    │
│                                                             │
│ 第 2 层：同 Provider 内 Model Fallback（自动、透明）           │
│   config.json 中每个 provider 配 fallbackModels 链            │
│   主模型不可用 → 自动尝试 fallback[0] → fallback[1]           │
│   适用：deepseek-chat 限流 → 自动降级到 deepseek-reasoner     │
│                                                             │
│ 第 3 层：启动时健康检查（自动、阻塞）                           │
│   开始对话前验证 provider 可达，不可达则提示切换                │
│   避免用户输入一大段后发现 API 不可用                           │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 配置设计

**⚠️ 关键纠正：** 项目运行时 provider 配置走 `providers-store.ts` 管理（`providers.json` 文件），
**不是** `config/schema.ts` 的 `ProviderConfigSchema`（config.json）。必须在 providers-store 侧扩展。

**`providers-store.ts` 的 `ProviderConfigEntrySchema` 扩展：**

```ts
// providers-store.ts — 当前 schema (仅支持 deepseek)
export const ProviderConfigEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  // 🆕 阶段5：放宽 type 约束，支持 deepseek | openai | anthropic | custom
  type: z.enum(["deepseek", "openai", "anthropic", "custom"]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().optional(),
  // 🆕 阶段5：同 provider 内模型 fallback 链
  fallbackModels: z.array(z.string()).max(5).optional(),
  // 🆕 阶段5：跨 provider fallback（指向另一个 provider 的 id）
  fallbackProvider: z.string().optional(),
});
```

**`providers.json` 示例（真实可运行形态）：**

```jsonc
{
  "version": 1,
  "activeProviderId": "deepseek",
  "providers": {
    "deepseek": {
      "id": "deepseek",
      "name": "DeepSeek",
      "type": "deepseek",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com",
      "defaultModel": "deepseek-chat",
      "enabled": true,
      // 仅包含支持 tools 的模型（deepseek-reasoner 不支持 tools，不放入 fallback 链）
      "fallbackModels": [],
      "fallbackProvider": "openai"
    },
    "openai": {
      "id": "openai",
      "name": "OpenAI",
      "type": "openai",
      "apiKey": "sk-yyy",
      "baseUrl": "https://api.openai.com",
      "defaultModel": "gpt-4o",
      "enabled": true,
      "fallbackModels": ["gpt-4o-mini"]
    }
  }
}
```

**注意：**
- `fallbackModels` 链必须**按 catalog 中 `supportsTools: true` 过滤**——当前 Runner 始终传 tool defs，不支持工具的模型（如 `deepseek-reasoner`）放入链会 API 报错
- `fallbackProvider` 指向另一个 provider 的 id，跨 provider 时需存在对应的 provider 类实现（如 `src/providers/openai.ts`，当前未实现，Week 4+ 待办）

### 5.4 `/provider` 命令设计

```
👤 /provider
📡 当前 Provider: deepseek (DeepSeek)
   Model: deepseek-chat
   Fallback 链: (无同 provider 备用模型)
   跨 Provider Fallback: openai
   状态: ✅ 正常

👤 /provider openai
⚠️  切换到 openai 需要重建 Agent 上下文。
   当前对话历史保留，但底层 provider 将变更。继续？(y/n)
👤 y
✅ 已切换至 openai (Model: gpt-4o)
   下一轮对话生效。
```

**实现要点（chat.ts）：**
- `/provider <name>` 调用 `store.setActiveProvider(name)` + 重建 AgentRunner（`/clear` 同款，[chat.ts:578-585](../../chat.ts#L578)）
- 重建时 `buildProviderRegistry` 改为遍历 store 全部 enabled provider 注册 factory（而非仅 active 一个）
- `runStream` 调用时显式传 `params.provider`（当前 chat.ts L642 不传，依赖 config 默认值 → 需改）
- 此命令与主菜单的"设置→切换"功能共享同一 `store.setActiveProvider`，两处保持一致

### 5.5 同 Provider 内 Model Fallback（自动）

> **与 Runner 重试的分层：** fallback 层在**未 commit（未产出可见内容）** 时按模型链切换，耗尽后将原始错误抛给 Runner。
> Runner 的 `runWithProvider` 重试循环（指数退避）作为**上层兜底**——fallback 层不管"是否可重试"，只按模型链切换。

```ts
// runner.ts — 包裹 provider.stream() 的模型 fallback
async function* streamWithModelFallback(
  provider: LLMProvider,
  modelId: string,
  fallbackModels: string[],  // 已预先过滤 supportsTools
  params: StreamParams,
): AsyncIterable<StreamEvent> {
  const chain = [modelId, ...fallbackModels];
  let lastError: unknown;
  let committed = false;

  for (const model of chain) {
    try {
      const stream = provider.stream({ ...params, model });
      for await (const ev of stream) {
        // 只有 start/content_block_start 是前导事件 — 未 commit
        // 首个非前导事件 = commit 点，此后失败不 fallback
        if (ev.type !== "start" && ev.type !== "content_block_start") {
          committed = true;
        }
        yield ev;
      }
      return; // 成功
    } catch (err) {
      lastError = err;
      if (committed) throw err;  // 已 commit → 不 fallback
      // 未 commit + rate-limit 错误 → 尝试下一个 model
      // 401/403 不在此层处理——同 provider 内所有 model 共享 API key，认证错误不会因换 model 解决
      if (!isRateLimitError(err)) throw err;
      // 继续尝试下一个 model
    }
  }
  throw lastError;  // 链耗尽，原样抛给 Runner 的上层重试循环
}
```

**关键设计决策：**

| 决策 | 理由 |
|---|---|
| fallback 仅覆盖未 commit 阶段 | 已产出可见内容后轮换 = 丢失/重复输出，比失败更糟 |
| 401/403 **不**走同 provider model fallback | 同 provider 所有 model 共享 API key，认证错误不会因换 model 解决；需跨 provider fallback 才能处理 |
| 429/quota_exceeded 走 model fallback | rate-limit 可能按 model 粒度，换 model 可能绕过 |
| 链耗尽后原样抛给 Runner | Runner 的 `runWithProvider` 有独立的指数退避重试（`runner.ts:1391`），fallback 层不做重试 |
| `fallbackModels` 必须过滤 `supportsTools` | 项目 Runner 始终传 tool defs（`runner.ts:1213`），不支持工具的模型会报错 |
| fallback 层不覆盖 `summarizeContextMessages` | 压缩摘要用 `provider.complete()` 直接调用（5.1 压缩逻辑），当前阶段仅包裹 `stream()`；此为已知缺口，Week 3 压缩实现时处理 |

### 5.6 跨 Provider Fallback（可选，Week 4+）

当前项目仅实现了 `DeepSeekProvider`。若需支持 `fallbackProvider: "openai"`，需额外工作：

1. 新建 `src/providers/openai.ts`（约 150 行，OpenAI 兼容接口）
2. `buildProviderRegistry()` 遍历 `store.listEnabled()` 注册全部 provider factory（非仅 active）
3. `streamWithModelFallback` 扩展为支持跨 provider 候选链（`RotatingCandidate[]`）

**当前阶段暂不实现跨 provider fallback**——`fallbackProvider` 字段预留，Week 4 先完成同 provider 内 model fallback + `/provider` 手动切换。

### 5.7 启动时健康检查

改用已有的 `provider.validateAuth()`（`providers/base.ts:60`）——零 token 成本：

```ts
// deepseek.ts:80-90 — GET /models，10s 超时，零 token 开销
async validateAuth(): Promise<boolean> {
  const res = await fetch(`${this.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${this.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  return res.ok;
}
```

在 `chat.ts` 入口惰性调用（首轮对话前 best-effort 检查），失败时提示但不阻塞进入对话。

### 5.8 实现清单

| # | 任务 | 预估代码量 | 难度 |
|---|---|---|
| 1 | `providers-store.ts` — 扩展 `ProviderConfigEntrySchema`（放宽 type + 加 fallback 字段） | ~8 行 | 低 |
| 2 | `chat.ts:buildProviderRegistry()` — 遍历全部 enabled provider 注册 factory（非仅 active） | ~15 行 | 中 |
| 3 | Runner 新增 `streamWithModelFallback()` — 同 provider 内 model 链式尝试（含 tools 过滤） | ~100 行 | 中 |
| 4 | `chat.ts` — 新增 `/provider` 命令（查看 + 切换 + 重建 runner） | ~60 行 | 中 |
| 5 | `chat.ts` — 启动健康检查（惰性 `validateAuth()`） | ~25 行 | 低 |

**总计：~208 行**（相比 Orkas rotating-provider 的 ~750 行，减少 72%）。
**暂不实现（Week 4+）：** `src/providers/openai.ts`（~150 行）、跨 provider 候选链（~50 行装配）。

---

## 六、5.3 Memory 系统（未实现，最低优先级）

### 6.1 现状

完全未实现。无 `cross_session_memory` 工具、无 `features/memory.ts`、无 § 分隔文件存储。

### 6.2 本项目适配策略

Memory 系统在 Orkas 中是**跨会话的 agent 注释系统**——模型可以将用户偏好、项目约定、
决策教训记录到 § 分隔的 markdown 文件中，在后续会话的 system prompt 中自动注入。

**本项目（CLI 学习框架）中 Memory 的简化：**

| Orkas 特性 | 本项目处理 |
|---|---|
| 四个作用域（user/shared/agent/project） | 🟡 **简化** — 仅保留 `user` 和 `shared` 两个作用域；无 agent/project 隔离需求 |
| 作用域门控（commander 可写 project，子 agent 只读） | ❌ **跳过** — 单用户 CLI 无多 agent 权限模型 |
| `§` 分隔条目流 + 字符/条目双上限 | ✅ **保留** — 核心存储格式，简单可靠 |
| 三层注入扫描（prompt-injection/exfiltration/invisible-unicode） | 🟡 **保留前提条件：工具不在不可信上下文中暴露** — 本项目 CLI 工具仅供本地使用，注入风险极低；但仍保留基础的正则扫描作为良好实践 |
| LIFO 驱逐（从前面删最旧） | ✅ **保留** |
| 原子保存（tmp + rename） | ✅ **保留** — 复用 `storage/paths.ts` 中的 `writeTextAtomicSync` |
| 启动期注入（`formatForSystemPrompt`） | ✅ **保留** — 空 memory 零 token 开销 |
| 导入解析（自由文本→条目分类） | ❌ **跳过** — 交互式 UI 功能，CLI 不适用 |
| `memoryScopeForSession()` 会话类型门控 | ❌ **跳过** — 单会话模式 |

### 6.3 实现清单（最低优先级）

| # | 任务 | 预估代码量 | 难度 |
|---|---|---|---|
| 1 | 新建 `src/memory/store.ts` — 基于 § 分隔符的条目 CRUD | ~200 行 | 中 |
| 2 | 新建 `src/memory/injection-scan.ts` — 三层正则扫描 | ~40 行 | 低 |
| 3 | 新建 `src/tools/memory-tool.ts` — `cross_session_memory` 工具 | ~120 行 | 中 |
| 4 | 新建 `src/memory/system-prompt.ts` — `formatForSystemPrompt()` 注入块 | ~50 行 | 低 |
| 5 | catalog.ts 注册 `cross_session_memory` 条目 | ~3 行 | 低 |
| 6 | Runner 接线 — tool 注入 + system prompt 注入 | ~20 行 | 低 |

---

## 七、实现路线图

```
阶段5 路线图（按优先级排列）：

Week 1 ─ 补齐 5.5 执行计划 + CLI 命令
         ├─ createExecutionPlanTool (120行)      [P0]
         ├─ catalog 注册 + Runner 接线            [P0]
         ├─ /plan 命令 (30行)                     [P0]
         └─ replace_objective 校验 + digest       [P1]

Week 2 ─ 补齐 5.4 Skill 调用链路
         ├─ createViewSkillTool (60行)            [P0]
         ├─ catalog 注册 + Runner 接线            [P0]
         └─ (用户侧 /skill 命令已有)              [已完成]

Week 3 ─ 补齐 5.1 上下文压缩 + 手动压缩
         ├─ 前置重构：CompactionControl 提升为 Runner 实例字段
         ├─ prepareContextBeforeModelCall 实际逻辑   [P1]
         ├─ summarizeContextMessages                [P1]
         ├─ Session 压缩候选生成                     [P1]
         └─ /compact 命令 + compactNow() 方法       [P0]
         (注：Week 3 不硬依赖 Week 1——执行计划对压缩是"质量增强"，非阻塞条件)

Week 4 ─ 补齐 5.6 Provider 轮转（重新设计版）
         ├─ providers-store schema 扩展 (8行)        [P1]
         ├─ streamWithModelFallback + tools 过滤      [P1]
         ├─ /provider 命令 + runner 重建 (60行)       [P1]
         └─ 启动健康检查 (validateAuth, 25行)         [P2]
         (暂不实现：跨 provider fallback / OpenAI provider 类)

Week 5+ ─ 可选
         └─ 5.3 Memory 系统                       [P3] — 需要跨会话记忆时
```

**已完成：**
- ✅ 5.2 循环检测 — 全部完成，无需额外工作

### 各批次 CLI 命令就绪时间

| 批次 | 新增命令 | 就绪时间 | 备注 |
|---|---|---|---|
| Week 1 | `/plan` | 5.5 工具实现后 | 依赖 Session 已有 executionPlan |
| Week 2 | `view_skill` 工具（模型调用） | 5.4 工具实现后 | **前置：需同步改写 `prompt.ts`**（去掉 read_file 指引） |
| Week 3 | `/compact` | 5.1 压缩逻辑实现后 | **前置：CompactionControl 提升为 Runner 实例字段** |
| Week 4 | `/provider [name]` | 5.6 provider 切换实现后 | 与主菜单"设置→切换"共享 `store.setActiveProvider` |

---

## 八、与本项目定位的关键差异总结

| 设计决策 | Orkas（桌面应用） | 本项目（CLI 学习框架） |
|---|---|---|
| 压缩触发 | Runner 自控（token 阈值 82%） | Runner 自控 **+ `/compact` 手动触发** |
| 循环检测 | Runner 自控（签名比对） | 同 Orkas |
| Memory 作用域 | 4 层（commander/worker/agent/project） | 2 层（user/shared），无多 agent |
| Skill 来源 | marketplace + custom + builtin | custom + builtin（无 marketplace） |
| Skill 调用 | 触发匹配 → `view_skill` 工具 | `/skill <id>` 命令（用户）+ `view_skill` 工具（模型） |
| 执行计划持久化 | `.context.json` 侧车 | `.context.json` 侧车（已实现，与 Orkas 一致） |
| 执行计划查看 | 无 CLI 命令 | `/plan` 命令查看当前步骤 |
| **Provider 轮转** | **多 provider 自动 fallback + 冷却管理 + 首事件门控** | **providers-store 扩展 fallback 链 + `/provider` 手动切换 + validateAuth 健康检查** |
| Provider 轮转代码量 | ~750 行（rotating + auth-error + cooldown） | ~208 行（providers-store + streamWithModelFallback + /provider 命令）；跨 provider fallback 待 Week 4+ |
| Provider 配置位置 | config 层（`LLMProvider` 实例工厂） | **providers-store**（`providers.json`）——纠正：非 config.json |
| 工具审批闭环 | IPC → renderer 对话框 | 环境变量 `TOOL_EXEC_MODE` 控制 |

### 阶段5 新增 CLI 命令汇总

| 命令 | 所属模块 | 功能 |
|---|---|---|
| `/plan` | 5.5 执行计划 | 查看当前执行计划步骤及状态 |
| `/compact` | 5.1 上下文压缩 | 手动触发上下文压缩，显示节省量 |
| `/provider [name]` | 5.6 Provider 轮转 | 查看/切换当前 LLM provider |
| `view_skill` 工具 | 5.4 Skill 系统 | 模型在对话中按需加载 skill 指令 |
