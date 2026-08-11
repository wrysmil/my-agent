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
import { Markdown } from './Markdown';
import {
  formatDuration,
  hasTraceSteps,
  type KeyParam,
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
  /**
   * 切消息/会话的强 reset 钩子；message.id 即可。
   * 变化时强制重置 userOverride / expanded / openStepIds（spec §4.3）。
   */
  resetKey?: string;
}

function shouldAutoExpand(
  isStreaming: boolean,
  hasFinalText: boolean,
  errorCount: number,
): boolean {
  if (errorCount > 0) return true;
  if (isStreaming && !hasFinalText) return true;
  if (!isStreaming && errorCount === 0) return true;
  return false;
}

export function RunTracePanel({
  trace,
  isStreaming,
  hasFinalText,
  resetKey,
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

  // 切换 message / 会话时强制重置所有 UI 状态（spec §4.3）。
  // 不依赖 props 变化，仅按 resetKey 触发。
  useEffect(() => {
    setUserOverride(false);
    setExpanded(shouldAutoExpand(isStreaming, hasFinalText, trace.errorCount));
    setOpenStepIds(new Set());
    // resetKey 是身份 key；其余闭包值用于重算默认展开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

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
      className="relative overflow-hidden rounded-xl border border-border/80 bg-white"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50"
      />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={timelineId}
        onClick={togglePanel}
        className="flex min-h-11 w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
      >
        <SummaryIcon status={trace.status} isStreaming={isStreaming} />
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-text">
          {trace.summaryLabel}
        </span>
        <span className="hidden shrink-0 tabular-nums text-xs text-text-muted sm:inline">
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
        className="border-t border-border/80 px-2 pb-2.5 pt-2"
      >
        {/*
          步骤正文不对父级/历史 live region 增量播报：reasoning 预览默认 aria-hidden，
          完整详情仅在用户二次展开后暴露（按钮本身仍可键盘聚焦）。
        */}
        {expanded && (
          <ol className="m-0 list-none p-0 space-y-2">
            {trace.steps.map((step) => (
              <TraceStepRow
                key={step.id}
                step={step}
                detailOpen={openStepIds.has(step.id)}
                onToggleDetail={() => toggleStep(step.id)}
              />
            ))}
          </ol>
        )}
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

function TraceRowCard({
  step,
  detailOpen,
  onToggleDetail,
  stepLabel,
  detailPre,
  detailBody,
}: {
  step: TraceStep;
  detailOpen: boolean;
  onToggleDetail: () => void;
  stepLabel: ReactNode;
  detailPre?: ReactNode;
  detailBody?: ReactNode;
}) {
  const isError =
    step.status === 'error' || (step.kind === 'tool' && step.isError);
  const baseClass = `flex h-9 w-full min-w-0 items-center gap-x-2 rounded-md border px-2.5 overflow-hidden ${
    isError ? 'border-danger/40 bg-danger-bg' : 'border-border bg-white'
  }`;

  return (
    <li className="relative min-w-0 pr-2">
      <button
        type="button"
        aria-expanded={detailOpen}
        aria-label={
          step.kind === 'thinking' ? '查看思考过程' : `查看 ${step.toolName} 结果`
        }
        onClick={onToggleDetail}
        className={`${baseClass} relative text-left transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
      >
        <span className="min-w-0 flex-1 flex items-center gap-x-2">
          {stepLabel}
        </span>
      </button>
      {detailOpen && (
        <div className="mt-1 mb-2 space-y-1.5">
          {detailBody}
          {detailPre}
        </div>
      )}
    </li>
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

  // v3.1 思考步骤视觉降级（spec §4.6）：4px 灰点 + 「思考」文字，无徽章 / 无 meta
  const stepLabel = (
    <>
      <span
        aria-hidden
        className="inline-block h-1 w-1 shrink-0 rounded-full bg-text-muted-2"
      />
      <span
        data-trace-step="thinking"
        className="shrink-0 text-[13px] text-text-muted whitespace-nowrap"
      >
        思考
      </span>
      <span className="min-w-0 flex-1" aria-hidden />
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

  const detailBody = step.detail ? (
    <div className="max-w-full overflow-hidden rounded-lg border border-border/80 bg-surface-hover/40 px-3 py-2.5 text-xs leading-relaxed text-text-muted">
      <Markdown text={step.detail} compact />
    </div>
  ) : null;

  return (
    <TraceRowCard
      step={step}
      detailOpen={detailOpen}
      onToggleDetail={onToggleDetail}
      stepLabel={stepLabel}
      detailBody={detailBody}
    />
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
  const hasDetail = Boolean(step.resultDetail) || Boolean(step.keyParams?.length) || Boolean(step.resultPreview);
  const isRunning = step.status === 'streaming' || step.status === 'pending';
  const isError = step.isError || step.status === 'error';

  // 状态位只放定长文案
  let meta = '';
  if (isRunning) meta = '执行中…';
  else if (isError) meta = '失败';
  else if (step.durationMs != null) meta = formatDuration(step.durationMs);
  else if (step.status === 'done') meta = '已完成';

  // v3.1：button 内只放身份文本（中文 actionLabel） + meta + chevron（高度 36px 刚性化）
  const stepLabel = (
    <>
      <span
        title={step.actionLabel}
        className="shrink-0 text-[13px] text-text whitespace-nowrap"
      >
        {step.actionLabel}
      </span>
      <span className="min-w-0 flex-1" aria-hidden />
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

  // 关键参数 pill：按 KEY_PARAM_ORDER 取前 2 项
  const keyParams: KeyParam[] = step.keyParams ?? [];
  const extraKeyCount = countExtraKeyParams(step.keyParams);

  const detailBody = (
    <>
      {(keyParams.length > 0 || step.inputPreview) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {keyParams.map((p) => (
            <span
              key={p.key}
              title={p.fullValue}
              aria-label={`${p.key}=${p.fullValue}`}
              className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11.5px] text-primary"
            >
              {p.value}
            </span>
          ))}
          {extraKeyCount > 0 && (
            <span className="text-xs text-text-muted">+{extraKeyCount}</span>
          )}
          {keyParams.length === 0 && step.inputPreview && (
            <span className="text-xs text-text-muted/60 break-all">
              {step.inputPreview}
            </span>
          )}
        </div>
      )}
      {step.resultPreview && (
        <div
          className={`text-xs ${
            isError ? 'text-danger/70' : 'text-text-muted/70'
          }`}
        >
          {step.resultPreview}
        </div>
      )}
    </>
  );

  const detailPre = step.resultDetail ? (
    <pre
      className={`whitespace-pre-wrap break-words rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed ${
        isError
          ? 'border-danger/20 bg-danger/5 text-danger/90'
          : 'border-border/80 bg-surface-hover/40 text-text-muted'
      }`}
    >
      {step.resultDetail}
    </pre>
  ) : null;

  return (
    <TraceRowCard
      step={step}
      detailOpen={detailOpen}
      onToggleDetail={onToggleDetail}
      stepLabel={stepLabel}
      detailBody={hasDetail ? detailBody : undefined}
      detailPre={detailPre}
    />
  );
}

/**
 * 已知 `keyParams` 已被派生层截到 ≤ KEY_PARAM_MAX（=2）；但旧 fixtures / 未来放宽时仍可能 ≥ 3，
 * 此处仅做兜底：当传入数组长度大于可见 pill 数时计算溢出。
 */
function countExtraKeyParams(keyParams: KeyParam[] | undefined): number {
  if (!keyParams) return 0;
  const KEY_PARAM_MAX = 2;
  return Math.max(0, keyParams.length - KEY_PARAM_MAX);
}
