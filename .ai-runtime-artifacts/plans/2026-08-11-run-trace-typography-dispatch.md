---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-11-run-trace-typography-plan.md
skills:
  - orchestration
skills_evidence:
  - .agents/skills/orchestration/SKILL.md
source:
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/project.git.md § Harness 执行沙箱
  - .ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md
created_at: 2026-08-11
status: draft
approved: true
approved_by: 用户（2026-08-11）：「并行执行」
branch: task/run-trace-typography
base: feature/chat-run-trace-panel
---

# Run Trace 排版与字体优化 — Harness 执行图

> 实施步骤以 plan 为准；本文件只描述 GROUP / WU 与派发参数。

## Working Branch

| 项 | 值 |
| --- | --- |
| branch | `task/run-trace-typography` |
| base | `feature/chat-run-trace-panel`（当前主 checkout 切换完成） |
| worktree_path | 主 checkout（无独立 worktree；批次 ≤ 5 WU、文件清单互不重叠） |
| 主 checkout 路径 | `d:\studyspace\project\my-agent` |

**不**对 `feature/chat-run-trace-panel` 强推；本任务所有提交落在 `task/run-trace-typography` 上；合并由用户手动走 MR。

## 执行图

```markdown
GROUP-1:
  WU-01: 实现 extractKeyParams / KeyParam / shortenKeyParam，在 buildRunTrace 的 tool_call 段写入 keyParams，并补 4-6 个 runTrace.test.ts 单元 | 标题: Run Trace 关键参数派生 | 文件: web/src/features/chat/runTrace.ts, web/tests/features/chat/runTrace.test.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | branch: task/run-trace-typography | wu_skills: auto

GROUP-2:
  WU-02: 抽取 TraceRowCard 通用行组件，重写 ToolStepRow 主行 JSX，加入关键参数 pill 与错误整行红茶色；ThinkingStepRow 改为走 TraceRowCard 移除紫框；更新 13 个旧断言 | 标题: Run Trace 视觉改造 | 文件: web/src/components/chat/RunTracePanel.tsx, web/tests/features/chat/run-trace-panel.test.tsx | 依赖: WU-01 | wu_type: ui | agent_role: coder | workspace_scope: wu | branch: task/run-trace-typography | wu_skills: auto
  WU-03: 给 pill 补 aria-label + title 属性；不动 globals.css | 标题: pill a11y | 文件: web/src/components/chat/RunTracePanel.tsx | 依赖: WU-02 | wu_type: chore | agent_role: implementer | workspace_scope: wu | branch: task/run-trace-typography | wu_skills: auto

GROUP-3:
  WU-04: run-trace-panel-matrix.test.tsx 追加 4 个用例（窄屏 360px 无横滚、错误态 aria-label、键盘 Enter、pill 渲染） | 标题: 测试矩阵追加 | 文件: web/tests/features/chat/run-trace-panel-matrix.test.tsx | 依赖: WU-02, WU-03 | wu_type: test | agent_role: test-engineer | workspace_scope: wu | branch: task/run-trace-typography | wu_skills: auto

GROUP-4:
  WU-05: 执行日志 + spec approved 字段；不写业务代码 | 标题: 产物落盘 | 文件: .ai-runtime-artifacts/execution-logs/2026-08-11-run-trace-typography-execution-log.md, .ai-runtime-artifacts/specs/2026-08-11-run-trace-typography-redesign-spec.md | 依赖: WU-04 | wu_type: docs | agent_role: implementer | workspace_scope: wu | branch: task/run-trace-typography | wu_skills: auto
```

并行度：同组内 WU 串行（同文件 / 同组件）；跨组严格串行；总 ≤ 5 WU。

## 尾盘（GROUP-4 返回后，不可跳过）

1. **集体测试**（leader 主线程）：
   - 跑 plan § 6 的 5 条命令；
   - 写 `.ai-runtime-artifacts/verifications/2026-08-11-run-trace-typography-verification-lite.md`（含 `### References 检查` 对照 definition-of-done / testing-patterns / accessibility / performance）。
2. **集体审查**（委派 `reviewer` 子 Agent，**不同实例**）：
   - 范围：`web/src/components/chat/RunTracePanel.tsx` + `web/src/features/chat/runTrace.ts` + 四个 test 文件；
   - 维度：a11y、视觉对齐 mockup、错误态覆盖、窄屏无横滚、a11y 属性、可维护性。
3. Leader 写 `.ai-runtime-artifacts/reviews/2026-08-11-run-trace-typography-code-review.md` 整合。
4. 通过后才在 `feature/chat-run-trace-panel` 上 `git merge --no-ff task/run-trace-typography`（用户手动）。

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-11 | 初稿：5 个 WU / 4 个 GROUP |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改任务细步 → 改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件
- 改分支策略 → 改 `branch` 字段并写新 dispatch
