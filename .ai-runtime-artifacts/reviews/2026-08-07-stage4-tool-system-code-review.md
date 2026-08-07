---
artifact: code-review
route: orchestration.collective-closeout
plan: .ai-runtime-artifacts/plans/stage4-tool-system-implementation.md
reviewer: Reviewer (general-purpose agent)
created_at: 2026-08-07
status: NEEDS_FIX
---

# 阶段4：工具系统 — 代码审查报告

## 总体结论：NEEDS_FIX

无 BLOCKER。类型检查 0 error，74 测试全绿。功能主体正确、模块边界清晰、测试质量良好。2 个 MAJOR 需在合并前处理。

## 五轴审查

### 一、正确性

| # | 严重度 | 发现 | 位置 |
|---|---|---|---|
| 1 | **MAJOR** | bash `unrestricted` 无法真正放开 cwd — `resolvePath` 先于 `isBashAllowed` 执行，`guardPath` 强制 cwd 在 workingDir/skillsDir 内，`unrestricted` 分支永远执行不到 | `builtin.ts:487-489` |
| 2 | **MAJOR** | bash 输出 `slice(0, 4000)` 截断 — 中文 ~6000 tokens < 8000 单结果预算，bash 永不触发溢出，计划核心验收场景不可达成 | `builtin.ts:517` |
| 3 | MINOR | `resolveRef` 空 if 块死代码 | `tool-result-tools.ts:48-51` |
| 4 | MINOR | 并行分支 `?? outcome.result` 永不触发，注释误导 | `runner.ts:2099` |
| 5 | MINOR | stat_file 描述("超过64KB仅报告字节数")与实际行为(返回lines+/chars+近似值)不一致 | `builtin.ts:184` |
| 6 | MINOR | `wrapToolWithCap` 死代码，无生产调用，计划 §11 明确排除 | `tool-result-cap.ts:309-321` |

### 二、可读性

整体良好。命名清晰、分段注释充分。

| # | 严重度 | 发现 |
|---|---|---|
| 7 | MINOR | `getToolsSystemPromptBlock` destructive 分支与常规分支重复构建，可合并 |

### 三、架构

模块边界清晰，依赖方向正确。

| # | 严重度 | 发现 |
|---|---|---|
| 8 | MINOR | `isToolVisibleToAgent` 当前为惰性机制 — worker 不传 agentId，执行边界不校验可见性 |
| 9 | MINOR | `readOnlyExtraRoots` 实现了但无人调用（5 个读工具均未传） |
| 10 | MINOR | worker 无取回工具 — `withoutDispatchTools` 不含 `TOOL_RESULT_TOOLS` |

### 四、安全

| # | 严重度 | 发现 |
|---|---|---|
| 11 | MINOR | 取回工具 symlink 越读风险 — `path.resolve` + `startsWith` 不解析 symlink |
| 12 | MINOR | `tool_result_search` 正则 ReDoS 风险 |

### 五、性能

| # | 严重度 | 发现 |
|---|---|---|
| 13 | MINOR | `tool_result_search` 整文件同步读取 (`readFileSync`) |
| 14 | MINOR | 并行分支 mutex 包裹整个 capToolResult（含磁盘写），粒度偏大 |

## 与 Plan 一致性

| 项 | 状态 |
|---|---|
| 5 个新模块 + 测试 | ✅ |
| builtin.ts 扩展 | ✅ |
| runner 双分支 + 账本 + mutex + 可见性过滤 | ✅ |
| paths.ts toolResultsDir + ensureDataLayout | ✅ |
| chat.ts 集成 (sweep//mode//tools//gc/banner/toolsBlock) | ✅ |
| vitest include src/**/*.test.ts | ✅ |
| plan §10.1 menu.ts TOOL_EXEC_MODE banner | ⚠️ 未实现（仅 chat 启动 banner 有） |
| plan §11 排除 wrapToolWithCap | ⚠️ 实现为死代码 |
| plan §3.2.3 读工具传 readOnlyExtraRoots | ⚠️ 未接线 |
| plan §6.2 bash >8K token 溢出验收 | ⚠️ 不可达成（MAJOR-2） |

## Skills 使用

- `code-review-and-quality` loaded — 五轴框架 + BLOCKER/MAJOR/MINOR/NICE 分级
