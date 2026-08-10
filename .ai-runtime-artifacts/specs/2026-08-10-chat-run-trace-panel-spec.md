---
artifact: spec
route: source-driven-development -> superpowers:brainstorming
skills:
  - source-driven-development
  - frontend-ui-engineering
  - frontend-design
skills_evidence:
  - .agents/skills/source-driven-development/SKILL.md
  - .agents/skills/frontend-ui-engineering/SKILL.md
  - .agents/skills/frontend-design/SKILL.md
  - skipped: brainstorming (SKILL.md not found in available project or user skill paths)
source:
  - 用户：「参考下 Kimi 那种……前提要契合当前项目」
  - 用户提供的 Kimi 过程时间线截图（平潭旅游页生成样例，两张）
  - 用户提供的当前项目过程面板截图
  - .ai-runtime-artifacts/research/2026-08-10-agent-process-panel-ux-research-report.md
  - .ai-runtime-artifacts/specs/2026-08-10-chat-session-stream-isolation-spec.md
  - .ai-runtime-artifacts/stack/2026-08-10-chat-session-stream-stack.md
  - web/src/components/chat/MessageBubble.tsx
  - web/src/components/chat/ProcessTracker.tsx
  - web/src/components/chat/ThinkingBlock.tsx
  - web/src/components/chat/ActivityStrip.tsx
created_at: 2026-08-10
status: approved
approved: true
approved_by: 用户（2026-08-10）：「可以的这个效果，我很满意，直接做吧」
approved_artifact: .ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-mockup.html
revision: 3
---

# Chat 单一 Run Trace 过程面板方案

## 1. 目标

将当前同一 assistant 回答中的工具、思考与运行状态，从多个并列折叠卡重构为一个 Kimi 风格但符合本项目设计系统的过程面板：

- 一次 run 只有一个过程入口；
- 最终答案始终是主内容；
- 用户能快速知道当前动作、完成进度和失败状态；
- 需要核验时可以查看步骤与工具详情；
- 不新增协议、不新增依赖、不复制其他产品品牌视觉。

## 2. 当前问题

当前 `MessageBubble` 顺序渲染：

1. `ThinkingDots`
2. `ProcessTracker`
3. `ActivityStrip`
4. 多个 `ThinkingBlockView`
5. 最终 Markdown

这会产生：

- 同一次 run 出现多个“思考过程”按钮；
- 工具调用与对应结果分成两行，信息翻倍；
- `ProcessTracker` 固定 `max-h-[300px] overflow-y-auto`，与消息列表形成嵌套滚动；
- ActivityStrip 与过程标题重复表达状态；
- assistant 整体大卡片、过程子卡片、thinking 子卡片形成三层边框；
- provider 的消息边界直接泄漏成用户界面边界。

## 3. 方案对比

### A. 只调整现有 CSS

减小边框、间距和字号，保留多个 ThinkingBlock。

优点：改动少。

缺点：无法消除重复控制项、嵌套滚动和信息架构错误。

结论：拒绝。

### B. 消息内单一 Run Trace（推荐）

将 thinking、tool call、tool result 派生为一个有序 timeline；最终 Markdown 独立显示。

优点：

- 与 Kimi 的核心交互一致；
- 适合当前 860px 单栏聊天布局；
- 可直接复用现有 blocks 与 Lucide；
- 不需要新增全局状态或后端协议。

缺点：需要重构过程组件及补组件测试。

结论：采用。

### C. 独立右侧 Research Sidebar

参考 ChatGPT Deep Research，把步骤和来源放入侧栏。

优点：长任务容量大，正文更干净。

缺点：当前页面宽度和布局不适合；移动端与状态同步成本高；对普通短任务过重。

结论：本期拒绝，可在未来“长任务工作台”模式单独设计。

## 4. 推荐交互

### 4.1 折叠态

assistant 消息顶部最多显示一个无外层卡片感的摘要行：

```text
⌄  已完成 12 个步骤 · 5 个工具
```

状态文案：

- submitting：`正在准备`
- thinking：`正在思考`
- tool_executing：`正在执行 {toolName}`
- generating：`正在整理回答`
- done：`已完成 {stepCount} 个步骤 · {toolCount} 个工具`
- partial/error：`完成，但有 {errorCount} 个步骤失败`
- aborted：`已停止 · 保留 {stepCount} 个步骤`

摘要行右侧显示 chevron；状态图标与文字共同表达，不只依赖颜色。

### 4.2 展开态（以用户提供的 Kimi 截图为校准）

过程面板是**一个**浅色圆角容器内的单一 timeline，行结构固定为：

```text
┌──────────────────────────────────────────────────────────┐
│  · 设计页面信息架构与交互                               > │
│  🔍 搜索网页   “平潭岛 旅游攻略 …”          11 个结果 > │
│  📄 获取网页   /path/or/domain.com            1 个网页 ∨ │
│  · 思考已完成                                           > │
│  ⌨ 运行 Python 代码                          已执行   > │
└──────────────────────────────────────────────────────────┘
最终答案（容器外，更高视觉权重）
```

行布局（每步一行，高度一致）：

| 区域 | 内容 |
| --- | --- |
| 左 | 类型图标或轻量 bullet；左侧虚线 timeline 贯穿 |
| 中 | 动作标题 + 同色更浅的一行参数摘要（查询词、路径、域名） |
| 右 | 结果计数或状态 + chevron；如 `11 个结果 >`、`1 个网页 ∨` |

规则：

- 整个过程只有**一层**容器边框；步骤本身不加独立卡片边框；
- 每个 `thinking` 是 timeline 中的轻量行，默认显示短标题（如“思考已完成”），完整 reasoning 点右侧 `>` 二次展开；
- 相邻且连续的 thinking 可合并为一个阶段，不跨工具步骤合并；
- `tool_call` 与同 `toolId` 的 `tool_result` **合并为一行**；运行中显示 spinner，完成显示计数/域名，失败显示错误文案；
- 工具名映射为用户动作：`web_search/web_fetch → 搜索网页/获取网页`，未知工具保留原名；
- 参数只显示安全摘要（截断 query/url）；完整参数与完整结果在该行内按需展开；
- **禁止**过程面板 `max-height + overflow-y`；只使用消息列表外层滚动；
- 过程区视觉权重低于最终答案：更小字号、muted 色、弱背景；正文在容器外、无过程边框包裹。

### 4.3 自动展开策略

- 新 run 开始且尚无最终 text：默认展开；
- 第一个 text block 出现：保持当前状态，不突然折叠；
- run 完成且用户从未手动操作：平滑折叠为摘要；
- 用户手动展开/折叠后，本次组件生命周期内不再自动改动；
- 历史会话加载：默认折叠；
- 存在 error 且无最终 text：默认展开；
- `prefers-reduced-motion` 下取消高度/旋转动画，仅即时切换。

### 4.4 最终答案

- 最终 Markdown 位于过程面板之后；
- assistant 不再使用强卡片边框包住整段长回答，改为接近无底色正文区；
- 用户消息继续保留右侧轻量气泡；
- 复制按钮保留在最终正文底部或 hover 区；
- token 用量默认不展示，保留为开发/高级信息入口，避免干扰正文。

## 5. 组件与数据设计

### 5.1 保持不变

- `ChatMessage`
- `Block`
- SSE envelope
- `chatRuntimeStore`
- history 聚合与 message ID 收敛
- Markdown 渲染

### 5.2 新展示模型

在前端增加纯函数派生，不写入 Zustand：

```typescript
type TraceStep =
  | {
      id: string;
      kind: 'thinking';
      status: BlockStatus;
      label: string;
      detail?: string;
    }
  | {
      id: string;
      kind: 'tool';
      status: BlockStatus;
      toolName: string;
      inputPreview?: string;
      resultPreview?: string;
      resultDetail?: string;
      durationMs?: number;
      isError: boolean;
    };

interface RunTraceViewModel {
  steps: TraceStep[];
  toolCount: number;
  completedCount: number;
  errorCount: number;
  currentLabel: string;
  status: 'running' | 'done' | 'error' | 'aborted';
}
```

派生规则：

1. 按 blocks 原顺序遍历；
2. tool call 先创建步骤并按 `toolId` 建索引；
3. tool result 通过 `toolCallId` 合并到对应步骤；
4. 找不到 call 的 result 仍创建独立工具步骤，避免静默丢数据；
5. thinking 保持顺序；仅相邻 thinking 可合并，不跨工具步骤合并；
6. text 不进入 trace，只进入最终 Markdown。

### 5.3 组件调整

建议结构：

```text
MessageBubble
├─ UserBubble
└─ AssistantMessage
   ├─ RunTracePanel
   │  ├─ RunTraceSummary
   │  └─ RunTraceTimeline
   │     ├─ ThinkingTraceStep
   │     └─ ToolTraceStep
   ├─ FinalMarkdown
   └─ MessageActions
```

替换关系：

- `ProcessTracker` → `RunTracePanel`
- `ThinkingBlockView` → `ThinkingTraceStep`
- `ActivityStrip` → 合并进 `RunTraceSummary`
- `ToolCallBlockView + ToolResultBlockView` → `ToolTraceStep`
- `ThinkingDots` 只在完全没有 trace step 时作为极短暂 fallback

## 6. 视觉约束

对齐用户截图，但用本项目 token 实现：

- 使用现有 `surface/border/text/text-muted/primary/danger` token；
- **不**引入 Kimi 蓝色机器人头像、品牌色或 favicon 行（本期不依赖来源 favicon）；
- 过程容器：一层 `rounded-xl`、浅 `surface-hover/30` 背景、细 `border`；无多层阴影；
- timeline：左侧 1px 虚线/点线贯穿图标中心；
- 行高约 36–40px，字号 12–13px；动作标题 `text-muted`，参数摘要更浅；
- 右侧计数用等宽数字感（tabular-nums），chevron 14px；
- 点击区域至少 44px 高；
- assistant 最终正文在过程容器外，接近无底色 prose，不被过程边框包裹；
- 不新增 sidebar；不使用大阴影、紫色渐变或多层圆角卡片；
- 过程详情代码/JSON 使用现有 JetBrains Mono。

## 7. 可访问性

- 总入口使用原生 `button`，包含 `aria-expanded` 与 `aria-controls`；
- timeline 使用 `<ol>` / `<li>`，状态变化区域使用 `aria-live="polite"`；
- 工具详情按钮使用具体标签：`查看 web_fetch 结果`；
- 焦点样式可见，Enter/Space 可操作；
- 错误同时使用图标和文字；
- 200% 缩放不产生横向页面滚动；
- 尊重 `prefers-reduced-motion`；
- 不把完整实时 reasoning 放入 aria-live，避免屏幕阅读器被 token 流淹没。

## 8. 验收标准

1. 一个 assistant 消息无论包含多少 thinking blocks，都只有一个顶层过程入口。
2. 同一 tool call/result 在 timeline 中只占一个步骤。
3. 完成态默认显示一行摘要，最终答案紧随其后。
4. 运行中能看见当前状态、已完成步骤和耗时。
5. 历史恢复和实时流使用相同展示结构。
6. 不出现 `ProcessTracker` 内部滚动条。
7. 无工具、仅 thinking、仅最终 text、工具失败、abort 五类消息均有明确展示。
8. 键盘可完成展开、收起和查看详情。
9. 320px、768px、1024px 宽度下无内容溢出。
10. 现有 message copy、Markdown、session 切换与 stream isolation 测试不回归。

## 9. 最低测试矩阵

- 纯函数：call/result 配对、孤儿 result、相邻 thinking 合并、跨工具不合并；
- 组件：多个 thinking 只出现一个顶层摘要按钮；
- 组件：运行中默认展开，历史完成态默认折叠；
- 组件：用户手动切换后不被自动状态覆盖；
- 组件：error/aborted 摘要；
- 组件：无 trace 时不渲染空面板；
- 可访问性：`aria-expanded`、可见标签、键盘操作；
- 回归：工具循环 history 恢复后只形成一个 assistant bubble 和一个 trace panel。

## 10. 不在本期

- 长任务独立 sidebar；
- 来源 favicon 与网页预览卡（截图中有，本期用域名/计数替代）；
- Kimi 式富交互最终产物（图表、Tab、景点卡片网格）——只改过程面板，不改答案渲染；
- 按 session 持久化面板展开状态；
- 修改后端 SSE/JSONL 协议；
- 展示或生成新的 chain-of-thought；
- 重做整页聊天视觉系统。

## 11. 设计自检

- [x] 参考 Kimi 的信息架构，不复制品牌视觉；
- [x] 最终答案优先，过程可核验但不喧宾夺主；
- [x] 适配现有 Block 数据与 React/Tailwind 技术栈；
- [x] 消除多个同名 thinking 折叠条；
- [x] 消除嵌套滚动；
- [x] 定义自动展开、历史加载、错误与中止语义；
- [x] 包含键盘、屏幕阅读器与 reduced-motion 约束；
- [x] 未修改业务代码。

## Next

- 认可该方案 → 说「直接实现」或「开始实现」
- 需要调整 → 指定希望更接近 Kimi，还是更强调当前项目的极简风格
- 希望先看视觉稿 → 说「先做界面草图」
