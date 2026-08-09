import { useState, lazy, Suspense } from 'react';
import { Copy, Check } from 'lucide-react';
import { ThinkingDots } from './ThinkingDots';
import { ThinkingBlockView } from './ThinkingBlock';
import { ProcessTracker } from './ProcessTracker';
import { ActivityStrip } from './ActivityStrip';
import type { ChatMessage } from '@/features/chat/types';
import { messageText } from '@/features/chat/useChatStream';

const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-4 w-3/4 bg-surface-hover rounded" />;
}

/**
 * MessageBubble — 聊天气泡组件。
 *
 * 支持结构化内容渲染：
 *   1. ThinkingDots（思考动画）—— 流开始时显示
 *   2. ProcessTracker（过程追踪）—— 工具调用/结果
 *   3. ActivityStrip（活动条）—— 当前状态+计时
 *   4. ThinkingBlock（思考内容）—— 可折叠
 *   5. FinalMarkdown（文本回复）—— Markdown 渲染
 *
 * 参考 Orkas 气泡分层设计：process → activity → thinking-dots → final。
 */
export function MessageBubble({ message, isStreaming }: {
  message: ChatMessage;
  isStreaming: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const role = message.role;

  const textContent = messageText(message);
  const hasContent = message.blocks.some(
    (b) => (b.type === 'text' && b.text.length > 0) || b.type === 'thinking'
  );
  const showThinkingDots = isStreaming && !hasContent;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  // 提取 thinking blocks（放在 header 下方，collapsible）
  const thinkingBlocks = message.blocks.filter((b) => b.type === 'thinking');

  // 提取 text blocks 用于 Markdown 渲染
  const textBlocks = message.blocks.filter((b) => b.type === 'text');

  return (
    <div
      className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} group relative mb-4`}
    >
      <div
        className={`max-w-[80%] min-w-0 rounded-lg px-4 py-2 ${
          role === 'user'
            ? 'bg-blue-500 text-white'
            : 'bg-surface border border-border'
        }`}
      >
        {role === 'user' ? (
          // 用户消息：简单文本
          <div className="whitespace-pre-wrap break-words">{message.text || textContent}</div>
        ) : (
          // AI 消息：结构化渲染
          <div className="space-y-1">
            {/* 1. Thinking Dots — 流开始时在气泡内显示 */}
            {showThinkingDots && <ThinkingDots />}

            {/* 2. Process Tracker — 工具调用/结果面板 */}
            {message.blocks.length > 0 && (
              <ProcessTracker blocks={message.blocks} />
            )}

            {/* 3. Activity Strip — 当前动作 + 计时器 */}
            {isStreaming && (
              <ActivityStrip
                streamState={message.streamState}
                activeToolCount={message.activeToolCount}
                streamStartTime={message.streamStartTime}
              />
            )}

            {/* 4. Thinking Blocks — 可折叠的思考内容 */}
            {thinkingBlocks.map((block) => (
              <ThinkingBlockView key={block.id} block={block} />
            ))}

            {/* 5. Text Blocks — Markdown 渲染 */}
            {textBlocks.length > 0 && (
              <Suspense fallback={<MarkdownFallback />}>
                <div className="prose prose-sm max-w-none break-words">
                  <Markdown
                    text={textBlocks.map((b) => b.text).join('\n')}
                  />
                </div>
              </Suspense>
            )}

            {/* Token 用量（完成后显示） */}
            {!isStreaming && message.usage && message.usage.totalTokens > 0 && (
              <div className="text-[10px] text-text-muted/30 text-right pt-1 border-t border-border/30 mt-1">
                {message.usage.inputTokens} → {message.usage.outputTokens} tokens
              </div>
            )}
          </div>
        )}
      </div>

      {/* 复制按钮 */}
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
