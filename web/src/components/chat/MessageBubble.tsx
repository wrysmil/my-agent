import { useState, lazy, Suspense } from 'react';
import { Copy, Check } from 'lucide-react';
import { ThinkingDots } from './ThinkingDots';
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
 * assistant 分层：
 *   1. ThinkingDots — 流式且尚无 trace / 最终 text 时的极短暂 fallback
 *   2. RunTracePanel — 过程时间线（思考 / 工具）
 *   3. Final Markdown — 过程容器外的正文区（无强卡片边框）
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
  const showThinkingDots = isStreaming && !showTrace && !hasFinalText;

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
      className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} group relative mb-4`}
    >
      <div
        className={`max-w-[80%] min-w-0 ${
          role === 'user'
            ? 'bg-blue-50 text-blue-950 px-4 py-3 rounded-2xl rounded-br-md shadow-sm dark:bg-blue-900/30 dark:text-blue-100'
            : ''
        }`}
      >
        {role === 'user' ? (
          <div className="whitespace-pre-wrap break-words">{message.text || textContent}</div>
        ) : (
          <div className="space-y-2">
            {showThinkingDots && <ThinkingDots />}

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
                  <Markdown
                    text={textBlocks.map((b) => b.text).join('\n')}
                  />
                </div>
              </Suspense>
            )}

            {/* Token 用量：仅开发入口，不删 message.usage 数据 */}
            {(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true &&
              !isStreaming &&
              message.usage &&
              message.usage.totalTokens > 0 && (
                <details className="text-[10px] text-text-muted/50 pt-1">
                  <summary className="cursor-pointer select-none">用量</summary>
                  <div className="text-right pt-0.5">
                    {message.usage.inputTokens} → {message.usage.outputTokens} tokens
                  </div>
                </details>
              )}
          </div>
        )}
      </div>

      {role === 'assistant' && textContent && (
        <button
          onClick={onCopy}
          className="ml-2 self-end opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
          aria-label="复制消息"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}
