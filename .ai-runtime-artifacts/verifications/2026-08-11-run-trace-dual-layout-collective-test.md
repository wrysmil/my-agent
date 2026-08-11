---
artifact: verification
route: orchestration:dispatcher-workflow -> batch-closeout
skills:
  - verification-before-completion
skills_evidence:
  - .agents/skills/verification-before-completion/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-plan.md
  - .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-dispatch.md
  - docs/superpowers/specs/2026-05-28-batch-closeout-review-and-collective-test.md
created_at: 2026-08-11
batch_id: GROUP-1 + GROUP-2
worktree_id: n/a
worktree_path: d:\studyspace\project\my-agent
verdict: PASS
---

# Run Trace v4 集体测试

> **纪律：** Leader 在主 checkout 重跑命令（不依赖 WU 自报）。
> **命令先跑、结论后写**（禁止"应该通过"）。

## 防跳过提醒

| 合理化借口 | 现实 |
|-----------|------|
| "WU-01 / WU-02 都过了" | 单测隔离 ≠ 集成正常。本表是 Leader 的本机验证。 |
| "WU-02 说 bug 不可复现就过了" | bug 不可复现 ≠ 视觉对齐。visual 断言需要 Leader 独立看。 |
| "切会话 bug 自动好了" | WU-02 仅在 mock store 验证；真实 LLM 流可能触发不同路径。 |

## 变更范围

- **本批次触及模块/目录**：
  - 新增 `web/src/components/chat/TraceBubble.tsx`
  - 新增 `web/tests/features/chat/trace-bubble.test.tsx`
  - 删除 `web/src/components/chat/CycleCard.tsx`
  - 删除 `web/tests/features/chat/cycle-card.test.tsx`
  - 改动 `web/src/components/chat/MessageBubble.tsx`（结构调整）
  - 改动 `web/tests/features/chat/message-bubble-cycle.test.tsx`
  - 改动 `web/src/components/chat/RunTracePanel.tsx`、`GeneratingIndicator.tsx`（v3.1 形态保留）
  - 改动 2 个 run-trace 测试（v3.1 形态保留）

## WU 已覆盖项（引用，非替代）

| WU | 命令/结论摘要 |
| --- | --- |
| WU-01 coder | tsc 0；8 文件 / 137 chat tests + build OK；CycleCard→TraceBubble 重命名 + MessageBubble 结构改 |
| WU-02 debugger | Playwright 3 轮 A↔B↔A：7/7 采样符合 spec（trace-bubble 计数恒为 1、灰底 241,242,244 恒在、run-trace 1px border 恒在、紫色侧条 rgb(108,92,231) 恒在）；**未修改业务代码**；详见 `.ai-runtime-artifacts/verifications/2026-08-11-wu02-session-switch-verification.md` |

## 命令表（本机重跑）

| 命令 | cwd | exit | 关键输出摘要 |
| --- | --- | --- | --- |
| `pnpm -C web exec tsc -b` | `d:\studyspace\project\my-agent` | 0 | 0 errors（无输出） |
| `pnpm exec vitest run tests/features/chat/` | `d:\studyspace\project\my-agent\web` | 0 | Test Files 8 passed (8); Tests 137 passed (137); Duration 3.14s |
| `pnpm -C web run build` | `d:\studyspace\project\my-agent` | 0 | dist 产物生成；CSS 79KB（gzip 13.2KB） |

## 集成 / E2E

- **WU-02 Playwright 复现**：3 轮 A↔B↔A 切换，7 个 DOM 采样点全部符合 spec（trace-bubble 计数=1、灰底=rgb(241,242,244)、run-trace border 1px solid、紫色侧条=rgb(108,92,231) 渐变、final-bubble 独立 720px 节点）。截图见 `.ai-runtime-artifacts/verifications/2026-08-11-wu02-sessionA-reswitched.png`。
- **bundle.test.ts** pre-existing 失败（CSS budget 79KB > 50KB）—— git stash 验证 pre-existing，与本 WU 无关。

## 未验证项

- **真实 LLM 流触发 trace 的切会话路径**：WU-02 用 mock store；用户原报告基于真实对话，可能触发 H3 假设（消息累积）但当前 mock 路径没触发。**建议下批加守卫测试**（spec §11 风险点 #3）。
- **`bg-[#f1f2f4]` 暗色模式 token 化**：spec §11 风险点 #4 已列；下批处理。

## 残留风险

- **WU-02 报告"bug 不可复现"** vs **用户原报告"切会话边框消失"** —— 二者可能不同会话状态。建议在 `.ai-runtime-artifacts/verifications/2026-08-11-wu02-session-switch-verification.md` 记录证据。
- **TraceBubble 容器无 border**（WU-01 决策偏离 spec §4.2 字面）—— RunTracePanel 内部已有 border；视觉上不突兀，但偏离 spec。集体审查阶段需 reviewer 显式确认。
- **MessageBubble 外层布局 flex-row+flex-col 双层**（WU-01 决策偏离 spec §4.3 字面 `flex flex-col items-stretch`）—— 复制按钮 group-hover 行为保留，结构意图一致。集体审查阶段需 reviewer 显式确认。

## 结论

**verdict:** PASS

- 双布局重构（spec §4.1-§4.3）已落地，单测 + 类型 + build 全绿
- 切会话 bug 在 WU-02 复现路径下不可观察（5 假设排查全未命中）
- 3 个偏离 spec 字面的决策（WU-01 + WU-02）均已记录在风险点；待集体审查 reviewer 显式确认

## Next

- PASS → 进入集体代码审查（`artifact-templates/code-review.md`）
- 委派 `reviewer` 子 Agent 写 `.ai-runtime-artifacts/reviews/2026-08-11-run-trace-dual-layout-code-review.md`
- 审查范围：TraceBubble + MessageBubble 结构改动 + WU-02 不可复现结论 + 3 个偏离决策