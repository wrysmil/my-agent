---
title: Run Trace UX 修订 — 工具名左列 + 默认展开 + 切会话状态隔离
status: ready
approved: true
date: 2026-08-11
route: Tier 2 编排候选
prev-spec:
  - .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-typography-redesign-spec.md
---

# 1. 背景

上一轮「Message Cycle Grouping」完成后，用户在浏览器实测发现三处 UX 缺陷：

1. **左侧时间线看不到工具名称**：当前 timeline node 仅为 4×4 圆点 + 状态图标（✓/⚠/spinner/小点），工具名（`web_fetch`、`write_file` 等）只能等用户展开 trace 并定位到行内 `actionLabel` 才能看到。折叠态看不到用了哪些工具，违反"summary 即索引"的预期。
2. **已完成 run 默认折叠**：当前 `shouldAutoExpand` 只在 `errorCount > 0` 或 `isStreaming` 时返回 `true`。**已完成 + 无错误** 的历史消息默认折叠 → 用户看不到 trace 步骤列表（含工具名），观感上"什么都没发生过"。
3. **切换会话时 RunTracePanel 内部状态泄漏**：`RunTracePanel` 用 `useState` 存 `userOverride` / `expanded` / `openStepIds`，但没有任何 prop 标识身份。切会话时如果 React 复用同一组件实例（key 不变），上一次的展开/折叠/打开详情状态会串到新消息上。**用户实测："切换会话再回来变鬼样子，刷新就正常"** —— 典型 React 状态泄漏症状。

> 实测现场：用户截图显示同会话第二次 run（`已完成 2 个步骤 · 1 个工具`）折叠态只显示数字摘要，看不到工具名；切到别的会话再切回，原本展开的 trace 莫名折叠 / 步骤详情莫名关闭。

# 2. 目标

- **左侧时间线列直接显示步骤身份**：tool 节点显示 `toolName` 原始标识符；thinking 节点显示「思考」；error 节点显示「错误」；running 节点显示「执行中」。折叠态也能一眼看到这次 run 用过的工具清单。
- **已完成 + 无错误的 run 默认展开 trace**：保证历史消息自动可读，仅保留对运行中和错误态的折叠偏好。
- **切换消息/会话时强制重置 RunTracePanel 内部 UI 状态**：避免跨消息的展开/折叠/详情展开状态串味。

# 3. 非目标

- **不**改 trace 数据模型（`runTrace.ts` 的派生层、`KeyParam` 提取已就位，不动）。
- **不**改 SSE / 流式协议 / 消息结构 / `CycleCard` 视觉。
- **不**在 `RunTracePanel` 之外引入新折叠逻辑（仍由该组件自治）。
- **不**动 `MessageList` 列表渲染逻辑；reset key 由 `MessageBubble` 一层下传即可。

# 4. 设计

## 4.1 左侧时间线列（StepLabel 替换 StepNode 圆点）

**当前实现**（`RunTracePanel.tsx:269-301`）：每个 `<li>` 绝对定位一个 `h-4 w-4` 圆形状态点（`StepNode`），状态用图标 + 颜色编码。虚线串联左右。

**修订实现**：把 `StepNode` 圆点**保留为右上角小圆徽章**（`absolute left-[18px] top-[2px] h-3 w-3`），主体改为在节点中心位置**渲染步骤身份文本**：

| 步骤类型 | 节点位置显示 | 颜色 | 右上徽章 |
|---|---|---|---|
| `tool` (done) | `toolName`（如 `write_file`） | `text-green-700` | ✓ 绿 |
| `tool` (running) | `toolName` | `text-primary` | ↻ 主色 spinner |
| `tool` (error) | `toolName` | `text-danger` | ⚠ 红 |
| `thinking` (done) | 「思考」 | `text-text-muted` | ✓ 灰 |
| `thinking` (running) | 「思考」 | `text-primary` | ↻ 主色 spinner |

字体 `font-mono text-[11px] tabular-nums`，最多 10 字符，超出截断 + `title` 提示。徽章与原本 `StepNode` 圆点同样 `bg-surface`，保持与背景融合。

**为什么要保留徽章**：状态点（运行/完成/失败）仍然需要颜色编码，仅靠文字无法 1 秒扫读状态。

**视觉影响**：
- `<li>` 左侧 padding 由 `pl-[34px]` 调整为 `pl-[88px]`（容纳最长 10 字符 mono 字 + 徽章）。
- `data-trace-line` 虚线位置同步调整到 `left-[82px]`（节点中心）。
- 行内 `flex items-center` 在 `pl-[88px]` 之后不变，按钮区右对齐逻辑保留。

## 4.2 默认展开策略修订

**当前**（`RunTracePanel.tsx:38-46`）：
```ts
function shouldAutoExpand(isStreaming, hasFinalText, errorCount): boolean {
  if (!hasFinalText && errorCount > 0) return true;
  if (isStreaming && !hasFinalText) return true;
  return false;  // ← 已完成无错误总是折叠
}
```

**修订**：
```ts
function shouldAutoExpand(isStreaming, hasFinalText, errorCount): boolean {
  if (errorCount > 0) return true;       // 错误强制展开（保留）
  if (isStreaming && !hasFinalText) return true;  // 流中无 final 强制展开（保留）
  if (!isStreaming && errorCount === 0) return true;  // 已完成无错误 → 默认展开
  return false;
}
```

**结果矩阵**：

| isStreaming | hasFinalText | errorCount | 默认 |
|---|---|---|---|
| false | false | 0 | ✅ **展开**（修订） |
| false | true | 0 | ✅ **展开**（修订） |
| false | true | >0 | ✅ 展开（保留） |
| true | false | 0 | ✅ 展开（保留） |
| true | true | 0 | ❌ 折叠（运行中已结束 final，等待下一轮） |

`userOverride` 机制保留（用户手动折叠/展开后不再被 effect 拉回）。

## 4.3 切会话状态隔离（resetKey）

**当前**：`RunTracePanel` 没有身份 prop，状态完全本地。

**修订**：新增可选 prop `resetKey?: string`。

- `MessageBubble.tsx` 在调用 `RunTracePanel` 时传 `resetKey={message.id}`。
- `RunTracePanel` 内部：
  ```ts
  useEffect(() => {
    setUserOverride(false);
    setExpanded(shouldAutoExpand(isStreaming, hasFinalText, trace.errorCount));
    setOpenStepIds(new Set());
  }, [resetKey]);
  ```
- `resetKey` 变化 → 强制清空三个 UI 状态并重算默认展开。

`message.id` 是 ChatMessage 已有字段（由流式层分配），无协议改动。

# 5. 数据 / 接口

## 5.1 `RunTracePanelProps` 扩展

```ts
export interface RunTracePanelProps {
  trace: RunTraceViewModel;
  isStreaming: boolean;
  hasFinalText: boolean;
  /** 切消息/会话的强 reset 钩子；message.id 即可 */
  resetKey?: string;
}
```

## 5.2 `MessageBubble.tsx` 调用更新

```tsx
<RunTracePanel
  trace={trace}
  isStreaming={isStreaming}
  hasFinalText={hasFinalText}
  resetKey={message.id}
/>
```

## 5.3 数据模型

**不改动** `runTrace.ts` / `ChatMessage` / `Block`。

## 5.4 视觉 token

- 徽章颜色复用现有 `text-green-600 / text-primary / text-danger / text-text-muted`。
- 文字颜色 `text-text` / `text-primary` / `text-danger`，与节点徽章区分（文字偏深，徽章图标偏亮）。

# 6. 实现范围

## 6.1 文件改动

| 文件 | 改动 |
|---|---|
| `web/src/components/chat/RunTracePanel.tsx` | 新增 `resetKey` prop；`StepNode` → `StepLabel` + 右上徽章组合；`shouldAutoExpand` 默认展开策略；`<li>` padding / `data-trace-line` left 同步 |
| `web/src/components/chat/MessageBubble.tsx` | 给 `RunTracePanel` 加 `resetKey={message.id}` |
| `web/tests/features/chat/run-trace-panel.test.tsx` | 加 resetKey / StepLabel / 默认展开新测试；旧"节点圆点"断言改"节点文字 + 徽章" |
| `web/tests/features/chat/run-trace-panel-matrix.test.tsx` | 同上 |
| `web/tests/features/chat/message-bubble-cycle.test.tsx` | 加 resetKey 传递断言 |

## 6.2 不改动

- `runTrace.ts`、`CycleCard.tsx`、`GeneratingIndicator.tsx`、`MessageList.tsx`、`Markdown.tsx`、`useChatStream.ts`。
- SSE 协议 / 流式状态机 / `ChatMessage` schema。
- 之前未提交的 WIP（`runTrace.ts` / `runTrace.test.ts` 的 `KeyParam` 提取）：本期确认是否一起 commit，但代码内容不动。

# 7. 兼容性

- **WCAG 2.1 AA**：节点身份文字继续 `aria-hidden`（视觉装饰）；徽章状态保留语义（`aria-label="已完成"` 等）；展开/折叠按钮仍带 `aria-expanded`。
- **键盘导航**：resetKey 变化不抢焦点（useEffect 在 commit 阶段触发，无 focus 副作用）。
- **滚动**：左列变宽不影响 sticky-bottom（外层 `<div>` 高度不变）。
- **暗色模式**：token 派生颜色不变，无主题破坏。
- **现有动画**：旋转 spinner / `transition-transform` 仍生效。

# 8. 测试

## 8.1 单元 / 组件（vitest）

`web/tests/features/chat/run-trace-panel.test.tsx` 新增 / 调整：

1. 节点身份文本断言：`tool` 节点渲染 `toolName`；`thinking` 节点渲染「思考」；超长截断 + `title` 完整值。
2. 右上徽章断言：done tool → ✓ 绿；running tool → spinner；error → ⚠ 红；thinking done → ✓ 灰。
3. `<li>` padding = `pl-[88px]`（不是 `pl-[34px]`）。
4. 默认展开：`isStreaming=false` + `errorCount=0` → 渲染 `<ol>` 不带 `hidden`。
5. 默认折叠：仅 `isStreaming=true && hasFinalText=true` 时折叠（运行中且已 final）。
6. userOverride：手动点折叠后，effect 不再拉回展开。
7. resetKey 变化：传入不同 `resetKey` → 状态重置（步骤详情关闭、userOverride 清空、expanded 重算）。

`web/tests/features/chat/message-bubble-cycle.test.tsx` 新增：
- 渲染时 `RunTracePanel` 接收的 props 中 `resetKey === message.id`。

## 8.2 矩阵测试（vitest）

`web/tests/features/chat/run-trace-panel-matrix.test.tsx`：
- 360 px 窄屏：节点文字 + keyParam pill 不溢出，无水平滚动。
- 多步骤：所有节点身份文本并列可见，无截断信息丢失。
- 暗色模式：颜色 token 切换不破坏。

## 8.3 tsc / lint / vitest

- `pnpm -C web exec tsc -b` 必跑，类型零误差。
- `pnpm -C web run lint:eslint -- --max-warnings 0` 通过。
- `pnpm -C web run test --run` 全绿。

## 8.4 浏览器视觉验证（Playwright）

复测以下场景：

1. 同一会话两次连续 run：第二次 run 折叠态摘要旁能看到 `write_file` 之类的工具名。
2. 历史已结束会话：刷新后默认 trace 展开，工具名 + 步骤全可见。
3. 切会话 → 再切回：原会话的展开/折叠状态被强制重置（基于 message.id，不依赖 React key 复用）。

# 9. 验收

- ✅ 折叠态能看到工具名列表（左侧 mono 字体文本列）。
- ✅ 已完成无错误 run 默认展开 trace。
- ✅ 切会话回来所有 RunTracePanel 内部 UI 状态恢复默认。
- ✅ 360 px 窄屏无横向滚动。
- ✅ WCAG AA：状态节点继续 `aria-hidden`，状态徽章保留语义。

# 10. References 检查

- `harness-kit/references/definition-of-done.md` → 视觉 / DOM 双轴；测试齐备；tsc + vitest 跑过。
- `harness-kit/references/frontend-ui-engineering` → 复用 token；不引入 magic color。
- `harness-kit/references/accessibility-checklist.md` → 节点身份文字 `aria-hidden`；徽章状态语义保留。
- `harness-kit/references/testing-patterns.md` → AAA；mock 层次最小化。
- `harness-kit/references/performance-checklist.md` → resetKey effect 一次性重置，无运行时热路径。

# 11. 范围之外

- 把 `RunTracePanel` 抽象为无状态组件 + 父组件托管（**本期不做**，状态隔离已在 prop 层完成）。
- 工具名多语言化（**本期不做**，保持原始 `toolName`）。
- 节点身份文字增加可点击跳转到步骤详情的交互（**本期不做**）。

# 12. Next

写 plan 后等用户说「开始实现 / 并行执行」。