---
title: 消息循环分组与转圈下移 — 实施计划
spec: .ai-runtime-artifacts/specs/2026-08-11-message-cycle-grouping-spec.md
mockup: .superpowers/brainstorm/run-trace-cycle/content/index.html
date: 2026-08-11
branch: task/run-trace-cycle-grouping
prev-batch: .ai-runtime-artifacts/plans/2026-08-11-run-trace-typography-plan.md
---

# 0. 前置

- spec 已 `approved: true`（用户「看完了可以的，写计划」）。
- 已选方案 **B**：`CycleCard` 包裹 + 左侧 3 px 主色竖条 + 转圈下移到 final 之后。
- 分支基线：在 `task/run-trace-typography` 已合入 develop 的前提下，从 **当前 HEAD**（开发分支链顶端）拉 `task/run-trace-cycle-grouping`。
  - 若 `task/run-trace-typography` 还在分支未合：直接续在该分支上（避免多分支来回切，commit 仍按 batch 切）。
- 不开 worktree（单 WU 顺序、无并行；Leader 主线程写代码，Tier 1 也允许）。本 batch 体量 < 100 行修改。

# 1. WU 拆解

| WU | 范围 | Agent | 估计 LOC |
| --- | --- | --- | --- |
| WU-01 | `CycleCard` + `GeneratingIndicator` 新组件实现 | coder | +60 |
| WU-02 | `MessageBubble` 改造：去 ThinkingDots、套 CycleCard、转圈下移 | coder | +30 / −10 |
| WU-03 | 单元测试 + 矩阵测试补齐 | test-engineer | +200 |
| WU-04 | tsc / lint / vitest / 浏览器验证 + 文档落盘 | implementer | +40 / −0 |

总计预估 **+330 / −10**，影响 5 个文件。

# 2. WU-01 — CycleCard + GeneratingIndicator 新组件

## 目标

新增 2 个**纯展示**组件，不引入新依赖、不改任何 hook 或派生层。

## 文件

- 新建 `web/src/components/chat/CycleCard.tsx`
- 新建 `web/src/components/chat/GeneratingIndicator.tsx`

## 改动点

### CycleCard.tsx

```tsx
// 纯包装：左侧 3px 主色竖条 + 圆角边框
// 仅用作视觉分组，不参与 tab 流 / 不暴露 a11y label
interface CycleCardProps { children: ReactNode }
export function CycleCard({ children }: CycleCardProps) {
  return (
    <div className="relative mt-3 first:mt-0 rounded-xl border border-border/80 bg-surface shadow-sm">
      <span aria-hidden className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50" />
      <div className="px-3.5 py-3 space-y-2">{children}</div>
    </div>
  );
}
```

### GeneratingIndicator.tsx

```tsx
// final 之后的「还在生成」提示：转圈 + 文本，仅当 isStreaming && !hasFinalText 时显示
import { Loader2 } from 'lucide-react';
export function GeneratingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-border/70 text-[12px] text-text-muted"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
      <span>AI 仍在生成中…</span>
    </div>
  );
}
```

## 验收

- tsc -b 通过
- 不引入 import cycle
- 文件 < 60 行
- 文件落盘后无 lint 报错

---

# 3. WU-02 — MessageBubble 改造

## 目标

按 spec § 6.1 改造 `MessageBubble.tsx`：

1. **删除** `ThinkingDots` 渲染分支（原 `MessageBubble.tsx:78`）。
2. **包入** `CycleCard`：assistant 分支整段内容进 `<CycleCard>`。
3. **新增** `<GeneratingIndicator>`：仅当 `isStreaming && !hasFinalText` 时渲染。
4. user 分支**不动**（保留原 user bubble）。

## 文件

- `web/src/components/chat/MessageBubble.tsx`

## 改动点

```diff
- import { ThinkingDots } from './ThinkingDots';
+ import { CycleCard } from './CycleCard';
+ import { GeneratingIndicator } from './GeneratingIndicator';
```

```diff
  const showTrace = hasTraceSteps(trace);
- const showThinkingDots = isStreaming && !showTrace && !hasFinalText;
+ // ThinkingDots 已移除：trace 出现后其占位无意义；转圈下移到 final 之后
+ const showGeneratingIndicator = isStreaming && !hasFinalText;
```

```diff
  ) : (
    <div className="space-y-2">
-     {showThinkingDots && <ThinkingDots />}
+     <CycleCard>
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
              <Markdown text={textBlocks.map((b) => b.text).join('\n')} />
            </div>
          </Suspense>
        )}

-     {/* 用量 */}
+     {showGeneratingIndicator && <GeneratingIndicator />}
+     </CycleCard>
+     {/* 用量保留在 CycleCard 外（开发态、不影响视觉）*/}
+     {(import.meta as ...).env?.DEV === true && !isStreaming && message.usage && ...}
```

> 注意：`textBlocks.length > 0` 块**不要**用 `&&` 短路 0 个元素时仍要保留外层 div 占位（避免 CycleCard 在没 final 时空白）。
> 改为始终渲染 `<div className="prose prose-sm max-w-none break-words">`，文本为空时内容为空，Markdown 渲染空字符串也无副作用。

## 验收

- `web/src/components/chat/MessageBubble.tsx` 净改动 ≤ 30 行。
- `ThinkingDots` import 与变量**全部清除**（grep 0 命中）。
- 视觉对照 mockup 方案 B：cycle 包裹 + 左侧竖条 + 转圈下移。

---

# 4. WU-03 — 单元 + 矩阵测试

## 目标

按 spec § 8 新增 / 调整测试，覆盖 8 个用例。

## 文件

- 新建 `web/tests/components/chat/CycleCard.test.tsx`
- 新建 `web/tests/components/chat/GeneratingIndicator.test.tsx`
- 新建 `web/tests/components/chat/MessageBubble.cycle.test.tsx`（新增，不动已有 MessageBubble.test.tsx 防止干扰）
- 新建 `web/tests/components/chat/MessageBubble.cycle.matrix.test.tsx`

## 用例清单

| # | 文件 | 用例 | 期望 |
| --- | --- | --- | --- |
| 1 | CycleCard | 渲染 children | children 出现在 DOM；左侧竖条存在且 `aria-hidden="true"` |
| 2 | CycleCard | 不在 tab 流 | 容器本身无 `tabindex`、无非装饰 button |
| 3 | GeneratingIndicator | 含转圈 + 文本 + role/aria-live | `role="status"` `aria-live="polite"`，含 `Loader2` svg，含「AI 仍在生成中…」 |
| 4 | MessageBubble.cycle | 已完成 run | CycleCard 渲染，trace + final 在内，**无** GeneratingIndicator |
| 5 | MessageBubble.cycle | 进行中且无 final | CycleCard 渲染，**有** GeneratingIndicator，final 区可能空 |
| 6 | MessageBubble.cycle | 进行中且有 final（部分流） | CycleCard 渲染，trace + final，**无** GeneratingIndicator（final 存在时不再示生成中） |
| 7 | MessageBubble.cycle | 多次 run | DOM 内出现 2 个 CycleCard，user bubble 不进 CycleCard |
| 8 | MessageBubble.cycle.matrix | 360 px 窄屏 | 无水平滚动；trace / final / indicator 均不溢出 |
| 9 | MessageBubble.cycle.matrix | 暗色 + 亮色 | 主题切换 token 一致（用 `data-theme` 切换 + 截图对比） |

## 测试工具

- `vitest` + `@testing-library/react`（已在用）
- `resize-observer-polyfill`（已有则复用）
- 截图对比：**不引入**新依赖；只断言关键 class / role / 文本存在

## 验收

- `pnpm -C web run test --run` 全绿，新增 ≥ 9 用例。
- 不修改既有测试（避免影响前一批次）。

---

# 5. WU-04 — tsc / lint / 浏览器验证 + 文档落盘

## 目标

- type-check / lint / 单测一次过。
- 浏览器实测（playwright）覆盖核心场景：已完成 run / 进行中 run / 多次 run。
- 写 verification-lite + 更新 dispatch + 写 execution-log。

## 文件

- `web/tsconfig.tsbuildinfo` 不动
- 新建 `.ai-runtime-artifacts/verifications/2026-08-11-message-cycle-grouping-verification-lite.md`

## 步骤

1. `pnpm -C web exec tsc -b` → 0 errors。
2. `pnpm -C web run lint:eslint -- --max-warnings 0` → pass。
3. `pnpm -C web run test --run` → 全绿。
4. playwright 跑两条历史会话：
   - `/#/chat/gconv-7d18591cceb8`（研究开源 AI 桌面应用，已完成）
   - `/#/chat/gconv-183c6ca978b5`（写一篇 AI 办公助手推荐社媒文章）
   截图 + 检查 CycleCard 数量 / 左侧竖条 / GeneratingIndicator 文案。
5. 写 `verification-lite.md`，含：
   - 命令 / 输出
   - 截图清单（路径）
   - References 检查（每条勾过）

## 验收

- 4 条命令零错。
- verification-lite 含命令输出片段 + 截图引用。
- References 检查勾完（definition-of-done / a11y / testing / performance）。

---

# 6. WU 执行顺序与依赖

```
WU-01 (新组件)
   ↓
WU-02 (MessageBubble 接入)
   ↓
WU-03 (测试)
   ↓
WU-04 (验证 + 文档)
```

**串行执行**。本批工作量小（≈ +330 LOC），并行无收益；串行避免 review 跨 WU diff。

# 7. 风险与兜底

| 风险 | 兜底 |
| --- | --- |
| `Markdown` 渲染空字符串抛错 | 测试用例覆盖；如出问题，`<Markdown text="" />` 改为条件渲染 |
| CycleCard 阴影在窄屏被裁 | `overflow-hidden` 不加，让 border / shadow 自然溢出 |
| 测试文件命名冲突 | 不改既有 MessageBubble.test.tsx，新建 `MessageBubble.cycle.test.tsx` |
| 暗色模式 token 未覆盖 | grep `--tw-` 字符串；若有 hardcoded color 替换为 token |
| 既有类型导入路径（`/chat/runTrace`） | 已有 alias，不动 |

# 8. 范围之外

- 不做跨多次 run 的内容去重（语义层改动，本期不做）。
- 不改 SSE / messageId / runId 协议。
- 不动 ChatPage / Composer / Sidebar。
- 不改 RunTracePanel / runTrace。

# 9. Next

dispatch 落盘后等用户「开始实现 / 并行执行」。
（实际本 batch 串行，预计一次发车即可完成 4 WU。）