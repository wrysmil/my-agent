---
title: 消息循环分组与转圈下移 — Dispatch Plan
spec: .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
plan: .ai-runtime-artifacts/plans/2026-08-11-message-cycle-grouping-plan.md
date: 2026-08-11
branch: task/run-trace-cycle-grouping
---

# 0. 执行模式

- **Tier 2 编排**（worktree 本来按 cursor 路由硬触发要开；本批 < 100 行业务改动 + 串行 + 单 WU → **不开 worktree**，在主 checkout 直接做；分支切到 `task/run-trace-cycle-grouping` 后整批落地）。
- **串行执行**：4 WU 顺序依赖强，无并行收益。
- **dispatch 总车次**：1 次派发即可（所有 WU 集中在一个 dispatch cycle 内顺序跑）。
- **不使用** sub-agent（Leader 主线程写代码），但**测试与代码审查走 `test-engineer` 与 `reviewer` subagent 实例**（保证不同实例，避免自我审查）。

# 1. Worktree / Branch 初始化（Leader 主线程）

1. `git status` → 确认 `task/run-trace-typography` 是否已合入 develop。
   - 若已合：从 develop 拉新分支 `task/run-trace-cycle-grouping`。
   - 若未合：续在 `task/run-trace-typography` 上提交（commit 信息标注本次 batch）。
2. `git checkout -b task/run-trace-cycle-grouping`（如适用）。
3. `git status` 截图或输出记录到 dispatch-track。

# 2. WU 串行执行

```
[WU-01] 新组件 CycleCard + GeneratingIndicator
   ↓ Leader 主线程
[WU-02] MessageBubble 改造
   ↓ Leader 主线程
[WU-03] 测试补齐
   ↓ test-engineer subagent
[WU-04] tsc/lint/test/浏览器验证 + 文档
   ↓ implementer subagent + Leader 主线程
```

## 2.1 WU-01（coder = Leader 主线程）

- Read spec § 4、§ 6.1、§ 6.4。
- Write 新建 `web/src/components/chat/CycleCard.tsx`、`GeneratingIndicator.tsx`。
- 不引入 import cycle。
- 完成后 `pnpm -C web exec tsc -b` 验证。
- 落盘 commit：`feat(chat): add CycleCard and GeneratingIndicator primitives`

## 2.2 WU-02（coder = Leader 主线程）

- Read `MessageBubble.tsx` 现状。
- StrReplace 按 plan § 3 diff 改。
- grep 确认 `ThinkingDots` 0 命中。
- `pnpm -C web exec tsc -b` 验证。
- 落盘 commit：`feat(chat): wrap assistant in CycleCard, drop ThinkingDots, move spinner after final`

## 2.3 WU-03（test-engineer subagent）

- 派发 `test-engineer` subagent 实例。
- prompt 引用本 plan § 4 + spec § 8。
- 期望返回：测试代码 + 跑过的 `pnpm -C web run test --run` 输出片段。
- 不通过 → 回炉修改，回到 WU-02 末状态重测。
- 落盘 commit：`test(chat): cover CycleCard, GeneratingIndicator and MessageBubble cycle grouping`

## 2.4 WU-04（implementer subagent + Leader 主线程）

- Leader 主线程跑：
  - `pnpm -C web exec tsc -b`
  - `pnpm -C web run lint:eslint -- --max-warnings 0`
  - `pnpm -C web run test --run`
- implementer subagent 跑：
  - playwright 浏览器实测 2 条历史会话
  - 截图保存到 `.ai-runtime-artifacts/verifacts/` （实际写到 `verifications/`）
- Leader 主线程 Write：
  - `.ai-runtime-artifacts/verifications/2026-08-11-message-cycle-grouping-verification-lite.md`
  - 更新 `.ai-runtime-artifacts/execution-logs/2026-08-11-message-cycle-grouping-execution-log.md`
- 落盘 commit：`docs(chat): add verification lite for cycle grouping batch`

# 3. 集体测试 + 集体审查（GROUP 尾盘）

1. **集体测试**（`verification-before-completion` skill）：
   - Leader Write `verifications/2026-08-11-message-cycle-grouping-collective-test.md`
   - 覆盖：tsc + lint + vitest + playwright 4 维度。
2. **集体审查**（`requesting-code-review` skill）：
   - 派发 `reviewer` subagent 实例（与 implementer / test-engineer 不同实例）。
   - 5 轴 review：correctness / readability / architecture / security / performance。
   - Leader Write `.ai-runtime-artifacts/reviews/2026-08-11-message-cycle-grouping-code-review.md`。
   - **code_review: PASS** 才允许声称批次完成。

# 4. 提交与分支

- 单 batch 内 4 个 commit 顺序落到 `task/run-trace-cycle-grouping`。
- 批次完成后：
  - 不自动 merge（等用户确认）。
  - 不自动 push（`git push` 由用户触发）。
- 用户说「合」再走 MR / merge。

# 5. 与上一批的关系

- 上一批 `2026-08-11-run-trace-typography` 改动的是 `RunTracePanel.tsx` 内部（视觉、pill、a11y）。
- 本批改动的是 `MessageBubble.tsx` 与新增的 `CycleCard / GeneratingIndicator`（包裹层、转圈位置）。
- **两批文件无重叠**，互不阻塞；如需回退其中一批，diff 清晰。

# 6. 风险与熔断

- 若 WU-02 改动后既有 `MessageBubble.test.tsx` 失败 → 优先把回归用例迁移到新 `MessageBubble.cycle.test.tsx`，不回退 WU-02 设计。
- 若 WU-03 playwright 截图发现视觉偏差 → 回到 WU-02 调 CSS class，不调 spec。
- 若 spec 本身需要改（用户审查反馈）→ 暂停 dispatch，更新 spec → 重新派发。

# 7. Next

dispatch 落盘 → 暂停 → 等用户「开始实现 / 并行执行」。
串行模式预计一次发车即可完成全部 4 WU。