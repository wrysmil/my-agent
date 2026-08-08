import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/features/chat/useChatStream';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2" role="log" aria-live="polite">
      {messages.map((m, i) => (
        <MessageBubble key={i} role={m.role} text={m.text} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
