import { Fragment, useState, lazy, Suspense } from 'react';
import { Copy, Check } from 'lucide-react';
import { TraceBubble } from './TraceBubble';
import { GeneratingIndicator } from './GeneratingIndicator';
import { RunTracePanel } from './RunTracePanel';
import { buildRunTrace, hasTraceSteps } from '@/features/chat/runTrace';
import type { ChatMessage } from '@/features/chat/types';
import { messageText } from '@/features/chat/useChatStream';

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

  // user 消息没有任何文本/内容时不渲染空气泡（避免流断开时显示空蓝色占位）
  const isEmptyUserMessage = role === 'user' && !message.text && !textContent;
  if (isEmptyUserMessage) return null;

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
