---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/specs/stage5-advanced-features.md
skills:
  - orchestration
skills_evidence:
  - .claude/skills/orchestration/SKILL.md
source:
  - core/orchestration/dispatcher-workflow.md
  - core/orchestration/skill-preferences.md
created_at: 2026-08-07
---

# Stage 5 高级特性 — Harness 执行图

> 实施步骤以 spec (`stage5-advanced-features.md`) 为准；本文件描述并行 GROUP / WU 与派发。
> 基于 Explore agent 代码基线分析（2026-08-07），文件路径以下表为准。

## 文件路径纠正

spec 文档中 `src/providers/providers-store.ts` 实际路径为 **`src/storage/providers-store.ts`**。以下 WU 描述均使用正确路径。

## 执行图

### GROUP-1（并行，非重叠文件）

```
GROUP-1:
  WU-01: 新建 execution-plan + view-skill 工具文件
    | 文件: src/tools/execution-plan.ts (NEW), src/tools/view-skill.ts (NEW)
    | 依赖: 无
    | wu_type: feature
    | agent_role: coder
    | wu_skills: incremental-implementation, test-driven-development, verification-before-completion

  WU-02: 修改 prompt.ts + providers-store.ts + catalog.ts
    | 文件: src/skills/prompt.ts, src/storage/providers-store.ts, src/tools/catalog.ts
    | 依赖: 无
    | wu_type: feature
    | agent_role: coder
    | wu_skills: incremental-implementation, verification-before-completion

  WU-03: 修改 session.ts（执行计划增强 + 压缩候选桩）
    | 文件: src/agent/session.ts
    | 依赖: 无
    | wu_type: feature
    | agent_role: coder
    | wu_skills: incremental-implementation, verification-before-completion
```

### GROUP-2（串行，依赖 GROUP-1 全部完成）

```
GROUP-2:
  WU-04: 修改 runner.ts（全部模块接线：5.5+5.4+5.1+5.6）
    | 文件: src/agent/runner.ts
    | 依赖: WU-01, WU-02, WU-03
    | wu_type: feature
    | agent_role: coder
    | wu_skills: incremental-implementation, verification-before-completion
```

### GROUP-3（串行，依赖 GROUP-2）

```
GROUP-3:
  WU-05: 修改 chat.ts（CLI 命令 + 工具接线）
    | 文件: chat.ts
    | 依赖: WU-04
    | wu_type: feature
    | agent_role: coder
    | wu_skills: incremental-implementation, verification-before-completion
```

---

## WU 详情

### WU-01: 新建工具文件（5.5 execution-plan + 5.4 view-skill）

**目标**: 创建两个新的工具定义文件

**范围**:

1. **`src/tools/execution-plan.ts`** (~120 行, NEW)
   - 实现 `createExecutionPlanTool(controller)` 工厂函数
   - 工具名: `manage_execution_plan`
   - 参数: `action: "update"|"clear"`, `plan` (maxItems:12, step maxLength:180), `replace_objective` (boolean), `explanation` (maxLength:500)
   - handler: 调用 controller 桥接方法
   - 参考 spec §2.2.1 完整参数定义

2. **`src/tools/view-skill.ts`** (~60 行, NEW)
   - 实现 `createViewSkillTool(loader: SkillLoader)` 工厂函数
   - 工具名: `view_skill`
   - 参数: `id: string` (skill 的 internal read id)
   - handler: `loader.load(spec)` → 返回 `spec.body`
   - id 不存在时返回友好错误信息
   - 参考 spec §4.2.1

**禁止**: 修改其他现有文件；不要在 runner/catalog 中注册

**Done criteria**:
- 两个文件类型检查通过
- 工具定义符合 `AgentTool` 接口
- 错误处理完善（无效 id / 无效 action）

---

### WU-02: 修改 prompt.ts + providers-store.ts + catalog.ts

**目标**: 修复 skill prompt、扩展 provider schema、新增两个工具目录条目

**范围**:

1. **`src/skills/prompt.ts`** (~5 行改动)
   - 行 65: 将 `read_file(<ROOT>/<id>/SKILL.md)` 改为 `view_skill(<id>)`
   - 行 66-69: 同步改写 ROOT 相关指引 — 去掉文件路径拼接说明，改为"使用 view_skill 工具加载 skill 完整指令"
   - ⚠️ **必须同步改写**，否则模型收到两条矛盾的取指令路径
   - 参考 spec §4.2.1 #4

2. **`src/storage/providers-store.ts`** (~8 行改动)
   - 行 13: `type: z.literal("deepseek")` → `type: z.enum(["deepseek", "openai", "anthropic", "custom"])`
   - schema 中新增可选字段: `fallbackModels: z.array(z.string()).max(5).optional()`, `fallbackProvider: z.string().optional()`
   - `defaultProvidersConfig()` 中 deepseek 条目补 `fallbackModels: []` 字段
   - 参考 spec §5.3

3. **`src/tools/catalog.ts`** (在 CATALOG 数组末尾 `];` 前追加, ~6 行)
   - 新增 `manage_execution_plan` 条目: `{ name: "manage_execution_plan", group: "meta", summary: "Maintain durable milestones for long tasks." }`
   - 新增 `view_skill` 条目: `{ name: "view_skill", group: "meta", summary: "Load the full instructions for a skill by its internal read id." }`
   - 参考 spec §2.2.1 #3 + §4.2.1 #2

**禁止**: 修改 runner.ts / session.ts / chat.ts / 新建文件

**Done criteria**:
- 类型检查通过
- `buildAvailableSkillsBlock` 输出不再包含 read_file 文件路径指引
- providers-store schema 接受 openai/anthropic/custom 类型
- catalog 注册两个新条目

---

### WU-03: 修改 session.ts（执行计划增强 + 压缩候选桩）

**目标**: 补齐 Session 侧执行计划安全校验 + 上下文压缩候选方法

**范围**:

1. **`replace_objective` 校验 + digest 追踪** (~40 行)
   - `ExecutionPlanState` 新增 `updatedUserMessageDigest?: string` 字段
   - `updateExecutionPlan()` 增加 `replace_objective` 校验:
     - 仅当 `latestUserDigest !== plan.updatedUserMessageDigest` 时允许替换 objective
   - 两条最低成本代码级校验（spec §2.2.3）:
     - `completed` 不可回退: `if (prev.status === "completed" && newStatus !== "completed") → reject`
     - 步骤文本不可变: `if (prev.step !== newStep) → reject`
   - 参考 spec §2.2.2 + §2.2.3

2. **压缩候选方法实现** (~80 行)
   - `getPendingHistoryArchive()`: 返回已完成轮次的消息 + 估算 token 数（当前 stub 返回 null）
   - `applyHistorySummary(summary, turnIds)`: 用摘要文本替换旧轮次消息
   - `getPendingActiveCheckpoint()`: 返回当前轮工具调用/结果组 + token 估算
   - `applyActiveCheckpointSummary(summary, epoch)`: 用检查点替换当前轮工具交互组
   - 参考 spec §3.2.3

**禁止**: 修改 runner.ts / chat.ts

**Done criteria**:
- 类型检查通过
- updateExecutionPlan 拒绝 completed→非completed 回退
- updateExecutionPlan 拒绝步骤文本变更
- getPendingHistoryArchive 不再恒返回 null

---

### WU-04: 修改 runner.ts（全部模块集成接线）

**目标**: 在 Runner 中完成 5.5/5.4/5.1/5.6 全部后端接线

**范围**:

1. **5.5 执行计划接线** (~10 行)
   - 构造器内: 从 opts 接收 `executionPlanController`，实例化 `createExecutionPlanTool(controller)` → `this.addTool()`
   - `getMessagesForModel()` 附近: reconciliation 提示注入（比较 `latestUserDigest !== plan.updatedUserMessageDigest`）
   - 参考 spec §2.2.1 #2 + §2.2.4

2. **5.4 Skill 接线** (~5 行)
   - 构造器内: 从 opts 接收 `skillLoader`，实例化 `createViewSkillTool(loader)` → `this.addTool()`
   - 参考 spec §4.2.1 #3

3. **5.1 上下文压缩** (~250 行)
   - **前置重构**: `CompactionControl` 提升为 Runner **实例字段**（从 `runWithProvider` 局部变量移出）
     - 新增私有字段 `compactionControl: CompactionControl`
     - `runWithProvider` 内复用它而非每次新建
   - 实现 `prepareContextBeforeModelCall()` 实际逻辑（替换行 1045-1054 的 no-op stub）:
     - 第一层历史摘要（HISTORY_THRESHOLD=12K）→ `summarizeContextMessages()`
     - 第二层活动检查点（ACTIVE_THRESHOLD=18K）→ shrink 循环（最多 2 次）
   - 新增 `summarizeContextMessages()` 私有方法: 用 `CONTEXT_COMPACTION_SYSTEM_PROMPT` 调 LLM 生成摘要
   - 新增 `compactNow()` 公开方法: 强制执行压缩（供 `/compact` 命令调用）
     - 返回 `{ before: number, after: number, summary: string }`
     - 更新 `attemptedFingerprints`
   - 新增 `minimumValidatedCompactionSavings(before)` 计算函数
   - 参考 spec §3.2.1 + §3.2.2 + §3.3

4. **5.6 Provider Fallback** (~120 行)
   - 新增 `streamWithModelFallback()` 私有方法:
     - 模型链: `[modelId, ...fallbackModels]`（fallbackModels 已由调用方过滤 supportsTools）
     - commit 点检测: 首个非 start/content_block_start 事件后 `committed = true`
     - 未 commit + rate-limit 错误 → 尝试下一个 model
     - 401/403 不在此层处理，直接抛给上层
     - 链耗尽后原样抛给 Runner 重试循环
   - `runWithProvider` 中: 获取 `fallbackModels` 配置 → 过滤 supportsTools → 包裹 `provider.stream()` 调用
   - 参考 spec §5.5

**禁止**: 修改 chat.ts

**Done criteria**:
- 类型检查通过
- CompactionControl 为 Runner 实例字段（非局部变量）
- compactNow() 可被外部调用
- streamWithModelFallback 正确处理 commit 点与 rate-limit 错误
- 所有新增工具通过 addTool() 注入

---

### WU-05: 修改 chat.ts（CLI 命令 + 工具接线）

**目标**: 在 CLI 入口中集成 Stage 5 全部用户可见功能

**范围** (~150 行):

1. **工具注入** (~25 行)
   - 实例化 `createExecutionPlanTool({ update, clear })` → `allTools.push()`
   - 实例化 `createViewSkillTool(skillLoader)` → `allTools.push()`
   - catalog 注册已在 WU-02 完成，此处仅 push 到 allTools + runner.addTool()
   - ⚠️ **修复 `/clear` 缺陷**: `/clear` 重建 runner 后重新注入调度工具（参考 Explore agent 发现的 bug）

2. **`/plan` 命令** (~30 行, spec §2.3)
   - 新增 `case "/plan"`:
     - `runner.getSession().getExecutionPlan()` → 格式化输出步骤列表
     - 无计划时显示 "📋 当前没有执行计划"
     - 有计划时显示: 标题 + 进度 (N/M 完成) + 步骤列表（✅/🔄/⏳/🚫 图标）

3. **`/compact` 命令** (~35 行, spec §3.3)
   - 新增 `case "/compact"`:
     - `await runner.compactNow()` → 输出压缩前后 token 对比
     - 格式: `🧹 压缩前: X tokens → 压缩后: Y tokens (节省 Z%)`

4. **`/provider [name]` 命令** (~60 行, spec §5.4)
   - 无参数: 显示当前 provider 信息（名称、model、fallback 链、状态）
   - 有参数: 确认后切换 `store.setActiveProvider(name)` + 重建 runner（同 `/clear`）

5. **`/help` 更新** (~10 行, spec §CLI 菜单与命令集成)
   - 在 `showHelp()` 中新增 `/plan`, `/compact`, `/provider [name]` 三条

6. **启动健康检查** (~25 行, spec §5.7)
   - 首轮对话前惰性 `provider.validateAuth()` best-effort 检查
   - 失败时提示但不阻塞

**禁止**: 修改 src/ 下任何文件

**Done criteria**:
- 类型检查通过
- `/plan` 正确显示执行计划（含空计划情况）
- `/compact` 触发压缩并显示 token 节省
- `/provider` 无参显示信息、有参可切换
- `/help` 包含三条新命令
- `/clear` 后调度工具正常工作

---

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿：5 WU，3 GROUP，基于 spec + Explore agent 代码基线 |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅
- 实现完成后 → 尾盘：`npm run check && npm test` → collective-test + code-review
