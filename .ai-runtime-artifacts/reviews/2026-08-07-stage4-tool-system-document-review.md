---
artifact: document-review
route: superpowers:document-review
skills:
  - document-review
skills_evidence:
  - .claude/skills/document-review/SKILL.md
  - .claude/skills/document-review/review-rules/plan.md
  - .claude/skills/document-review/checklists/review-checklist.md
source:
  - .ai-runtime-artifacts/plans/stage4-tool-system-implementation.md
  - docs/spec/仿写Agent框架指南.md（第四阶段 §4.1–§4.4 参照）
  - 项目代码事实核查（src/tools/base.ts、builtin.ts、src/storage/path-sandbox.ts、src/agent/runner.ts、src/prompts/system-prompt-builder.ts、src/orchestration/tools.ts、actor.ts、config/schema.ts、storage/paths.ts、chat.ts、package.json）
reviewer: 独立子 Agent（generalPurpose）
reviewed_by: Leader（复核关键发现属实）
created_at: 2026-08-07
---

# stage4-tool-system-implementation.md 审查报告

## 文档类型

实施计划（标题含"实现文档"，含现状盘点、模块拆分、类型/签名、文件变更清单、实现顺序，判定为 plan 类型，按 `review-rules/plan.md` 审查）。

## 审查规则加载

- [x] 通用审查流程 (review-checklist.md)
- [x] 文档类型特定规则 (plan.md)
- [x] 环境准备审查规则（重点：Phase 1 环境准备、依赖/环境变量/验证命令）
- [x] 事实核对：文档全部现状声明（行数、函数、模块）对照源码逐一核实

## 审查结果

### 1. 文档完整性
[评分：基本完整]

现状盘点（§1.1 表格）与代码事实**高度吻合**：`base.ts` 83 行、`builtin.ts` 595 行、`path-sandbox.ts` 47 行完全一致；`runner.ts` 1877 行（文档称 1878）、`system-prompt-builder.ts` 356 行（称 357）、`orchestration/tools.ts` 254 行（称 255）各差 1 行，可忽略；`ToolResult.persistedOutput` 字段、`MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND = 16_000`（runner.ts:94）、`runToolWithWatchdog`（runner.ts:585）、`buildSystemPrompt`（builder.ts:237）、`buildDispatchTools`（tools.ts:79）、`COMMANDER_ID = "commander"`（actor.ts:10）均存在。

**重要缺口：**
- 无整体验收标准/里程碑（各模块有"目标"但没有可量化的阶段验收，例如"bash 三种模式各跑通一个场景"">8K token 结果溢出并可经 ref 取回"）。
- 无测试计划节（详见维度 4）。
- 无风险与回滚节（详见维度 5）。
- 无时间与资源节（详见维度 6）。

### 2. 逻辑清晰度
[评分：基本完整，含 4 处内部矛盾]

模块划分清晰（工具目录 / 文件工具 / bash 权限 / 结果管理），类型与签名具体，`<persisted-output>` marker 格式、双预算逻辑、GC 规则均有可执行描述。

**内部矛盾 / 与项目实际不符：**
1. **§2.1「3 组」vs §3.1.1 定义 4 组**：§2.1 称"分组从 Orkas 的 11 组简化为本项目实际的 3 组（fs, shell, web）"，但 §3.1.1 的 `ToolGroup` 与 §3.1.2 表格、§3.1.3 GROUP_ORDER 实际是 **4 组（fs / shell / web / meta）**。文字与代码定义冲突。
2. **§2.3「环境变量 / 配置文件」vs §3.3.1 仅环境变量**：§2.3 称 `localExecMode` 从"环境变量 `TOOL_EXEC_MODE` / 配置文件 `CoreAgentConfig`"读取；§3.3.1 的 `getLocalExecMode()` 无参、只读 `process.env.TOOL_EXEC_MODE`，且文件变更清单（§四）**不含** `config/schema.ts`（当前 schema 无任何 tool exec 字段，已核实）。配置来源声明无实现载体。
3. **§3.1.2 表格列出调度工具 vs 注说明其不在 catalog**：表格把 `run_worker / dispatch_to / hand_off_to` 列在 meta 组，注又说"不在 catalog 常驻注册"。读者会困惑以哪个为准。
4. **「extraTools」术语与项目实际不符**：§3.1.2 注称调度工具"注入指挥官的 `extraTools`"。本项目 runner 无 `extraTools` 概念——`chat.ts`（line 391-393）用 `runner.addTool(dt)` 把 `buildDispatchTools()` 的返回值注入**同一个** `this.tools` Map（`addTool` 在 runner.ts:793 `this.tools.set`）。因此反漂移测试的收集范围与排除规则（"catalog ∪ extraTools"）在本项目落地时需要对三个调度工具名做特判排除，文档未给出该规则。
5. **§3.5「allTools.map(toToolDefinition)」与实际代码不符**：真实代码是 runner.ts:1161 `[...this.tools.values()].map(toToolDefinition)`（`this.tools` 是 `Map<string, AgentTool>`，runner.ts:683）。

### 3. 环境准备完整性
[评分：不完整]

**关键缺失：无 Phase 1 环境准备。** §五"实现顺序与依赖"直接从 `catalog.ts` 开始。虽然本项目已具备 node_modules / vitest.config.ts，但本阶段会引入**项目首批测试文件**（当前 `src/` 下零 `.test.ts`，`npm test` 从未被实际执行过），因此环境验证并非无事可做：

- 缺预检命令：`npm run check`（tsc --noEmit）基线、`npx vitest run`（确认测试基座可跑、甚至当前 0 用例也能正常退出）、Node 版本要求（package.json 未声明 `engines`）。
- 缺新增依赖声明：本阶段无需新增第三方依赖（账本原子性可用已有 `async-mutex`），但文档应明确一句"无新增依赖"，避免实现者去装新包。
- 平台差异：唯一涉及的平台差异是 `isBashAllowed` 的 cwd 字符串前缀比较（见缺失项 7），文档未说明 Windows 路径规范化处理。

按 `plan.md` 与技能红色警报"批准 Phase 1 不是环境准备的计划"，该项为阻塞项。

### 4. 测试计划
[评分：严重不足]

仅两个新建模块列了测试文件：`catalog.test.ts`（反漂移）、`file-tools.test.ts`（笼统一句"测试"）。**其余三块零测试计划，而这恰是本阶段复杂度与风险最高之处：**

- `tool-result-cap.ts`（~350 行，全阶段最复杂）无测试：token 估算、单结果预算、本轮账本扣减、溢出持久化、`buildBoundedPreview` 72/28、持久化失败降级（永不抛异常）、GC 驱逐逻辑全部无测试用例。
- `tool-result-tools.ts` 无测试：ref 越权校验、`tool_result_read_chunk` 游标边界、`tool_result_search` 匹配/截断。
- `bash-permissions.ts`（纯函数三模式 + env 解析，最适合单测）无测试文件，且文件变更清单（§四）里根本没有 `bash-permissions.test.ts`。

无覆盖率目标、无测试数据准备方案（如溢出用的超大 sample、GC 的 mock 文件集）、无集成测试（如 runner 端到端触发一次真实溢出）。违反 plan.md"单元测试覆盖核心逻辑 / 覆盖率目标明确"。

### 5. 事实准确性
[评分：基本完整，无硬错误]

10 处现状声明全部核实属实（行数仅差 ±1）。无"文档声称 vs 代码实际"的硬错误。细节出入集中在 runner 集成描述（见缺失项 4 与 §3.5 措辞）。

### 6. 可执行性
[评分：中等]

- 优点：文件路径、类型、函数签名、行数预估、实现顺序依赖（§五）具体，新人可按图索骥。
- 缺点：**全程无一条验证命令**。5 个步骤、10 个文件变更，没有任何 `npm run check` / `npx vitest run ...` / 手动 chat 场景验证步骤；步骤粒度也偏大（"第5步 集成改动"一次改 3 个文件，未拆可独立验证的小任务）；无故障排查指南。

## 缺失项清单

### 🔴 阻塞
1. **无 Phase 1 环境准备**（§五 缺第 0 步）——违反 plan.md 硬性要求；且本阶段引入项目首批测试，必须先验证 `npm run check`、`npx vitest run` 基座可用。
2. **`tool-result-cap.ts` / `tool-result-tools.ts` / `bash-permissions.ts` 零测试计划**——全阶段最复杂逻辑（溢出/账本/GC/取回/权限）无测试用例、无覆盖率目标；`bash-permissions.test.ts` 甚至未列入文件变更清单。
3. **全程无验证命令**——每个步骤缺"验证通过才算完成"的可执行命令/预期输出。

### 🟡 重要
4. **§3.5 / §3.4.5 的 runner 集成描述与真实代码不符**：a) 应为 `[...this.tools.values()]` 而非 `allTools`（runner.ts:1161）；b) `capToolResult` 需在**顺序分支（runner.ts:1623）与并行分支（runner.ts:1698）两处**调用，文档只提"runToolWithWatchdog 返回后"单点；c) 并行分支对本轮账本的**并发扣减无原子性方案**（`async-mutex` 已是依赖，文档未提），不处理则并行工具可超支本轮预算。
5. **bash 权限配置来源自相矛盾**（§2.3 vs §3.3.1，见维度 2）：建议二选一——仅保留 `TOOL_EXEC_MODE` 环境变量，或补 `config/schema.ts` 字段并给 `getLocalExecMode()` 增加参数/工厂函数。
6. **无风险与回滚节**：`delete_file` 破坏性且不可恢复；`capToolResult` 影响**每一个**工具结果（故障=结果被截断/丢失）；catalog 渲染改变 system prompt 结构（影响 KV 缓存前缀与模型对工具的描述）；`resolvePath` 增加 readOnlyExtraRoots 改动既有读路径。应逐条给缓解/回滚（如删除前备份、`TOOL_EXEC_MODE` 即时切换即天然回滚开关、catalog 集成用 feature flag）。
7. **§3.3.1 `isBashAllowed` 的 cwd 检查用字符串 `cwd.startsWith(workingDir)`**（line 284）：Windows 下分隔符（`\` vs `/`）与大小写差异会使 `E_PATH_OUT_OF_SCOPE` 误判/漏判，应复用 `path-sandbox.ts` 的 `path.resolve` 规范化比较（与 `guardPath` 同逻辑）。
8. **`localExec` 元数据与实现不一致**：catalog 表给 `write_file / edit_file / delete_file` 标 `localExec`，但本阶段只对 `bash` 实现权限门。渲染时模型会被提示"(gated by local-execution permission)"而实际文件写工具无任何门控（仅沙箱）。建议：让文件写工具也挂 `TOOL_EXEC_MODE` 门控（disabled 时拒绝写），或去掉这三个标记。
9. **无时间与资源节**：步骤 1–4（catalog / file-tools / bash-permissions / tool-result-cap）实际相互独立（均只依赖既有 builtin/base），可并行但未标注；无耗时量级预估（仅有行数预估，属资源但不含时间）。

### 🟢 建议
10. **§2.1「3 组」与 §3.1.1「4 组」措辞统一**（meta 组需保留，调度工具注释需要它）。
11. **§3.1.2 注改写**：把"extraTools"替换为本项目真实的 `runner.addTool()` 注入机制，并写明反漂移测试的收集规则（`this.tools` 全部 key，排除 3 个调度工具名 或 catalog 为调度工具登记条目二选一）。
12. **file-tools.ts 与 builtin.ts 的 `resolvePath` 归属未说明**：`resolvePath` 是 builtin.ts 的模块私有函数（builtin.ts:516），`file-tools.ts`（新文件）无法直接复用；且文件工具被拆到两个文件（读/写/改在 builtin，增删在 file-tools）。建议 stat_file/delete_file 直接放 builtin.ts，或把文件工具整体迁到 file-tools.ts，并明确 `resolvePath` 的导出与 readOnlyExtraRoots 传递方式。
13. **`toolResultsDir` 路径未定义**：`paths.ts` 无 tool-results 目录。建议新增 `dataRoot()/tool-results/` 子目录并在 `paths.ts` 定义；同时说明沙箱根（workingDir + skill 目录）不含 dataRoot，故 `read_file` 天然读不到持久化结果（与 marker"不要用 read_file 读"一致），如需额外防御再加门控。
14. **`sweepToolResults` 调用点未指定**：应写明在 `chat.ts` 的 `main()`（line 193）启动流程里、`ensureDataLayout()` 之后调用。
15. **`buildSystemPrompt` 签名变更未说明**：需新增参数（如 `toolsBlock`）承载 `getToolsSystemPromptBlock` 输出；且 `chat.ts` 在创建 runner 前调用 `buildSystemPrompt`（line 353），此时调度工具尚未 `addTool`（line 391-393）——系统提示中的工具列表快照与运行期注入的差异需写清（可接受：调度工具不在列表，与 §3.1.2 注一致）。
16. **`stat_file` 行数/字符数统计需整读文件**：对超大文件会卡执行，建议限制只读前 N 字节或用 `fstat` 判定后跳过。
17. **无整体验收/里程碑**：补一条阶段级验收清单（各模式手测 + 溢出取回手测 + `npm run check` + `npm test` 全绿）。

## 改进建议（按优先级）

1. **（阻塞）新增"第 0 步 环境准备"**（置于 §五 实现顺序之前）：`node -v`（≥18）、`npm install`、`npm run check`（预期 0 error）、`npx vitest run`（确认基座跑通，即使当前 0 用例）、一句"本阶段无新增第三方依赖（账本原子性用已有 async-mutex）"。每步给预期输出。
2. **（阻塞）新增"测试计划"节**，至少覆盖：
   - `bash-permissions.test.ts`：三模式 ×（env 解析矩阵、cwd 界内/界外/未设 workingDir、Windows 路径规范化）。
   - `tool-result-cap.test.ts`：`estimateToolResultTokens`（CJK/ASCII 混合）、双预算（单结果超限、账本累计超限、无账本放行）、`persistToolResult` 内容寻址去重 + 原子 rename + 并发竞态、`capToolResult` 持久化失败降级为 `buildBoundedPreview` + error marker（永不抛）、`buildBoundedPreview` 72/28、`sweepToolResults` 陈旧/配额驱逐。设覆盖率目标（如 `vitest --coverage` 关键路径 100% 分支）。
   - `catalog.test.ts` 补：`isToolVisibleToAgent` 的 ownerAgent 单值/数组/缺省、`getToolsSystemPromptBlock` 空数组→""、缺失 name→warn+跳过、渲染顺序与 KV 稳定。
   - 一条 runner 集成测试（集成测试层面）：注入一个返回超大结果的工具 → 断言溢出 marker 出现、ref 可取回。
3. **（阻塞）§3.5 重写为两分支集成**：顺序分支（1623 后、`addToolResult` 前）+ 并行分支（1698 后）+ 账本创建位置（每轮 toolCalls 的 batches 循环前，runner.ts:1598 前），账本扣减用 `async-mutex` 保证原子；§3.4.5 的代码片段改为与 runner 实际 `state` 组装（`input.readFileState` / `input.runScopedLedger` 同层）匹配的形式。
4. **（重要）统一 bash 权限来源**：建议仅环境变量 `TOOL_EXEC_MODE`（CLI 学习项目，配置化收益低）；若坚持配置化，则补 `config/schema.ts` 字段 + `getLocalExecMode(opts)` 带参，并更新 §四 文件变更清单。
5. **（重要）新增"风险与回滚"节**：每条高风险项给缓解与回滚（`TOOL_EXEC_MODE=disabled` 作为 bash/写文件的总开关回滚路径；catalog 渲染集成保留开关可一键关闭；delete_file 语义"不可恢复"在 prompt/文档中显式声明）。
6. **（重要）新增"时间与资源"节**：标注步骤 1–4 可并行、第 5 步阻塞等待 1–4；给每步量级耗时（如"1-2h / 3-4h"）。
7. **（重要）修复集成描述与元数据一致性**：§3.5 改 `[...this.tools.values()]`；§3.1.2 注改 `addTool` 表述并写清反漂移排除规则；决定 `localExec` 是否也门控文件写工具。
8. **（建议）一致性收尾**：3 组→4 组措辞；`resolvePath` 归属；`toolResultsDir` 落 `paths.ts`；`sweepToolResults` 调用点；`buildSystemPrompt` 参数；`stat_file` 大文件防护；阶段级验收清单。

## 事实出入清单（文档声称 vs 代码实际）

| # | 严重度 | 文档声称 | 代码实际 |
|---|--------|---------|---------|
| D1 | Medium | §3.5「在 `allTools.map(toToolDefinition)` 前过滤」 | runner.ts:1161 为 `[...this.tools.values()].map(toToolDefinition)`；`this.tools` 是 Map |
| D2 | Medium | §2.3 `localExecMode` 从 env `TOOL_EXEC_MODE` / 配置 `CoreAgentConfig` 读取 | §3.3.1 代码仅读 env；`config/schema.ts` 无 tool exec 字段；`getLocalExecMode()` 无参 |
| D3 | Medium | §3.1.2 注调度工具注入"指挥官的 extraTools" | 本项目 runner 无 extraTools；chat.ts:391-393 用 `runner.addTool(dt)` 注入同一 `this.tools` Map |
| D4 | Low | §3.4.5 每轮创建账本并 `ctx.state[...]=inlineLedger` | runner 实际把 `input.readFileState`/`runScopedLedger`/`toolResultReadKeys` 展开进 `state`；账本需以同层方式传入并保证并行扣减原子 |
| D5 | Low | §1.1 runner.ts 1878 / builder.ts 357 / tools.ts 255 行 | 实为 1877 / 356 / 254（差 1 行，可忽略） |

**核对通过项（示例）：** §1.1 全部模块行数、8 个内置工具名、`guardPath`/`isPathAllowed`、`ToolResult.persistedOutput`（base.ts:27）、`MAX_INLINE_TOOL_RESULT_TOKENS_PER_ROUND=16_000`（runner.ts:94）、`runToolWithWatchdog`（runner.ts:585）、`buildSystemPrompt`（builder.ts:237）、`buildDispatchTools`（tools.ts:79）、`COMMANDER_ID`（actor.ts:10）、"skip 阻塞 IPC 审批/TCC/PDF 等 Orkas 特性"的省略决策与参照蓝本 §4 一致。

## 适配决策合理性评估（本项目特殊性）

文档 §1.2 / §2 / §六 的**省略/简化决策总体合理**：
- 省略 IPC 审批闭环 → 改 env 变量模式：符合 CLI 无 renderer 的实情 ✅
- 省略 macOS TCC 敏感路径 / PDF/Office/OCR/artifact/交互式 CLI → 符合"CLI 学习型框架"定位 ✅
- 省略 `checkEditFreshness`（单进程低并发）、流式输出承接（当前 bash 走内存）、`wrapToolWithCap`（runner 直调 capToolResult）→ 均有正当理由 ✅

**但两处"简化"需再权衡：**
1. **`delete_file` 不做工作区外确认、不设恢复**：CLI 场景可接受，但因无 UI 兜底，"删除即不可恢复"的风险全部落在模型行为上，建议至少在 catalog 渲染/prompt 中显式声明破坏性，并在风险节给回滚说明（缺失项 6）。
2. **`localExec` 标记 vs 未实现门控**（缺失项 8）：简化到只门控 bash、却保留文件写工具的 localExec 渲染标记，属于"简化不彻底导致的元数据失真"，比显式去掉标记更糟。

## 审查结论

**FAIL（需修订后复审）。**

理由：
1. **违反 plan.md 硬性要求**：Phase 1 非环境准备；步骤无验证命令；`tool-result-cap`/`tool-result-tools`/`bash-permissions`（本阶段最复杂、最易错逻辑）零测试计划、无覆盖率目标。按"缺失环境配置带来的返工比缺失功能更严重"原则不能放行。
2. **runner 集成描述与真实代码有多处出入**（allTools vs this.tools、顺序+并行两分支、并行账本原子性、state 组装方式），照文档实现会在并行分支遗漏 `capToolResult`，导致大结果直接撑爆上下文或账本超支。
3. **bash 权限"配置文件"声明无实现载体**（§2.3 vs §3.3.1 自相矛盾）。

正面：现状盘点准确度极高（无硬错误）、文件/类型/签名具体、省略决策符合 CLI 学习框架定位、双预算/内容寻址/marker/GC 等关键机制保留完整。问题集中在"环境准备 / 测试计划 / runner 集成细节 / 风险回滚"四块，修复局部可控；修订 High 项后应能通过复审。

## Next

- 需要补充 → 按本报告"改进建议"第 1–7 项修订文档（先改 🔴 项：加环境准备第 0 步 + 测试计划节 + §3.5 两分支集成重写），修订完成后重跑复审
- 若只改 🟡/🟢 → 可选择性处理，但 🔴 三项（环境准备、测试计划、验证命令）不可跳过
