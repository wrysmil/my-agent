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
        <div className="text-center space-y-4 max-w-md px-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-primary/40" />
            </div>
          </div>
          <div>
            <h3 className="text-base font-semibold text-text mb-1">开始对话</h3>
            <p className="text-sm text-text-muted/70 leading-relaxed">
              在下方输入框输入消息，按{' '}
              <kbd className="px-1.5 py-0.5 text-[11px] bg-surface-hover border border-border rounded font-mono">
                Enter
              </kbd>{' '}
              发送。Shift+Enter 换行。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-5 pt-6 pb-4"
      role="log"
      aria-live="polite"
    >
      <div className="space-y-5">
        {messages.map((m) => (
          <div key={m.id} className="message-enter">
            <MessageBubble
              message={m}
              isStreaming={
                isStreaming &&
                m.role === 'assistant' &&
                m === messages[messages.length - 1]
              }
            />
          </div>
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
