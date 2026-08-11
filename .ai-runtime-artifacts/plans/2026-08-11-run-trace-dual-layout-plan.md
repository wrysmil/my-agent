---
artifact: implementation-plan
route: superpowers:writing-plans -> orchestration:dispatcher-workflow
skills:
  - writing-plans
  - orchestration
skills_evidence:
  - skipped: writing-plans (not found at .agents/skills/)
  - orchestration/SKILL.md
dispatch: .ai-runtime-artifacts/plans/2026-08-11-run-trace-dual-layout-dispatch.md
source:
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md
  - AGENTS.md
  - harness-kit/core/routing.md
created_at: 2026-08-11
status: draft
approved: false
branch: task/run-trace-cycle-grouping
---

# Plan — Run Trace v4（双布局 + 切会话 bug fix）

> 实施步骤以 **plan** 为准；本文件只描述任务细步与依赖。
> 并行策略见同 stem 的 `*-dispatch.md`。

## Goal

落地 spec v4：trace 灰色独立气泡 + final 裸内容（左缘对齐、不嵌套），同时真实修复切会话 bug。

## Architecture / Tech Stack

- React 18 + TypeScript + Tailwind v4
- 测试：vitest + @testing-library/react + userEvent
- E2E 验证：Playwright MCP（启 vite + 浏览器截图）

## 当前状态（v3.1 已落地）

git status 已 M 10 个文件（含 v3.1 改动），未 commit。**v3.1 改动的代码保留**，本批只重构结构和修 bug。

## Task 列表

### GROUP-1 — 双布局重构（单 coder WU）

#### Task 1.1 — `CycleCard` → `TraceBubble` 重命名

1. 创建新文件 `web/src/components/chat/TraceBubble.tsx`
   - 内容基本复制 v3.1 的 `CycleCard.tsx`
   - 调整：`bg-white` → `bg-[#f1f2f4]`、`px-4 py-3.5` → `p-0`、max-width `560px` → `660px`
   - 注释更新：CycleCard → TraceBubble
2. 删除旧文件 `web/src/components/chat/CycleCard.tsx`
3. grep `CycleCard` 全仓，确认无遗漏 import

#### Task 1.2 — `MessageBubble.tsx` 结构调整

1. import 调整：`CycleCard` → `TraceBubble`
2. 删除 `<CycleCard>` wrapper，改为 Fragment（`<>...</>`）
3. 三个独立节点（用稳定 key）：
   ```tsx
   {showTrace && (
     <TraceBubble key={`${message.id}-trace`}>
       <RunTracePanel ... />
     </TraceBubble>
   )}
   {textBlocks.length > 0 && (
     <div
       key={`${message.id}-final`}
       className="w-full max-w-[720px] self-start"
     >
       <Suspense fallback={<MarkdownFallback />}>
         <div className="prose prose-sm max-w-none break-words">
           <Markdown text={...} />
         </div>
       </Suspense>
     </div>
   )}
   {showGeneratingIndicator && (
     <div
       key={`${message.id}-gen`}
       className="self-start"
     >
       <GeneratingIndicator />
     </div>
   )}
   ```
4. 调整外层容器：`<div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} group relative mb-4`}>` → assistant 分支用 `flex-col items-stretch`
5. 复制按钮位置不变（user 仍用 `justify-end`）

#### Task 1.3 — 测试更新

- `web/tests/features/chat/cycle-card.test.tsx` → 改名为 `trace-bubble.test.tsx`
  - 断言：背景 `bg-[#f1f2f4]`、max-width 660px、不含 final 内容
- `web/tests/features/chat/message-bubble-cycle.test.tsx`
  - 断言：trace 和 final 是**独立 DOM 节点**（用 `data-testid="trace-bubble"` 和 `data-testid="final-bubble"` 标记）
  - 断言：切不同 message.id 时独立节点独立 remount
- `web/tests/features/chat/run-trace-panel.test.tsx`、`run-trace-panel-matrix.test.tsx`、`generating-indicator.test.tsx` — 不变（v3.1 已更新）

#### Task 1.4 — 视觉验证（Leader 跑）

1. `pnpm -C web exec tsc -b` — 零误差
2. `pnpm exec vitest run tests/features/chat/` — 全绿
3. **启 vite** + Playwright 截图，验证：
   - trace 灰色气泡
   - final 裸内容无边框
   - 两者左缘对齐

### GROUP-2 — 切会话 bug 诊断与修复（coder WU，单派）

#### Task 2.1 — 复现 bug（诊断阶段）

1. 启 vite（`pnpm -C web run dev`，端口 5173 或现有端口）
2. 用 Playwright MCP：
   - 开 A 会话，发送一条消息触发 trace
   - 截图 A 状态（应该正常）
   - 切到 B 会话
   - 切回 A 会话
   - 截图 A 状态（应该有边框 + 紫色侧条）
3. 用 `browser_evaluate` 检查切回后 DOM：
   - `document.querySelectorAll('[data-trace-bubble]').length`
   - `document.querySelectorAll('[data-final-bubble]').length`
   - 验证 message.id 在切会话前后是否一致

#### Task 2.2 — 定位根因（按 spec §4.4.2 的 5 假设排查）

| 假设 | 检查方法 | 文件 |
|---|---|---|
| H1: `key` 无效 | React DevTools 检查 message.id；看 `useEffect resetKey` 是否真触发 | `RunTracePanel.tsx`、`MessageBubble.tsx` |
| H2: 条件渲染失败 | DOM 检查 trace 节点是否在 | `MessageBubble.tsx` |
| H3: 消息累积 | 对比 A/B 会话切回前后的 `messages.length` | `MessageList.tsx`、`useChatStream.ts` |
| H4: CSS 渲染错位 | 检查 `CycleCard`（已改名 TraceBubble）border/侧条 className 是否在 DOM 上 | `TraceBubble.tsx` |
| H5: className 条件覆盖 | grep `CycleCard` / `TraceBubble` 相关 className 条件分支 | `MessageBubble.tsx` |

#### Task 2.3 — 修复（按根因确定方案）

最可能的根因是 **H3（消息累积）**——如果切会话时 `useChatStream` 没正确清空旧 messages，会导致渲染 N 个 `<MessageBubble>`。验证方法：

- 在 `useChatStream` 加 `console.log`（开发模式）打印 sessionId 切换时的 messages 数组
- 或者直接看 `MessageList.tsx` 的 `messages` 来源

如果是 H3：修 `useChatStream` 或 `MessageList`，确保 sessionId 变化时**完全替换** messages，不累加。

如果是 H1：把 key 改为 `${sessionId}-${messageId}` 或在 `MessageList` 加 `useMemo` 强制重建。

#### Task 2.4 — 验证修复

- Playwright 重复 Task 2.1 步骤
- 截图断言：切回后 TraceBubble 边框 + 紫色侧条存在
- 截图断言：仅一个 TraceBubble（不是 N 个）

### GROUP-3 — 尾盘

同 v3.1：collective-test + code-review + leader commit。

## Plan 自检

- [x] 区分已落地（v3.1 保留）vs 待重构（v4 结构调整）
- [x] 切会话 bug 走诊断流程（不堆防御代码）
- [x] 测试更新单独成 Task（避免与实现混合）
- [x] 视觉验证用 Playwright + 启 vite
- [x] 不动 runTrace.ts / Markdown.tsx / RunTracePanel.tsx 结构
- [x] 风险点（CycleCard 重命名外部 import、bug 根因）已标

## 风险点

1. **CycleCard 重命名** —— grep 后处理外部 import；如有遗漏 vite build 报
2. **MessageBubble 结构改动** —— message-bubble-cycle 测试断言可能失效
3. **切会话 bug 根因未知** —— Task 2.2 排查前无法确定修复点
4. **`#f1f2f4` 硬编码** —— 暗色模式需 token 化（建议本批顺便抽 token 或下批处理）

## Next

写完 plan 暂停，等用户说「开始实现」或「并行执行」。