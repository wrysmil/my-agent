---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/)
  - orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - core/orchestration/dispatcher-workflow.md
created_at: 2026-08-11
status: draft
approved: false
branch: task/run-trace-cycle-grouping
---

# Run Trace v4 — Harness 执行图

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```markdown
GROUP-1: 双布局重构（单 coder WU；按 plan Task 1.1-1.4 串行）
  WU-01: CycleCard→TraceBubble 重命名 + MessageBubble 结构 | 标题: Run Trace v4 双布局 | 文件: web/src/components/chat/{CycleCard→TraceBubble,MessageBubble}.tsx + 2 个测试文件 | 依赖: 无 | wu_type: ui | agent_role: coder | workspace_scope: wu | worktree_path: 当前 worktree | branch: task/run-trace-cycle-grouping | wu_skills: auto

GROUP-2: 切会话 bug 诊断 + 修复（单 coder WU；按 plan Task 2.1-2.4 串行；诊断在修复前）
  WU-02: 启 vite + Playwright 复现 + DOM 检查 + 根因定位 + 修复 | 标题: Run Trace v4 切会话 bug fix | 文件: MessageList.tsx / useChatStream.ts / MessageBubble.tsx（按根因） | 依赖: WU-01（先重构后修复） | wu_type: ui-bug | agent_role: debugger | workspace_scope: wu | worktree_path: 当前 worktree | branch: task/run-trace-cycle-grouping | wu_skills: auto

GROUP-3: 尾盘（串行）
  WU-03: 集体测试 (collective-test) | 标题: v4 集体测试 | 文件: .ai-runtime-artifacts/verifications/2026-08-11-run-trace-dual-layout-collective-test.md | agent_role: Leader | 依赖: WU-01 / WU-02
  WU-04: 集体审查 (code-review) | 标题: v4 集体审查 | 文件: .ai-runtime-artifacts/reviews/2026-08-11-run-trace-dual-layout-code-review.md | agent_role: reviewer | 依赖: WU-03
  WU-05: leader 验证 + commit | 标题: v4 leader commit | 文件: git commit | agent_role: Leader | 依赖: WU-04
```

## WU-01 派发要素（coder）

- **角色**：coder
- **任务 ID**：WU-01
- **spec / plan / dispatch**：见 header
- **目标分支**：`task/run-trace-cycle-grouping`
- **worktree_path**：当前 worktree（`d:\studyspace\project\my-agent`）
- **Stage Skills**（auto 解析，wu_type=ui）：
  - `frontend-ui-engineering`
  - `incremental-implementation`
  - `verification-before-completion`
  - `requesting-code-review`
  - `source-driven-development`
- **必跑命令**：
  - `pnpm -C web exec tsc -b`
  - `pnpm exec vitest run tests/features/chat/`
  - `pnpm -C web run build`
- **禁止**：commit / push / 改 runTrace.ts / 改 RunTracePanel.tsx / 改 Markdown.tsx / 切会话 bug 修复（属 WU-02）

## WU-02 派发要素（debugger）

- **角色**：debugger
- **任务 ID**：WU-02
- **依赖**：WU-01（先重构）
- **Stage Skills**（auto 解析，wu_type=ui-bug）：
  - `systematic-debugging`
  - `source-driven-development`
  - `verification-before-completion`
  - `browser-testing-with-devtools`
- **必须先诊断再修复**（plan §GROUP-2 流程）
- **必跑命令**：
  - `pnpm -C web run dev`（启 vite，端口看实际）
  - Playwright MCP：开 A → 切 B → 切回 A → DOM 检查
  - 修复后重跑 vitest

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-11 | 初稿：双 WU-01（重构）+ WU-02（bug fix），串行依赖 |

## Next

执行图确认 → 说「开始实现」或「并行执行」。