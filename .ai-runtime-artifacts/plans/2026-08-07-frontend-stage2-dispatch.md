---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage2-plan.md
skills:
  - orchestration
skills_evidence:
  - harness-kit/core/orchestration/dispatcher-workflow.md
source:
  - harness-kit/core/orchestration/dispatcher-workflow.md
  - harness-kit/core/orchestration/skill-preferences.md
created_at: 2026-08-07
---

# 阶段2：IPC 通信增强 — Harness 执行图

> 实施步骤以 [plan](2026-08-07-frontend-stage2-plan.md) 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```
GROUP-1（并行，2 WU）:
  WU-01: Preload API 增强（stream {promise,cancel} + push白名单 + 统一invoke）
  WU-02: Main 进程 Handler 适配（myagent.streamStart/streamCancel + chat.js 重写）

GROUP-2（串行，依赖 GROUP-1 全部完成）:
  WU-03: IPC 路由垫片 + 聊天适配（ipc-shim.js 新建 + api.js 兼容层 + chat.js 流式适配）
```

```
┌─────────────────┐     ┌──────────────────────────┐
│ WU-01           │     │ WU-02                     │
│ preload.cjs     │     │ main.cjs + chat.js (ipc)  │
│ 1 file, ~80行   │     │ 2 files, ~80行            │
└────────┬────────┘     └────────────┬─────────────┘
         │                           │
         └──────────┬────────────────┘
                    │ GROUP-1 完成
                    ▼
         ┌─────────────────────────────────────┐
         │ WU-03                                │
         │ ipc-shim.js + api.js + chat.js       │
         │ 3 files, ~100行                      │
         └─────────────────────────────────────┘
                    │
                    ▼
            阶段2 完成
```

## WU 详情

### GROUP-1

```markdown
WU-01:
  标题: Preload API 增强
  文件: dist/electron/preload.cjs
  依赖: 无
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  worktree_path: <WORKTREE>
  branch: feature/frontend
  wu_skills: incremental-implementation, verification-before-completion

WU-02:
  标题: Main 进程 Stream Handler 适配
  文件: dist/electron/main.cjs, dist/src/ipc/chat.js
  依赖: 无
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  worktree_path: <WORKTREE>
  branch: feature/frontend
  wu_skills: incremental-implementation, verification-before-completion
```

### GROUP-2

```markdown
WU-03:
  标题: IPC 路由垫片 + 聊天流式适配
  文件: src/renderer/js/ipc/ipc-shim.js, src/renderer/js/ipc/api.js, src/renderer/js/features/chat.js
  依赖: WU-01, WU-02
  wu_type: feature
  agent_role: coder
  workspace_scope: wu
  worktree_path: <WORKTREE>
  branch: feature/frontend
  wu_skills: incremental-implementation, verification-before-completion
```

## 文件不相交验证

| 文件 | WU-01 | WU-02 | WU-03 |
|---|---|---|---|
| `dist/electron/preload.cjs` | ✅ | — | — |
| `dist/electron/main.cjs` | — | ✅ | — |
| `dist/src/ipc/chat.js` | — | ✅ | — |
| `src/renderer/js/ipc/ipc-shim.js` | — | — | ✅ |
| `src/renderer/js/ipc/api.js` | — | — | ✅ |
| `src/renderer/js/features/chat.js` | — | — | ✅ |

**GROUP-1 内 WU-01 与 WU-02 文件完全不相交，可安全并行。**

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿 |
