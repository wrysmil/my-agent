import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChatStream } from '@/features/chat/useChatStream';
import { useTranslation } from '@/i18n/useTranslation';
import { apiPost } from '@/lib/api';
import { Composer } from '@/components/chat/Composer';
import { MessageList } from '@/components/chat/MessageList';
import { StreamIndicator } from '@/components/chat/StreamIndicator';

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);

  // Auto-create session when no sessionId in URL
  // Source: .ai-runtime-artifacts/specs/2026-08-08-six-issues-fix-spec.md §3.3.1
  useEffect(() => {
    if (sessionId) return;
    let cancelled = false;
    setCreating(true);
    apiPost<{ session?: { id: string } }>('/api/sessions', { kind: 'gconv' })
      .then((data) => {
        if (!cancelled && data?.session?.id) {
          navigate(`/chat/${data.session.id}`, { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) setCreating(false);
      });
    return () => { cancelled = true; };
  }, [sessionId, navigate]);

  const cid = sessionId || '';

  const { status, messages, historyLoaded, send, abort } = useChatStream(cid);

  if (creating) {
    return (
      <div className="flex flex-col h-full items-center justify-center" data-testid="page-chat">
        <p className="text-sm text-text-muted">{t('chat.generating')}</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex flex-col h-full items-center justify-center" data-testid="page-chat">
        <p className="text-sm text-text-muted">{t('chat.emptyState')}</p>
      </div>
    );
  }

  if (!historyLoaded) {
    return (
      <div className="flex flex-col h-full items-center justify-center" data-testid="page-chat">
        <p className="text-sm text-text-muted">{t('chat.generating')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="page-chat">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <h2 className="text-sm font-medium text-text-muted">
          {t('chat.sessionLabel', { id: sessionId })}
        </h2>
        {status === 'streaming' && <StreamIndicator />}
      </div>
      <MessageList messages={messages} />
      <Composer onSend={send} onAbort={abort} status={status} />
    </div>
  );
}
