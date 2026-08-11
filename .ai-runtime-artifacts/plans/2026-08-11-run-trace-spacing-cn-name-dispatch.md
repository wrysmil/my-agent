---
artifact: implementation-dispatch
route: orchestration:dispatcher-workflow
plan: .ai-runtime-artifacts/plans/2026-08-11-run-trace-spacing-cn-name-plan.md
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/)
  - orchestration/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-spacing-cn-name-spec.md
  - core/orchestration/dispatcher-workflow.md
created_at: 2026-08-11
status: draft
approved: false
branch: task/run-trace-cycle-grouping
---

# Run Trace v3.1 — Harness 执行图

> 实施步骤以 **plan** 为准；本文件只描述并行 GROUP / WU 与派发。
> 多轮审阅时优先改本文件，避免扰动 plan 内 Task 细步。

## 执行图

```markdown
GROUP-1: UI 修订收尾 + bug fix（单 coder WU；按 plan Task 顺序串行）
  WU-01: 视觉降级 + 切会话 bug fix | 标题: Run Trace v3.1 视觉与 bug fix | 文件: web/src/components/chat/{RunTracePanel,CycleCard,MessageBubble,GeneratingIndicator}.tsx + 5 个测试文件 | 依赖: 无 | wu_type: feature | agent_role: coder | workspace_scope: wu | worktree_path: <由 dispatch-track 写入> | branch: task/run-trace-cycle-grouping | wu_skills: auto
```

> **决策说明**：本批 5+ 文件改动均强耦合（结构 + 样式 + 测试断言共享），并行拆分风险大于收益。**单 WU 串行实施**，由 `coder` agent 在当前 worktree 内完成。

## 派发要素（Prompt 必备字段）

- **角色**：coder（按 `.agents/agents/coder.md` → `core/orchestration/agents/coder.md`）
- **任务 ID**：WU-01
- **spec**：`specs/2026-08-11-run-trace-spacing-cn-name-spec.md`
- **plan**：`plans/2026-08-11-run-trace-spacing-cn-name-plan.md`
- **dispatch**：`plans/2026-08-11-run-trace-spacing-cn-name-dispatch.md`（本文件）
- **目标分支**：`task/run-trace-cycle-grouping`（不新开 worktree）
- **worktree_path**：当前 worktree 即可（`d:\studyspace\project\my-agent`）
- **Stage Skills**（auto 解析）：
  - `verification-before-completion` — 每步改完跑 tsc + vitest
  - `incremental-implementation` — 小步替换，不大爆炸改
  - `source-driven-development` — 参考 `harness-kit/core/artifacts.md` 契约
- **必跑命令**：
  - `pnpm -C web exec tsc -b`
  - `pnpm -C web run test --run web/tests/features/chat/run-trace-panel.test.tsx`
  - `pnpm -C web run test --run`
  - `pnpm -C web run lint`
- **禁止**：
  - commit / push
  - 改 runTrace.ts / MessageList.tsx / useChatStream.ts / Markdown.tsx
  - 跳过测试更新
  - 同句"写计划然后执行"立即实现

## 返回格式（cagent 返回 → Leader 整合）

```markdown
WU-01 返回：
- 落地文件：<list>
- 测试更新：<list>
- tsc / vitest / lint：<pass/fail + 详情>
- 风险点 / 决策：<如有>
- 未做项 / 已知问题：<如有>
- 建议下一步：test-engineer WU / collective-test / code-review
```

## GROUP-2 — 测试补强（test-engineer WU，可选）

如果 WU-01 落地后 leader 决定需要独立测试视角验证，再派：

```markdown
GROUP-2: 独立测试覆盖（test-engineer）
  WU-02: 端到端测试 + 边界覆盖 | 标题: Run Trace v3.1 端到端测试 | 文件: web/tests/features/chat/run-trace-panel*.test.tsx 等 | 依赖: WU-01 | wu_type: test | agent_role: test-engineer | workspace_scope: wu | worktree_path: <同 WU-01> | branch: task/run-trace-cycle-grouping | wu_skills: auto
```

> **默认**：WU-01 自带测试更新（Task 1.5）。如需独立视角，Leader 在 WU-01 返回后决定派 WU-02。

## GROUP-3 — 尾盘

```markdown
GROUP-3: 尾盘
  WU-03: 集体测试 (collective-test) | 标题: v3.1 集体测试 | 文件: .ai-runtime-artifacts/verifications/2026-08-11-run-trace-spacing-cn-name-collective-test.md | agent_role: Leader | 依赖: WU-01 / WU-02
  WU-04: 集体审查 (code-review) | 标题: v3.1 集体审查 | 文件: .ai-runtime-artifacts/reviews/2026-08-11-run-trace-spacing-cn-name-code-review.md | agent_role: reviewer | 依赖: WU-03
  WU-05: leader 验证 + commit | 标题: v3.1 leader 验证 + commit | 文件: git commit | agent_role: Leader | 依赖: WU-04
```

> WU-03 / WU-04 / WU-05 串行执行，不可跳过。`code_review: PASS` 不替代集体测试。

## 变更记录（可选）

| 轮次 | 日期 | 变更摘要 |
| --- | --- | --- |
| 1 | 2026-08-11 | 初稿：单 WU-01（实施 + 测试），后续 GROUP-2/3 视情况派 |

## Next

执行图确认 → 说「开始实现」或「并行执行」
只改 plan 任务、不改并行策略 → 仅改 `*-plan.md`
只改 WU 拆分 / 依赖 → 改本文件并告知 Leader 审阅