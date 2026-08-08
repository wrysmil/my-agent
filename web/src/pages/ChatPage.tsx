import { useParams } from 'react-router-dom';
import { useChatStream } from '@/features/chat/useChatStream';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { StreamIndicator } from '@/components/chat/StreamIndicator';

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const cid = sessionId || 'default';
  const { status, messages, send, abort } = useChatStream(cid);

  return (
    <div className="flex flex-col h-full" data-testid="page-chat">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-medium text-text-muted">
          {sessionId ? `会话: ${sessionId}` : '新对话'}
        </h2>
        {status === 'streaming' && <StreamIndicator />}
      </div>
      <MessageList messages={messages} />
      <Composer onSend={send} onAbort={abort} status={status} />
    </div>
  );
}
