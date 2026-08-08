import { useState, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatStatus } from '@/features/chat/types';

export function Composer({ onSend, onAbort, status, modelSelector }: {
  onSend: (text: string) => void;
  onAbort: () => void;
  status: ChatStatus;
  modelSelector?: ReactNode;
}) {
  const [text, setText] = useState('');
  const sendingRef = useRef(false);
  const isStreaming = status === 'streaming' || status === 'submitting' || status === 'reconnecting';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isStreaming || sendingRef.current) return;
    sendingRef.current = true;
    onSend(text.trim());
    setText('');
    // 短暂延迟后解锁，防止极端情况下的重复提交
    setTimeout(() => { sendingRef.current = false; }, 500);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border px-4 py-3 bg-surface shrink-0">
      {modelSelector && (
        <div className="flex items-center gap-2 mb-2">
          {modelSelector}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息（Enter 发送，Shift+Enter 换行）"
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
