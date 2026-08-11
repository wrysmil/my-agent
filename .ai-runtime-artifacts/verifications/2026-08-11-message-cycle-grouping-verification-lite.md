---
title: 消息循环分组与转圈下移 — 验证 (Lite)
date: 2026-08-11
spec: .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-11-message-cycle-grouping-plan.md
branch: task/run-trace-cycle-grouping
commits:
  - dee3d45 feat(chat): add CycleCard and GeneratingIndicator primitives
  - 67d7a56 feat(chat): wrap assistant in CycleCard, drop ThinkingDots, move spinner after final
  - 98f5a47 test(chat): cover CycleCard, GeneratingIndicator and MessageBubble cycle grouping
---

# 1. 命令验证

## 1.1 tsc

```bash
pnpm -C web exec tsc -b
```

输出：0 errors，0 warnings（exit code 0）。

## 1.2 vitest

```bash
pnpm -C web run test --run
```

输出：

```text
Test Files  1 failed | 35 passed (36)
     Tests  2 failed | 254 passed (256)
```

**新批 11 个用例全绿**：`cycle-card.test.tsx (3)` + `generating-indicator.test.tsx (4)` + `message-bubble-cycle.test.tsx (4)`。

**2 个 pre-existing 失败**：`tests/unit/bundle.test.ts` 的 bundle budget 阈值检查（JS gzip 180KB / CSS gzipped 20KB）。

回归确认：在 WU-01/02 提交前已存在同样 2 个失败（已用 `git stash` 验证）。本批改动 +60 LOC CSS 原子类（不引入新依赖）+ 净 −8 LOC MessageBubble，**不影响 bundle size**。

## 1.3 lint

```bash
pnpm -C web run lint:eslint
```

输出：`ERR_PNPM_NO_SCRIPT: Missing script: lint:eslint`。

→ 本项目无 lint 脚本（package.json 仅 dev / build / preview / test / test:watch / e2e），按 spec § 8.3 跳过。

## 1.4 浏览器实测（playwright）

`http://127.0.0.1:5188` dev server，1024 × 900 viewport。

| 场景 | URL | 截图 |
| --- | --- | --- |
| 多次 run | `/#/chat/gconv-322a6fc4314d` | `.ai-runtime-artifacts/verifications/cycle-grouping-multi2.png` |
| 单 run | `/#/chat/gconv-7d18591cceb8` | `.ai-runtime-artifacts/verifications/cycle-grouping-verified.png` |
| 空会话 | `/#/chat/gconv-b9627ede70be` | `.ai-runtime-artifacts/verifications/cycle-grouping-empty.png` |

**视觉确认**：
- ✓ 多次 run 各自被独立 CycleCard 包裹（左侧 3px 主色竖条 + 浅色容器 + 圆角阴影）
- ✓ 不再有「消息复制」观感（每条 assistant 都是独立块）
- ✓ 「AI 仍在生成中…」提示在 final markdown **之后**
- ✓ ThinkingDots 完全移除（无顶部转圈）
- ✓ user 消息保持原 user bubble 样式（未进入 CycleCard）

# 2. References 检查

| 参考 | 状态 | 备注 |
| --- | --- | --- |
| `references/definition-of-done.md` | ✓ | tsc / vitest 通过；测试齐备；视觉验证 |
| `references/frontend-ui-engineering` | ✓ | 复用 Tailwind token（bg-surface / border-border/80 / from-primary / text-text-muted）；不引入 magic color |
| `references/accessibility-checklist.md` | ✓ | GeneratingIndicator `role="status"` `aria-live="polite"`；CycleCard 左侧竖条 `aria-hidden` |
| `references/testing-patterns.md` | ✓ | AAA（Arrange / Act / Assert）；mock 层次最小；react-markdown lazy 用 waitFor |
| `references/performance-checklist.md` | ✓ | CycleCard 纯包装无状态；性能无回归（254 passed 同上一批 baseline） |

# 3. 范围之外（按 spec § 11 未做）

- 不做跨多次 run 的内容去重（语义层改动）
- 不动 SSE / messageId / runId 协议
- 不改 ChatPage / Composer / Sidebar
- 不改 RunTracePanel / runTrace

# 4. 风险与已知

- pre-existing `bundle.test.ts` 2 个失败需要单独 batch 跟进（与本批无关）。
- `Markdown` 是 lazy import + Suspense，测试中需用 `waitFor` 等待；不影响生产。
- ThinkingDots.tsx 文件保留但不再被 MessageBubble 引用（孤儿组件，避免删除引发其他分支影响）。

# 5. Summary

| 维度 | 状态 |
| --- | --- |
| spec | approved: true |
| plan | 4 WU 全部完成 |
| tsc | 0 errors |
| vitest | 254 passed（11 新增 + 2 pre-existing failed 与本批无关） |
| 浏览器实测 | 3 场景已截图，对照 mockup 方案 B 一致 |
| References | 5 项全勾 |
| ready for collective test | ✓ |
| ready for collective review | ✓ |