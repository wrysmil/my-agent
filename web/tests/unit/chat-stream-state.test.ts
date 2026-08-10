import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  messageText,
  useChatStream,
} from '../../src/features/chat/useChatStream';
import { useChatRuntimeStore } from '../../src/features/chat/chatRuntimeStore';

function makeMockStream(frames: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c: ReadableStreamDefaultController) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function makeOpenMockStream(frames: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c: ReadableStreamDefaultController) {
      for (const f of frames) c.enqueue(enc.encode(f));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function makeControlledStream() {
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
    emit(event: string, envelope: Record<string, unknown>) {
      controller.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`),
      );
    },
  };
}

describe('useChatStream state machine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatRuntimeStore.setState({
      sessions: {},
      runs: {},
      _accessOrder: [],
    });
  });

  it('initial status is idle, messages is empty', () => {
    const { result } = renderHook(() => useChatStream('test-cid'));
    expect(result.current.status).toBe('idle');
    expect(result.current.messages).toEqual([]);
  });

  it('idle → submitting → streaming → done on explicit done', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));
    expect(result.current.status).toBe('idle');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      makeMockStream([
        'event: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
        'event: content_block_delta\ndata: {"seq":2,"delta":{"type":"text_delta","text":"hi"}}\n\n',
        'event: message_stop\ndata: {"seq":3}\n\n',
        'event: done\ndata: {"seq":4}\n\n',
      ])
    );

    await act(async () => {
      await result.current.send('hello');
    });

    expect(result.current.status).toBe('done');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      text: 'hello',
    });
    expect(result.current.messages[1].role).toBe('assistant');
    expect(messageText(result.current.messages[1])).toBe('hi');
  });

  it('abort() stops the active run and clears its session ownership', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      makeOpenMockStream([
        'event: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
        'event: content_block_delta\ndata: {"seq":2,"delta":{"type":"text_delta","text":"x"}}\n\n',
      ])
    );

    act(() => {
      void result.current.send('x');
    });

    await waitFor(() => expect(result.current.status).toBe('streaming'));
    const runId = useChatRuntimeStore.getState().getSession('test-cid')?.activeRunId;
    expect(runId).toBeTruthy();

    act(() => {
      result.current.abort();
    });

    expect(result.current.status).toBe('aborted');
    expect(useChatRuntimeStore.getState().getSession('test-cid')?.activeRunId).toBeNull();
    expect(useChatRuntimeStore.getState().getRun(runId!)?.abortController).toBeNull();
  });

  it('transitions to error on HTTP failure', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 500 })
    );

    await act(async () => {
      await result.current.send('hello');
    });

    expect(result.current.status).toBe('error');
  });

  it('does not send when already submitting', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));

    // Make fetch hang so we stay in submitting
    vi.spyOn(global, 'fetch').mockImplementationOnce(
      () => new Promise(() => {}) // never resolves
    );

    // Start first send (will hang in submitting)
    act(() => {
      result.current.send('first');
    });

    expect(result.current.status).toBe('submitting');

    // Second send should be a no-op
    await act(async () => {
      await result.current.send('second');
    });

    // Should only have the first user message
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].text).toBe('first');
  });

  // ============================================================
  // 回归：从 /chat/:id 切到 /chat（点 Sidebar ➕ 号）应该立刻清空视图
  // ============================================================
  describe('sessionId 变化时的视图重置', () => {
    it('rerender with empty sessionId clears messages even if previous session had history', async () => {
      // 1) 先给一个 session 挂上历史，模拟「在历史会话中」
      vi.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { messages: [
            { role: 'user', content: [{ type: 'text', text: '之前的问题' }] },
            { role: 'assistant', content: [{ type: 'text', text: '之前的回答' }] },
          ] } }),
          { status: 200 },
        ),
      );

      const { result, rerender } = renderHook(
        ({ cid }: { cid: string }) => useChatStream(cid),
        { initialProps: { cid: 'gconv-existing' } },
      );

      // 等历史加载完
      await waitFor(() => {
        expect(result.current.historyLoaded).toBe(true);
      });
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].text).toBe('之前的问题');

      // 2) 关键场景：把 sessionId 清空（= 点 Sidebar ➕ 号 → /chat）
      // 不应该再 fetch 任何东西（已经被 if (!sessionId) return 短路）
      // 而且 messages 应该被清空
      rerender({ cid: '' });

      await waitFor(() => {
        expect(result.current.messages).toEqual([]);
      });
      expect(result.current.historyLoaded).toBe(false);
      expect(result.current.status).toBe('idle');
    });

    it('rerender with another non-empty sessionId clears previous messages before reloading', async () => {
      vi.spyOn(global, 'fetch')
        // 第一次：a 的历史
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, data: { messages: [
              { role: 'user', content: [{ type: 'text', text: 'a-q' }] },
            ] } }),
            { status: 200 },
          ),
        )
        // 第二次：b 的历史
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ ok: true, data: { messages: [
              { role: 'user', content: [{ type: 'text', text: 'b-q' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'b-a' }] },
            ] } }),
            { status: 200 },
          ),
        );

      const { result, rerender } = renderHook(
        ({ cid }: { cid: string }) => useChatStream(cid),
        { initialProps: { cid: 'a' } },
      );

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1);
        expect(result.current.messages[0].text).toBe('a-q');
      });

      // 切到 b
      rerender({ cid: 'b' });

      // 关键：切到 b 的瞬间，a 的消息必须被清空（不能同时显示 a 和 b）
      // 即使 b 的历史还没回来，视图也得是空白
      await waitFor(() => {
        const texts = result.current.messages.map((m) => m.text);
        expect(texts).not.toContain('a-q');
      });

      // 等 b 的历史回来
      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
        expect(result.current.messages[0].text).toBe('b-q');
        // assistant 消息的文本从 blocks 里取（message-level .text 不用于 assistant）
        const assistantBlocks = result.current.messages[1].blocks;
        const firstTextBlock = assistantBlocks.find(
          (b): b is import('@/features/chat/types').TextBlock => b.type === 'text',
        );
        expect(firstTextBlock?.text).toBe('b-a');
      });
    });
  });

  // ============================================================
  // 回归：abort() 后 UI 应该解禁（stop button 卡死 bug）
  // ============================================================
  describe('abort() 后 UI 不应再被 Composer 视为「streaming 中」', () => {
    it('abort() 后 status 必须脱离 submitting/streaming/reconnecting，否则 Composer textarea 永久 disabled', async () => {
      // 模拟「streaming 中点停止」的最少状态机：
      //   1. 第一次 send 让 status 进 submitting
      //   2. 立刻 abort → status 必须是 'aborted'
      //   3. 关键断言：status 不再落在 submitting/streaming/reconnecting 中，
      //      否则 Composer 的 isStreaming=true → textarea 永久 disabled
      //      （用户报告的「点停止后卡死」就是这条路径）。
      vi.spyOn(global, 'fetch').mockImplementationOnce(() => new Promise(() => {}));

      const { result } = renderHook(() => useChatStream('test-cid'));

      // 触发 send（fire-and-forget，因为 fetch 永远不 resolve）
      act(() => {
        result.current.send('first');
      });
      // send 后 status 应该至少在 submitting 或 streaming（这里因 fetch 挂起 → submitting）
      expect(['submitting', 'streaming']).toContain(result.current.status);

      // 关键：点"停止" → abort
      act(() => {
        result.current.abort();
      });

      // ⭐ 核心断言（用户报告的 bug 修复点）
      expect(result.current.status).toBe('aborted');
      expect(['submitting', 'streaming', 'reconnecting']).not.toContain(result.current.status);
    });

    it('abort 后第二次 run 消费独立 stream，且第一 run 晚到终态不覆盖它', async () => {
      const first = makeControlledStream();
      const second = makeControlledStream();
      const postedRuns: string[] = [];
      vi.spyOn(global, 'fetch').mockImplementation((input, init) => {
        const url = String(input);
        if (url.endsWith('/history')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                data: { sessionId: 'test-cid', revision: 0, messages: [] },
              }),
              { status: 200 },
            ),
          );
        }
        const body = JSON.parse(String(init?.body)) as { runId: string };
        postedRuns.push(body.runId);
        return Promise.resolve(
          postedRuns.length === 1 ? first.response : second.response,
        );
      });

      const { result } = renderHook(() => useChatStream('test-cid'));
      await waitFor(() => expect(result.current.historyLoaded).toBe(true));

      act(() => void result.current.send('first'));
      await waitFor(() => expect(postedRuns).toHaveLength(1));
      await act(async () => {
        first.emit('message_start', {
          sessionId: 'test-cid', runId: postedRuns[0], streamId: 'first', seq: 1,
          event: 'message_start',
          data: { message: { id: 'assistant-first', stream_id: 'first' } },
        });
      });
      await waitFor(() => expect(result.current.status).toBe('streaming'));
      act(() => { result.current.abort(); });
      expect(result.current.status).toBe('aborted');

      act(() => void result.current.send('second'));
      await waitFor(() => expect(postedRuns).toHaveLength(2));
      await act(async () => {
        second.emit('message_start', {
          sessionId: 'test-cid', runId: postedRuns[1], streamId: 'second', seq: 1,
          event: 'message_start',
          data: { message: { id: 'assistant-second', stream_id: 'second' } },
        });
        second.emit('content_block_delta', {
          sessionId: 'test-cid', runId: postedRuns[1], streamId: 'second', seq: 2,
          event: 'content_block_delta',
          data: { delta: { type: 'text_delta', text: 'second reply' } },
        });
        second.emit('done', {
          sessionId: 'test-cid', runId: postedRuns[1], streamId: 'second', seq: 3,
          event: 'done',
          data: {},
        });
      });
      await waitFor(() => expect(result.current.status).toBe('done'));
      expect(
        result.current.messages
          .filter((message) => message.runId === postedRuns[1])
          .map(messageText)
          .join(' '),
      ).toContain('second reply');

      await act(async () => {
        first.emit('error', {
          sessionId: 'test-cid', runId: postedRuns[0], streamId: 'first', seq: 2,
          event: 'error',
          data: { error: { message: 'late first error' } },
        });
      });
      expect(result.current.status).toBe('done');
    });
  });
});
