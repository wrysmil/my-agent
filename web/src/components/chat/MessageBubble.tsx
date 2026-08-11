import { useState, lazy, Suspense } from 'react';
import { Copy, Check } from 'lucide-react';
import { CycleCard } from './CycleCard';
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
 * assistant 分层（全部包在 CycleCard 内，详见 spec § 4.2）：
 *   1. RunTracePanel — 过程时间线（思考 / 工具）
 *   2. Final Markdown — 正文区
 *   3. GeneratingIndicator — 仅 isStreaming && !hasFinalText 时显示，转圈下移到 final 之后
 *
 * user 消息：保持原 user bubble 样式（不进 CycleCard）。
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
          <CycleCard>
            {showTrace && (
              <RunTracePanel
                trace={trace}
                isStreaming={isStreaming}
                hasFinalText={hasFinalText}
                resetKey={message.id}
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

            {showGeneratingIndicator && <GeneratingIndicator />}
          </CycleCard>
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
