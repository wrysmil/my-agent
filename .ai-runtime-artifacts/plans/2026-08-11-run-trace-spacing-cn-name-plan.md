---
artifact: implementation-plan
route: superpowers:writing-plans -> orchestration:dispatcher-workflow
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/)
  - orchestration/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-11-run-trace-spacing-cn-name-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-spacing-cn-name-spec.md
  - AGENTS.md
  - harness-kit/core/routing.md
created_at: 2026-08-11
status: draft
approved: false
branch: task/run-trace-cycle-grouping
---

# Plan — Run Trace v3.1

> 实施步骤以 **plan** 为准；本文件只描述任务细步与依赖。
> 并行策略见同 stem 的 `*-dispatch.md`。

## Goal

落地 spec v3.1 的 11 个修订（紫色侧条归 trace、中文动作名、默认折叠、思考降级、Generating 简化、工具名不截断、step-card 高度统一、CycleCard 宽度对齐、切会话 bug 强化）。

## 现状盘点（git status 已 M）

当前分支 `task/run-trace-cycle-grouping` 已 staged：

- `web/src/components/chat/RunTracePanel.tsx` — 已部分落地 §4.8（去 STEP_LABEL_MAX_CHARS、pl-[72]→pl-[112]、whitespace-nowrap）
- `web/src/components/chat/GeneratingIndicator.tsx` — 待 git diff 确认（上一轮改过"AI 仍在生成中…"删除）
- `.ai-runtime-artifacts/execution-logs/...` — 已修订

## Architecture / Tech Stack

- React 18 + TypeScript + Tailwind
- 测试：vitest + @testing-library/react + userEvent
- Lint / Type：`pnpm -C web exec tsc -b`、`pnpm -C web run lint`

## Task 列表

### GROUP-1 — UI 修订收尾 + bug fix（单 coder WU）

依赖：当前已 staged 改动。无外部依赖。

#### Task 1.1 — `RunTracePanel.tsx` 视觉降级收尾（spec §4.6、§4.8、§4.9）

1. **`StepLabel` 字体调整**（line 338）：
   - `font-mono text-[11px] tabular-nums` → `font-sans text-[13px]`（中文 sans，与正文统一）
   - 保留 `whitespace-nowrap`
2. **StepLabel 删除颜色编码**（line 297-300）：
   - 删除 `textColor` 的 error / running / done 分支（统一 `text-text-muted`）
   - 删除 `badgeClass` 三种颜色分支（统一 muted）
3. **StepLabel 按 kind 分流渲染**（line 336-343）：
   - `step.kind === 'thinking'`：4px 灰点 + "思考" 灰字，无徽章
   - `step.kind === 'tool'`：现有 chip 形式 + meta（**注意**：当前是绝对定位，spec 要求嵌入 button 内——见下文结构性调整）
4. **结构性调整：StepLabel 从绝对定位改为 button 内首元素**
   - 删除 `<li>` 的 `pl-[112px]`（StepLabel 不再 absolute，按钮占满 `<li>` 宽度）
   - 删除 `<li>` 内的 `<span data-trace-line>` 虚线 absolute span
   - 调整 `<li>` 为简单 flex 容器，padding 由 step-card 内部决定
   - **或将 StepLabel 彻底删除**：直接把身份文本作为 button 的第一个子元素
   - **决策**：保留 StepLabel 作为子组件，但不再 absolute——作为 button 的第一个子元素
5. **step-card 高度刚性化**（line 237 `baseClass`）：
   - 在 `<button>` className 加 `h-9`（36px）或 `min-h-9`；与 `<div>` fallback 同
   - 调整 padding `px-2.5 py-1.5` → `px-2.5 py-0`（高度由 h-9 决定）
   - overflow：`overflow-hidden`
6. **紫色竖条内化**（新增到 RunTracePanel 根 div 内）：
   - 在 RunTracePanel 顶层 `<div>` 内增加：
     ```tsx
     <span aria-hidden className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50" />
     ```
   - 根 div 加 `relative overflow-hidden rounded-lg border ... bg-white`

**实现要点**：

- **不要**重写整个文件；用 `StrReplace` 做小步替换，每改一处跑 `pnpm -C web exec tsc -b` 验
- 改完跑 `pnpm -C web run test --run web/tests/features/chat/run-trace-panel.test.tsx` 看是否绿
- 现有失败的测试断言要更新（见 Task 1.3）

#### Task 1.2 — `CycleCard.tsx` 收尾（spec §4.1、§4.5、§4.10）

1. 删除紫色竖条 span（line 25-28）
2. padding `px-3.5 py-3` → `px-4 py-3.5`
3. 宽度 `max-w-[80%]` → `max-w-[560px] width-full`（对齐 spec §4.10）

#### Task 1.3 — `MessageBubble.tsx` key 强化（spec §4.11）

1. 给 `CycleCard` 加 `key={message.id}`（line 82）
2. 给 `RunTracePanel` 加 `key={message.id}`（line 84）

#### Task 1.4 — `GeneratingIndicator.tsx` 简化（spec §4.7）

1. 删除 `<span>AI 仍在生成中…</span>`（已在上一轮做过，确认）
2. 调整容器：去掉 `gap-2 text-[12px] text-text-muted`

#### Task 1.5 — 测试更新（spec §8.1）

涉及：

- `web/tests/features/chat/run-trace-panel.test.tsx`
- `web/tests/features/chat/run-trace-panel-matrix.test.tsx`
- `web/tests/features/chat/message-bubble-cycle.test.tsx`
- `web/tests/features/chat/cycle-card.test.tsx`
- `web/tests/features/chat/generating-indicator.test.tsx`（如有）

更新断言：

1. 工具名 = `toolActionLabel(toolName)`（"write_file" → "写入文件"），而非原 `toolName`
2. 无右上徽章（不再断言 `bg-surface` 圆点 + Check/AlertCircle/Loader2 出现）
3. step 卡片默认不含 keyParams pill / resultPreview 文本可见
4. 思考步骤无 meta 显示（"已完成"等）
5. step-card className 含 `h-9` 或等高类
6. CycleCard 不含紫色竖条（断言无 `bg-gradient-to-b from-primary`）
7. RunTracePanel 含紫色竖条
8. MessageBubble：CycleCard 与 RunTracePanel 都接收 `key={message.id}`（如可通过 spy 验）
9. CycleCard 宽度断言 `max-w-[560px]`
10. GeneratingIndicator：不含"AI 仍在生成中…"文字

#### Task 1.6 — 验证

- `pnpm -C web exec tsc -b` 零误差
- `pnpm -C web run test --run` 全绿
- `pnpm -C web run lint` 零警告

## Plan 自检

- [x] 每个 Task 都有具体文件 + 行号 + 改法
- [x] 区分已落地 vs 待办
- [x] 测试更新单独成 Task（避免与实现混合）
- [x] 验证命令具体可执行
- [x] 不动 runTrace.ts / MessageList.tsx / useChatStream.ts / Markdown.tsx
- [x] 风险点（结构性 StepLabel 嵌入 button）已标"决策"

## 风险点（需实施时关注）

1. **StepLabel 嵌入 button 内**会影响现有测试断言（StepLabel 是 `<span aria-hidden absolute>` → 嵌入 button 内首子元素）。需先 Read 现有测试看断言形态，再决定是删 StepLabel 还是改它。
2. **`<li>` 取消 `pl-[112px]`** 后，`data-trace-line` 虚线怎么画？要找替代位置（可能由 step-card 内的左侧伪元素实现）。
3. **`font-mono` → `font-sans` 切换**会让 step-card 内字号变化（11px → 13px），需要 button 高度算一次再定 padding。

## Next

写完 plan 暂停，等用户说「开始实现」或「并行执行」。

---

**References 检查**：

- `harness-kit/references/definition-of-done.md` § 视觉 / DOM 双轴；tsc + vitest 跑过 — 已在 Task 1.6 落实
- `harness-kit/references/testing-patterns.md` § AAA；mock 最小化 — 测试更新保持这一原则
- `harness-kit/references/accessibility-checklist.md` § 状态语义靠 aria-label — 已确认
- `harness-kit/references/performance-checklist.md` § 默认折叠减少首渲 DOM — 已确认