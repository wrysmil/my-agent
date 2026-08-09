import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage, ChatStatus } from '@/features/chat/types';
import { MessageSquare } from 'lucide-react';

export function MessageList({
  messages,
  status,
}: {
  messages: ChatMessage[];
  status: ChatStatus;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" role="log" aria-live="polite">
        <div className="text-center space-y-3 max-w-md px-6">
          <div className="flex justify-center">
            <MessageSquare className="w-12 h-12 text-text-muted/30" />
          </div>
          <h3 className="text-lg font-medium text-text-muted">开始对话</h3>
          <p className="text-sm text-text-muted/70 leading-relaxed">
            在下方输入框输入消息，按{' '}
            <kbd className="px-1.5 py-0.5 text-xs bg-surface-hover border border-border rounded">
              ⌘+Enter
            </kbd>{' '}
            发送。可以在输入框下方选择模型和思考级别。
          </p>
        </div>
      </div>
    );
  }

  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-2 space-y-1"
      role="log"
      aria-live="polite"
    >
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          isStreaming={
            isStreaming &&
            m.role === 'assistant' &&
            m === messages[messages.length - 1]
          }
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
