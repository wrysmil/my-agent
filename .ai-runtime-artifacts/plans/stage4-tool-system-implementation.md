# 阶段4：工具系统 — 实现文档

> 基于 [仿写Agent框架指南](../../docs/spec/仿写Agent框架指南.md) 第四阶段，结合项目当前状态编写。
> 本项目的工具系统定位为 **CLI/学习型 Agent 框架**（非 Orkas Electron 桌面应用），
> 因此在权限门控、IPC 审批闭环、TCC 敏感路径等方面做了大幅简化。

---

## 一、现状分析

### 1.1 已建成模块（可直接复用/小改）

| 模块 | 文件 | 状态 |
|---|---|---|
| 工具抽象层 | [src/tools/base.ts](../../src/tools/base.ts) (83行) | ✅ 完整 — `AgentTool`, `ToolContext`, `ToolResult`, `defineTool()` |
| 内置工具集 | [src/tools/builtin.ts](../../src/tools/builtin.ts) (595行) | ✅ 完整 — 8 个工具：`read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `grep_files`, `bash`, `web_fetch` |
| 路径沙箱 | [src/storage/path-sandbox.ts](../../src/storage/path-sandbox.ts) (47行) | ✅ 有基础门控 — `guardPath()` + `isPathAllowed()`，但缺少敏感路径检查 |
| AgentRunner | [src/agent/runner.ts](../../src/agent/runner.ts) (1878行) | ✅ 完整 — 已含工具执行循环、死循环检测、收敛控制、压缩框架 |
| System Prompt 构建 | [src/prompts/system-prompt-builder.ts](../../src/prompts/system-prompt-builder.ts) (357行) | ✅ 完整 — 模板组装 + 缓存友好拆分 |
| 调度工具 | [src/orchestration/tools.ts](../../src/orchestration/tools.ts) (255行) | ✅ 完整 — `run_worker`, `dispatch_to`, `hand_off_to` |

### 1.2 项目中已屏蔽/不适用的 Orkas 功能

以下 Orkas 特性在**本项目（CLI 学习框架）中不需要**，对应的实现省略：

| Orkas 特性 | 本项目处理 |
|---|---|
| IPC 审批闭环 (`requestBashDecision` → renderer 对话框) | **省略** — CLI 环境下无 renderer，bash 用环境变量 `TOOL_EXEC_MODE` 控制权限 |
| macOS TCC 敏感路径 (`~/Desktop`, `~/Library/Keychains`) | **省略** — 跨平台 CLI 工具不应硬编码 macOS 路径 |
| Electron 附件目录 (`chatAttachmentDirForConversation`) | **省略** — 无聊天附件概念 |
| `interactive_cli_start/read/send/close` 系列 | **省略** — 交互式 CLI 非本期需求 |
| PDF/Office 工具 (`markdown_to_pdf`, `create_docx` 等) | **省略** — 非核心需求，可作为后续 plugin |
| `create_artifact` / `publish_outputs` | **省略** — 交付清单机制适合 UI 产品，CLI 直接写文件即可 |
| 视频/图像生成工具 | **省略** — 非通用 agent 框架核心 |
| Connector/MCP 伞形工具 | **省略** — 可作为后续扩展 |

---

## 二、阶段4 实现范围

按四个子模块划分，标注与项目的适配策略：

### 2.1 工具目录 (tool-catalog.ts)

**目标：** 建立工具元数据注册表，支撑 system prompt 中分组渲染 + 可见性门控。

**与本项目的适配：**

- **保留：** `ToolGroup` 分组（简化为本项目实际有的组）、`ToolCatalogEntry`（含 `summary`, `group`, `permission`, `ownerAgent`）、`isToolVisibleToAgent()`、`getToolsSystemPromptBlock()`、反漂移测试
- **简化：** 分组从 Orkas 的 11 组简化为本项目实际的 4 组（`fs`, `shell`, `web`, `meta`）；不实现 connector 伞形注入
- **新增：** 集成到 [src/prompts/system-prompt-builder.ts](../../src/prompts/system-prompt-builder.ts) 的 `buildSystemPrompt()` 调用链中，让工具列表由 catalog 驱动渲染

**实现清单：**

```
src/tools/catalog.ts          (~180行)  工具目录核心
src/tools/catalog.test.ts     (~40行)   反漂移测试
```

### 2.2 文件工具增强 (builtin.ts 扩展)

**目标：** 基于现有内置工具，补齐缺失的文件操作 + 双层门控。

**与本项目的适配：**

- **保留：** `stat_file`、`delete_file`（工作区内直接删）、`readOnlyExtraRoots` 概念
- **简化：**
  - `delete_file` 不做工作区外确认卡（无 UI renderer），仅支持工作区/允许根内删除
  - `edit_file` 不做 `checkEditFreshness`（本项目暂不需要并发编辑保护）
  - `read_file` 行号显示保持现有的 `行号|` 格式，不改 `<n>\t<text>` 格式（与项目现有代码一致即可）
  - 不实现 `ocr_file`、`create_artifact`、`publish_outputs`
  - `skill disable 拦截` 暂不实现（skill 系统尚未建设完成）
- **新增：** `stat_file`（简单版 — 返回文件大小/行数/字符数，不做 PDF/Office 提取；大文件防护：只读前 64KB 统计行数/字符数，超出部分仅报告 `fs.statSync` 的 size）

**实现清单：**

```
src/tools/builtin.ts            (+~80行)  追加 stat_file, delete_file；resolvePath 改为导出 + 支持 readOnlyExtraRoots
```

### 2.3 Bash 权限模式 (bash-permissions.ts)

**目标：** 为 bash 工具增加可配置的执行权限控制。

**与本项目的适配：**

- **保留：** 三模式权限（`disabled`, `workspace_only`, `unrestricted`）、`DENY_MESSAGE`、每 `execute()` 重读模式
- **简化：**
  - 不做 `requestBashDecision` IPC 审批闭环 → 用环境变量 `TOOL_EXEC_MODE` 控制模式
  - 不做命令风险分类（`classifyConfiguredBashCommand`）→ 学习项目暂不需要
  - 不做敏感路径审批（无 macOS TCC）→ 仅依赖路径沙箱
  - 不做 `cancelForCid`（交互式 CLI 不在 scope）
  - 不做 Bash 输出报告（`bash` 扫描 cwd 新文件）
- **新增：** `localExecMode` 从环境变量 `TOOL_EXEC_MODE` 读取（CLI 学习项目，环境变量足够，不引入配置文件的额外复杂度）

**实现清单：**

```
src/tools/bash-permissions.ts (~100行)  Bash 权限模式
```

### 2.4 工具结果管理 (tool-result-cap.ts + tool-result-tools.ts)

**目标：** 超大工具结果自动溢出持久化 + 取回工具，防止撑爆上下文。

**与本项目的适配：**

- **保留：** 双预算（单结果 + 本轮账本）、CJK 感知 token 估算、内容寻址持久化 + 原子 rename、`<persisted-output>` XML marker、`buildBoundedPreview`（72% head + 28% tail）、永不抛异常降级、GC 驱逐
- **简化：**
  - 不做流式输出承接（`persistStreamedToolResult`）— 本项目 bash 工具不使用流式输出到文件
  - 不做 CLI 端 `maybeSpillToolResult` — 本项目 runner 在同进程内处理
  - GC 简化：不按用户激活触发，改为按文件数/时间清理（可手动调用或启动时执行）
- **新增：** `capToolResult` 直接集成到 `AgentRunner.executeToolLoop` 的 `runToolWithWatchdog` 返回值处理

**实现清单：**

```
src/tools/tool-result-cap.ts        (~350行)  结果溢出/持久化
src/tools/tool-result-tools.ts      (~150行)  取回工具（tool_result_search / tool_result_read_chunk）
```

---

## 三、模块实现详情

### 3.1 工具目录 (`src/tools/catalog.ts`)

#### 3.1.1 类型定义

```ts
export type ToolGroup = 'fs' | 'shell' | 'web' | 'meta';

export interface ToolCatalogEntry {
  name: string;                          // 必须与 AgentTool.name 精确匹配
  summary: string;                       // 面向 setup LLM 的一行英文描述（短摘要）
  group: ToolGroup;                      // 渲染分组
  permission?: 'localExec';              // 受运行时权限门控时填写
  ownerAgent?: string | string[];        // 仅指定 agent 可见
}
```

#### 3.1.2 工具全表（按本项目实际工具）

| Group | 工具 | 权限 |
|---|---|---|
| **fs** | `read_file`, `write_file`, `edit_file`, `delete_file`, `list_files`, `search_files`, `grep_files`, `stat_file`, `tool_result_search`, `tool_result_read_chunk` | —（写工具仅沙箱门控，不标 localExec） |
| **shell** | `bash` | `localExec` |
| **web** | `web_fetch` | — |
| **meta** | `run_worker`, `dispatch_to`, `hand_off_to` | ownerAgent = `commander`（仅指挥官可见） |

> **注意：** 调度三工具 (`run_worker`, `dispatch_to`, `hand_off_to`) 不在 catalog 常驻注册，
> 而是由 `buildDispatchTools()` 通过 `runner.addTool()` 动态注入（见 `chat.ts:391-393`）。
> 反漂移测试收集 `this.tools` 全部 key，对这三个调度工具名做特判排除。

#### 3.1.3 固定渲染顺序

```ts
const GROUP_ORDER: ReadonlyArray<{ group: ToolGroup; title: string }> = [
  { group: 'fs',    title: 'Files / workspace' },
  { group: 'shell', title: 'Shell' },
  { group: 'web',   title: 'Web' },
  { group: 'meta',  title: 'Task / cross-session state' },
];
```

#### 3.1.4 核心函数

```ts
/** 可见性门控 */
export function isToolVisibleToAgent(name: string, agentId: string): boolean;

/** 渲染工具列表为 system prompt 块 */
export function getToolsSystemPromptBlock(names: string[]): string;
// 输入来自 runner.ts::[...this.tools.values()].map(t => t.name)（实际代码 runner.ts:1161）
// 按 GROUP_ORDER 分组，每组输出：
//   - **name** — summary (gated by local-execution permission)
// 目录中缺失 name → log.warn + 跳过
// 空 names → 返回 ""

/** 注册自定义条目（extra tools） */
export function registerCatalogEntry(entry: ToolCatalogEntry): void;
```

#### 3.1.5 反漂移测试

```ts
// catalog.test.ts
// 1. 收集 runner.ts 实际注册的 builtin 工具名
// 2. 断言 builtin 工具 ⊆ CATALOG_NAME_SET
// 3. 断言每个 builtin 工具有对应的 catalog entry
```

---

### 3.2 文件工具增强 (`src/tools/builtin.ts` 扩展)

#### 3.2.1 `stat_file` 工具

```ts
export const statFileTool = defineTool({
  name: "stat_file",
  description: "获取文件元信息：大小、行数、字符数。不读取完整文件内容。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "文件路径" },
    },
    required: ["filePath"],
  },
  execute: async (input, ctx) => {
    // 1. resolvePath → 沙箱门控
    // 2. fs.statSync → { size, mtimeMs }
    // 3. 文本文件额外：读前 64KB 统计行数 + 字符数（大文件防护，超过 64KB 仅报 size）
    // 4. 二进制文件：仅报 size + mtime，标注为 binary
    // 5. 返回格式化的元信息
  },
});
```

#### 3.2.2 `delete_file` 工具

```ts
export const deleteFileTool = defineTool({
  name: "delete_file",
  description: "删除文件（仅限工作区/允许根内）。⚠️ 不可恢复，请谨慎使用。",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "要删除的文件路径" },
    },
    required: ["filePath"],
  },
  execute: async (input, ctx) => {
    // 1. resolvePath → 沙箱门控（写工具校验排除 readOnlyExtraRoots）
    // 2. 检查文件存在，不存在则报错
    // 3. fs.unlinkSync → 返回确认信息
    // 4. 路径越界/权限不足 → 返回错误（不静默吞掉）
  },
});
```

#### 3.2.3 resolvePath 改动

现有 [src/tools/builtin.ts](../../src/tools/builtin.ts) 的 `resolvePath()` 是模块私有函数（builtin.ts:516）。
需要做以下改动：

- **导出** `resolvePath`，增加 `opts: { isWrite?: boolean; extraRoots?: string[]; readOnlyExtraRoots?: string[] }` 参数
- **写工具**（write_file, edit_file, delete_file）：传入 `isWrite: true`，resolvePath 内排除 `readOnlyExtraRoots`
- **读工具**（read_file, stat_file, list_files, search_files, grep_files）：`readOnlyExtraRoots` 作为额外只读根
- 与现有 `path-sandbox.ts::guardPath` 保持一致的双重校验逻辑

---

### 3.3 Bash 权限模式 (`src/tools/bash-permissions.ts`)

#### 3.3.1 模式定义

```ts
export type LocalExecMode = 'disabled' | 'workspace_only' | 'unrestricted';

const DENY_MESSAGE =
  'E_TOOL_EXECUTION_ACCESS_DISABLED: Tool execution access is disabled. ' +
  'Set TOOL_EXEC_MODE=workspace_only or TOOL_EXEC_MODE=unrestricted to enable.';

export function getLocalExecMode(): LocalExecMode {
  // 优先级：环境变量 TOOL_EXEC_MODE > 默认 workspace_only
  const env = process.env.TOOL_EXEC_MODE?.toLowerCase();
  if (env === 'disabled') return 'disabled';
  if (env === 'unrestricted') return 'unrestricted';
  return 'workspace_only';
}

export function isBashAllowed(cwd: string, workingDir?: string): { allowed: boolean; reason?: string } {
  const mode = getLocalExecMode();
  if (mode === 'disabled') return { allowed: false, reason: DENY_MESSAGE };
  if (mode === 'unrestricted') return { allowed: true };
  // workspace_only: 用 path.resolve 规范化后比较（兼容 Windows 分隔符/大小写）
  if (workingDir) {
    const normalizedCwd = path.resolve(cwd);
    const normalizedWd = path.resolve(workingDir);
    if (normalizedCwd !== normalizedWd && !normalizedCwd.startsWith(normalizedWd + path.sep)) {
      return { allowed: false, reason: `E_PATH_OUT_OF_SCOPE: bash cwd "${cwd}" is outside workspace "${workingDir}"` };
    }
  }
  return { allowed: true };
}
```

#### 3.3.2 集成到 bash 工具

在 [src/tools/builtin.ts](../../src/tools/builtin.ts) 的 `bashTool.execute()` 入口处加入：

```ts
// 在 bash 工具 execute 开头：
const check = isBashAllowed(cwd, ctx.workingDir);
if (!check.allowed) {
  return { content: check.reason!, isError: true };
}
```

---

### 3.4 工具结果管理

#### 3.4.1 结果溢出 (`src/tools/tool-result-cap.ts`)

核心函数与类型：

```ts
/** 单结果内联 token 预算（默认 8000） */
export const DEFAULT_INLINE_RESULT_TOKENS = 8_000;

/** 本轮账本 key（挂在 ToolContext.state） */
export const TOOL_RESULT_INLINE_LEDGER_STATE_KEY = 'toolResultInlineLedger';

export type ToolResultInlineLedger = {
  initialTokens: number;
  remainingTokens: number;
};

/** CJK 感知 token 估算 */
export function estimateToolResultTokens(text: string): number {
  // CJK 字符 × 1.5 + 其他字符 / 4
}

/** 构建 72% head + 28% tail 预览 */
export function buildBoundedPreview(content: string, maxTokens: number): string;

/** 内容寻址持久化 + 原子 rename */
export function persistToolResult(
  toolResultsDir: string,
  toolName: string,
  content: string,
): string;

/** 主入口：检查 → 溢出/放行 */
export function capToolResult(
  toolName: string,
  result: ToolResult,
  ctx: ToolContext,
  opts: { maxInlineTokens?: number; toolResultsDir: string },
): ToolResult;

/** 包装器：保持 executionMode */
export function wrapToolWithCap(
  tool: AgentTool,
  opts: { maxInlineTokens?: number; toolResultsDir: string },
): AgentTool;
```

#### 3.4.2 双预算逻辑

```
capToolResult(toolName, result, ctx, opts):
  1. content = result.content || ""
  2. estimatedTokens = estimateToolResultTokens(content)
  3. 单结果预算: estimatedTokens > opts.maxInlineTokens → 溢出
  4. 本轮账本: claimRoundInlineBudget(ctx, estimatedTokens) → 失败则溢出
  5. 都不超 → 原样返回
  6. 溢出 → persistToolResult → buildPersistedOutputMarker → 返回 ref marker
  7. 持久化失败 → buildBoundedPreview(content, 600) + error marker（不抛异常）
```

#### 3.4.3 `<persisted-output>` Marker 格式

```xml
<persisted-output ref="sha256hash" tool="bash" size="125000" estimated_tokens="31000" status="success">
[600 token 预览: 72% head + 28% tail]
[Full content is stored under result ref sha256hash.
 Use tool_result_search(ref, query) first, or tool_result_read_chunk(ref, cursor, maxTokens)
 for an exact bounded slice. Do not use read_file on the stored path.]
</persisted-output>
```

#### 3.4.4 取回工具 (`src/tools/tool-result-tools.ts`)

```ts
export const toolResultSearchTool = defineTool({
  name: "tool_result_search",
  description: "在已持久化的工具结果中搜索。ref 来自 <persisted-output> 标记。",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "结果引用标识" },
      query: { type: "string", description: "搜索关键词或正则" },
      maxTokens: { type: "number", description: "最大返回 token 数（默认 2000）" },
    },
    required: ["ref", "query"],
  },
  execute: async (input, ctx) => {
    // 1. resolve ref → 持久化路径（校验在 tool-results 目录内）
    // 2. 读取文件 → substring/regex 匹配
    // 3. 返回匹配段落（≤ maxTokens）
    // 4. ref 无效 → 错误提示
  },
});

export const toolResultReadChunkTool = defineTool({
  name: "tool_result_read_chunk",
  description: "按游标读取持久化工具结果的指定片段。",
  inputSchema: {
    type: "object",
    properties: {
      ref: { type: "string", description: "结果引用标识" },
      cursor: { type: "number", description: "字节偏移" },
      maxTokens: { type: "number", description: "最大返回 token 数（默认 2000）" },
    },
    required: ["ref", "cursor"],
  },
  execute: async (input, ctx) => {
    // 1. resolve ref → 路径
    // 2. fs.readSync + 游标切片
    // 3. 返回切片文本
  },
});
```

#### 3.4.5 账本管理

账本通过 `ToolContext.state` 传入，与 `readFileState` / `runScopedLedger` / `toolResultReadKeys` 同层（见 runner.ts:1628-1633）：

```ts
// runner.ts 集成点（batches 循环前，runner.ts:1598 附近）：
const inlineLedger: ToolResultInlineLedger = {
  initialTokens: MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND,  // 16,000
  remainingTokens: MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND,
};

// 在每个 batch 执行前注入 state：
const state: Record<string, unknown> = {
  ...this.toolContextState,
  readFileState: input.readFileState,
  runScopedLedger: input.runScopedLedger,
  toolResultReadKeys: input.toolResultReadKeys,
  [TOOL_RESULT_INLINE_LEDGER_STATE_KEY]: inlineLedger,  // 本轮账本
};
```

- **顺序分支：** `claimRoundInlineBudget` 单线程修改 `remainingTokens`，无需锁
- **并行分支：** 并发 `capToolResult` 需 `async-mutex` 包裹账本扣减，包装为 `capToolResultWithLock`（见 §3.5）

#### 3.4.6 GC (`sweepToolResults`)

```ts
export function sweepToolResults(
  toolResultsDir: string,
  maxAgeDays?: number,       // 默认 7
  maxTotalBytes?: number,    // 默认 200MB（学习项目，比 Orkas 1GB 小）
): { deleted: number; freedBytes: number } {
  // 1. 删除 mtime > maxAgeDays 的条目
  // 2. 累计字节，超配额按 mtime 升序驱逐
  // 3. 返回统计
}
```

调用时机：在 [src/cli/chat.ts](../../src/cli/chat.ts) 的 `main()` 启动流程中，`ensureDataLayout()` 之后执行。

**`toolResultsDir` 路径：** 在 [src/storage/paths.ts](../../src/storage/paths.ts) 中新增 `toolResultsDir(): string`（`dataRoot()/tool-results/`）。沙箱根不含 dataRoot，因此 `read_file` 天然读不到持久化结果（与 marker 提示"不要用 read_file 读"一致）。

---

### 3.5 Runner 集成改动 (`src/agent/runner.ts`)

实际代码结构（参考 runner.ts:1161, 1598-1756）：

- 工具定义来自 `[...this.tools.values()].map(toToolDefinition)`（runner.ts:1161，非 `allTools.map`）
- 工具执行分**顺序分支**（runner.ts:1623，`batch.length === 1`）和**并行分支**（runner.ts:1698，`else`）
- 两分支均需在 `runToolWithWatchdog` 返回后 → `addToolResult` 前调用 `capToolResult`

**改动点：**

1. **工具可见性过滤：** 在 runner.ts:1161 的 `[...this.tools.values()].map(toToolDefinition)` 之前，先 `filter(tool => isToolVisibleToAgent(tool.name, agentId))`

2. **工具结果溢出 — 顺序分支（runner.ts:1623 附近）：**
   ```
   outcome = await runToolWithWatchdog(...)
   → capped = capToolResult(call.name, outcome.result, ctx, opts)
   → await this.session.addToolResult(call.id, capped.content, capped.isError)
   → yield { type: "tool_end", ..., result: capped.content, persistedOutput: capped.persistedOutput, ... }
   ```

3. **工具结果溢出 — 并行分支（runner.ts:1698 附近）：**
   ```
   outcomes = await Promise.all(batch.slice(0, cap).map(async (call) => {
     outcome = await runToolWithWatchdog(...)
     // ⚠️ capToolResult 内 claimRoundInlineBudget 需原子化：用 async-mutex 锁账本扣减
     capped = await capToolResultWithLock(call.name, outcome.result, ctx, opts, ledgerMutex)
     return { call, outcome, capped }
   }))
   → 按声明顺序: await this.session.addToolResult(call.id, capped.content, capped.isError)
   → yield { type: "tool_end", ..., persistedOutput: capped.persistedOutput, ... }
   ```
   - **并行账本原子性：** `capToolResult` 内部 `claimRoundInlineBudget` 修改 `ctx.state[LEDGER_KEY].remainingTokens`。并行工具并发调用时，需用 `async-mutex`（项目已有依赖）包裹账本扣减，防止超支。提供 `capToolResultWithLock` 包装函数。

4. **账本创建：** 每轮 `batches` 循环（runner.ts:1598）之前，从 `input.runScopedLedger` 同层传入：
   ```ts
   const inlineLedger: ToolResultInlineLedger = {
     initialTokens: MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND,
     remainingTokens: MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND,
   };
   // 注入到 state，与 readFileState/runScopedLedger/toolResultReadKeys 同层
   ctx.state[TOOL_RESULT_INLINE_LEDGER_STATE_KEY] = inlineLedger;
   ```

5. **buildSystemPrompt 参数变更：** `buildSystemPrompt()` 新增 `toolsBlock?: string` 参数，接收 `getToolsSystemPromptBlock(names)` 的输出。调用方（`chat.ts`）注意：调度工具在 `buildSystemPrompt` 之后才 `addTool`，因此 system prompt 中的工具列表不包含调度工具（与 §3.1.2 注一致，可接受）。

---

## 四、文件变更清单

| 文件 | 操作 | 行数(估) | 说明 |
|---|---|---|---|
| `src/tools/catalog.ts` | 新建 | ~180 | 工具目录 + 渲染 |
| `src/tools/catalog.test.ts` | 新建 | ~60 | 反漂移测试 + 可见性门控测试 + 渲染测试 |
| `src/tools/bash-permissions.ts` | 新建 | ~100 | Bash 三模式权限 |
| `src/tools/bash-permissions.test.ts` | 新建 | ~60 | 三模式 × env 解析矩阵 + cwd 边界测试 |
| `src/tools/tool-result-cap.ts` | 新建 | ~350 | 结果溢出/持久化/GC |
| `src/tools/tool-result-cap.test.ts` | 新建 | ~120 | token 估算 / 双预算 / 持久化去重 / 降级 / GC |
| `src/tools/tool-result-tools.ts` | 新建 | ~150 | 取回工具（search / read_chunk） |
| `src/tools/tool-result-tools.test.ts` | 新建 | ~60 | ref 校验 / 游标边界 / 匹配截断 |
| `src/tools/builtin.ts` | 修改 | +80 | 追加 stat_file, delete_file；resolvePath 导出 + readOnlyExtraRoots；bash 集成权限检查 |
| `src/agent/runner.ts` | 修改 | +40 | 集成 capToolResult（顺序+并行两分支）+ 工具可见性过滤 + 账本 + async-mutex 原子扣减 |
| `src/prompts/system-prompt-builder.ts` | 修改 | +15 | `buildSystemPrompt` 新增 `toolsBlock` 参数 |
| `src/storage/paths.ts` | 修改 | +5 | 新增 `toolResultsDir()` |
| `src/cli/chat.ts` | 修改 | +40 | 启动时调用 `sweepToolResults`；数字菜单集成（Bash 模式显示、`/mode` 命令、`/tools` 按组展示、`/gc` 手动清理） |
| `vitest.config.ts` | 修改 | +1 | include 增加 `src/**/*.test.ts` |
| `src/cli/menu.ts` | 修改 | +15 | 主菜单 banner 显示 `TOOL_EXEC_MODE` 状态 |

**总代码增量：** ~1310 行（新建 ~1080 + 修改 ~230）

---

## 五、实现顺序与依赖

### 第0步：环境准备（强制前置）

> **说明：** 本阶段引入项目首批测试文件（当前 `src/` 下零 `.test.ts`），需先验证测试基座可用。

```bash
# 0a. 确认 Node 版本
node -v            # 预期 ≥18

# 0b. 安装依赖（无新增第三方包，账本原子性用已有 async-mutex）
npm install        # 预期: "up to date"

# 0c. TypeScript 编译检查
npm run check      # 预期: 0 error

# 0d. 测试基座验证（当前 0 用例也应正常退出）
npx vitest run     # 预期: "No test files found" 或 exit 0
```

### 实现步骤

```
第1步: catalog.ts + catalog.test.ts          (无依赖)
  验证: npx vitest run src/tools/catalog.test.ts  → 全绿

第2步: builtin.ts 扩展                         (依赖 catalog.ts)
  stat_file + delete_file + resolvePath 导出 + readOnlyExtraRoots
  验证: npm run check → 0 error; npx vitest run src/tools/ → 全绿

第3步: bash-permissions.ts + test             (依赖 builtin.ts 的 bash)
  验证: npx vitest run src/tools/bash-permissions.test.ts → 全绿;
        TOOL_EXEC_MODE=disabled node ... → bash 返回 DENY_MESSAGE

第4步: tool-result-cap.ts + tool-result-tools.ts + tests  (依赖 base.ts)
  验证: npx vitest run src/tools/tool-result-*.test.ts → 全绿

第5步: 集成改动 (builtin.ts → runner.ts → system-prompt-builder.ts → paths.ts → chat.ts)
  验证: npm run check → 0 error;
        npx vitest run → 全绿;
        手动 chat 场景: 执行返回 >8K 结果的 bash 命令 → 验证溢出 marker 出现

---

## 六、测试计划

本阶段引入项目首批测试文件，需覆盖以下模块：

### 6.1 单元测试

| 测试文件 | 覆盖要点 |
|---|---|
| `catalog.test.ts` | `isToolVisibleToAgent` — ownerAgent 单值/数组/缺省；`getToolsSystemPromptBlock` — 空数组→""、缺失 name→warn+跳过、渲染顺序与 KV 稳定；反漂移 — builtin 工具 ⊆ catalog |
| `bash-permissions.test.ts` | `getLocalExecMode` — 三模式 env 解析矩阵（disabled/workspace_only/unrestricted/未设/非法值）；`isBashAllowed` — cwd 界内/界外/未设 workingDir、Windows 路径分隔符规范化（`\` vs `/`） |
| `tool-result-cap.test.ts` | `estimateToolResultTokens` — CJK/ASCII 混合、纯中文、纯英文、空串；`claimRoundInlineBudget` — 足够/不足/无账本放行；`persistToolResult` — 内容寻址去重（同 content 只存一份）、原子 rename（tmp→abs）、并发竞态（rename 失败但目标已存在）；`capToolResult` — 不超→原样、单结果超→溢出、账本超→溢出、持久化失败→降级为 buildBoundedPreview + error marker（永不抛异常）；`buildBoundedPreview` — 72/28 比例、短结果不截断；`sweepToolResults` — 陈旧驱逐（mtime>7天）、配额驱逐（累计>200MB） |
| `tool-result-tools.test.ts` | `tool_result_search` — ref 越权校验（路径不在 tool-results 内）、匹配/截断边界；`tool_result_read_chunk` — 游标 0/中间/超界、maxTokens 截断 |

### 6.2 集成测试（手动 chat 场景）

- **溢出→取回闭环：** 执行返回 >8K token 结果的 bash 命令 → 验证 `<persisted-output>` marker 出现 → 用 `tool_result_search` 取回 → 验证结果可读
- **Bash 权限：** `TOOL_EXEC_MODE=disabled` → bash 返回 DENY_MESSAGE；`TOOL_EXEC_MODE=workspace_only` → cwd 在工作区外被拒绝
- **工具目录渲染：** 启动 chat → 检查 system prompt 中 `## Available tools` 按组渲染、catalog 缺失 tool 不崩溃

### 6.3 覆盖率目标

- `tool-result-cap.ts` / `bash-permissions.ts` / `tool-result-tools.ts`：关键路径 100% 分支覆盖
- `catalog.ts`：全部公共函数覆盖
- 运行 `npx vitest run --coverage` 确认不跌破

---

## 七、风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| `delete_file` 不可恢复 | 模型误删用户文件 | catalog 渲染/prompt 中显式声明破坏性；实现时在返回消息中加 `⚠️ 不可恢复` 标记 |
| `capToolResult` 覆盖所有工具结果 | 持久化失败 → 结果截断/丢失 | 永不抛异常降级（buildBoundedPreview fallback）；`TOOL_EXEC_MODE` 不影响结果溢出逻辑 |
| catalog 渲染改变 system prompt 结构 | 影响 KV 缓存前缀 + 模型工具选择行为 | `buildSystemPrompt` 的 `toolsBlock` 参数可选，默认不传则跳过工具列表节（保持向后兼容） |
| `resolvePath` 增加 readOnlyExtraRoots | 改动既有读路径，可能引入越权漏洞 | 改动集中在一处、复用 `guardPath` 双重校验；写工具显式排除 readOnlyExtraRoots |
| bash 权限模式误配 | `unrestricted` 下模型可执行任意命令 | 默认 `workspace_only`；`TOOL_EXEC_MODE=disabled` 作为紧急总开关；模式即时生效（每次 execute 重读） |

---

## 八、时间与资源

| 步骤 | 预估耗时 | 可并行 |
|---|---|---|
| 第0步：环境准备 | 15 min | — |
| 第1步：catalog.ts + test | 1–2 h | ✅ 与 Steps 2/3/4 并行 |
| 第2步：builtin.ts 扩展（stat_file, delete_file, resolvePath） | 1–2 h | ✅ 与 Steps 1/3/4 并行 |
| 第3步：bash-permissions.ts + test | 1–2 h | ✅ 与 Steps 1/2/4 并行 |
| 第4步：tool-result-cap.ts + tool-result-tools.ts + tests | 3–4 h | ✅ 与 Steps 1/2/3 并行 |
| 第5步：集成改动 | 2–3 h | 🔗 阻塞等待 1/2/3/4 全部完成 |

**总预估：** 5–7 小时（并行执行 Step 1–4）或 8–12 小时（串行执行）。

---

## 九、阶段验收清单

- [ ] `npm run check` → 0 error
- [ ] `npx vitest run` → 全绿，覆盖率关键路径 ≥100% 分支
- [ ] `TOOL_EXEC_MODE=disabled` → bash 返回错误
- [ ] `TOOL_EXEC_MODE=workspace_only` → 工作区外 bash 被拒绝
- [ ] 执行 >8K token 结果 → `<persisted-output>` marker 出现
- [ ] `tool_result_search` + `tool_result_read_chunk` 取回溢出结果可读
- [ ] 启动 chat → system prompt 中 `## Available tools` 按组渲染
- [ ] 调度工具不在 catalog 渲染列表中（`isToolVisibleToAgent` 正常过滤）

---

## 十、数字菜单集成（chat.ts）

本阶段新增功能需要在 CLI 数字菜单中体现：

### 10.1 主菜单 Banner 增强

在 `renderMainMenu()` banner 下方显示 `TOOL_EXEC_MODE` 状态：

```
🤖 My Agent — 主菜单
   Bash: workspace_only (设 TOOL_EXEC_MODE 更改)

   当前: deepseek (DeepSeek V3)
```

### 10.2 对话内新增命令

| 命令 | 功能 |
|---|---|
| `/mode [disabled\|workspace_only\|unrestricted]` | 查看/切换 Bash 执行模式 |
| `/tools`（增强） | 按 group（fs/shell/web/meta）分组展示工具，标注敏感工具 ⚠️ |
| `/gc` | 手动清理过期工具结果，显示清理统计 |

### 10.3 对话启动信息增强

在 `runChat()` 启动 banner 中显示：
- 工具按 group 统计（fs: 10, shell: 1, web: 1, meta: 3）
- 当前 Bash 执行模式
- 调度工具可用子 Agent 列表

### 10.4 启动流程

在 `ensureDataLayout()` 之后调用 `sweepToolResults()` 自动清理过期工具结果。

---

## 十一、本阶段不做的功能（明确排除）

| 功能 | 排除原因 |
|---|---|
| Bash IPC 审批闭环 | CLI 无 UI renderer，不适用 |
| macOS TCC 敏感路径 | 跨平台框架不应硬编码 macOS 路径 |
| 命令风险分类（classifyBashCommand） | 学习项目暂不需要 |
| 交互式 CLI 工具系列 | 非本期需求 |
| PDF/Office 工具 | 非通用 agent 核心 |
| OCR 工具 | 非通用 agent 核心 |
| create_artifact / publish_outputs | 面向 UI 产品的功能 |
| Skill 禁用拦截（guardDisabledSkillAccess） | Skill 系统尚未建设 |
| edit_file 新鲜度检查（checkEditFreshness） | 单进程场景并发风险低 |
| 流式输出承接（persistStreamedToolResult） | 当前 bash 不输出到流文件 |
| MCP 连接器伞形注入 | 可作为独立扩展 |
| wrapToolWithCap（包装器模式） | 本阶段直接在 runner 调用 capToolResult，无需包装 |
