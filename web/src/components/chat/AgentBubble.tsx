/**
 * AgentBubble — 子 Agent 消息气泡。
 *
 * v4 设计（对齐 v3.4 mockup）：
 * 结构：role-line（头像+名称+标签+状态）→ summary-line（✓+摘要+折叠开关）→
 * 可折叠 agent-trace（thinking / tool_call / tool_result 步骤）→
 * text-body（typewriter 文本 + 绿色闪烁光标）。
 *
 * 状态推导：status==='working' → 工作态（展开 trace + 光标）；否则完成态（默认折叠）。
 */

import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Loader2,
} from 'lucide-react';
import type {
  ChatMessage,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
} from '@/features/chat/types';
import { buildAgentSummary } from '@/features/chat/useChatStream';

const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-4 w-3/4 bg-surface-hover rounded" />;
}

export interface AgentBubbleProps {
  message: ChatMessage;
  className?: string;
}

/**
 * 绿色闪烁光标样式。
 * globals.css 属于 WU-04 可改范围之外，故在组件内联注入一次。
 */
const AGENT_CURSOR_CSS = `
.agent-cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: #0e9f6e;
  vertical-align: -2px;
  margin-left: 2px;
  border-radius: 1px;
  animation: agent-cursor-blink 1s infinite;
}
@keyframes agent-cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
`;

export function AgentBubble({ message, className = '' }: AgentBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isWorking = message.status === 'working';

  // working→done 迁移自动折叠；用户手动切换后保留其选择。
  const [userOverride, setUserOverride] = useState(false);
  const [traceOpen, setTraceOpen] = useState(isWorking);

  useEffect(() => {
    if (userOverride) return;
    setTraceOpen(isWorking);
  }, [isWorking, userOverride]);

  const agentName = message.actorName ?? '子 Agent';
  const tagLabel = message.isFinal ? '最终回答' : '子 Agent 回复';
  const statusLabel = isWorking ? '工作中…' : '已完成';

  const agentSteps = message.blocks.filter(
    (b): b is ThinkingBlock | ToolCallBlock | ToolResultBlock =>
      b.type === 'thinking' || b.type === 'tool_call' || b.type === 'tool_result',
  );

  const textContent = message.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');

  const summaryText =
    message.summary && message.summary.length > 0
      ? message.summary
      : buildAgentSummary(message.blocks);

  const toggleTrace = () => {
    setUserOverride(true);
    setTraceOpen((v) => !v);
  };

  const onCopy = async () => {
    if (!textContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div
      data-testid="agent-bubble"
      className={`flex group relative w-full max-w-[640px] self-start overflow-hidden rounded-xl border-l border-emerald-500/30 bg-emerald-500/10 shadow-sm transition-shadow duration-200 ${className} ${
        isWorking
          ? 'border-[#0e9f6e] shadow-[0_0_0_2px_rgba(14,159,110,0.18)]'
          : ''
      }`}
    >
      <div className="flex flex-col flex-1 min-w-0">
        {/* role-line */}
        <div className="flex flex-wrap items-center gap-2 px-3.5 pt-3 pb-1">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-emerald-400 text-[11px] font-bold text-white"
          >
            {agentName.slice(0, 1).toUpperCase()}
          </span>
          <span className="shrink-0 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
            {agentName}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
              message.isFinal
                ? 'border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-500'
                : 'border border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {tagLabel}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px] text-text-muted">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                isWorking ? 'bg-emerald-500 animate-pulse' : 'bg-text-muted'
              }`}
            />
            <span aria-live="polite">{statusLabel}</span>
          </span>
        </div>

        {/* summary-line：✓ + 摘要 + 折叠开关 */}
        <button
          type="button"
          data-testid="agent-summary"
          aria-expanded={traceOpen}
          aria-label={traceOpen ? '收起执行过程' : '展开执行过程'}
          onClick={toggleTrace}
          className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left text-[12.5px] text-text-muted transition-colors hover:bg-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-inset"
        >
          <Check size={14} className="shrink-0 text-emerald-600" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{summaryText}</span>
          <ChevronDown
            size={14}
            aria-hidden
            className={`shrink-0 text-text-muted transition-transform duration-200 ${
              traceOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* agent-trace（可折叠） */}
        {traceOpen && (
          <div
            data-testid="agent-trace"
            className="mx-3.5 mb-2 space-y-1.5 border-t border-dashed border-emerald-500/25 pt-2.5"
          >
            {agentSteps.length === 0 ? (
              <div className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
                <span>{isWorking ? '思考中…' : '暂无执行步骤'}</span>
              </div>
            ) : (
              agentSteps.map((step) => (
                <AgentStepRow key={step.id} step={step} />
              ))
            )}
          </div>
        )}

        {/* text-body：typewriter 文本 + 绿色闪烁光标 */}
        <div className="px-3.5 pt-1 pb-3 text-[13px] leading-relaxed text-text">
          <Suspense fallback={<MarkdownFallback />}>
            <div className="prose prose-sm max-w-none break-words">
              <Markdown text={textContent} />
            </div>
          </Suspense>
          {isWorking && (
            <span
              data-testid="agent-cursor"
              className="agent-cursor"
              aria-hidden
            />
          )}
        </div>
      </div>

      {/* 复制按钮 */}
      {textContent && (
        <button
          onClick={onCopy}
          className="mr-2 mt-3 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
          aria-label="复制消息"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}

      <style>{AGENT_CURSOR_CSS}</style>
    </div>
  );
}

/**
 * agent-trace 单步：thinking（✦）→ tool_call（⚙ 工具名·参数摘要）→ tool_result（结果摘要）。
 * 完成步骤带 ✓；streaming/pending 显示转圈；error 显示失败。
 */
function AgentStepRow({
  step,
}: {
  step: ThinkingBlock | ToolCallBlock | ToolResultBlock;
}) {
  const isStreaming = step.status === 'streaming' || step.status === 'pending';
  const isError =
    step.status === 'error' || (step.type === 'tool_result' && (step as ToolResultBlock).isError);

  let icon = '✓';
  let iconClass = 'bg-emerald-500/15 text-emerald-700';
  let label: ReactNode;

  if (step.type === 'thinking') {
    icon = '✦';
    iconClass = 'bg-amber-500/15 text-amber-600';
    label = (
      <>
        <span className="shrink-0 text-text-muted">思考</span>
        <span className="min-w-0 flex-1 truncate">{(step as ThinkingBlock).thinking}</span>
      </>
    );
  } else if (step.type === 'tool_call') {
    icon = '⚙';
    iconClass = 'bg-emerald-500/15 text-emerald-700';
    const toolCall = step as ToolCallBlock;
    label = (
      <>
        <span className="shrink-0 font-medium text-text">{toolCall.toolName}</span>
        {toolCall.inputRaw && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">
            {summarizeInput(toolCall.inputRaw)}
          </span>
        )}
      </>
    );
  } else {
    const toolResult = step as ToolResultBlock;
    label = (
      <span className="min-w-0 flex-1 truncate text-text-muted">
        {toolResult.content}
      </span>
    );
  }

  return (
    <div
      data-agent-step={step.type}
      className={`flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${
        isError
          ? 'bg-danger/5'
          : isStreaming
            ? 'bg-emerald-500/5'
            : 'bg-emerald-500/5 hover:bg-emerald-500/10'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] ${iconClass}`}
      >
        {icon}
      </span>
      {label}
      {isStreaming ? (
        <Loader2
          size={12}
          className="shrink-0 animate-spin text-emerald-600"
          aria-label="执行中"
        />
      ) : isError ? (
        <AlertCircle
          size={12}
          className="shrink-0 text-danger"
          aria-label="失败"
        />
      ) : (
        <Check size={12} className="shrink-0 text-emerald-600" aria-hidden />
      )}
    </div>
  );
}

/** 从 inputRaw JSON 提取参数摘要（前 2 个 key=value），解析失败时截断原文。 */
function summarizeInput(inputRaw: string): string {
  try {
    const parsed = JSON.parse(inputRaw) as Record<string, unknown>;
    const entries = Object.entries(parsed).slice(0, 2);
    if (entries.length === 0) return '';
    return entries
      .map(([k, v]) => `${k}="${typeof v === 'string' ? v : JSON.stringify(v)}"`)
      .join(' ');
  } catch {
    return inputRaw.replace(/\s+/g, ' ').slice(0, 40);
  }
}
