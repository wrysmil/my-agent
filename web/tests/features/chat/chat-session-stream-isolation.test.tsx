import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRuntimeStore } from '../../../src/features/chat/chatRuntimeStore';
import {
  mergePersistedWithOverlay,
  useChatStream,
} from '../../../src/features/chat/useChatStream';
import { logger } from '../../../src/lib/logger';

type StreamControl = {
  response: Response;
  emit: (event: string, envelope: Record<string, unknown>) => void;
  close: () => void;
};

function controlledStream(): StreamControl {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
  });

  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    emit(event, envelope) {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`),
      );
    },
    close() {
      controller.close();
    },
  };
}

function historyResponse(
  sessionId: string,
  revision: number,
  messages: unknown[] = [],
): Response {
  return new Response(
    JSON.stringify({ ok: true, data: { sessionId, revision, messages } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function textForRun(sessionId: string, runId: string): string {
  const message = useChatRuntimeStore
    .getState()
    .getSession(sessionId)
    ?.messages.find((item) => item.role === 'assistant' && item.runId === runId);
  return message?.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('') ?? '';
}

describe('chat session stream isolation regressions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatRuntimeStore.setState({
      sessions: {},
      runs: {},
      _accessOrder: [],
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce('client-a')
        .mockReturnValueOnce('run-a')
        .mockReturnValueOnce('client-b')
        .mockReturnValueOnce('run-b'),
    });
  });

  it('keeps A overlay and later deltas across A → B → A with late history', async () => {
    const streamA = controlledStream();
    let resolveLateHistoryA!: (response: Response) => void;
    const lateHistoryA = new Promise<Response>((resolve) => {
      resolveLateHistoryA = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/sessions/A/history') return lateHistoryA;
      if (url === '/api/sessions/B/history') {
        return Promise.resolve(historyResponse('B', 0));
      }
      if (url === '/api/sessions/A/messages/stream' && init?.method === 'POST') {
        return Promise.resolve(streamA.response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatStream(sessionId),
      { initialProps: { sessionId: 'A' } },
    );

    act(() => {
      void result.current.send('question A');
    });
    await act(async () => {
      streamA.emit('message_start', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-a', stream_id: 'stream-a' } },
      });
      streamA.emit('content_block_delta', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 2,
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: 'first ' } },
      });
    });
    await waitFor(() =>
      expect(
        useChatRuntimeStore.getState().getRun('run-a')?.pendingTextBuffer,
      ).toBe('first '),
    );
    act(() => {
      useChatRuntimeStore.getState().flushTextBuffer('run-a');
    });
    expect(textForRun('A', 'run-a')).toBe('first ');

    rerender({ sessionId: 'B' });
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));

    await act(async () => {
      resolveLateHistoryA(historyResponse('A', 0));
      await Promise.resolve();
    });

    rerender({ sessionId: 'A' });
    expect(textForRun('A', 'run-a')).toBe('first ');

    await act(async () => {
      streamA.emit('content_block_delta', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 3,
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: 'second' } },
      });
    });
    await waitFor(() =>
      expect(
        useChatRuntimeStore.getState().getRun('run-a')?.pendingTextBuffer,
      ).toBe('second'),
    );
    act(() => {
      useChatRuntimeStore.getState().flushTextBuffer('run-a');
    });

    expect(textForRun('A', 'run-a')).toBe('first second');
  });

  it('creates the assistant before assigning message_start stable ID', async () => {
    const stream = controlledStream();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) return Promise.resolve(historyResponse('A', 0));
      if (init?.method === 'POST') return Promise.resolve(stream.response);
      throw new Error(`Unexpected request: ${url}`);
    });

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await act(async () => {
      stream.emit('message_start', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 1,
        event: 'message_start',
        data: { message: { id: 'stable-assistant', stream_id: 'stream-a' } },
      });
      await Promise.resolve();
    });

    const assistant = useChatRuntimeStore
      .getState()
      .getSession('A')
      ?.messages.find((message) => message.role === 'assistant');
    expect(assistant?.messageId).toBe('stable-assistant');
  });

  it('retains a queued rAF buffer until its run assistant exists', () => {
    const store = useChatRuntimeStore.getState();
    store.ensureSession('A');
    store.createRun('A', 'run-a');
    store.setActiveRun('A', 'run-a');
    store.setRunStatus('run-a', 'running');

    store.appendTextBuffer('run-a', 'not lost');
    store.flushTextBuffer('run-a');
    store.cancelRunRaf('run-a');

    expect(store.getRun('run-a')?.pendingTextBuffer).toBe('not lost');

    store.updateMessages('A', 'run-a', (messages) => [
      ...messages,
      {
        id: 'asst-run-a',
        role: 'assistant',
        blocks: [],
        runId: 'run-a',
      },
    ]);
    store.flushTextBuffer('run-a');

    expect(textForRun('A', 'run-a')).toBe('not lost');
    expect(store.getRun('run-a')?.pendingTextBuffer).toBe('');
  });

  it('clears only the terminal run resources while preserving same-run convergence writes', () => {
    const store = useChatRuntimeStore.getState();
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    store.ensureSession('A');
    store.ensureSession('B');
    store.createRun('A', 'run-a');
    store.createRun('B', 'run-b');
    store.setActiveRun('A', 'run-a');
    store.setActiveRun('B', 'run-b');
    store.setRunAbortController('run-a', controllerA);
    store.setRunAbortController('run-b', controllerB);
    store.setRunStatus('run-a', 'succeeded');
    store.setActiveRun('A', null);
    store.setRunAbortController('run-a', null);

    store.updateMessages('A', 'run-a', () => [
      {
        id: 'persisted-a',
        role: 'assistant',
        blocks: [],
        runId: 'run-a',
        messageId: 'assistant-a',
      },
    ]);

    expect(store.getSession('A')?.messages).toHaveLength(1);
    expect(store.getRun('run-a')?.abortController).toBeNull();
    expect(store.getSession('B')?.activeRunId).toBe('run-b');
    expect(store.getRun('run-b')?.abortController).toBe(controllerB);
  });

  it('lets overlay win until history reaches the run persisted revision', () => {
    const persisted = [{
      id: 'hist-assistant-a',
      role: 'assistant' as const,
      blocks: [{
        id: 'persisted-text',
        type: 'text' as const,
        status: 'done' as const,
        text: 'old',
      }],
      runId: 'run-a',
      messageId: 'assistant-a',
    }];
    const overlay = [{
      id: 'asst-run-a',
      role: 'assistant' as const,
      blocks: [{
        id: 'overlay-text',
        type: 'text' as const,
        status: 'done' as const,
        text: 'complete',
      }],
      runId: 'run-a',
      messageId: 'assistant-a',
    }];

    expect(
      mergePersistedWithOverlay(persisted, overlay, 4, () => 5)[0].blocks[0],
    ).toMatchObject({ text: 'complete' });
    expect(
      mergePersistedWithOverlay(persisted, overlay, 5, () => 5)[0].blocks[0],
    ).toMatchObject({ text: 'old' });
  });

  it('done clears active run resources without touching another session run', async () => {
    const stream = controlledStream();
    const neverResolvingHistory = new Promise<Response>(() => {});
    let historyCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url === '/api/sessions/A/history') {
        historyCalls += 1;
        return historyCalls === 1
          ? Promise.resolve(historyResponse('A', 0))
          : neverResolvingHistory;
      }
      if (url === '/api/sessions/A/messages/stream' && init?.method === 'POST') {
        return Promise.resolve(stream.response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const store = useChatRuntimeStore.getState();
    store.ensureSession('B');
    store.createRun('B', 'run-b');
    const controllerB = new AbortController();
    store.setRunAbortController('run-b', controllerB);
    store.setActiveRun('B', 'run-b');

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await act(async () => {
      stream.emit('message_start', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-a', stream_id: 'stream-a' } },
      });
      stream.emit('done', {
        sessionId: 'A',
        runId: 'run-a',
        streamId: 'stream-a',
        seq: 2,
        event: 'done',
        data: { persistedRevision: 2, messageId: 'assistant-a' },
      });
    });

    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getRun('run-a')?.status).toBe(
        'succeeded',
      ),
    );
    const state = useChatRuntimeStore.getState();
    expect(state.getSession('A')?.activeRunId).toBeNull();
    expect(state.getRun('run-a')).toMatchObject({
      abortController: null,
      submittingTimer: null,
      messageStopped: false,
      persistedRevision: 2,
    });
    expect(state.getSession('B')?.activeRunId).toBe('run-b');
    expect(state.getRun('run-b')?.abortController).toBe(controllerB);
  });

  it('does not let an old run terminal steal a newer run UI ownership', async () => {
    const first = controlledStream();
    const second = controlledStream();
    let streamCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse('A', 0));
      }
      if (init?.method === 'POST') {
        streamCalls += 1;
        return Promise.resolve(streamCalls === 1 ? first.response : second.response);
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('first'));
    await act(async () => {
      first.emit('message_start', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-a', stream_id: 'stream-a' } },
      });
    });

    act(() => result.current.abort());
    act(() => void result.current.send('second'));
    await act(async () => {
      second.emit('message_start', {
        sessionId: 'A', runId: 'run-b', streamId: 'stream-b', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-b', stream_id: 'stream-b' } },
      });
    });
    await waitFor(() => expect(result.current.status).toBe('streaming'));

    await act(async () => {
      first.emit('error', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 2,
        event: 'error',
        data: { error: { message: 'late old failure' } },
      });
    });

    expect(result.current.status).toBe('streaming');
    expect(useChatRuntimeStore.getState().getSession('A')?.activeRunId).toBe('run-b');
  });

  it('aborts a timed-out old request without changing the newer run UI', async () => {
    vi.useFakeTimers();
    try {
      let firstSignal: AbortSignal | undefined;
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/history')) return Promise.resolve(historyResponse('A', 0));
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      });

      const { result } = renderHook(() => useChatStream('A'));
      await act(async () => {
        await Promise.resolve();
      });
      act(() => void result.current.send('first'));

      const store = useChatRuntimeStore.getState();
      store.createRun('A', 'new-active-run');
      store.setRunStatus('new-active-run', 'running');
      store.setActiveRun('A', 'new-active-run');
      store.setSessionStatus('A', 'streaming');

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(firstSignal?.aborted).toBe(true);
      expect(store.getSession('A')?.activeRunId).toBe('new-active-run');
      expect(store.getSession('A')?.status).toBe('streaming');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a delayed history response older than the current session revision', async () => {
    let resolveHistory!: (response: Response) => void;
    const delayedHistory = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValue(delayedHistory);

    renderHook(() => useChatStream('A'));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')).toBeDefined(),
    );
    const store = useChatRuntimeStore.getState();
    store.setSessionMessages('A', [{
      id: 'newer',
      role: 'assistant',
      blocks: [],
      messageId: 'newer',
    }]);
    store.setSessionHistoryLoaded('A', true, 5);

    await act(async () => {
      resolveHistory(historyResponse('A', 4, [{
        id: 'older',
        role: 'assistant',
        content: [{ type: 'text', text: 'older snapshot' }],
      }]));
      await Promise.resolve();
    });

    expect(store.getSession('A')?.historyRevision).toBe(5);
    expect(store.getSession('A')?.messages[0]?.messageId).toBe('newer');
  });

  it('restores one assistant bubble for a persisted tool-loop run', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(historyResponse('A', 4, [
      {
        id: 'user-a',
        role: 'user',
        runId: 'run-a',
        turnId: 1,
        content: [{ id: 'user-a:0', type: 'text', text: 'question' }],
      },
      {
        id: 'assistant-tool-step',
        role: 'assistant',
        runId: 'run-a',
        turnId: 1,
        content: [
          { id: 'thinking-a', type: 'thinking', thinking: 'researching' },
          { id: 'tool-a', type: 'tool_use', name: 'web_fetch', input: {} },
        ],
      },
      {
        id: 'tool-result-row',
        role: 'user',
        runId: 'run-a',
        turnId: 1,
        content: [{
          id: 'result:tool-a',
          type: 'tool_result',
          toolUseId: 'tool-a',
          name: 'web_fetch',
          content: 'result',
        }],
      },
      {
        id: 'assistant-final',
        role: 'assistant',
        runId: 'run-a',
        turnId: 1,
        content: [{ id: 'assistant-final:0', type: 'text', text: 'final answer' }],
      },
    ]));

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: 'question',
    });
    expect(result.current.messages[1]).toMatchObject({
      id: 'hist-assistant-final',
      role: 'assistant',
      runId: 'run-a',
      messageId: 'assistant-final',
    });
    expect(result.current.messages[1].blocks.map((block) => block.type)).toEqual([
      'thinking',
      'tool_call',
      'tool_result',
      'text',
    ]);
  });

  it('removes orphan runs when a session is removed and bounds terminal run metadata', () => {
    const store = useChatRuntimeStore.getState();
    store.ensureSession('A');
    for (let index = 0; index < 30; index += 1) {
      const runId = `failed-${index}`;
      store.createRun('A', runId);
      store.setRunStatus(runId, 'failed');
    }

    expect(
      Object.values(useChatRuntimeStore.getState().runs)
        .filter((run) => run.sessionId === 'A').length,
    ).toBeLessThanOrEqual(20);

    store.createRun('A', 'orphan');
    store.markRunAwaitingPersistence('orphan', 99);
    expect(store.getSession('A')?.pendingPersistence['orphan']).toBe(99);
    store.removeSession('A');
    expect(store.getSession('A')).toBeUndefined();
    expect(
      Object.values(useChatRuntimeStore.getState().runs)
        .filter((run) => run.sessionId === 'A'),
    ).toEqual([]);
  });

  it('keeps persistence convergence metadata after awaiting run eviction', () => {
    const store = useChatRuntimeStore.getState();
    store.ensureSession('A');
    store.setSessionMessages('A', [{
      id: 'overlay-0',
      role: 'assistant',
      blocks: [{
        id: 'overlay-text',
        type: 'text',
        status: 'done',
        text: 'overlay complete',
      }],
      runId: 'awaiting-0',
      messageId: 'assistant-0',
    }]);

    for (let index = 0; index < 21; index += 1) {
      const runId = `awaiting-${index}`;
      store.createRun('A', runId);
      store.markRunAwaitingPersistence(runId, 10 + index);
      store.setRunStatus(runId, 'succeeded');
    }
    expect(store.getRun('awaiting-0')).toBeUndefined();
    expect(store.getSession('A')?.pendingPersistence['awaiting-0']).toBe(10);

    const persisted = [{
      id: 'hist-0',
      role: 'assistant' as const,
      blocks: [{
        id: 'persisted-text',
        type: 'text' as const,
        status: 'done' as const,
        text: 'persisted complete',
      }],
      runId: 'awaiting-0',
      messageId: 'assistant-0',
    }];
    store.applySessionHistory('A', 9, (overlay, pending) =>
      mergePersistedWithOverlay(
        persisted,
        overlay,
        9,
        (runId) => pending[runId] ?? null,
      ),
    );
    expect(textForRun('A', 'awaiting-0')).toBe('overlay complete');

    store.applySessionHistory('A', 10, (overlay, pending) =>
      mergePersistedWithOverlay(
        persisted,
        overlay,
        10,
        (runId) => pending[runId] ?? null,
      ),
    );
    expect(textForRun('A', 'awaiting-0')).toBe('persisted complete');
    expect(
      useChatRuntimeStore.getState().getSession('A')
        ?.pendingPersistence['awaiting-0'],
    ).toBeUndefined();
  });

  it('bounds pending persistence while retaining safe convergence for evicted entries', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
      const store = useChatRuntimeStore.getState();
      store.ensureSession('A');
      store.ensureSession('B');

      const messages = [
        {
          id: 'old-overlay',
          role: 'assistant' as const,
          blocks: [{
            id: 'old-text',
            type: 'text' as const,
            status: 'done' as const,
            text: 'current overlay',
          }],
          runId: 'old-awaiting',
          messageId: 'old-assistant',
        },
        ...Array.from({ length: 64 }, (_, index) => ({
          id: `overlay-${index}`,
          role: 'assistant' as const,
          blocks: [],
          runId: `awaiting-${index}`,
          messageId: `assistant-${index}`,
        })),
      ];
      store.setSessionMessages('A', messages);

      store.createRun('A', 'old-awaiting');
      store.markRunAwaitingPersistence('old-awaiting', 10);
      vi.advanceTimersByTime(30 * 60 * 1000 + 1);

      store.createRun('A', 'active-a');
      store.setRunStatus('active-a', 'running');
      store.setActiveRun('A', 'active-a');
      store.createRun('B', 'active-b');
      store.setRunStatus('active-b', 'running');
      store.setActiveRun('B', 'active-b');
      store.markRunAwaitingPersistence('active-b', 500);

      for (let index = 0; index < 64; index += 1) {
        const runId = `awaiting-${index}`;
        store.createRun('A', runId);
        store.markRunAwaitingPersistence(runId, 100 + index);
        store.setRunStatus(runId, 'succeeded');
      }

      const pendingA = store.getSession('A')?.pendingPersistence ?? {};
      expect(Object.keys(pendingA)).toHaveLength(32);
      expect(pendingA['awaiting-63']).toBe(163);
      expect(pendingA['old-awaiting']).toBeUndefined();
      expect(pendingA['awaiting-0']).toBeUndefined();
      expect(store.getSession('A')?.activeRunId).toBe('active-a');
      expect(store.getRun('active-a')?.status).toBe('running');
      expect(store.getSession('B')?.activeRunId).toBe('active-b');
      expect(store.getSession('B')?.pendingPersistence['active-b']).toBe(500);

      store.applySessionHistory('A', 9, (overlay, pending) =>
        mergePersistedWithOverlay(
          [{
            id: 'stale-old',
            role: 'assistant',
            blocks: [{
              id: 'stale-text',
              type: 'text',
              status: 'done',
              text: 'stale persisted',
            }],
            runId: 'old-awaiting',
            messageId: 'old-assistant',
          }],
          overlay,
          9,
          (runId) => pending[runId] ?? null,
        ),
      );
      expect(textForRun('A', 'old-awaiting')).toBe('current overlay');
      expect(store.getSession('A')?.activeRunId).toBe('active-a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not rerender an A hook for background B session updates', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(historyResponse('A', 0));
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useChatStream('A');
    });
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    const settledRenders = renders;

    act(() => {
      const store = useChatRuntimeStore.getState();
      store.ensureSession('B');
      store.setSessionStatus('B', 'streaming');
      store.setSessionMessages('B', [{
        id: 'background-b',
        role: 'assistant',
        blocks: [],
      }]);
    });

    expect(renders).toBe(settledRenders);
  });

  it('treats EOF without terminal as error, preserves partial overlay, and allows resend', async () => {
    const truncated = controlledStream();
    const retry = controlledStream();
    let streamCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse('A', 0));
      }
      streamCalls += 1;
      return Promise.resolve(
        streamCalls === 1 ? truncated.response : retry.response,
      );
    });

    const store = useChatRuntimeStore.getState();
    store.ensureSession('B');
    store.setSessionMessages('B', [{
      id: 'b-message',
      role: 'assistant',
      blocks: [],
    }]);

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('secret partial request'));
    await act(async () => {
      truncated.emit('message_start', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-a', stream_id: 'stream-a' } },
      });
      truncated.emit('content_block_delta', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 2,
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: 'partial answer' } },
      });
      truncated.close();
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.status).not.toBe('done');
    expect(store.getSession('A')?.activeRunId).toBeNull();
    expect(textForRun('A', 'run-a')).toBe('partial answer');
    expect(store.getSession('B')?.messages).toHaveLength(1);

    act(() => void result.current.send('retry request'));
    await waitFor(() => expect(streamCalls).toBe(2));
    expect(store.getSession('A')?.activeRunId).toBe('run-b');
    await act(async () => {
      retry.emit('done', {
        sessionId: 'A', runId: 'run-b', streamId: 'stream-b', seq: 1,
        event: 'done',
        data: {},
      });
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('keeps explicit done as the only successful EOF path', async () => {
    const stream = controlledStream();
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      return Promise.resolve(
        url.endsWith('/history') ? historyResponse('A', 0) : stream.response,
      );
    });
    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('question'));
    await act(async () => {
      stream.emit('message_start', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-a', stream_id: 'stream-a' } },
      });
      stream.emit('done', {
        sessionId: 'A', runId: 'run-a', streamId: 'stream-a', seq: 2,
        event: 'done',
        data: {},
      });
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
  });

  it('reuses clientMessageId after EOF retry while creating a new run and stream', async () => {
    const first = controlledStream();
    const retried = controlledStream();
    const posted: Array<{
      text: string;
      clientMessageId: string;
      runId: string;
    }> = [];
    const debug = vi.spyOn(logger, 'debug');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse('A', 0));
      }
      posted.push(JSON.parse(String(init?.body)));
      return Promise.resolve(posted.length === 1 ? first.response : retried.response);
    });

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('SECRET RETRY TEXT'));
    await waitFor(() => expect(posted).toHaveLength(1));
    await act(async () => {
      first.emit('message_start', {
        sessionId: 'A', runId: posted[0].runId, streamId: 'stream-first', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-first', stream_id: 'stream-first' } },
      });
      first.close();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.retry());
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].clientMessageId).toBe(posted[0].clientMessageId);
    expect(posted[1].runId).not.toBe(posted[0].runId);
    await act(async () => {
      retried.emit('message_start', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'stream-retry', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-retry', stream_id: 'stream-retry' } },
      });
    });
    await waitFor(() =>
      expect(
        useChatRuntimeStore.getState().getRun(posted[1].runId)?.streamId,
      ).toBe('stream-retry'),
    );
    expect(
      useChatRuntimeStore
        .getState()
        .getSession('A')
        ?.messages.find(
          (message) =>
            message.role === 'assistant' && message.runId === posted[1].runId,
        )?.messageId,
    ).toBe('assistant-retry');
    expect(
      useChatRuntimeStore
        .getState()
        .getSession('A')
        ?.messages.find(
          (message) =>
            message.role === 'assistant' && message.runId === posted[0].runId,
        )?.messageId,
    ).toBe('assistant-first');
    expect(
      useChatRuntimeStore.getState().getSession('A')?.retryCandidate,
    ).toMatchObject({
      clientMessageId: posted[0].clientMessageId,
      runId: posted[1].runId,
    });
    expect(
      debug.mock.calls
        .filter(([message]) => message.includes('发送消息'))
        .map((call) => JSON.stringify(call))
        .join(' '),
    ).not.toContain('SECRET RETRY TEXT');
    await act(async () => {
      retried.emit('done', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'stream-retry', seq: 2,
        event: 'done',
        data: {},
      });
    });
  });

  it('converges direct deduplicated done without ghost messages when history refetch fails', async () => {
    const ids = [
      'client-a', 'run-a', 'client-current-bug', 'run-retry',
      'client-new', 'run-new',
    ];
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => ids.shift()) });
    const first = controlledStream();
    const deduplicated = controlledStream();
    const next = controlledStream();
    const posted: Array<{ clientMessageId: string; runId: string }> = [];
    let historyCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        historyCalls += 1;
        return historyCalls === 1
          ? Promise.resolve(historyResponse('A', 0))
          : Promise.reject(new Error('history unavailable'));
      }
      posted.push(JSON.parse(String(init?.body)));
      return Promise.resolve(
        [first.response, deduplicated.response, next.response][posted.length - 1],
      );
    });

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('original'));
    await waitFor(() => expect(posted).toHaveLength(1));
    await act(async () => {
      first.emit('message_start', {
        sessionId: 'A', runId: posted[0].runId, streamId: 'first', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-real', stream_id: 'first' } },
      });
      first.emit('content_block_delta', {
        sessionId: 'A', runId: posted[0].runId, streamId: 'first', seq: 2,
        event: 'content_block_delta',
        data: { delta: { type: 'text_delta', text: 'known answer' } },
      });
      first.close();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    const before = useChatRuntimeStore.getState().getSession('A')?.messages ?? [];
    expect(before.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(before.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(textForRun('A', posted[0].runId)).toBe('known answer');

    act(() => result.current.retry());
    await waitFor(() => expect(posted).toHaveLength(2));
    await act(async () => {
      deduplicated.emit('done', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'dedup', seq: 1,
        event: 'done',
        data: {
          ok: true,
          deduplicated: true,
          messageId: 'assistant-real',
          persistedRevision: 2,
        },
      });
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    const after = useChatRuntimeStore.getState().getSession('A');
    expect(after?.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(after?.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(after?.messages.find((message) => message.messageId === 'assistant-real'))
      .toMatchObject({ blocks: expect.any(Array) });
    expect(textForRun('A', posted[0].runId)).toBe('known answer');
    expect(after?.activeRunId).toBeNull();
    expect(after?.pendingPersistence[posted[1].runId]).toBeUndefined();
    expect(useChatRuntimeStore.getState().getRun(posted[1].runId)).toBeUndefined();

    act(() => void result.current.send('new question'));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2].clientMessageId).not.toBe(posted[0].clientMessageId);
    act(() => result.current.abort());
  });

  it('removes an empty retry placeholder when deduplicated done follows message_start', async () => {
    const first = controlledStream();
    const deduplicated = controlledStream();
    const posted: Array<{ clientMessageId: string; runId: string }> = [];
    let historyCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        historyCalls += 1;
        return historyCalls === 1
          ? Promise.resolve(historyResponse('A', 0))
          : Promise.reject(new Error('history unavailable'));
      }
      posted.push(JSON.parse(String(init?.body)));
      return Promise.resolve(posted.length === 1 ? first.response : deduplicated.response);
    });
    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('original'));
    await waitFor(() => expect(posted).toHaveLength(1));
    await act(async () => {
      first.emit('message_start', {
        sessionId: 'A', runId: posted[0].runId, streamId: 'first', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-real', stream_id: 'first' } },
      });
      first.close();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.retry());
    await waitFor(() => expect(posted).toHaveLength(2));
    await act(async () => {
      deduplicated.emit('message_start', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'dedup', seq: 1,
        event: 'message_start',
        data: { message: { id: 'assistant-real', stream_id: 'dedup' } },
      });
    });
    expect(
      useChatRuntimeStore
        .getState()
        .getSession('A')
        ?.messages.filter((message) => message.role === 'assistant'),
    ).toHaveLength(2);

    await act(async () => {
      deduplicated.emit('done', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'dedup', seq: 2,
        event: 'done',
        data: {
          ok: true,
          deduplicated: true,
          messageId: 'assistant-real',
          persistedRevision: 2,
        },
      });
    });
    await waitFor(() => expect(result.current.status).toBe('done'));
    const messages = useChatRuntimeStore.getState().getSession('A')?.messages ?? [];
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(messages[1]?.messageId).toBe('assistant-real');
  });

  it('creates a fresh clientMessageId for a normal send after success', async () => {
    const first = controlledStream();
    const second = controlledStream();
    const posted: Array<{ clientMessageId: string; runId: string }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse('A', 0));
      }
      posted.push(JSON.parse(String(init?.body)));
      return Promise.resolve(posted.length === 1 ? first.response : second.response);
    });
    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('first'));
    await waitFor(() => expect(posted).toHaveLength(1));
    await act(async () => {
      first.emit('done', {
        sessionId: 'A', runId: posted[0].runId, streamId: 'first', seq: 1,
        event: 'done',
        data: {},
      });
    });
    await waitFor(() => expect(result.current.status).toBe('done'));

    act(() => void result.current.send('second'));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].clientMessageId).not.toBe(posted[0].clientMessageId);
    expect(posted[1].runId).not.toBe(posted[0].runId);
    expect(
      useChatRuntimeStore.getState().getSession('A')?.retryCandidate,
    ).toMatchObject({
      clientMessageId: posted[1].clientMessageId,
      runId: posted[1].runId,
    });
    await act(async () => {
      second.emit('done', {
        sessionId: 'A', runId: posted[1].runId, streamId: 'second', seq: 1,
        event: 'done',
        data: {},
      });
    });
  });

  it('keeps retry identity isolated between A and B sessions', async () => {
    const ids = [
      'client-a', 'run-a', 'client-b', 'run-b',
      'client-a-current-bug', 'run-a-retry',
      'client-b-current-bug', 'run-b-retry',
    ];
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => ids.shift()),
    });
    const streams = {
      A: [controlledStream(), controlledStream()],
      B: [controlledStream(), controlledStream()],
    };
    const posted: Record<
      'A' | 'B',
      Array<{ clientMessageId: string; runId: string; model?: string }>
    > = {
      A: [],
      B: [],
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const session: 'A' | 'B' = url.includes('/A/') ? 'A' : 'B';
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse(session, 0));
      }
      posted[session].push(JSON.parse(String(init?.body)));
      return Promise.resolve(streams[session][posted[session].length - 1].response);
    });

    const hookA = renderHook(() => useChatStream('A'));
    const hookB = renderHook(() => useChatStream('B'));
    await waitFor(() => {
      expect(hookA.result.current.historyLoaded).toBe(true);
      expect(hookB.result.current.historyLoaded).toBe(true);
    });
    act(() => void hookA.result.current.send('A secret', { model: 'model-a' }));
    act(() => void hookB.result.current.send('B secret', { model: 'model-b' }));
    await waitFor(() => {
      expect(posted.A).toHaveLength(1);
      expect(posted.B).toHaveLength(1);
    });
    await act(async () => {
      streams.A[0].close();
      streams.B[0].close();
    });
    await waitFor(() => {
      expect(hookA.result.current.status).toBe('error');
      expect(hookB.result.current.status).toBe('error');
    });

    act(() => hookA.result.current.retry());
    act(() => hookB.result.current.retry());
    await waitFor(() => {
      expect(posted.A).toHaveLength(2);
      expect(posted.B).toHaveLength(2);
    });
    expect(posted.A[1].clientMessageId).toBe(posted.A[0].clientMessageId);
    expect(posted.B[1].clientMessageId).toBe(posted.B[0].clientMessageId);
    expect(posted.A[1].clientMessageId).not.toBe(posted.B[1].clientMessageId);
    expect(posted.A[1].runId).not.toBe(posted.A[0].runId);
    expect(posted.B[1].runId).not.toBe(posted.B[0].runId);
    expect(posted.A[1].model).toBe('model-a');
    expect(posted.B[1].model).toBe('model-b');
    await act(async () => {
      streams.A[1].emit('done', {
        sessionId: 'A', runId: posted.A[1].runId, streamId: 'A-retry', seq: 1,
        event: 'done',
        data: {},
      });
      streams.B[1].emit('done', {
        sessionId: 'B', runId: posted.B[1].runId, streamId: 'B-retry', seq: 1,
        event: 'done',
        data: {},
      });
    });
  });

  it('logs send metadata without user text', async () => {
    const debug = vi.spyOn(logger, 'debug');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse('A', 0));
      }
      return new Promise<Response>(() => {});
    });
    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => void result.current.send('TOP SECRET BODY'));

    const sendCall = debug.mock.calls.find(([message]) =>
      message.includes('发送消息'),
    );
    expect(sendCall).toBeDefined();
    expect(sendCall?.[1]).toMatchObject({
      textLength: 15,
      sessionId: 'A',
      runId: 'run-a',
    });
    expect(JSON.stringify(sendCall)).not.toContain('TOP SECRET BODY');
  });
});
