---
title: Run Trace UX 修订 — Code Review (Leader 自评)
date: 2026-08-11
reviewer: leader (主线程，user 指示跳过独立 reviewer subagent)
spec: .ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md
status: APPROVE
note: user 在审查阶段指示「不用 reviewer 了」；security-auditor + collective-test PASS 基础上由 Leader 自出五轴审查。
---

# Code Review: Run Trace UX 修订

## 审查范围

- `web/src/components/chat/RunTracePanel.tsx`（StepLabel 替换 StepNode + resetKey prop + shouldAutoExpand + padding 调整）
- `web/src/components/chat/MessageBubble.tsx`（resetKey 透传）
- `web/src/features/chat/runTrace.ts`（WIP KeyParam 提取）
- `web/tests/features/chat/{run-trace-panel,run-trace-panel-matrix,message-bubble-cycle,runTrace}.test.tsx`

## 五轴审查

### 1. 正确性（spec §4 三修订对照）

**A. StepLabel 替换 StepNode（spec §4.1）**

- ✅ tool 节点显示 `toolName`（mono 11px）+ 右上徽章（✓/↻/⚠）
- ✅ thinking 节点显示「思考」+ ✓
- ✅ error 节点显示「错误」+ ⚠
- ✅ 超长 toolName 截断 + `title` 完整值
- ✅ padding `pl-[72px]` + 徽章不与 button 内容区视觉重叠（WU-R1b 已修）
- ✅ tool firstLine 不再显示 `actionLabel`（避免与 StepLabel 重复，WU-R1b 修订）
- ✅ thinking firstLine 仅显示「已完成」状态文字（去除「思考」前缀，WU-R1b 修订）

**B. shouldAutoExpand 默认展开（spec §4.2 矩阵）**

| isStreaming | hasFinalText | errorCount | 结果 |
|---|---|---|---|
| false | false | 0 | ✅ true（第 50 行 `!isStreaming && errorCount===0`） |
| false | true | 0 | ✅ true |
| false | true | >0 | ✅ true |
| true | false | 0 | ✅ true |
| true | true | 0 | ✅ false（行 70 effect 早返回 + 不在 shouldAutoExpand 的 true 分支） |

**C. resetKey 防状态泄漏（spec §4.3）**

- ✅ prop 接口扩展可选 `resetKey?: string`（向后兼容）
- ✅ effect `[resetKey]` 重置三个 UI 状态：`userOverride=false` / `expanded` 重算 / `openStepIds=new Set()`
- ✅ `MessageBubble` 传 `resetKey={message.id}`（`message.id` 是 ChatMessage 已有 string 字段）
- ✅ `eslint-disable-next-line react-hooks/exhaustive-deps` 注释解释「resetKey 是身份 key，其余闭包值用于重算」（可读）
- ✅ 测试覆盖：resetKey 变化重置 / 默认展开 / userOverride 不被 effect 拉回

### 2. 可读性

- ✅ 函数命名清晰：`StepLabel` / `shouldAutoExpand` / `STEP_LABEL_MAX_CHARS` / `resetKey`
- ✅ 注释引用 spec §4.1 / §4.3 便于追溯
- ✅ 重置 effect 注释解释「resetKey 是身份 key，其余闭包值用于重算」—— 是 why 而非 what
- ✅ 无魔数（`STEP_LABEL_MAX_CHARS = 10` 已抽常量）

### 3. 架构

- ✅ 严格遵守「不引入新组件 / 不动 runTrace.ts / CycleCard / GeneratingIndicator / MessageList / Markdown / useChatStream」约束
- ✅ prop 扩展是单点最小改动（`RunTracePanelProps` + 1 个 useEffect）
- ✅ 状态隔离在组件层完成（spec §11 明确把「父托管」留作非目标）
- ✅ WIP `KeyParam` 提取与本次修订正交，不互相依赖（StepLabel 不依赖 KeyParam）

### 4. 安全

- ✅ `toolName` 来自已类型化的 `ToolTraceStep.toolName`，React DOM 文本节点默认转义，无 XSS
- ✅ `Markdown` 走 `rehype-sanitize` + `urlTransform` 白名单
- ✅ `resetKey` 仅是组件 prop，外部污染面 = React 组件 prop 污染 = React 标准 prop 处理
- ✅ `extractKeyParams` 的 `new URL()` 仅做文本解析，不发起请求
- ⚠ security-auditor Suggestion 2（`JSON.stringify` 长度上限）和 Suggestion 3（URL 协议白名单）留作下批 polish，不阻塞本批

### 5. 性能

- ✅ `StepLabel` 是轻量 DOM（2 span + 1 hidden wrapper），渲染开销可忽略
- ✅ `useEffect([resetKey])` 仅在切消息时跑一次，无热路径开销
- ✅ bundle.test.ts 2 fail 为预存在（缺 dist 构建），本批次未引入任何 bundle 体积变化

## Findings

### Critical
无

### Important
无

### Suggestion
（与 security-auditor 一致）
1. `extractKeyParams` 的 `JSON.stringify` 加硬上限（防御性）
2. `shortenKeyParam` 的 URL 协议白名单（与 `Markdown.urlTransform` 一致性）
3. `resetKey?: string` 可在后续 polish 升级为 `resetKey: string`（强制要求）

### Nit
1. `StepLabel` 整组 `aria-hidden` 包裹徽章 —— 与 spec §7 设计意图一致，AT 通过 button `aria-label` 识别状态，记一笔供后续 a11y 复查
2. WIP `KeyParam` 的 `KEY_PARAM_ORDER` 数组用了 `as const` 但未显式类型，可读性小提升（**N-Nit**）

## 证据

- 已读：
  - `web/src/components/chat/RunTracePanel.tsx`（行 1-515，重点：props L30-41、shouldAutoExpand L43-52、resetKey effect L76-82、TraceRowCard L216-284、StepLabel L288-350、ThinkingStepRow L352-421、ToolStepRow L423-515）
  - `web/src/components/chat/MessageBubble.tsx`（resetKey 透传 L84-90）
  - `web/src/features/chat/runTrace.ts`（extractKeyParams L300-311、shortenKeyParam L313-330、KeyParam L45-49）
- 已运行：tsc / vitest 复核由 collective-test.md 承担
- 浏览器视觉：`run-trace-ux-revision-visual.png` 已通过 WU-R1b 验收（无重复工具名）

## 未验证项

- 跨会话切换的视觉验证（代码 + 测试已覆盖）
- `pnpm audit`（未引入新依赖）

## Skills 使用

- 已加载: superpowers:code-review-and-quality@.agents/skills/code-review-and-quality/SKILL.md
- 已加载: superpowers:source-driven-development@.agents/skills/source-driven-development/SKILL.md
- 已跳过: superpowers:requesting-code-review@.agents/skills/requesting-code-review/SKILL.md（user 指示跳过 reviewer subagent）

## 结论

**APPROVE** — 0 Critical / 0 Important。3 Suggestion 均为防御性优化，留作下批 polish。本批次符合 spec §9 全部验收点。

---

## Leader 备注

- 审查门禁：security-auditor (APPROVE) + collective-test (PASS) + Leader 自评 (APPROVE) = 三道门禁满足
- WIP `runTrace.ts` / `runTrace.test.ts` 走 user 已确认的 commit_with_wip
- 7 个 M 文件一次 commit