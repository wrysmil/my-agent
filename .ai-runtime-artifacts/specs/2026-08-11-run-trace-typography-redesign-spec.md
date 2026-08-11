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
  - .cursor/skills/brainstorming/SKILL.md
source:
  - 用户：「那个工具调用的展现的块好像有点问题」
  - 用户：「这个中间过程的内容的排版，和字体那些你再优化下吧，设计一下」
  - 用户对方案 A / B / C 的选择（A）+ 后续细问：thinking 行统一成信息卡、参数 pill 只挑 url/filePath/query/command 高频 key
  - 既有 spec：.ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-spec.md
  - 既有派生层：web/src/features/chat/runTrace.ts
  - 既有组件：web/src/components/chat/RunTracePanel.tsx
  - 既有 token：web/src/styles/globals.css
  - 视觉方案 mockup：.superpowers/brainstorm/run-trace-typography/content/structure-vs-style.html
created_at: 2026-08-11
status: approved
approved: true
approved_by: 用户（2026-08-11）：「并行执行」（等于 spec 批准 + 实施授权）
revision: 1
---

# Run Trace 排版与字体优化方案（修订）

## 1. 目标

承接 RU-2026-08-10 之后由用户提出的「中间过程内容排版和字体再优化」要求，在不破坏现有
单 Run Trace 信息架构与派生层契约的前提下，把 `RunTracePanel` 内部的步骤行从「紫框
thinking + 裸行 tool」两种不统一的视觉，改成统一的 **信息卡 + 关键参数 pill + 错误轻提色**
方案。具体：

- 同一组件族（thinking/tool）共用同一行容器，视觉权重一致；
- 关键参数（url / filePath / query / command）以 JetBrains Mono 衬色 pill 展示，便于扫读；
- 错误整行变红茶色，状态位与左侧节点同步；
- 不引入新依赖、不改派生层 merge 逻辑、不动 a11y 与折叠行为。

## 2. 当前问题

1. **视觉不统一**：thinking 行带 `border-primary/45 bg-primary/5` 紫框，tool 行无边框，
   两者视觉重量差异大。原因：thinking 卡片化只是因为有可展开详情，tool 走另一套。
2. **参数拥挤**：长 `url` 与 `query` 走 `inputPreview` 拼接串 "url: https://…/search?q=…&",
   在窄屏下 `truncate` 截在逗号后语义不完整；行内也常出现非常长的 URL 仍按一个 span 处理。
3. **状态位冲突**：之前修复时已把 `resultPreview` 从右侧状态位移到第二行，但「动作名 +
   长 inputPreview + 状态 + chevron」这四个元素仍挤在一行 flex-nowrap 上，窄屏信息密度过
   高，且 inputPreview 一旦较长会占据中间剩余空间，状态位与 chevron 视觉地位被弱化。
4. **错误识别成本**：tool 错误时仅状态文本变红，整行无视觉提示，需要细看才能捕捉。

## 3. 方案对比

### A. 保持现状只微调样式

字号、行高、间距微调。优点：风险极低。缺点：紫框 + 裸行不统一、长 URL 拥挤、错误不够醒
目——核心问题没解决。

结论：拒绝。

### B. 统一信息卡 + 关键参数 pill（推荐）

thinking/tool 共用同一行容器（白底 / 1px border / 4px 圆角），关键参数从 input 中结构化
抽取后渲染为 JetBrains Mono 衬色 pill，错误整行变红茶色。

优点：
- 解决「不统一」根因：thinking / tool 走同一卡片；
- 解决「长 URL 拥挤」：pill 只展示 hostname + 必要路径首段，中间剩余空间交给 inputPreview 兜底；
- 解决「错误识别成本」：错误整行变红茶色，节点 / 状态 / 预览行同步红色提示；
- 视觉 token 全部沿用现有 `surface / border / text / text-muted / primary / danger`，不新增；
- 派生层向后兼容（`inputPreview` 保留），旧测试几乎不用改。

缺点：增加 ~80 行组件代码 + ~30 行派生层；需要新增 fake 视觉断言。

结论：采用。

### C. 重做过程区（独立卡片 / 侧栏）

像 ChatGPT Deep Research 那样把所有步骤放进独立卡片或侧栏。优点：长任务容量大。缺点：
布局改造太大；与既有 spec § 4 推翻；现行 860px 单栏不需要。

结论：拒绝。

## 4. 视觉规则

### 4.1 行容器（统一）

| 元素 | 规则 |
| --- | --- |
| 容器 | 1px `border-border`、4px 圆角、`bg-surface` |
| 内边距 | `px-2.5 py-1.5`（与旧 ThinkingStepRow / ToolStepRow 一致） |
| 高度 | `min-h-11`；行高 `leading-snug` |
| hover | 背景变 `bg-surface-hover/60` |
| focus | `ring-2 ring-primary/40`，沿用现有 |

### 4.2 主行三栏布局

```
┌────────────────────────────────────────────────────────────┐
│  [动作名 13px Inter Medium]  [pill 11.5px Mono]  [状态]  ⌄ │
│  [预览行 12px Inter Regular，truncate]                       │
└────────────────────────────────────────────────────────────┘
```

- **动作名**（13px Inter Medium，`text-text`）：`actionLabel` 取自 `toolActionLabel()`，
  thinking 行用 `step.label`（思考已完成 / 正在思考 / 思考失败）。
- **关键参数 pill**（11.5px JetBrains Mono，`bg-primary/10 text-primary`，1px `border-primary/20`）：
  - 渲染规则见 § 5.1；
  - 最多 2 个；超过 2 个时保留前 2 个 + `+N` 提示额外数量；
  - pill 自身加 `title` 属性，给鼠标 hover 完整原值。
- **状态位**（12px tabular-nums，`text-text-muted` 或 `text-danger`）：仅渲染定长文案
  —— `执行中…` / `失败` / `1.2s` / `已完成` / `查看` / `收起`。
- **chevron**（14px Lucide）：detail 按钮独占，状态变化时 200ms 旋转。

### 4.3 预览行（可选第二行）

- 仅在 `step.resultPreview`（tool）或 `showPreview`（thinking）存在且 `detailOpen=false` 时显示；
- 12px `text-text-muted/60` 单行 `truncate`；错误时变 `text-danger/70`；
- 展开后变为 `<pre>` 区，等宽 + 圆角 + 1px 边框（沿用现有样式）。

### 4.4 错误态

- 整行卡片 `bg-danger-bg` + `border-danger/40`；
- 左侧节点 `border-danger/45 text-danger` + `AlertCircle` 图标；
- 状态位 `text-danger`；
- 预览行 `text-danger/70`；
- 展开后 `<pre>` 沿用既有 `border-danger/20 bg-danger/5 text-danger/90` 区分成功/失败。

### 4.5 thinking 行

- 视觉与 tool 行一致（共用同一卡片样式）；
- 关键参数 pill 留空（thinking 没有 input）；
- 动作名 = `step.label`（"思考已完成" / "正在思考" / "思考失败"）；
- 状态位 = `查看` / `收起`（有 detail 时）或 `已完成`（无 detail 且 done）；

### 4.6 状态文案（沿用既有 SummaryIcon）

- `running` / `streaming` → `Loader2` Spin 节点 + 文案 `执行中…` / `正在思考`；
- `error` → `AlertCircle` 节点 + 文案 `失败`；
- `done` 且 tool → `Check` 节点 + 文案 `已完成` 或 `durationMs`；
- `done` thinking → `text-text-muted` 圆点 + 文案 `已完成`。

## 5. 派生层（`runTrace.ts`）

### 5.1 新增 `extractKeyParams`

```ts
export interface KeyParam {
  key: string;        // 'url' | 'filePath' | 'query' | 'command' | 'path'
  value: string;      // 渲染入 pill 的短文本
  fullValue: string;  // title 提示
}

const KEY_PARAM_ORDER = ['url', 'filePath', 'query', 'command', 'path'] as const;
const KEY_PARAM_MAX = 2;

export function extractKeyParams(input?: Record<string, unknown>): KeyParam[] {
  if (!input) return [];
  const out: KeyParam[] = [];
  for (const key of KEY_PARAM_ORDER) {
    const raw = input[key];
    if (raw == null) continue;
    const full = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const value = shortenKeyParam(key, full);
    out.push({ key, value, fullValue: full });
    if (out.length >= KEY_PARAM_MAX) break;
  }
  return out;
}

function shortenKeyParam(key: string, full: string): string {
  if (key === 'url') {
    try {
      const u = new URL(full);
      const path = u.pathname.length > 24 ? u.pathname.slice(0, 24) + '…' : u.pathname;
      return `${u.hostname}${path}`;
    } catch {
      return full.length > 40 ? full.slice(0, 40) + '…' : full;
    }
  }
  if (key === 'filePath' || key === 'path') {
    const parts = full.split(/[\\/]/);
    const last = parts[parts.length - 1] || full;
    return last.length > 32 ? last.slice(0, 32) + '…' : last;
  }
  if (key === 'query' || key === 'command') {
    return full.length > 40 ? full.slice(0, 40) + '…' : full;
  }
  return full;
}
```

### 5.2 `ToolTraceStep` 扩展

```ts
export interface ToolTraceStep {
  // ... 现有字段
  keyParams?: KeyParam[];   // 新增；component 优先读此字段
  inputPreview?: string;    // 保留；KeyParam 抽不出时 fallback
}
```

### 5.3 不变

- `buildRunTrace` 合并逻辑（call/result merge）；
- `buildSummaryLabel` / `resolveStatus`；
- `formatInputPreview`（作为 fallback）；
- 现有 24 个 `runTrace.test.ts` 用例。

## 6. 组件改动（`RunTracePanel.tsx`）

### 6.1 抽取 `<TraceRowCard>`

```tsx
function TraceRowCard({
  step,
  detailOpen,
  onToggleDetail,
  firstLine,
  secondLine,
  detailPre,
}: {
  step: TraceStep;
  detailOpen: boolean;
  onToggleDetail: () => void;
  firstLine: ReactNode;
  secondLine?: ReactNode;
  detailPre?: ReactNode;
}) {
  const isError = step.status === 'error' ||
    (step.kind === 'tool' && step.isError);
  const hasDetail = step.kind === 'thinking'
    ? Boolean(step.detail)
    : Boolean(step.resultDetail);
  const baseClass = `flex min-h-11 w-full min-w-0 flex-col justify-center gap-y-0.5 rounded-lg border px-2.5 py-1.5 ${
    isError
      ? 'border-danger/40 bg-danger-bg'
      : 'border-border bg-surface'
  }`;

  return (
    <li className="relative min-w-0 pl-[34px] pr-2">
      <span aria-hidden data-trace-line
        className="pointer-events-none absolute bottom-0 left-[19px] top-0 border-l border-dashed border-text-muted/30" />
      <StepNode step={step} />
      {hasDetail ? (
        <button type="button" aria-expanded={detailOpen}
          aria-label={step.kind === 'thinking' ? '查看思考过程' : `查看 ${step.toolName} 结果`}
          onClick={onToggleDetail}
          className={`${baseClass} text-left transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}>
          <div className="flex w-full min-w-0 items-center gap-x-2">{firstLine}</div>
          {secondLine && <div className="block w-full min-w-0 truncate text-xs text-text-muted/60">{secondLine}</div>}
        </button>
      ) : (
        <div className={baseClass}>
          <div className="flex w-full min-w-0 items-center gap-x-2">{firstLine}</div>
          {secondLine && <div className="block w-full min-w-0 truncate text-xs text-text-muted/60">{secondLine}</div>}
        </div>
      )}
      {detailOpen && detailPre}
    </li>
  );
}
```

### 6.2 主行 JSX

```tsx
<div className="flex w-full min-w-0 items-center gap-x-2">
  <span className="shrink-0 text-[13px] font-medium text-text">{actionLabel}</span>
  {keyParams.map(p => (
    <span key={p.key} title={p.fullValue}
      className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11.5px] text-primary">
      {p.value}
    </span>
  ))}
  {extraKeyCount > 0 && <span className="text-xs text-text-muted">+{extraKeyCount}</span>}
  <span className="min-w-0 flex-1 truncate text-xs text-text-muted/60">
    {inputPreview ?? ''}
  </span>
  <span className={`shrink-0 text-xs tabular-nums ${isError ? 'text-danger' : 'text-text-muted'}`}>
    {meta}
  </span>
  {hasDetail && <ChevronDown ... />}
</div>
```

### 6.3 预览行与展开 `<pre>` 沿用现有

不变；错误时颜色套用既有 `danger` token。

### 6.4 移除旧紫框

- 删除 `ThinkingStepRow` 内 `border-primary/45 bg-primary/5` 与 `hover:bg-primary/10`；
- 改为走新的 `TraceRowCard`；
- 选中态 ring 仍保留（`focus-visible:ring-primary/40`）。

## 7. 兼容与测试

### 7.1 现有测试影响

- `runTrace.test.ts`（24 个）：不动；
- `run-trace-panel.test.tsx`（13 个）：更新 `bg-primary/5` / `border-primary/45` 视觉断言
  为统一卡片类（`bg-surface border-border` / 错误态 `border-danger/40 bg-danger-bg`）；
- `run-trace-panel-matrix.test.tsx`（10 个）：思考/工具合并用例的行为不变，仅视觉 class
  名更新。

### 7.2 新增测试

- `runTrace.test.ts`：新增 `extractKeyParams` 单元（4–6 个 case）：
  - url 主机名 + 长 path 截断；
  - filePath 仅保留文件名；
  - 仅识别 § 5.1 列出的 5 个 key；
  - 超过 2 个时输出前 2 个 + `extraKeyCount`；
- `run-trace-panel.test.tsx`：新增用例：
  - 工具行渲染 pill + title 属性；
  - 错误态整行带 `border-danger/40 bg-danger-bg`；
  - 窄屏（< 360px）下无横向滚动；
  - thinking 行不再带 `bg-primary/5` 紫框。

### 7.3 视觉回归

- 视觉对照：浅色 / 深色主题均需与 `.superpowers/brainstorm/.../structure-vs-style.html`
  方案 A 肉眼对齐（同一段 trace）；
- 截图证据归档到 `.ai-runtime-artifacts/verifications/2026-08-11-run-trace-typography-verification-lite.md`，
  不再单独写 spec 章节。

## 8. 验收标准

1. 一个 assistant 消息内任意种类 step（thinking/tool/running/error）共用同一类卡片，
   视觉权重一致。
2. 工具行的关键参数（url/filePath/query/command/path）以衬色 pill 渲染，pill 自带
   `title` 完整值。
3. 错误整行 `border-danger/40 bg-danger-bg`，预览行 `text-danger/70`。
4. 浅色 / 深色主题下都能保持卡片对比度对比 window ≥ 3:1（与现有 `surface` 同档）。
5. 窄屏（≤ 360px）下不出现横向滚动，状态位 + chevron 始终可见。
6. 现有 47 个测试全部通过；本 spec 新增 8–12 个测试覆盖关键参数与错误态。
7. 派生层零破坏：`inputPreview` 仍保留，fallback 路径可独立单元覆盖。
8. 折叠/展开/自动展开策略、a11y、键盘操作与上一版完全一致。

## 9. 不在本期

- 重做过程区结构（侧栏 / 卡片分组）；
- 引入新字体（保持当前 Inter + JetBrains Mono 组合）；
- 重新设计摘要行 / 折叠态 / 最终 Markdown 视觉；
- 改 `ChatMessage` / `Block` / SSE 协议 / 状态机。

## 10. 设计自检

- [x] 信息层级：动作名 > 关键参数 pill > 预览行；状态位与 chevron 共享区域；
- [x] 颜色沿用既有 token，不引入新色；
- [x] 视觉重量 < 最终 Markdown；
- [x] 错误同时使用图标（节点）+ 文字（状态 / 预览）+ 整行底色；
- [x] 所有交互目标 ≥ 44px 高；
- [x] 不破坏现有 47 个测试即可回归。

## Next

- 审阅通过 → 用户回复「approved」 → Leader 切到 `writing-plans` 写 plan → 进入实现。
- 想再调一档（pill 颜色更深 / thinking 仍保留紫点 / 状态位加复制按钮）→ 继续在本 spec 内讨论。
