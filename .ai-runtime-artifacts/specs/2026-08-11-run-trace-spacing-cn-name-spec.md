---
title: Run Trace v3.1 — 紫色侧条归 trace + 中文动作名 + 默认折叠参数 + 切会话修复 + 思考步骤降级 + 高度刚性化 + 宽度对齐
artifact: spec
route: superpowers:brainstorming -> superpowers:writing-plans
skills:
  - brainstorming
  - writing-plans
skills_evidence:
  - skipped: brainstorming (not found at .agents/skills/)
  - skipped: writing-plans (not found at .agents/skills/)
source:
  - AGENTS.md
  - harness-kit/core/routing.md
  - harness-kit/core/artifacts.md
status: draft
approved: false
date: 2026-08-11
prev-spec:
  - .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-typography-redesign-spec.md
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-ux-revision-spec.md
---

# 1. 背景

上一轮 Run Trace UX 修订落地后，用户在浏览器实测发现四个新问题：

1. **紫色侧条贯通到 final markdown**：当前 `CycleCard` 在外层画 3px 紫色渐变竖条 + `top-2 bottom-2`，覆盖 trace + final 整张卡。视觉上 final 区域也被"染色"，与 trace 区域没有边界感。**期望**：紫色竖条仅贴在 trace 部分；final markdown 区域不被紫色条覆盖。
2. **工具名展示"丑" + 用户要中文可读名称**：当前 `StepLabel` 用 mono 11px 显示原始 `toolName`（如 `write_file`、`bash`、`list_file`）。中文用户读起来不直观。**期望**：显示 `toolActionLabel` 的中文版本（如「写入文件」「执行命令」「列出文件」）；字号 / 颜色与正文一致（不强调）；**不再**用颜色编码状态（绿/红/蓝徽章去掉）。
3. **参数 / 结果默认展开过多**：当前 `keyParams`（如 `dirPath: D:\...`）和 `resultPreview` 默认显示，导致 step 卡片**很高 + 内容密集**。**期望**：参数和结果**默认折叠**，只显示 `actionLabel`（如「写入文件」）+ 状态文字（如「已完成」）；用户点 step 卡片才展开参数 + 完整结果。
4. **切会话回来 CycleCard 边框 + 紫色竖条消失（"鬼样子"）**：用户截图显示从某会话切走再切回后，已完成 CycleCard **没有圆角边框、没有紫色侧条**，只有 trace 行 + final 文字裸渲染。根根因待查（详见 §4.4）；本 spec 必须同时修复。

### v3.1 追加（2026-08-11 后续反馈）

5. **思考步骤"logo 太多"**：当前思考步骤独立显示「思考」文字 + 紫红渐变 logo + 完成态勾徽章，密度高时（如 3-5 颗连排）视觉爆表。**期望**：思考步骤去掉 logo / 徽章 / 颜色，仅显示**灰色 4px 圆点 + 灰色「思考」二字**（13px，不强调），与工具步骤视觉同级但权重更低。
6. **`GeneratingIndicator` 多余文字**：「AI 仍在生成中…」文字 + 转圈占视觉空间。**期望**：只保留转圈，文字删除。
7. **工具名不缩短**：当前 `StepLabel` 限制 `STEP_LABEL_MAX_CHARS = 10` + `max-w-[56px] truncate`，中文工具名（如「执行 shell 命令」14 字）会被硬切。**期望**：去掉字符截断限制，名字走自然宽度；`<li>` padding 同步加大到 112px 防挤压 button 内容。
8. **step-card 高度不统一**：思考 / 工具 / 执行中 / 失败四种 step 卡片高度不一致（padding / 字号 / 装饰元素差异）。**期望**：所有 step-card 同 `height: 36px` 刚性化，差异仅在内容本身。
9. **CycleCard 宽度对齐**：相邻两张 CycleCard 宽度不一（`max-width: 80%`）造成视觉断裂。**期望**：固定宽度（如 `max-width: 560px`），相邻卡片左缘右缘对齐。

# 2. 目标

- 紫色竖条只贴在 `RunTracePanel` 内（trace 部分）；final markdown 区域不被覆盖。
- 工具名显示中文可读名称（`toolActionLabel(toolName)`），字号 / 颜色与正文统一。
- 不再用颜色编码状态（去掉 StepLabel 的 ✓/⚠/↻ 彩色徽章）；状态信息仅在 summary header 与 step meta 中体现。
- step 卡片**默认只显示 actionLabel + meta**；keyParams、resultPreview、resultDetail 默认折叠，用户点击展开。
- 切会话 / 切消息后 CycleCard 视觉完整（圆角边框 + 内部组件正确渲染）。

# 3. 非目标

- 不改 `runTrace.ts` 数据模型（`toolActionLabel` 已存在，仅消费）。
- 不改 `MessageList.tsx`、`useChatStream.ts`、SSE 协议。
- 不改 `GeneratingIndicator.tsx`。
- 不引入新依赖。
- 不改 spec 之外的 docs。

# 4. 设计

## 4.1 紫色侧条归 trace（`CycleCard` / `RunTracePanel`）

**当前**（`CycleCard.tsx:24-28`）：
```tsx
<div className="relative ... rounded-xl border ... bg-white shadow-sm">
  <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50" />
  <div className="px-3.5 py-3 space-y-2">{children}</div>
</div>
```

**修订**：
- `CycleCard` 改为**仅做容器**（圆角边框 + 内 padding + 阴影），**不再画紫色竖条**。
- `RunTracePanel` 在内部画紫色竖条（只覆盖 summary + timeline 部分）：
  ```tsx
  <div data-run-trace className="relative overflow-hidden rounded-lg border ... bg-white">
    <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50" />
    {/* summary + timeline */}
  </div>
  ```
- final markdown 由 `MessageBubble` 渲染在 `CycleCard` 内但**在 `RunTracePanel` 之后**，不被紫色竖条覆盖（因为紫色竖条 scope 在 RunTracePanel 的 relative div 内）。

## 4.2 中文动作名 + 去除颜色徽章（`RunTracePanel.StepLabel` / `ToolStepRow` / `ThinkingStepRow`）

**当前**（`StepLabel` 行 286-350）：
- tool 节点显示 `toolName`（mono 11px text-green-700）+ ✓ 徽章
- thinking 节点显示「思考」+ ✓ 徽章
- 颜色由 status 决定（绿/红/蓝/灰）

**修订**：
- **tool 节点**：显示 `toolActionLabel(toolName)`，即中文可读名（如「写入文件」「执行命令」「列出文件」）。
- **thinking 节点**：显示「思考」（不变）。
- **字号 / 字重 / 颜色**：与正文一致（`text-[13px] text-text font-medium`，不再 mono）。
- **不再**用颜色编码状态：去掉右上徽章（✓/⚠/↻）；状态信息仅在 step 卡片的右侧 meta（"已完成" / "执行中" / "失败"）和 summary header 中体现。
- **不再**需要 10 字符截断（中文短）。

**实现位置调整**：当前 StepLabel 用 `absolute left-3 top-1.5` 定位在 `<li>` 的 padding 区域内。修订后 StepLabel 作为 step 卡片**内部**的「左侧 label」自然嵌入——`<button className="step-card">` 第一个元素是 label span，不再 absolute。

这样：
- `<li>` 的 `pl-[72px]` 取消，改为 `pl-[0px]`（StepLabel 在 button 左侧，button 占满 `<li>` 宽度）。
- StepLabel 是 button 的子元素，flex 布局天然对齐。

## 4.3 step 卡片默认折叠参数 / 结果（`RunTracePanel` 数据流）

**当前**：step 卡片**始终渲染** keyParams pill + resultPreview 文本（一行）+ meta。

**修订**：step 卡片**默认只渲染**：
- actionLabel（「写入文件」）
- meta（"已完成" / "执行中" / "失败" / duration）
- chevron（▾）

参数（keyParams + inputPreview）和结果（resultPreview / resultDetail）**整体放到 detail 区域**，默认 `hidden`，用户点击 step 卡片才展开（沿用现有 `detailOpen` 机制，但**默认折叠所有步骤**——不只 thinking）。

**默认行为变更**：
- `shouldAutoExpand` 不变（面板整体默认展开 trace）
- `detailOpen` 默认初始化改为 `new Set()`（与当前一致，已是默认折叠）
- 用户点 step → toggle → 展开 keyParams + resultPreview + resultDetail
- thinking 步骤的 preview 行也只在 detailOpen 时显示

## 4.4 切会话"鬼样子"修复（诊断 + 修法）

**诊断思路**：
- 复现条件：用户切到会话 A → 切到会话 B → 切回 A。
- 症状：CycleCard 边框消失、紫色侧条消失、final markdown 文字直接裸渲染在 chat 列表背景上。
- 候选根因：
  - **H1**：`resetKey` 触发 `useState(() => shouldAutoExpand(...))` 抛异常（极小概率，因为同一 message.id 的 resetKey 不会触发 init 函数重跑，但重挂载时 init 函数会跑）。
  - **H2**：`textBlocks.filter((b) => b.type === 'text')` 在某次切会话时返回 `[]` → final markdown 区不渲染，**但 CycleCard 容器还在**（截图应显示空容器，不是裸 final）。
  - **H3**：`CycleCard` 的 `bg-white` + `border` 在 dark mode / 父级 `bg-surface` 视觉对比下，看起来"消失"。但用户截图是亮色，应该不是 dark mode 问题。
  - **H4**：`MessageBubble` 在切会话时**整个 assistant 分支**意外走入 user 分支（条件渲染失败）→ final 直接渲染在 chat 列表里，不在 CycleCard 内。**最可能**。
  - **H5**：`runTrace.ts` 的派生层在某个 message 状态（如流式中断的临时消息）抛错 → `showTrace=true` 但 `buildRunTrace` 抛错 → CycleCard children 为空但保留，但**final markdown 不在 CycleCard 内**——这不可能，因为 final 在 MessageBubble 里固定渲染。

**修法（防御性，覆盖 H4 + 其他可能）**：
- `MessageBubble.tsx` 中确认 `role === 'assistant'` 判断只依赖 `message.role`，不依赖 `isStreaming` 或其他 prop。
- 给 `CycleCard` 加 `key={message.id}` 强制重挂载（防 React 18 并发模式下 reconciler 把不同 message 的子节点混用）。
- 给 `RunTracePanel` 也加 `key={message.id}`（与现有 resetKey 一起双重保险）。
- 给 CycleCard children 加 `try/catch` 包一层（开发模式显示错误，生产静默），便于定位问题。

**最简且最可能有效的修复**：给 `CycleCard` 加 `key={message.id}` + 给 `RunTracePanel` 加 `key={message.id}`。如果 React 把 message.id=A 的 children 和 message.id=B 的 children 复用，加 key 强制重挂载能解决问题。

**完整修复验证**：本地 + 浏览器实测：
- 同一会话多次发送 → 切到另一个会话 → 切回 → CycleCard 视觉完整。

## 4.5 间距优化（已与 v3 mockup 对齐）

- CycleCard `px-3.5 py-3` → `px-4 py-3.5`（略加 padding）
- RunTracePanel summary `px-3.5 py-2.5` → `px-4 py-3`
- RunTracePanel timeline `pt-2 pb-2.5` → `pt-2.5 pb-3`
- step row padding `py-1.5` → `py-2`（更宽松）
- step row 之间 `space-y-0.5`（默认 trace 列表的 gap）→ `space-y-2`（v3 mockup 用 gap: 10px）

## 4.6 思考步骤视觉降级（v3.1）

**当前**：思考步骤独立展示 StepLabel（紫红渐变 logo + 「思考」文字 + ✓ 徽章）。

**修订**：删除 StepLabel 的徽章 + 颜色编码，思考步骤改为：

- 视觉降级：4px 灰色圆点 (`bg-text-muted-2`) + 「思考」灰色文字 (`text-text-muted text-[13px]`)；与工具步骤**视觉同级但权重更低**。
- 不使用 chip / 紫红 logo / 完成勾徽章。
- 不显示 `meta`（"已完成"等状态），与工具步骤区分靠**左侧装饰**而非文字状态。

**实现**：StepLabel 改为按 step.kind 区分渲染：
- `kind === 'thinking'`：4px 灰点 + "思考" 文字，无徽章，无 meta
- `kind === 'tool'`：现有 chip 形式 + meta（保留视觉锚点）

## 4.7 `GeneratingIndicator` 简化（v3.1）

**当前**：

```tsx
<div role="status" aria-live="polite" className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-border/70 text-[12px] text-text-muted">
  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
  <span>AI 仍在生成中…</span>
</div>
```

**修订**：删除 `<span>AI 仍在生成中…</span>`，保留转圈 + 虚线分隔线；调整容器去掉 `gap-2`、`text-[12px] text-text-muted`：

```tsx
<div role="status" aria-live="polite" className="flex items-center mt-2 pt-2 border-t border-dashed border-border/70">
  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
</div>
```

## 4.8 工具名自然宽度（v3.1）

**当前**（`StepLabel` 行 286-298）：
```tsx
const STEP_LABEL_MAX_CHARS = 10;
const identityText = rawIdentity.length > STEP_LABEL_MAX_CHARS
  ? rawIdentity.slice(0, STEP_LABEL_MAX_CHARS)
  : rawIdentity;
```

**修订**：删除 `STEP_LABEL_MAX_CHARS` 常量与硬截断逻辑。`<li>` padding 同步调整以容纳长名字：

- `<li>` `pl-[72px]` → `pl-[112px]`（中文 14 字符 ≈ 84px，加 spacing）
- 虚线 `left-[68px]` → `left-[108px]`
- StepLabel 文字 `font-mono text-[11px]` → `font-sans text-[13px]`（与工具步骤正文统一）
- StepLabel `max-w-[56px] truncate` → 改为 `whitespace-nowrap`（不截断，但允许单行不换行）

## 4.9 step-card 高度刚性化（v3.1）

**当前**：step-card padding `py-1.5`（约 24px 内容 + 24px padding = 48px 高），思考步骤额外 padding / 字号差异 → 高度不一。

**修订**：所有 step-card 同高度：

```css
.step-card {
  height: 36px;       /* 刚性 */
  padding: 0 10px;
  overflow: hidden;   /* 内容超长不撑高 */
}
```

不同 step 类型差异仅在内容：
- 思考：4px 灰点 + "思考" 灰字 + chevron
- 工具：chip 名字 + meta + chevron（已展开时加 detail 区）
- 执行中：12px 旋转环（替代原 16px SVG）+ chip + meta + chevron
- 失败：chip + 红色 meta + chevron + 错误边框背景

## 4.10 CycleCard 固定宽度（v3.1）

**当前**：`max-width: 80%`（响应式容器宽度）。

**修订**：固定 `max-width: 560px`、`width: 100%`。相邻两张 CycleCard 左缘右缘对齐，视觉不"断层"。

## 4.11 切会话 bug 修复 — 强化（v3.1）

**当前**：仅 `RunTracePanel` 收到 `resetKey={message.id}`。

**修订**：除保留 `resetKey` 外，给两个组件**都加 `key={message.id}`**：

```tsx
<CycleCard key={message.id}>
  {showTrace && (
    <RunTracePanel
      key={message.id}
      trace={trace}
      isStreaming={isStreaming}
      hasFinalText={hasFinalText}
      resetKey={message.id}
    />
  )}
  ...
</CycleCard>
```

- `key` 变 → React 强制 unmount + mount 整个组件树，所有 state 重置、CSS 重渲、伪元素（`::before` 紫条）重建。
- `resetKey` 与 `key` 双保险：`resetKey` 处理 RunTracePanel 内部 state 重置，`key` 兜底 React 组件实例复用导致的所有视觉/状态错位。

# 5. 数据 / 接口

## 5.1 StepLabel 接口变化

**当前 StepLabel 内部组件** —— 修订后**不再作为独立组件**，改为 step 卡片 button 的第一个 flex 子元素。代码结构：

```tsx
<button className="step-card ...">
  <span className="step-label">{step.kind === 'tool' ? toolActionLabel(step.toolName) : '思考'}</span>
  {/* keyParams pill 区（detail 展开时才显示） */}
  <span className="step-spacer" />
  <span className="step-meta">{meta}</span>
  <ChevronDown className="..." />
</button>
```

`toolActionLabel` 已从 `runTrace.ts` 导出，调用方无需新增 import。

## 5.2 `MessageBubble` 改动

- 给 `CycleCard` 加 `key={message.id}`
- 给 `RunTracePanel` 加 `key={message.id}`（与现有 `resetKey={message.id}` 一起；key 用于强制重挂载，resetKey 用于状态重置）

## 5.3 `RunTracePanel` 改动

- 新增 `<span aria-hidden purple-bar />` 在根 div 内（替代 CycleCard 的紫色条）
- StepLabel 删除，独立组件不再存在；改为 step 卡片 button 第一个子元素
- step 卡片默认折叠：keyParams pill、resultPreview、detail 全部放入 `detailOpen` 条件渲染区

## 5.4 `CycleCard` 改动

- 删除紫色竖条 span
- 调整 padding `px-3.5 py-3` → `px-4 py-3.5`
- 不持有状态；纯展示组件

# 6. 实现范围

## 6.1 文件改动

| 文件 | 改动 |
|---|---|
| `web/src/components/chat/CycleCard.tsx` | 删除紫色竖条；调整 padding `px-3.5 py-3` → `px-4 py-3.5`；固定宽度 `max-width: 560px` |
| `web/src/components/chat/RunTracePanel.tsx` | 新增紫色竖条（内部）；删除 StepLabel；改为 button 内首元素；默认折叠 keyParams/result；step-card `height: 36px`；`<li>` `pl-[112px]` |
| `web/src/components/chat/MessageBubble.tsx` | 给 CycleCard + RunTracePanel 加 `key={message.id}` |
| `web/src/components/chat/GeneratingIndicator.tsx` | 删除 "AI 仍在生成中…" 文字；保留转圈 + 虚线分隔 |
| `web/tests/features/chat/run-trace-panel.test.tsx` | 更新断言：身份文本 → 中文 actionLabel；无右上徽章；step 卡片默认不含 keyParams/resultPreview 可见；思考步骤无 meta；step-card 高度断言 |
| `web/tests/features/chat/run-trace-panel-matrix.test.tsx` | 同上 |
| `web/tests/features/chat/message-bubble-cycle.test.tsx` | 加 `key={message.id}` 断言（如可观察） |
| `web/tests/features/chat/cycle-card.test.tsx` | 删除紫色竖条断言；调整 padding 类名断言；宽度断言 |
| `web/tests/features/chat/generating-indicator.test.tsx`（如有） | 删除 "AI 仍在生成中…" 文字断言 |

## 6.2 不改动

- `runTrace.ts` 数据层（仅消费 `toolActionLabel`）
- `MessageList.tsx`、`useChatStream.ts`、`Markdown.tsx`
- SSE 协议 / `ChatMessage` schema

# 7. 兼容性

- WCAG 2.1 AA：去掉颜色徽章后，状态信息依赖 button `aria-label`（`查看 ${toolName} 结果`）和 summary 的 aria-live；已有覆盖。
- 键盘导航：resetKey + key 双保险；无 focus 副作用。
- 暗色模式：颜色 token 派生不变。
- 现有动画：chevron 旋转、spinner 仍生效（仅 tool 步骤在 isStreaming 时有 spinner，徽章独立组件删了不影响）。

# 8. 测试

## 8.1 单元 / 组件（vitest）

`run-trace-panel.test.tsx` 新增 / 调整：

1. **中文动作名**：tool 步骤默认显示 `toolActionLabel(toolName)` 中文版本（如 `write_file` → 「写入文件」）；thinking 显示「思考」。
2. **无右上徽章**：step 卡片 button 内不包含彩色图标徽章（Check/AlertCircle/Loader2）。
3. **默认折叠**：step 卡片 button 默认不含 keyParams pill、resultPreview 文本、detail pre。
4. **展开后**：点击 step 卡片 → keyParams pill + resultPreview + resultDetail 全部显示。
5. **紫色竖条**：RunTracePanel 根 div 内包含 `aria-hidden` 渐变条 span；CycleCard 根 div 不包含。

`message-bubble-cycle.test.tsx`：
- 加断言：`CycleCard` 接收 `key={message.id}`，`RunTracePanel` 接收 `key={message.id}`（可通过 spy 或 DOM 验证）。

`cycle-card.test.tsx`：
- 删除 `aria-hidden` 渐变条 span 断言；更新 padding 类名。

## 8.2 集成 / E2E

- 浏览器实测（Playwright）：
  1. 同一会话多次发送 → 切到另一会话 → 切回，CycleCard 视觉完整（圆角边框 + 紫色条 + final 内容齐全）。
  2. step 卡片默认只显示 actionLabel + meta，无 keyParams/result。
  3. 点击 step 卡片 → 展开 keyParams/result。

## 8.3 tsc / lint / vitest

- `pnpm -C web exec tsc -b` 零误差。
- `pnpm -C web run test --run` 全绿。

# 9. 验收

- ✅ 紫色竖条仅覆盖 trace 部分；final markdown 区域不被紫色条覆盖。
- ✅ 工具名显示中文可读名称（`toolActionLabel`），且不截断（长名字走自然宽度）。
- ✅ 不再用颜色编码状态（无 ✓/⚠/↻ 彩色徽章）。
- ✅ step 卡片默认只显示 actionLabel + meta；点击展开 keyParams/result。
- ✅ 思考步骤视觉降级：灰点 + 灰字，无徽章。
- ✅ `GeneratingIndicator` 只剩转圈。
- ✅ 所有 step-card 高度统一 36px。
- ✅ CycleCard 固定宽度 560px，相邻卡片左缘右缘对齐。
- ✅ 切会话回来 CycleCard 视觉完整（圆角边框 + 紫色条 + final 内容齐全）。
- ✅ 360 px 窄屏无横向滚动。
- ✅ WCAG AA：状态信息依赖 button aria-label。

# 10. References 检查

- `harness-kit/references/definition-of-done.md` → 视觉 / DOM 双轴；测试齐备；tsc + vitest 跑过。
- `harness-kit/references/frontend-ui-engineering` → 复用 token；不引入 magic color。
- `harness-kit/references/accessibility-checklist.md` → 状态语义靠 button aria-label + summary aria-live 兜底；无颜色徽章后 a11y 仍满足。
- `harness-kit/references/testing-patterns.md` → AAA；mock 层次最小化。
- `harness-kit/references/performance-checklist.md` → 默认折叠减少首次渲染 DOM 节点；key 重挂载仅在切消息时触发。

# 12. Next

写 plan 后等用户说「开始实现」。