---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-05-my-agent-fix-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - ~/.claude/skills/writing-plans/SKILL.md
source:
  - core/orchestration/dispatcher-workflow.md
created_at: 2026-08-05
---

# My Agent 修复 — Harness 执行图

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。

## 执行图

```
GROUP-1（Phase 1 — 对话核心，文件不相交，可并行）:
  WU-1.1: Provider factory 注册 | 文件: src/providers/index.ts | 依赖: 无 | wu_type: feature | agent_role: coder
  WU-1.2: Config 读写对齐 + Provider 测试 | 文件: src/ipc/config.ts, src/storage/config-store.ts(新) | 依赖: 无 | wu_type: feature | agent_role: coder

  ─── barrier: WU-1.1 + WU-1.2 完成 ───

  WU-1.3: Chat IPC 重写 + AgentRunner 接入 | 文件: src/ipc/chat.ts, src/ipc/index.ts | 依赖: WU-1.1, WU-1.2 | wu_type: feature | agent_role: coder
  WU-1.4: 主进程入口 + 删除 main.ts | 文件: electron/main.cjs, electron/main.ts(删除) | 依赖: WU-1.3 | wu_type: feature | agent_role: coder

  ─── barrier: WU-1.3 完成 ───

  WU-1.5: Session 持久化 | 文件: src/ipc/sessions.ts | 依赖: WU-1.3 | wu_type: feature | agent_role: coder
  WU-1.6: Chat 页面修复 | 文件: electron/renderer/js/pages/chat.js | 依赖: WU-1.3, WU-1.5 | wu_type: feature | agent_role: coder

GROUP-2（Phase 2 — 管理功能，文件不相交，全部并行）:
  WU-2.1: 设置页重写 | 文件: electron/renderer/js/pages/settings.js | 依赖: GROUP-1 全部 | wu_type: feature | agent_role: coder
  WU-2.2: 会话管理完善 | 文件: electron/renderer/js/pages/sessions.js, src/ipc/sessions.ts | 依赖: GROUP-1 全部 | wu_type: feature | agent_role: coder

GROUP-3（Phase 3 — Skills + UI，文件不相交，全部并行）:
  WU-3.1: Skills IPC 接入 | 文件: src/ipc/skills.ts | 依赖: GROUP-2 全部 | wu_type: feature | agent_role: coder
  WU-3.2: Skills 页面去 Mock | 文件: electron/renderer/js/pages/skills.js | 依赖: WU-3.1 | wu_type: feature | agent_role: coder
  WU-3.3: 暗色主题 + UI 打磨 | 文件: electron/renderer/css/variables.css, electron/renderer/css/theme-dark.css(新), electron/renderer/js/app.js | 依赖: GROUP-2 全部 | wu_type: feature | agent_role: coder
```

## 各 WU Skills

| WU | Skills (coder 默认: auto → skill-preferences.md) |
|----|---------------------------------------------------|
| 全部 coder WU | `source-driven-development`, `test-driven-development`, `verification-before-completion` |

## 约束

- **禁止** Worker 修改 `src/agent/runner.ts`（核心引擎不改）
- **禁止** Worker 修改 `electron/preload.cjs`（IPC 协议不变）
- **禁止** Worker commit/push（Leader + git-xywh 执行）
- **禁止** 修改 `harness-kit/`、`test/` 目录

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-05 | 初稿 — 3 GROUP 10 WU |

## Next

- 执行图确认 → 说「开始实现」或「并行执行」
- 只改 plan 任务、不改并行策略 → 仅改 `*-plan.md`
- 只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅
