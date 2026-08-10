/**
 * RunTracePanel — 单一 Run Trace 过程面板。
 *
 * 一个浅色容器内：摘要行 + timeline。工具 call/result 已在派生层合并。
 * 最终答案由父组件渲染在容器外（WU-04）。
 *
 * 契约：`.ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md` §6
 * 方案：`.ai-runtime-artifacts/specs/2026-08-10-chat-run-trace-panel-spec.md` §4 / §6 / §7
 */

import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleStop,
  Loader2,
} from 'lucide-react';
import {
  formatDuration,
  hasTraceSteps,
  type RunTraceViewModel,
  type ThinkingTraceStep,
  type ToolTraceStep,
  type TraceStep,
} from '@/features/chat/runTrace';

export interface RunTracePanelProps {
  trace: RunTraceViewModel;
  /** 历史加载的消息传 false，用于「默认折叠」策略 */
  isStreaming: boolean;
  /** 该消息是否已产出最终 text，用于自动折叠时机 */
  hasFinalText: boolean;
}

function shouldAutoExpand(
  isStreaming: boolean,
  hasFinalText: boolean,
  errorCount: number,
): boolean {
  if (!hasFinalText && errorCount > 0) return true;
  if (isStreaming && !hasFinalText) return true;
  return false;
}

export function RunTracePanel({
  trace,
  isStreaming,
  hasFinalText,
}: RunTracePanelProps) {
  const timelineId = useId();
  const [userOverride, setUserOverride] = useState(false);
  const [expanded, setExpanded] = useState(() =>
    shouldAutoExpand(isStreaming, hasFinalText, trace.errorCount),
  );
  const [openStepIds, setOpenStepIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (userOverride) return;
    // 出现最终 text 后不要突然折叠（保持当前状态）
    if (isStreaming && hasFinalText) return;
    setExpanded(shouldAutoExpand(isStreaming, hasFinalText, trace.errorCount));
  }, [isStreaming, hasFinalText, trace.errorCount, userOverride]);

  if (!hasTraceSteps(trace)) return null;

  const togglePanel = () => {
    setUserOverride(true);
    setExpanded((v) => !v);
  };

  const toggleStep = (id: string) => {
    setOpenStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const metaParts = [`${trace.steps.length} 步`, `${trace.toolCount} 个工具`];

  return (
    <div
      data-run-trace
      className="rounded-xl border border-border/80 bg-surface-hover/30 overflow-hidden"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={timelineId}
        onClick={togglePanel}
        className="flex w-full min-h-11 items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
      >
        <SummaryIcon status={trace.status} isStreaming={isStreaming} />
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-text">
          {trace.summaryLabel}
        </span>
        <span className="shrink-0 tabular-nums text-xs text-text-muted">
          {metaParts.join(' · ')}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-200 ${
            expanded ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      <div
        id={timelineId}
        hidden={!expanded}
        className="border-t border-border/80 px-2 pb-2.5 pt-1.5"
      >
        {/*
          步骤正文不对父级/历史 live region 增量播报：reasoning 预览默认 aria-hidden，
          完整详情仅在用户二次展开后暴露（按钮本身仍可键盘聚焦）。
        */}
        <ol className="m-0 list-none p-0 [&>li:first-child>[data-trace-line]]:top-[18px] [&>li:last-child>[data-trace-line]]:bottom-[calc(100%-18px)]">
          {trace.steps.map((step) => (
            <TraceStepRow
              key={step.id}
              step={step}
              detailOpen={openStepIds.has(step.id)}
              onToggleDetail={() => toggleStep(step.id)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function SummaryIcon({
  status,
  isStreaming,
}: {
  status: RunTraceViewModel['status'];
  isStreaming: boolean;
}) {
  if (status === 'error') {
    return (
      <AlertCircle
        className="h-4 w-4 shrink-0 text-danger"
        aria-label="失败"
      />
    );
  }
  if (status === 'aborted') {
    return (
      <CircleStop
        className="h-4 w-4 shrink-0 text-amber-700"
        aria-label="已停止"
      />
    );
  }
  if (status === 'running' || isStreaming) {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-primary"
        aria-label="运行中"
      />
    );
  }
  return <Check className="h-4 w-4 shrink-0 text-green-600" aria-hidden />;
}

function TraceStepRow({
  step,
  detailOpen,
  onToggleDetail,
}: {
  step: TraceStep;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  if (step.kind === 'thinking') {
    return (
      <ThinkingStepRow
        step={step}
        detailOpen={detailOpen}
        onToggleDetail={onToggleDetail}
      />
    );
  }
  return (
    <ToolStepRow
      step={step}
      detailOpen={detailOpen}
      onToggleDetail={onToggleDetail}
    />
  );
}

function TimelineItem({
  step,
  children,
}: {
  step: TraceStep;
  children: ReactNode;
}) {
  return (
    <li className="relative pl-[34px] pr-2">
      {/* 虚线贯穿节点中心（left≈19px，节点中心≈20px） */}
      <span
        aria-hidden
        data-trace-line
        className="pointer-events-none absolute bottom-0 left-[19px] top-0 border-l border-dashed border-text-muted/30"
      />
      <StepNode step={step} />
      {children}
    </li>
  );
}

function StepNode({ step }: { step: TraceStep }) {
  const isRunning = step.status === 'streaming' || step.status === 'pending';
  const isError =
    step.status === 'error' || (step.kind === 'tool' && step.isError);
  const isDone = step.status === 'done' && !isError;

  let nodeClass =
    'absolute left-3 top-2.5 z-[1] flex h-4 w-4 items-center justify-center rounded-full border border-border bg-surface text-text-muted';
  if (isError) {
    nodeClass =
      'absolute left-3 top-2.5 z-[1] flex h-4 w-4 items-center justify-center rounded-full border border-danger/45 bg-surface text-danger';
  } else if (isRunning) {
    nodeClass =
      'absolute left-3 top-2.5 z-[1] flex h-4 w-4 items-center justify-center rounded-full border border-primary/45 bg-surface text-primary';
  } else if (isDone && step.kind === 'tool') {
    nodeClass =
      'absolute left-3 top-2.5 z-[1] flex h-4 w-4 items-center justify-center rounded-full border border-green-600/45 bg-surface text-green-600';
  }

  return (
    <span className={nodeClass} aria-hidden>
      {isRunning ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : isError ? (
        <AlertCircle className="h-2.5 w-2.5" />
      ) : isDone && step.kind === 'tool' ? (
        <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
      ) : (
        <span className="block h-1.5 w-1.5 rounded-full bg-text-muted" />
      )}
    </span>
  );
}

function ThinkingStepRow({
  step,
  detailOpen,
  onToggleDetail,
}: {
  step: ThinkingTraceStep;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const hasDetail = Boolean(step.detail);
  // 流式中不在行内挂 reasoning 预览，避免 CoT 被意外播报；完成后可截断预览（对 AT 隐藏）
  const showPreview =
    hasDetail &&
    !detailOpen &&
    step.status !== 'streaming' &&
    step.status !== 'pending';
  const row = (
    <>
      <span className="shrink-0 text-[13px] text-text-muted">{step.label}</span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-text-muted/60"
        aria-hidden={showPreview || undefined}
      >
        {showPreview
          ? step.detail!.replace(/\s+/g, ' ').trim().slice(0, 80)
          : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-text-muted">
        {hasDetail ? (detailOpen ? '收起' : '查看') : step.status === 'done' ? '已完成' : ''}
      </span>
      {hasDetail && (
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted/70 transition-transform duration-200 ${
            detailOpen ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      )}
    </>
  );

  return (
    <TimelineItem step={step}>
      {hasDetail ? (
        <button
          type="button"
          aria-expanded={detailOpen}
          aria-label="查看思考过程"
          onClick={onToggleDetail}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-0 py-1.5 text-left transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {row}
        </button>
      ) : (
        <div className="flex min-h-9 w-full items-center gap-2 py-1.5">{row}</div>
      )}
      {detailOpen && step.detail && (
        <pre className="mb-2 mt-0.5 whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-surface-hover/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-text-muted">
          {step.detail}
        </pre>
      )}
    </TimelineItem>
  );
}

function ToolStepRow({
  step,
  detailOpen,
  onToggleDetail,
}: {
  step: ToolTraceStep;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const hasDetail = Boolean(step.resultDetail);
  const isRunning = step.status === 'streaming' || step.status === 'pending';
  const isError = step.isError || step.status === 'error';

  let meta = '';
  if (isRunning) meta = '执行中…';
  else if (isError) meta = '失败';
  else if (step.resultPreview) meta = step.resultPreview;
  else if (step.durationMs != null) meta = formatDuration(step.durationMs);
  else if (step.status === 'done') meta = '已完成';

  const row = (
    <>
      <span className="shrink-0 text-[13px] text-text-muted">{step.actionLabel}</span>
      {step.inputPreview && (
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted/60">
          {step.inputPreview}
        </span>
      )}
      {!step.inputPreview && <span className="min-w-0 flex-1" />}
      <span
        className={`shrink-0 text-xs tabular-nums ${
          isError ? 'text-danger' : 'text-text-muted'
        }`}
      >
        {meta}
      </span>
      {hasDetail && (
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-muted/70 transition-transform duration-200 ${
            detailOpen ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      )}
    </>
  );

  return (
    <TimelineItem step={step}>
      {hasDetail ? (
        <button
          type="button"
          aria-expanded={detailOpen}
          aria-label={`查看 ${step.toolName} 结果`}
          onClick={onToggleDetail}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-0 py-1.5 text-left transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {row}
        </button>
      ) : (
        <div className="flex min-h-9 w-full items-center gap-2 py-1.5">{row}</div>
      )}
      {detailOpen && step.resultDetail && (
        <pre
          className={`mb-2 mt-0.5 whitespace-pre-wrap break-words rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed ${
            isError
              ? 'border-danger/20 bg-danger/5 text-danger/90'
              : 'border-border/80 bg-surface-hover/40 text-text-muted'
          }`}
        >
          {step.resultDetail}
        </pre>
      )}
    </TimelineItem>
  );
}
