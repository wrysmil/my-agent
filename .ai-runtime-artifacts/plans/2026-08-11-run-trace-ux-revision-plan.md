---
title: Run Trace UX 修订实施计划
status: ready
approved: true
date: 2026-08-11
spec: .ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md
prev-plan: .ai-runtime-artifacts/plans/2026-08-11-message-cycle-grouping-plan.md
---

# 1. 背景

实现 spec §4 三个修订：左侧时间线显示工具名 + 已完成 run 默认展开 + resetKey 防状态泄漏。

# 2. 执行图

WORKTREE-INIT：**SKIPPED**（理由：沿用 `task/run-trace-cycle-grouping` 分支，user 已在该分支确认 spec；worktree 的分支隔离不适用已有 task 分支。上轮 cycle grouping 同样在主 checkout 完成。本批次 worker cwd 仍为 `d:\studyspace\project\my-agent`，但 worker 必须**不得**触碰下列禁改文件。）

> 若未来 user 要求 worktree 隔离，需先与 user 确认 base 分支，再回退到本 plan 之前。

## 2.1 文件归属

| 文件 | WU-R1 | WU-R2 | WU-R3 | 备注 |
|---|---|---|---|---|
| `web/src/components/chat/RunTracePanel.tsx` | ✅ | ✅ | ✅ | 唯一实现文件，三 WU 顺序改 |
| `web/src/components/chat/MessageBubble.tsx` | ✅ | ✅ | ✅ | 仅 WU-R1 改一次（传 resetKey），后续 WU 不再碰 |
| `web/tests/features/chat/run-trace-panel.test.tsx` | ❌ | ❌ | ✅ | |
| `web/tests/features/chat/run-trace-panel-matrix.test.tsx` | ❌ | ❌ | ✅ | |
| `web/tests/features/chat/message-bubble-cycle.test.tsx` | ❌ | ❌ | ✅ | |
| `.ai-runtime-artifacts/specs/...` | ❌ | ❌ | ❌ | spec 已写完 |
| `.ai-runtime-artifacts/plans/...` | ❌ | ❌ | ❌ | plan + dispatch 本回合写完 |
| `.ai-runtime-artifacts/execution-logs/...` | ❌ | ❌ | ✅ | Leader 收尾时 Write |

## 2.2 WU 编排（全部顺序，文件耦合）

### WU-R1 — 实现 RunTracePanel + MessageBubble（agent_role: coder）

- **cwd**：`d:\studyspace\project\my-agent`
- **Done criteria**：
  1. `RunTracePanel.tsx` 新增 `resetKey?: string` prop；`useEffect` 监听 `resetKey` 变化 → 重置 `userOverride=false`、`expanded=shouldAutoExpand(...)`、`openStepIds=new Set()`。
  2. `shouldAutoExpand` 新增分支：`!isStreaming && errorCount === 0` → `true`（已完成无错误默认展开）。
  3. `StepNode`（原 269-301 行）拆为「**身份文本**」+「**右上徽章**」组合：
     - 身份文本（中央）：tool 节点显示 `toolName`（`font-mono text-[11px] tabular-nums`，超过 10 字符截断 + `title`）；thinking 节点显示「思考」；error 节点显示「错误」；running 节点显示「执行中」。
     - 右上徽章：`absolute` 在中央文字右上 `top-[2px] left-[calc(50%+24px)]`（近似），与原文 `StepNode` 圆点同尺寸 `h-3 w-3`，保留颜色/图标编码。
  4. `<li>` 的 `pl-[34px]` 改为 `pl-[88px]`（容纳最长 10 字符 mono 工具名 + 徽章）。
  5. `data-trace-line`（虚线串联）的 `left-[19px]` 调整为 `left-[82px]`（节点中心）。
  6. `MessageBubble.tsx` 给 `RunTracePanel` 加 `resetKey={message.id}`。
  7. 自检：`pnpm -C web exec tsc -b` 零误差。
- **Skills**：coder 默认 + `frontend-ui-engineering`（UI 改动）
- **验证命令**：
  ```
  pnpm -C web exec tsc -b
  pnpm -C web run test --run --reporter=basic web/tests/features/chat/run-trace-panel.test.tsx
  ```
  （允许这两个文件相关测试在 WU-R3 之前暂时 FAIL，因 WU-R3 才更新断言；其他测试必须保持绿）
- **允许修改**：`RunTracePanel.tsx`、`MessageBubble.tsx`
- **禁止**：其他 src / test / spec / plan / log 文件；不 commit
- **返回**：`wu_status: pass | fail`、`self_check`、`code_review`（轻量）、`### Skills 使用`

### WU-R2 — 测试更新（agent_role: test-engineer）

- **cwd**：`d:\studyspace\project\my-agent`
- **Done criteria**：
  1. `run-trace-panel.test.tsx` 新增 / 调整：
     - 节点身份文本断言：tool 节点 `screen.getByText(toolName)`、thinking 节点 `getByText('思考')`；超长截断 + `title`。
     - 右上徽章：done tool → `Check` 图标 + `text-green-600`；running → spinner + `text-primary`；error → `AlertCircle` + `text-danger`；thinking done → `Check` + `text-text-muted`。
     - `<li>` `class` 含 `pl-[88px]`（不是 `pl-[34px]`）。
     - 默认展开：`isStreaming=false` + `errorCount=0` → `<ol>` 不带 `hidden` / 父 `div` 不带 `hidden`。
     - 默认折叠：仅 `isStreaming=true && hasFinalText=true` 时折叠。
     - userOverride：手动点折叠后，effect 不再拉回展开。
     - resetKey 变化：rerender 时换 resetKey → 步骤详情关闭、userOverride 清空、expanded 重算。
  2. `run-trace-panel-matrix.test.tsx`：
     - 360 px 窄屏无水平滚动。
     - 多步骤节点身份文本并列可见。
     - 暗色模式颜色 token 派生。
  3. `message-bubble-cycle.test.tsx`：
     - 加 `RunTracePanel` 的 `resetKey === message.id` 断言（可通过 `screen.getByTestId` 或 spy on prop，或渲染时把 `resetKey` 透传到 DOM 标识）。
- **Skills**：test-engineer 默认 + `test-driven-development`
- **验证命令**：
  ```
  pnpm -C web run test --run --reporter=basic
  ```
- **允许修改**：三个测试文件
- **禁止**：实现文件；spec / plan / log；不 commit
- **返回**：`wu_status`、`### Skills 使用`

### WU-R3 — Leader 收尾（Leader 主线程 / Tier 1 自打包）

- **cwd**：`d:\studyspace\project\my-agent`
- **Done criteria**：
  1. `pnpm -C web exec tsc -b` 零误差。
  2. `pnpm -C web run test --run` 全绿。
  3. 浏览器 visual 验证（vite dev server，Playwright 截图）：同会话两次 run 折叠态能看到工具名；历史会话默认展开；切会话回来 RunTracePanel 状态被重置。
  4. 落盘：
     - `.ai-runtime-artifacts/verifications/2026-08-11-run-trace-ux-revision-verification-lite.md`
     - `.ai-runtime-artifacts/execution-logs/2026-08-11-run-trace-ux-revision-execution-log.md`
     - 视情况补充 `.ai-runtime-artifacts/collective-test/2026-08-11-run-trace-ux-revision-collective-test.md`
  5. 提交（commit + push 不动，等 user 决策）：
     - 一起提交：`web/src/features/chat/runTrace.ts`、`web/tests/features/chat/runTrace.test.ts`（之前未提交的 WIP，本轮 user 决定 commit_with_wip）。
     - 本轮新增文件：`RunTracePanel.tsx`、`MessageBubble.tsx`、三个测试文件、spec/plan/execution-log/verification-lite。
- **Skills**：Leader 默认
- **返回**：落盘清单 + git status 输出。

# 3. 依赖与执行顺序

```
WU-R1 (coder)
   ↓ 完成后
WU-R2 (test-engineer)
   ↓ 完成后
WU-R3 (Leader)
   ↓ 完成后
集体测试 (Leader)
   ↓ 通过后
集体审查（reviewer + security-auditor + perf-auditor，按需）
   ↓ 通过后
尾盘落盘（execution-log links）
```

WU-R1 → WU-R2 必须顺序：测试断言依赖最终实现的 prop 名/类名。
WU-R2 → WU-R3 必须顺序：verification 需要测试绿。

# 4. 反模式自检（orchestration-patterns.md）

- [x] 实现与审查不同实例（WU-R2 不是 reviewer，reviewer 单独委派）
- [x] worker 信息充分（spec 已批 + 本 plan + 允许/禁改文件清单）
- [x] 不跳过尾盘（WU-R3 包含 collective-test + 落盘）
- [x] 不在主 checkout commit 由 worker（WU-R1/R2 不 commit，WU-R3 由 Leader commit）
- [x] WORKTREE-INIT SKIPPED 理由记录（§ 2）

# 6. References 检查（Leader 收尾对照）

- `harness-kit/references/definition-of-done.md`
- `harness-kit/references/testing-patterns.md`
- `harness-kit/references/accessibility-checklist.md`
- `harness-kit/references/performance-checklist.md`
- `harness-kit/references/orchestration-patterns.md`
- `harness-kit/references/observability-checklist.md`

# 7. Next

user 说「开始实现 / 并行执行」后按 WU-R1 → R2 → R3 派发。