import { useState, useRef, useCallback } from 'react';
import { parseSseStream } from '@/lib/sse';

export type ChatStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'done'
  | 'aborted'
  | 'error'
  | 'reconnecting';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_RETRIES = 5;
const SUBMITTING_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

export function useChatStream(sessionId: string) {
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const submittingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ChatStatus>('idle');

  const setStatusSafe = useCallback((s: ChatStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (
        ['submitting', 'streaming', 'reconnecting'].includes(statusRef.current)
      )
        return;
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      streamIdRef.current = null;
      setStatusSafe('submitting');
      setMessages((m) => [...m, { role: 'user', text }]);

      submittingTimerRef.current = setTimeout(() => {
        ctrl.abort();
        setStatusSafe('error');
      }, SUBMITTING_TIMEOUT_MS);

      try {
        const res = await fetch(
          `/api/sessions/${sessionId}/messages/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: ctrl.signal,
            credentials: 'same-origin',
          },
        );
        if (submittingTimerRef.current)
          clearTimeout(submittingTimerRef.current);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error('no body');
        setStatusSafe('streaming');
        let assistantText = '';
        let retries = 0;
        while (true) {
          try {
            for await (const evt of parseSseStream(res.body)) {
              if (evt.event === 'message_start') {
                streamIdRef.current = (evt.data as Record<string, unknown>)
                  .streamId as string;
              } else if (evt.event === 'content_block_delta') {
                assistantText +=
                  ((evt.data as Record<string, unknown>).delta as Record<
                    string,
                    unknown
                  >)?.text ?? '';
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (last?.role === 'assistant') {
                    return [
                      ...m.slice(0, -1),
                      { role: 'assistant', text: assistantText },
                    ];
                  }
                  return [...m, { role: 'assistant', text: assistantText }];
                });
              } else if (
                evt.event === 'message_stop' ||
                evt.event === 'done'
              ) {
                setStatusSafe('done');
                return;
              } else if (evt.event === 'error') {
                setStatusSafe('error');
                return;
              } else if (evt.event === 'aborted') {
                setStatusSafe('aborted');
                return;
              }
            }
            return;
          } catch {
            if (retries >= MAX_RETRIES) {
              setStatusSafe('error');
              return;
            }
            setStatusSafe('reconnecting');
            await new Promise((r) => setTimeout(r, BACKOFF_MS[retries]));
            retries++;
            setStatusSafe('streaming');
          }
        }
      } catch {
        if (submittingTimerRef.current)
          clearTimeout(submittingTimerRef.current);
        setStatusSafe('error');
      }
    },
    [sessionId, setStatusSafe],
  );

  const abort = useCallback(async () => {
    controllerRef.current?.abort();
    if (streamIdRef.current) {
      try {
        await fetch(`/api/sessions/${sessionId}/messages/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ streamId: streamIdRef.current }),
          credentials: 'same-origin',
        });
      } catch {
        /* best-effort */
      }
    }
    setStatusSafe('aborted');
  }, [sessionId, setStatusSafe]);

  const retry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) send(lastUserMsg.text);
  }, [messages, send]);

  return { status, messages, send, abort, retry };
}
