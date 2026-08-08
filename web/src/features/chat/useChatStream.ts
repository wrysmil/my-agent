import { useState, useRef, useCallback, useEffect } from 'react';
import { parseSseStream } from '@/lib/sse';
import { apiGet } from '@/lib/api';

export type ChatStatus =
  | 'idle'
  | 'submitting'
  | 'streaming'
  | 'reconnecting'
  | 'done'
  | 'error'
  | 'aborted';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatOptions {
  model?: string;
  thinkingLevel?: 'off' | 'low' | 'high';
}

interface SerializedMsg {
  role: string;
  content?: string;
  text?: string;
  contentBlocks?: Array<{ type: string; text?: string }>;
}

const MAX_RETRIES = 5;
const SUBMITTING_TIMEOUT_MS = 60_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

export function useChatStream(sessionId: string) {
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const submittingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ChatStatus>('idle');
  const optionsRef = useRef<ChatOptions>({});

  const setStatusSafe = useCallback((s: ChatStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // Load history when sessionId changes — reset state to force reload
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    setHistoryLoaded(false);
    setMessages([]);

    apiGet<{ messages: SerializedMsg[] }>(`/api/sessions/${sessionId}/history`)
      .then((data) => {
        if (cancelled || !data?.messages) {
          if (!cancelled) setHistoryLoaded(true);
          return;
        }
        const loaded: ChatMessage[] = [];
        for (const m of data.messages) {
          const role = m.role === 'user' ? 'user' : 'assistant';
          let text = m.text || m.content || '';
          if (!text && m.contentBlocks) {
            text = m.contentBlocks
              .filter((b) => b.type === 'text')
              .map((b) => b.text || '')
              .join('\n');
          }
          if (text) loaded.push({ role: role as 'user' | 'assistant', text });
        }
        if (!cancelled) {
          setMessages(loaded);
          setHistoryLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true); // mark loaded even on error
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  const send = useCallback(
    async (text: string, options?: ChatOptions) => {
      if (
        ['submitting', 'streaming', 'reconnecting'].includes(statusRef.current)
      )
        return;
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      streamIdRef.current = null;
      optionsRef.current = options ?? {};
      setStatusSafe('submitting');
      setMessages((m) => [...m, { role: 'user', text }]);

      if (submittingTimerRef.current) clearTimeout(submittingTimerRef.current);
      submittingTimerRef.current = setTimeout(() => {
        if (statusRef.current === 'submitting') setStatusSafe('error');
      }, SUBMITTING_TIMEOUT_MS);

      try {
        const body: Record<string, unknown> = { text };
        if (options?.model) body.model = options.model;
        if (options?.thinkingLevel) body.thinkingLevel = options.thinkingLevel;

        const res = await fetch(
          `/api/sessions/${sessionId}/messages/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
            credentials: 'same-origin',
          },
        );
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          let errMsg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errBody);
            if (j?.error?.message) errMsg = j.error.message;
          } catch { /* ignore parse error */ }
          setMessages((m) => [
            ...m,
            { role: 'assistant', text: `❌ ${errMsg}` },
          ]);
          setStatusSafe('error');
          return;
        }
        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        let retries = 0;

        for await (const evt of parseSseStream(reader)) {
          try {
            if (evt.event === 'message_start') {
              setStatusSafe('streaming');
              if (submittingTimerRef.current)
                clearTimeout(submittingTimerRef.current);
              if (evt.data?.streamId)
                streamIdRef.current = evt.data.streamId;
            } else if (evt.event === 'text_delta') {
              const delta = evt.data?.delta ?? '';
              setMessages((m) => {
                const last = m[m.length - 1];
                if (last?.role === 'assistant') {
                  return [
                    ...m.slice(0, -1),
                    { ...last, text: last.text + delta },
                  ];
                }
                return [...m, { role: 'assistant', text: delta }];
              });
            } else if (evt.event === 'done') {
              setStatusSafe('done');
              return;
            } else if (evt.event === 'error') {
              const errData = evt.data as Record<string, unknown>;
              const errInfo = errData?.error as Record<string, unknown> | undefined;
              const errMsg =
                (errInfo?.message as string) || '未知错误';
              setMessages((m) => [
                ...m,
                { role: 'assistant', text: `❌ 错误：${errMsg}` },
              ]);
              setStatusSafe('error');
              return;
            } else if (evt.event === 'aborted') {
              setStatusSafe('aborted');
              return;
            }
          } catch {
            if (retries >= MAX_RETRIES) {
              setStatusSafe('error');
              return;
            }
            retries += 1;
            await new Promise((r) =>
              setTimeout(r, BACKOFF_MS[retries - 1] ?? 16000),
            );
            setStatusSafe('reconnecting');
          }
        }
        setStatusSafe('done');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatusSafe('aborted');
        } else {
          setStatusSafe('error');
        }
      }
    },
    [sessionId],
  );

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    setStatusSafe('aborted');
  }, []);

  const retry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) send(lastUserMsg.text, optionsRef.current);
  }, [messages, send]);

  return { status, messages, send, abort, retry, historyLoaded };
}
