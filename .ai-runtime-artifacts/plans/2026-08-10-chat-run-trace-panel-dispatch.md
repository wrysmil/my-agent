---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-10-chat-run-trace-panel-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - "skipped: writing-plans (未安装)"
  - .agents/skills/orchestration/SKILL.md
source:
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/project.git.md § Harness 执行沙箱
  - .ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md
created_at: 2026-08-10
approved: true
approved_by: 用户（2026-08-10）：选择「就按这个执行图开始实现」
---

# Chat Run Trace 过程面板 — Harness 执行图

> 实施步骤以 plan 为准；本文件只描述 GROUP / WU 与派发参数。

## Worktree

| 项 | 值 |
| --- | --- |
| worktree_path | `d:\studyspace\project\.harness-worktrees\my-agent\wt-2026-08-10-chat-run-trace-panel` |
| branch | `harness/wt-2026-08-10-chat-run-trace-panel` |
| base | `main`（当前 HEAD `1daf953`） |
| 命令 | `git worktree add -b harness/wt-2026-08-10-chat-run-trace-panel <worktree_path> main` |

编排产物（plan / dispatch / execution-log / track / 尾盘产物）始终写在主 checkout；业务代码只在 `worktree_path`。

## 执行图

```markdown
GROUP-1:
  WU-01: 实现 runTrace 派生层与单元测试（buildRunTrace / hasTraceSteps / toolActionLabel / formatDuration / formatInputPreview 迁移） | 标题: Run Trace 派生层 | 文件: web/src/features/chat/runTrace.ts, web/tests/features/chat/runTrace.test.ts | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: d:\studyspace\project\.harness-worktrees\my-agent\wt-2026-08-10-chat-run-trace-panel | branch: harness/wt-2026-08-10-chat-run-trace-panel | wu_skills: auto

GROUP-2:
  WU-02: 实现 RunTracePanel 组件族（摘要行 + timeline + 两类步骤行 + 自动展开策略）与组件测试 | 标题: Run Trace 面板组件 | 文件: web/src/components/chat/RunTracePanel.tsx, web/tests/features/chat/run-trace-panel.test.tsx | 依赖: WU-01 | wu_type: ui | agent_role: coder | workspace_scope: wu | worktree_path: 同上 | branch: 同上 | wu_skills: auto
  WU-03: 新增 timeline 视觉基础类并纳入 prefers-reduced-motion 与 focus-visible | 标题: timeline 视觉与 a11y 基础 | 文件: web/src/styles/globals.css | 依赖: 无 | wu_type: chore | agent_role: implementer | workspace_scope: wu | worktree_path: 同上 | branch: 同上 | wu_skills: auto

GROUP-3:
  WU-04: MessageBubble 接线新面板、最终答案移出过程容器、下线 ProcessTracker/ActivityStrip/ThinkingBlock/ToolCallBlock/ToolResultBlock 并清理残留 import | 标题: MessageBubble 接线与旧组件下线 | 文件: web/src/components/chat/MessageBubble.tsx, web/src/components/chat/ProcessTracker.tsx(删除), web/src/components/chat/ActivityStrip.tsx(删除), web/src/components/chat/ThinkingBlock.tsx(删除), web/src/components/chat/ToolCallBlock.tsx(删除), web/src/components/chat/ToolResultBlock.tsx(删除), web/tests/unit/message-copy.test.tsx | 依赖: WU-02, WU-03 | wu_type: refactor | agent_role: coder | workspace_scope: wu | worktree_path: 同上 | branch: 同上 | wu_skills: auto

GROUP-4:
  WU-05: 补齐 spec § 9 测试矩阵（五类消息形态、历史与实时同构、a11y、响应式） | 标题: Run Trace 测试矩阵 | 文件: web/tests/features/chat/run-trace-panel-matrix.test.tsx | 依赖: WU-04 | wu_type: test | agent_role: test-engineer | workspace_scope: wu | worktree_path: 同上 | branch: 同上 | wu_skills: auto
```

并行度：GROUP-2 内 2 个 WU 并行（文件不重叠）；其余 GROUP 串行，均 ≤5。

## 尾盘（GROUP-4 返回后，不可跳过）

1. 集体测试 → Write `.ai-runtime-artifacts/verifications/2026-08-10-chat-run-trace-panel-collective-test.md`（含 `### References 检查`，对照全部 7 个 reference）
2. 集体审查 → 委派 `reviewer`（与实现不同实例）→ Leader Write `.ai-runtime-artifacts/reviews/2026-08-10-chat-run-trace-panel-code-review.md`
3. 更新 `.ai-runtime-artifacts/execution-logs/` 执行日志后才可声称批次完成

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-10 | 初稿：5 个 WU / 4 个 GROUP，GROUP-2 并行 |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改任务细步 → 改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件
