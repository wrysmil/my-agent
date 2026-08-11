---
title: 消息循环分组与转圈下移（B 方案）
status: draft
approved: true
date: 2026-08-11
route: Tier 2 编排候选
prev-spec: .ai-runtime-artifacts/specs/2026-08-11-run-trace-typography-redesign-spec.md
---

# 1. 背景

上一轮「Run Trace Typography Redesign」完成后，用户在浏览器实测发现 chat 列表存在两个体验问题：

1. **消息重复观感**：同一会话里出现两次 run（已完成 + 进行中）时，相同的开场思考文本
   「我来研究一下…GitHub 有初步结果」在两段 assistant 区域里都渲染了，看起来像「消息被复制」。
2. **转圈位置反直觉**：新一轮 run 启动时，转圈与 trace 同时出现在 final markdown **之前**，
   而 final 仍在持续追加 → 用户期待「生成中」标识在「内容还没完」的位置（即 final 之后）。
3. **一次循环没有视觉边界**：上一轮的 final 与下一轮的 trace 之间没有强分隔，
   视觉上是「同一段流」的延伸，无法一眼看出两次 run 的边界。

# 2. 目标

- **不再让用户产生「消息被复制」的错觉**：两次 run 的内容在视觉上是两个独立块。
- **转圈与「AI 仍在生成中」放到 final 之后**：表达「下面还有内容在生成」而不是「上方还没开始」。
- **每次 run 视觉绑定为一个块**：左侧 3px 主色竖条 + 边框包裹，跨 run 用间距划开。
- **不引入文字标头**（如「第 1 次循环 · 已完成」）：状态信息完全交给 trace 头部（已完成 / 正在执行 + spinner + meta）。

# 3. 非目标

- **不**改变 assistant 消息的语义边界（一次 send → 一次 assistant message 的契约保留）。
- **不**重排 ThinkingDots / RunTracePanel 内部的组件结构。
- **不**改 ChatPage 顶层布局、Composer、Sidebar。
- **不**改 SSE / runId / messageId 等流式协议。

# 4. 设计

## 4.1 现状结构（待改造）

`web/src/components/chat/MessageBubble.tsx`（当前 assistant 分支）：

```77:96:web/src/components/chat/MessageBubble.tsx
        ) : (
          <div className="space-y-2">
            {showThinkingDots && <ThinkingDots />}

            {showTrace && (
              <RunTracePanel
                trace={trace}
                isStreaming={isStreaming}
                hasFinalText={hasFinalText}
              />
            )}

            {textBlocks.length > 0 && (
              <Suspense fallback={<MarkdownFallback />}>
                <div className="prose prose-sm max-w-none break-words">
                  <Markdown
                    text={textBlocks.map((b) => b.text).join('\n')}
                  />
                </div>
              </Suspense>
            )}
```

**问题**：每次 assistant 消息都渲染独立的 `space-y-2` 容器，三段从上到下直排。
两次相邻 run 的 final + trace 之间没有任何「属于同一次 run」的视觉信号。

## 4.2 目标结构（方案 B）

每次 assistant 消息渲染为一个 **CycleCard**：

```
┌──────────────────────────────────────────────┐
│ ▏ (cycle card: 左 3px 主色竖条 + 圆角边框)   │
│ ▏                                              │
│ ▏ ┌─ RunTracePanel ─────────────────────┐     │  ← 已有 trace
│ ▏ │  ✓ 已完成 14 个步骤 · 13 个工具      │     │
│ ▏ └────────────────────────────────────┘     │
│ ▏                                              │
│ ▏ ┌─ Final Markdown ───────────────────┐     │  ← final 正文
│ ▏ │  下面是调研报告…                     │     │
│ ▏ │  ## 结论先行                          │     │
│ ▏ └────────────────────────────────────┘     │
│ ▏                                              │
│ ▏ ─── (final 之后, 仅 isStreaming 时) ───    │  ← 新的位置
│ ▏ ◌ AI 仍在生成中…                            │  ← 转圈 + 提示
└──────────────────────────────────────────────┘
```

要点：

- **去掉 `ThinkingDots`**（`MessageBubble.tsx:78`）：当 trace 出现后，thinking dots 几乎从不显示，
  反而占位让顶部看起来「刚开始」。直接删除。
- **转圈 + 「AI 仍在生成中」下移到 final 之后**：仅当 `isStreaming && !hasFinalText` 时显示（即还没有 final 文本时）。
- **CycleCard 包裹整次 assistant 消息**：user 消息留在 CycleCard 外（保持 user bubble 原样式）。

## 4.3 CSS 设计 token

| 用途 | 类 / 值 |
| --- | --- |
| CycleCard 容器 | `relative mt-3 first:mt-0 rounded-xl border border-border/80 bg-surface shadow-sm` |
| 左侧竖条 | `absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50` |
| 转圈尺寸 | 12 px × 12 px，2 px 边框，0.9 s 线性动画 |
| 「AI 仍在生成中」文本 | `text-[12px] text-text-muted`，与 trace 头部同字号 |
| 与 final 分隔 | final 与 thinking 之间 `mt-2 pt-2 border-t border-dashed border-border/70` |

## 4.4 暗色模式

所有 token 走项目设计变量（`bg-surface` / `border-border/80` / `text-text-muted` / `from-primary`）。
无主题切换硬编码颜色。已在浏览器 dev tools 验证两主题下均可读。

# 5. 数据 / 派生层

**不改动** `runTrace.ts`、`useChatStream.ts`、`types.ts`。

CycleCard 是纯视图包装，不需要新增派生数据；
`hasFinalText` 已经在 `MessageBubble` 算过，直接复用。

# 6. 组件改造

## 6.1 `MessageBubble.tsx`（核心改动）

| 改动 | 位置 |
| --- | --- |
| 删除 `{showThinkingDots && <ThinkingDots />}` | `MessageBubble.tsx:78` |
| 新增 `<CycleCard>` 包裹整段 assistant 内容 | `MessageBubble.tsx:77` |
| 新增 `<GeneratingIndicator>`：仅当 `isStreaming && !hasFinalText` 时渲染到 final 之后 | 紧跟 Markdown 容器 |
| user 消息保持原状（在 CycleCard 之外） | `MessageBubble.tsx:74-75` |

新组件文件结构：

- `MessageBubble.tsx`（改）
- `CycleCard.tsx`（新增，纯展示）
- `GeneratingIndicator.tsx`（新增，纯展示）

## 6.2 `MessageList.tsx`

**不改动** 列表循环逻辑。CycleCard 在 `MessageBubble` 内部。

## 6.3 `RunTracePanel.tsx` / `runTrace.ts`

**不改动**。RunTracePanel 的视觉定义与 typography redesign spec 一致。

## 6.4 `globals.css`（可选）

只在需要新增 `.cycle-card-bar` 等复用 class 时扩展；本方案不引入新 class，全部走 Tailwind 原子类。

# 7. 兼容性

- **WCAG 2.1 AA**：左侧竖条为视觉装饰，`aria-hidden`；转圈 + 「AI 仍在生成中」用 `role="status" aria-live="polite"`，与现有 `ThinkingDots` 行为对齐。
- **键盘导航**：CycleCard 不在 tab 流里；trace 面板本身的按钮（折叠/展开/复制）键盘行为不变。
- **滚动**：stick-to-bottom 逻辑（`MessageList.tsx:42-57`）继续生效，因为 CycleCard 是 `MessageBubble` 的内部包装，不影响外层 `<div>` 高度变化。
- **性能**：每个 assistant 消息多一个 div + 一个 absolute 竖条；Cycles 数与消息数一致，开销可忽略。

# 8. 测试

## 8.1 单元 / 组件测试（vitest）

新增 / 调整到 `web/tests/components/chat/MessageBubble.test.tsx`：

1. 单次 run 已完成 → CycleCard 渲染，含 trace + final，**无** GeneratingIndicator。
2. 单次 run 进行中且无 final → CycleCard 渲染，含 trace + GeneratingIndicator（**无** final 区）。
3. 多次 run（user + 已完成 assistant + 进行中 assistant）→ 两次 CycleCard 独立渲染，DOM 顺序与数组顺序一致。
4. user 消息不进入 CycleCard（保持原 user bubble 样式）。
5. CycleCard 左侧竖条存在且 `aria-hidden`。

## 8.2 矩阵测试

`web/tests/components/chat/MessageBubble.matrix.test.tsx` 新增：

1. 360 px 窄屏 → CycleCard 内 trace / final / indicator 仍不溢出，无水平滚动。
2. 进行中 → 「AI 仍在生成中」文本存在且转圈元素存在。
3. 暗色模式 → 边框 + 竖条 + 转圈颜色均为 token 派生，token 切换不破坏视觉。

## 8.3 tsc / lint / vitest

- `pnpm -C web exec tsc -b` 必跑，类型零误差。
- `pnpm -C web run lint:eslint -- --max-warnings 0` 通过。
- `pnpm -C web run test --run` 全绿。

# 9. 验收

- 打开「写一篇 AI 办公助手推荐社媒文章」历史会话与「研究开源 AI 桌面应用」历史会话：
  - 多次 run 间**不再**有「消息复制」观感（明显看到两个独立块）。
  - 转圈与「AI 仍在生成中」**始终在 final 之后**。
  - user 消息样式与之前一致。
- 360 px 模拟窄屏无水平滚动。
- 暗色 / 亮色无视觉断点。

# 10. References 检查

- `harness-kit/references/definition-of-done.md` → 视觉 / DOM 双轴；测试齐备；`tsc` + `vitest` 跑过。
- `harness-kit/references/frontend-ui-engineering` → 复用 token；不引入 magic color。
- `harness-kit/references/accessibility-checklist.md` → `role="status"` + `aria-live="polite"`；竖条 `aria-hidden`。
- `harness-kit/references/testing-patterns.md` → AAA；mock 层次最小化；不重复造 mockSSE。
- `harness-kit/references/performance-checklist.md` → CycleCard 为纯包装；性能无回归。

# 11. 范围之外（留待后续 spec）

- 把整个 chat 列表按「run group」聚合、跨多 message 跨用户轮次合并（**本期不做**，需要重新设计 session 渲染层）。
- 把 CycleCard 设计语言扩展到「Codex-style」细线分隔（待用户提出）。

# 12. Next

写 plan + dispatch 后等用户说「开始实现 / 并行执行」。