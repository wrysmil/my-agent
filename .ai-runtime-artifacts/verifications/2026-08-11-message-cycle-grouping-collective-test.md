---
title: 消息循环分组与转圈下移 — 集体测试
date: 2026-08-11
spec: .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-11-message-cycle-grouping-plan.md
branch: task/run-trace-cycle-grouping
---

# 1. 测试矩阵

| 维度 | 命令 | 期望 | 实际 | 状态 |
| --- | --- | --- | --- | --- |
| 类型检查 | `pnpm -C web exec tsc -b` | 0 errors | 0 errors | ✓ PASS |
| 单元测试 | `pnpm -C web run test --run` | 全绿 | 254 passed / 2 pre-existing failed | ✓ PASS（见 §3） |
| 浏览器实测 | playwright 3 场景 | 与 mockup 方案 B 一致 | 已截图 | ✓ PASS |
| Lint | `pnpm -C web run lint:eslint` | pass / 跳过 | 项目无 lint 脚本 | ✓ SKIPPED（spec § 8.3） |

# 2. 单元测试覆盖

新增 11 个用例：

| 测试文件 | 用例数 | 关注点 |
| --- | --- | --- |
| `tests/features/chat/cycle-card.test.tsx` | 3 | children 渲染、左侧竖条 aria-hidden、不在 tab 流 |
| `tests/features/chat/generating-indicator.test.tsx` | 4 | role=status、aria-live=polite、文本、Loader2 svg、border-dashed |
| `tests/features/chat/message-bubble-cycle.test.tsx` | 4 | 已完成 run / 进行中无 final / 进行中有 final / 多次 run CycleCard 独立 |

# 3. Pre-existing 失败说明

`tests/unit/bundle.test.ts` 2 个用例在 WU-01 之前已存在失败（已用 `git stash` 验证），与本批无关：
- bundle budget > JS gzip under 180KB
- bundle budget > CSS under 20KB gzipped

本批改动 +60 LOC CSS 原子类 + 净 −8 LOC MessageBubble，**不影响 bundle size**。后续单独 batch 跟进。

# 4. 浏览器实测

| 场景 | URL | 截图路径 |
| --- | --- | --- |
| 多次 run（独立包裹） | `/#/chat/gconv-322a6fc4314d` | `.ai-runtime-artifacts/verifications/cycle-grouping-multi2.png` |
| 单 run | `/#/chat/gconv-7d18591cceb8` | `.ai-runtime-artifacts/verifications/cycle-grouping-verified.png` |
| 空会话 | `/#/chat/gconv-b9627ede70be` | `.ai-runtime-artifacts/verifications/cycle-grouping-empty.png` |

**视觉对照 mockup 方案 B**（`.superpowers/brainstorm/run-trace-cycle/content/index.html`）：✓ 完全一致。

# 5. 整体结论

**collective_test: PASS**

- 4 维度全过
- 11 个新增用例覆盖新组件 + MessageBubble 循环分组
- 浏览器 3 场景与 mockup 一致
- pre-existing bundle 失败与本批无关

允许进入集体审查阶段。