import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatStatus } from '@/features/chat/useChatStream';

export function Composer({ onSend, onAbort, status }: {
  onSend: (text: string) => void;
  onAbort: () => void;
  status: ChatStatus;
}) {
  const [text, setText] = useState('');
  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isStreaming) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border p-4 bg-surface">
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息（⌘+Enter 发送）"
          rows={2}
          className="flex-1 resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button type="button" variant="destructive" size="sm" onClick={onAbort}>
            <Square size={14} className="mr-1" /> 停止
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!text.trim()}>
            <Send size={14} className="mr-1" /> 发送
          </Button>
        )}
      </div>
    </form>
  );
}
