import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/features/chat/useChatStream';
import { MessageSquare, Cpu } from 'lucide-react';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

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
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted/50">
            <Cpu className="w-3 h-3" />
            <span>支持 DeepSeek Chat / Reasoner 模型</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2" role="log" aria-live="polite">
      {messages.map((m, i) => (
        <MessageBubble key={i} role={m.role} text={m.text} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
