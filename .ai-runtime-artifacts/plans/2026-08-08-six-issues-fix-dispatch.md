---
artifact: dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-08-six-issues-fix-plan.md
created_at: 2026-08-08
worktree: .claude/worktrees/wt-2026-08-08-six-issues-fix
---

# 6 项问题修复 — 执行图

## 执行图

```
GROUP-P0（串行 — 基础修复，先执行）:
  WU-P0: Task 1 (API Key 加载) + Task 2 (Chat SSE 修复)
  | 文件: bin/my-agent-web.ts, src/config/loader.ts, src/web/server/routes/providers.ts,
  |       src/web/server/routes/messages.ts, web/src/features/chat/useChatStream.ts
  | 测试: test/config.test.ts, src/web/server/index.test.ts
  | 依赖: 无
  | wu_type: fix
  | agent_role: coder
  | wu_skills: test-driven-development, source-driven-development
         ↓ (P0 完成后并行)
GROUP-P1:                               GROUP-P2:
  WU-P1: Task 3 (Session) +              WU-P2: Task 6 (Logging) +
         Task 4 (i18n hook) +                   Task 7 (Config API) +
         Task 5 (i18n UI)                       Task 8 (Settings UI)
  | 依赖: GROUP-P0                       | 依赖: 无
  | agent_role: coder                    | agent_role: coder
  | wu_skills: test-driven-development,  | wu_skills: test-driven-development,
  |   frontend-ui-engineering            |   observability-and-instrumentation
```

## 派发批次

### Batch 1: WU-P0（阻塞性修复）

1 个 coder agent，执行 plan Task 1 + Task 2（串行依赖，同 agent 处理）。

### Batch 2: WU-P1 ∥ WU-P2（P0 完成后并行派发）

2 个 coder agent 并行。

## 尾盘

全部 GROUP 完成后：collective-test → 并行审查 → Leader 落盘产物
