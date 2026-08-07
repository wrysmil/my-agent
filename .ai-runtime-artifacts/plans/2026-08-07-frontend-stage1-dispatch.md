---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-07-frontend-stage1-plan.md
skills:
  - orchestration
skills_evidence:
  - .claude/skills/orchestration/SKILL.md
source:
  - core/orchestration/dispatcher-workflow.md
  - adapters/claude/bindings.md
created_at: 2026-08-07
tier: 1
---

# 阶段1 前端基础积木 — Harness 执行图

> 实施步骤以 [plan](2026-08-07-frontend-stage1-plan.md) 为准；本文件只描述并行 GROUP / WU 与派发。

## Tier 判定

**Tier 1 — Leader 直做。** 所有 WU 均为纯新建文件（无后端依赖、无编译、无测试），文件间无交叉依赖（Task 1-4 完全独立），每文件 ~40-200 行。Leader 主线程直接实现，跳过 WorktreeInit，尾盘写 verification-lite。

## 执行图

```
GROUP-1（Tier 1 Leader 直做 — 顺序执行，无需并行子Agent）:
  WU-01: 图标系统 icons.js | 文件: src/renderer/js/shared/icons.js | 依赖: 无 | wu_type: feature | tier: 1
  WU-02: 工具函数+日志 utils.js + logger.js | 文件: src/renderer/js/shared/utils.js, logger.js | 依赖: 无 | wu_type: feature | tier: 1
  WU-03: 国际化 i18n.js + zh.json | 文件: src/renderer/js/shared/i18n.js, locales/zh.json | 依赖: 无 | wu_type: feature | tier: 1
  WU-04: 全局状态 state.js | 文件: src/renderer/js/state/state.js | 依赖: 无 | wu_type: feature | tier: 1

GROUP-2（依赖 GROUP-1）:
  WU-05: HTML/CSS重构 + 页面迁移 + 集成 | 文件: index.html, style.css, 迁移现有pages/*.js→features/*.js, main.cjs适配 | 依赖: WU-01~04 | wu_type: feature | tier: 1
```

## 变更记录

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-07 | 初稿 — Tier 1 Leader 直做 |

## Next

- 执行图确认 → Leader 直做实现
- 尾盘 → `verification-lite` + `execution-log` 落盘
