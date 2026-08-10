---
artifact: interface-contract
route: api-and-interface-design
skills:
  - api-and-interface-design
skills_evidence:
  - .agents/skills/api-and-interface-design/SKILL.md
source:
  - .ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-spec.md § 5.2
  - web/src/features/chat/types.ts
  - web/src/components/chat/ToolCallBlock.tsx（formatInputPreview）
  - web/src/components/chat/ToolResultBlock.tsx（formatDuration）
  - web/src/components/chat/ActivityStrip.tsx（状态文案）
created_at: 2026-08-10
status: draft
approved: false
---

# Run Trace 模块接口契约

WU-01（派生层）与 WU-02（面板组件）、WU-04（接线）之间的唯一边界。**先落契约再实现**：WU-02 只依赖本文件声明的类型与语义，不读 WU-01 的实现细节。

## 1. 归属

| 项 | 值 |
| --- | --- |
| 模块路径 | `web/src/features/chat/runTrace.ts` |
| 所有者 WU | WU-01 |
| 消费者 | `RunTracePanel`（WU-02）、`MessageBubble`（WU-04） |
| 上游类型 | `web/src/features/chat/types.ts` 的 `Block` / `BlockStatus` / `ChatMessage`（**不修改**） |

## 2. 类型

```typescript
import type { Block, BlockStatus } from '@/features/chat/types';

export interface ThinkingTraceStep {
  id: string;
  kind: 'thinking';
  status: BlockStatus;
  /** 行标题，如「思考已完成」「正在思考」 */
  label: string;
  /** 完整 reasoning；二次展开时显示 */
  detail?: string;
  /** 被合并的相邻 thinking block 数量，≥1 */
  mergedCount: number;
}

export interface ToolTraceStep {
  id: string;
  kind: 'tool';
  status: BlockStatus;
  /** 原始工具名，如 web_fetch */
  toolName: string;
  /** 用户可读动作，如「获取网页」；未知工具回落为 toolName */
  actionLabel: string;
  /** 参数安全摘要（已截断），如查询词或域名 */
  inputPreview?: string;
  /** 结果摘要（已截断），如「11 个结果」或首行内容 */
  resultPreview?: string;
  /** 完整结果文本；二次展开时显示 */
  resultDetail?: string;
  durationMs?: number;
  isError: boolean;
}

export type TraceStep = ThinkingTraceStep | ToolTraceStep;

export type RunTraceStatus = 'running' | 'done' | 'error' | 'aborted';

export interface RunTraceViewModel {
  steps: TraceStep[];
  toolCount: number;
  completedCount: number;
  errorCount: number;
  /** 折叠态摘要行文案，见 §4 */
  summaryLabel: string;
  status: RunTraceStatus;
}

export interface BuildRunTraceOptions {
  /** 由 MessageList 下传，标识该消息是否为当前流式消息 */
  isStreaming: boolean;
  /** ChatMessage.streamState，用于运行中文案 */
  streamState?: ChatMessage['streamState'];
  /** ChatStatus 为 aborted 时置 true */
  aborted?: boolean;
}
```

## 3. 函数签名

```typescript
/** 纯函数；同一 blocks + options 必须返回等价结果，不读写全局状态 */
export function buildRunTrace(
  blocks: Block[],
  options: BuildRunTraceOptions,
): RunTraceViewModel;

/** 无任何 trace step 时为 false，调用方据此完全不渲染面板 */
export function hasTraceSteps(vm: RunTraceViewModel): boolean;
```

派生规则（与 spec § 5.2 一致，此处为可测语义）：

| 输入 | 输出 |
| --- | --- |
| `tool_call` | 新建 `ToolTraceStep`，按 `toolId` 建索引 |
| `tool_result`，`toolCallId` 命中索引 | 合并进已有步骤（填 `resultPreview` / `resultDetail` / `durationMs` / `isError` / `status`） |
| `tool_result`，`toolCallId` 未命中 | 仍新建独立 `ToolTraceStep`，不静默丢弃 |
| 连续相邻 `thinking` | 合并为一个 `ThinkingTraceStep`，`mergedCount` 累加，`detail` 按顺序拼接 |
| 被工具步骤隔开的 `thinking` | **不**合并 |
| `text` | 不进入 `steps` |

## 4. 摘要文案（唯一真相源）

`summaryLabel` 由 `buildRunTrace` 生成，组件不再自行拼装：

| 条件 | 文案 |
| --- | --- |
| `isStreaming` 且 `streamState === 'thinking'` | `正在思考` |
| `isStreaming` 且存在 `status === 'streaming'` 的工具步骤 | `正在执行 {actionLabel}` |
| `isStreaming` 且 `streamState === 'generating'` | `正在整理回答` |
| `isStreaming` 且无 step | `正在准备` |
| `aborted` | `已停止 · 保留 {steps.length} 个步骤` |
| `errorCount > 0` | `完成，但有 {errorCount} 个步骤失败` |
| 其他 | `已完成 {steps.length} 个步骤 · {toolCount} 个工具` |

`status` 映射：`isStreaming → 'running'`；`aborted → 'aborted'`；`errorCount > 0 → 'error'`；否则 `'done'`。

## 5. 工具名映射与格式化

同在 `runTrace.ts` 导出，供组件与测试复用：

```typescript
export function toolActionLabel(toolName: string): string;   // web_search → 搜索网页；未知 → 原名
export function formatDuration(ms: number): string;          // 迁移自 ToolResultBlock.tsx:12-17
export function formatInputPreview(input?: Record<string, unknown>, inputRaw?: string): string | undefined; // 迁移自 ToolCallBlock.tsx:11-23
```

约定：截断上限沿用现有实现（参数最多 3 项、字符串 60/80 字符、结果 160 字符），不新增魔法数字散落到组件里。

## 6. 组件 props 契约（WU-02 对外）

```typescript
export interface RunTracePanelProps {
  trace: RunTraceViewModel;
  /** 历史加载的消息传 false，用于「默认折叠」策略 */
  isStreaming: boolean;
  /** 该消息是否已产出最终 text，用于自动折叠时机 */
  hasFinalText: boolean;
}
```

`RunTracePanel` 自持展开状态；一旦用户手动切换，组件生命周期内不再被自动策略覆盖（spec § 4.3）。父组件**不**传 `expanded`，避免受控/非受控混用。

## 7. 兼容性

- 不改 `types.ts`、SSE envelope、JSONL 协议、`chatRuntimeStore`；
- 新增字段一律可选，`Block` 现有字段语义不变；
- `formatDuration` / `formatInputPreview` 从旧组件迁移后，旧组件在 WU-04 一并下线，不留重复实现（DoD「无重复业务逻辑」）。

## 8. 自检

- [x] 每个导出都有明确输入/输出类型
- [x] 变体用可辨别联合（`kind`），消费者可类型收窄
- [x] 文案与截断逻辑单点归属，不散落组件
- [x] 无未命中即静默丢数据的路径
- [x] 面板 props 非受控，避免状态双源
