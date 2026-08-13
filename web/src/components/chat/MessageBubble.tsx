import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Copy, Check, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { TraceBubble } from './TraceBubble';
import { GeneratingIndicator } from './GeneratingIndicator';
import { RunTracePanel } from './RunTracePanel';
import { buildRunTrace, hasTraceSteps } from '@/features/chat/runTrace';
import type {
  ChatMessage,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
} from '@/features/chat/types';
import { buildAgentSummary, messageText } from '@/features/chat/useChatStream';

const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-4 w-3/4 bg-surface-hover rounded" />;
}

/**
 * MessageBubble — 聊天气泡组件。
 *
 * v4 双布局（spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md` § 4.3）：
 *   assistant 分支为三个独立 DOM 节点（不再共享单气泡容器）：
 *     1. TraceBubble（灰色气泡，仅包 trace）
 *     2. final markdown 裸内容节点（无边框/无背景/无气泡）
 *     3. GeneratingIndicator（仅 isStreaming && !hasFinalText 时显示）
 *   每个子节点独立 key（`${message.id}-{trace,final,gen}`），切会话时 React 识别稳定。
 *
 * user 消息：保持原 user bubble 样式（不进 TraceBubble / 不进 final 节点）。
 */
export function MessageBubble({
  message,
  isStreaming,
  aborted = false,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  /** 当前流被中止时，由 MessageList 对最后一条 assistant 下传 */
  aborted?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const role = message.role;

  const textContent = messageText(message);
  const hasFinalText = message.blocks.some(
    (b) => b.type === 'text' && b.text.length > 0,
  );

  const trace = buildRunTrace(message.blocks, {
    isStreaming,
    streamState: message.streamState,
    aborted,
  });
  const showTrace = hasTraceSteps(trace);
  // 转圈 + 「AI 仍在生成中」下移到 final 之后；仅当还没产出 final 时显示。
  // （删除了原 ThinkingDots：trace 出现后其占位无意义。）
  const showGeneratingIndicator = isStreaming && !hasFinalText;

  // user / agent 消息没有任何文本/内容时不渲染空气泡（避免流断开时显示空占位）。
  // agent 消息须 blocks 也为空才算空：working 态气泡可能在首条 worker 文本前仅有
  // internal steps（dispatch_started → worker_step_start 先于 worker_text_delta）。
  const isEmptyUserMessage = role === 'user' && !message.text && !textContent;
  const isEmptyAgentMessage =
    role === 'agent' &&
    !message.text &&
    !textContent &&
    message.blocks.length === 0;
  if (isEmptyUserMessage || isEmptyAgentMessage) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const textBlocks = message.blocks.filter((b) => b.type === 'text');

  return (
    <div
      className={`flex group relative mb-4 ${
        role === 'user' ? 'justify-end' : 'flex-row items-start'
      }`}
    >
      {role === 'user' ? (
        <div className="max-w-[80%] min-w-0 bg-blue-50 text-blue-950 px-4 py-3 rounded-2xl rounded-br-md shadow-sm dark:bg-blue-900/30 dark:text-blue-100">
          <div className="whitespace-pre-wrap break-words">{message.text || textContent}</div>
        </div>
      ) : role === 'agent' ? (
        <AgentBubble message={message} textContent={textContent} />
      ) : (
        <Fragment>
          <div className="flex flex-col items-stretch min-w-0 flex-1">
            {showTrace && (
              <TraceBubble key={`${message.id}-trace`}>
                <RunTracePanel
                  key={message.id}
                  trace={trace}
                  isStreaming={isStreaming}
                  hasFinalText={hasFinalText}
                  resetKey={message.id}
                />
              </TraceBubble>
            )}

            {textBlocks.length > 0 && (
              <div
                key={`${message.id}-final`}
                data-testid="final-bubble"
                className="w-full max-w-[720px] self-start"
              >
                <Suspense fallback={<MarkdownFallback />}>
                  <div className="prose prose-sm max-w-none break-words">
                    <Markdown
                      text={textBlocks.map((b) => b.text).join('\n')}
                    />
                  </div>
                </Suspense>
              </div>
            )}

            {showGeneratingIndicator && (
              <div key={`${message.id}-gen`} data-testid="gen" className="self-start">
                <GeneratingIndicator />
              </div>
            )}
          </div>

          {textContent && (
            <button
              onClick={onCopy}
              className="ml-2 mt-1 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
              aria-label="复制消息"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </Fragment>
      )}
    </div>
  );
}

/**
 * 绿色闪烁光标样式（v3.4 mockup：`@keyframes blink`）。
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

/**
 * v3.4 mockup 对齐的 agent 气泡（WU-03）。
 *
 * 结构：role-line（头像+名称+标签+状态）→ summary-line（✓+摘要+折叠开关）→
 * 可折叠 agent-trace（thinking / tool_call / tool_result 步骤）→
 * text-body（typewriter 文本 + 绿色闪烁光标）。
 *
 * 状态推导：status==='working' → 工作态（展开 trace + 光标）；否则完成态（默认折叠）。
 * 摘要优先用 WU-02 生成的 message.summary，无则从 blocks 推导。
 */
function AgentBubble({
  message,
  textContent,
}: {
  message: ChatMessage;
  textContent: string;
}) {
  const isWorking = message.status === 'working';
  // working→done 迁移自动折叠；用户手动切换后保留其选择（仿 RunTracePanel 模式）。
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
  const summaryText =
    message.summary && message.summary.length > 0
      ? message.summary
      : buildAgentSummary(message.blocks);

  const toggleTrace = () => {
    setUserOverride(true);
    setTraceOpen((v) => !v);
  };

  return (
    <div
      data-testid="agent-bubble"
      className={`w-full max-w-[640px] self-start overflow-hidden rounded-xl border-l border-emerald-500/30 bg-emerald-500/10 shadow-sm transition-shadow duration-200 ${
        isWorking
          ? 'border-[#0e9f6e] shadow-[0_0_0_2px_rgba(14,159,110,0.18)]'
          : ''
      }`}
    >
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
            agentSteps.map((step) => <AgentStepRow key={step.id} step={step} />)
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
          <span data-testid="agent-cursor" className="agent-cursor" aria-hidden />
        )}
      </div>

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
    step.status === 'error' || (step.type === 'tool_result' && step.isError);

  let icon = '✓';
  let iconClass = 'bg-emerald-500/15 text-emerald-700';
  let label: ReactNode;

  if (step.type === 'thinking') {
    icon = '✦';
    iconClass = 'bg-amber-500/15 text-amber-600';
    label = (
      <>
        <span className="shrink-0 text-text-muted">思考</span>
        <span className="min-w-0 flex-1 truncate">{step.thinking}</span>
      </>
    );
  } else if (step.type === 'tool_call') {
    icon = '⚙';
    iconClass = 'bg-emerald-500/15 text-emerald-700';
    label = (
      <>
        <span className="shrink-0 font-medium text-text">{step.toolName}</span>
        {step.inputRaw && (
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">
            {summarizeInput(step.inputRaw)}
          </span>
        )}
      </>
    );
  } else {
    label = (
      <span className="min-w-0 flex-1 truncate text-text-muted">
        {step.content}
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

