---
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
  - .ai-runtime-artifacts/specs/2026-08-11-run-trace-spacing-cn-name-spec.md（v3.1，已落地）
  - .superpowers/brainstorm/run-trace-cycle-v6/content/index.html（v6 mockup，已批准）
  - 用户反馈 5 张实际应用截图
status: draft
approved: false
created_at: 2026-08-11
---

# Run Trace v4 — 双布局（trace 灰色气泡 + final 裸内容）+ 切会话 bug 修复

# 1. 背景

v3.1（spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-spacing-cn-name-spec.md`）已落地：紫色侧条归 trace、StepLabel 删除嵌入 button、step-card 高度刚性化、CycleCard 固定宽度 560px、思考步骤降级、Generating 简化、工具名不截断、`key={message.id}` 双保险。**但用户在浏览器实测发现两个未达预期问题**：

1. **trace 与 final 仍同处一容器**：v3.1 的 `CycleCard` 是**单气泡包 trace + final**。用户期望两者**视觉分离**：trace 独立灰色气泡 + final 裸内容铺在 chat 列表（参考 v6 mockup）。
2. **致命 bug：切会话产生多个气泡**：从某会话切走再切回，已完成 CycleCard **没有边框、没有紫色侧条**，final 文字"裸奔"渲染（截图 5）。v3.1 的 `key={message.id}` 未真正修复此 bug——根因待定位。

# 2. 目标

- trace 独立灰色气泡（居左、660px、`#f1f2f4` 背景、紫色侧条、有边框）
- final 裸内容（无边框 / 无背景 / 无气泡，居左 720px，直接铺 chat 列表）
- 两者**左缘对齐、不嵌套**
- 修复切会话 bug（根因定位后彻底修复）

# 3. 非目标

- 不改 v3.1 已落地的样式细节（工具名 sans 13px、思考降级、step-card h-9、Generating 简化等）
- 不改 `runTrace.ts` 数据层
- 不改 `Markdown.tsx`
- 不改 SSE 协议

# 4. 设计

## 4.1 双布局（v6 mockup 拍板）

**当前 v3.1 形态**：

```
[msg assistant]
  └─ CycleCard (560px, bg-white, border)
       ├─ RunTracePanel (trace)
       ├─ final-md (markdown 段落/表格)
       └─ GeneratingIndicator (可选)
```

**v4 目标形态**：

```
[msg assistant, flex-col, items-stretch]
  ├─ TraceBubble (居左, max-w 660px, bg #f1f2f4, border, 紫色侧条)
  │    └─ RunTracePanel (trace)
  └─ final-md-container (居左, max-w 720px, 无边框/无背景/无气泡)
       └─ Markdown (段落/表格)
```

两个**独立 DOM 节点**，trace 与 final 之间无 wrapper、无气泡嵌套。

## 4.2 CycleCard → TraceBubble 改名

| 属性 | v3.1 | v4 |
|---|---|---|
| 组件名 | `CycleCard` | `TraceBubble`（语义更准确） |
| 背景 | `bg-white` | `bg-[#f1f2f4]`（灰色，工具感） |
| padding | `px-4 py-3.5` | `p-0`（容器内 RunTracePanel 自己处理 padding） |
| max-width | `560px` | `660px` |
| align-self | `flex-start` | `flex-start`（左对齐） |
| 紫色侧条 | 已移到 RunTracePanel 内部（v3.1） | 同 |

**保留 `CycleCard` 名字作为 alias**（避免破坏外部 import）—— 实际指向 TraceBubble。或彻底改名（推荐）。

## 4.3 MessageBubble 结构调整

**当前（v3.1）**：

```tsx
<CycleCard key={message.id}>
  {showTrace && <RunTracePanel ... />}
  {textBlocks.length > 0 && <Markdown ... />}
  {showGeneratingIndicator && <GeneratingIndicator />}
</CycleCard>
```

**v4**：

```tsx
<>
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
          <Markdown text={textBlocks.map(b => b.text).join('\n')} />
        </div>
      </Suspense>
    </div>
  )}
  {showGeneratingIndicator && (
    <div key={`${message.id}-gen`} className="self-start">
      <GeneratingIndicator />
    </div>
  )}
</>
```

要点：

- 用 **Fragment** 包，不再用 `CycleCard` 整体容器
- 每个子节点**独立 key**（`${message.id}-trace` / `${message.id}-final` / `${message.id}-gen`），切会话时 React 识别稳定
- `TraceBubble` 只包 trace 步骤；final markdown 是**单独的 `<div>`** 节点，不再嵌入气泡内
- `GeneratingIndicator` 也是独立节点，紧跟 final 之后（无气泡）

## 4.4 切会话 bug 修复（根因诊断 + 修法）

### 4.4.1 复现条件

用户 A 会话 → 切到 B 会话 → 切回 A。**已完成的 CycleCard 边框 + 紫色侧条消失**，final 文字裸渲染在 chat 列表背景。

### 4.4.2 候选根因

- **H1**：v3.1 加的 `key={message.id}` 实际无效（被并发模式吞掉，或 message.id 复用）
- **H2**：`CycleCard` 实际未渲染（条件判断失败），但 final markdown 还在外层
- **H3**：`MessageList` 在切会话时把会话 A 的消息 + 会话 B 的消息**累积渲染**，导致一条 AI 消息变成 N 个气泡
- **H4**：CSS 渲染错位（`CycleCard` 的 border/紫色 `::before` 在切会话瞬间被 unmount 但未重新挂载）
- **H5**：`useChatStream` 在切会话时把旧消息的 streamState 错误继承，导致 CycleCard 的 `bg-white` + border 类被某些条件 class 覆盖

### 4.4.3 修复策略

1. **诊断阶段**（leader + implementer 先排查）：
   - 启 vite + 浏览器复现
   - 用 React DevTools / DOM 检查切会话瞬间 CycleCard DOM 是否在
   - 检查 `useChatStream` / `MessageList` 是否在切会话时累积消息
2. **修复阶段**（取决于根因）：
   - 如果 H3：消息累积 → 修 `MessageList` 或 `useChatStream` 的 sessionId 切换逻辑
   - 如果 H1/H4：`key` 改用更稳定的 key（如 `sessionId + messageIndex`），或加 `useMemo` 强制组件实例重建
   - 如果 H5：检查 className 条件分支

### 4.4.4 验证手段

- 启动 vite dev server（`pnpm -C web run dev`）
- Playwright 脚本：开 A 会话 → 切 B → 切回 A，截图对比
- 截图断言：CycleCard 边框 + 紫色侧条在切回后仍然存在

## 4.5 间距

- TraceBubble 内 RunTracePanel padding：`px-3.5 py-2.5`（v3.1 已落地）
- final 容器：`py-1`（小段间距，不贴 trace 也不太空）
- final markdown 段落：`mb-3`（v3.1 已有）

## 4.6 切会话 bug 复盘

- v3.1 写的修复是 `key={message.id}` + `resetKey`，**没真修**。教训：spec 阶段的"修法"必须**先验证根因**，不能凭直觉加防御代码。
- 本 spec §4.4 改诊断流程：先 Playwright 复现 → DOM 检查 → 定位根因 → 修复。

# 5. 数据 / 接口

## 5.1 CycleCard 重命名

**决策**：彻底改名 `CycleCard` → `TraceBubble`。同时改文件路径：

- `web/src/components/chat/CycleCard.tsx` → `TraceBubble.tsx`

需要更新的 import：
- `MessageBubble.tsx`（唯一外部用户）

如果发现外部 import（grep `CycleCard`），需逐一更新。

## 5.2 MessageBubble 接口

无变化（仅内部结构调整）。

# 6. 实现范围

## 6.1 文件改动

| 文件 | 改动 |
|---|---|
| `web/src/components/chat/CycleCard.tsx` → 重命名 `TraceBubble.tsx` | 重命名；背景 `bg-white` → `bg-[#f1f2f4]`；padding 改为 `p-0`；max-width `560px` → `660px` |
| `web/src/components/chat/MessageBubble.tsx` | 结构调整：Fragment 替代 CycleCard wrapper；trace / final / gen 三独立节点 + 独立 key |
| 切会话 bug 修复（待根因定位） | 修改 `MessageList.tsx` / `useChatStream.ts` 等（按根因确定） |
| `web/tests/features/chat/cycle-card.test.tsx` | 改名为 `trace-bubble.test.tsx`；断言更新（背景色、宽度、无 final 内容） |
| `web/tests/features/chat/message-bubble-cycle.test.tsx` | 断言：trace 与 final 是独立 DOM 节点（不再嵌入同一气泡） |
| `web/tests/features/chat/run-trace-panel.test.tsx` | 不变（v3.1 已更新） |
| `web/tests/features/chat/run-trace-panel-matrix.test.tsx` | 不变 |
| `web/tests/features/chat/generating-indicator.test.tsx` | 不变 |

## 6.2 不改动

- `runTrace.ts`（v3.1 已消费 `toolActionLabel`）
- `Markdown.tsx`、`RunTracePanel.tsx`（仅消费者，结构不变）
- SSE 协议

# 7. 兼容性

- WCAG 2.1 AA：v3.1 已落地无颜色编码 + aria-label
- 暗色模式：trace `#f1f2f4` 在暗色模式需调整为 `rgba(255,255,255,.04)`（与 dark step-card 背景同）
- 360 px 窄屏：trace 660px → 100%；final 720px → 100%；flex-col 自动堆叠

# 8. 测试

## 8.1 单元 / 组件（vitest）

`trace-bubble.test.tsx`：
- 断言：背景 `bg-[#f1f2f4]`、max-width 660px、左对齐、不包含 final markdown

`message-bubble-cycle.test.tsx`：
- 断言：trace 和 final 是**独立 DOM 节点**（查询用 `data-testid` 区分）
- 断言：切不同 message.id 时 trace / final 节点独立 remount
- 断言：generating indicator 独立节点

## 8.2 集成 / E2E（Playwright + vite）

- 启 vite → 复现切会话 bug（开 A → 切 B → 切回 A）
- 断言：CycleCard（TraceBubble）边框 + 紫色侧条始终存在
- 断言：trace 与 final 视觉对齐（两者左缘、垂直方向不嵌套）

## 8.3 tsc / lint / vitest

- `pnpm -C web exec tsc -b` 零误差
- `pnpm exec vitest run` 全绿（pre-existing bundle.test.ts 失败忽略）

# 9. 验收

- ✅ TraceBubble 灰色（`#f1f2f4` 背景、660px 居左、紫色侧条）
- ✅ final markdown 无边框 / 无背景 / 居左 720px
- ✅ trace 与 final 左缘对齐、垂直方向不嵌套
- ✅ 思考步骤视觉降级保留（v3.1）
- ✅ 切会话回来 TraceBubble 视觉完整（边框 + 紫色侧条 + final 内容齐全）
- ✅ GeneratingIndicator 独立节点
- ✅ 360 px 窄屏无横向滚动

# 10. References 检查

- `harness-kit/references/definition-of-done.md` § 视觉 / DOM 双轴；tsc + vitest 跑过
- `harness-kit/references/frontend-ui-engineering` § 复用 token；不引入 magic color（`#f1f2f4` 是 hardcoded，建议从 token 派生）
- `harness-kit/references/accessibility-checklist.md` § 状态语义靠 aria-label（保留 v3.1）
- `harness-kit/references/testing-patterns.md` § AAA；mock 最小化
- `harness-kit/references/orchestration-patterns.md` § 切会话 bug 修法：先诊断再修复，不堆防御代码

# 11. 风险点

1. **`CycleCard` 重命名**破坏外部 import（grep 后处理）
2. **切会话 bug 根因未明**：spec §4.4 列了 5 个假设，**实施 WU 必须先诊断再修**
3. **结构改动 + 测试**：MessageBubble 从单气泡改为多节点，所有 message-bubble 测试断言可能失效
4. **`#f1f2f4` 灰色**：未来换主题（如 dark mode）需 token 化，建议本批顺便抽 token

# 12. Next

写 plan + dispatch。等用户说「开始实现」。