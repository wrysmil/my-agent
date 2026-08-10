import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatStream } from '../../src/features/chat/useChatStream';

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

describe('useChatStream state machine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initial status is idle, messages is empty', () => {
    const { result } = renderHook(() => useChatStream('test-cid'));
    expect(result.current.status).toBe('idle');
    expect(result.current.messages).toEqual([]);
  });

  it('idle → submitting → streaming → done on message_stop', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));
    expect(result.current.status).toBe('idle');

    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      makeMockStream([
        'event: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
        'event: content_block_delta\ndata: {"seq":2,"delta":{"text":"hi"}}\n\n',
        'event: message_stop\ndata: {"seq":3}\n\n',
      ])
    );

    await act(async () => {
      await result.current.send('hello');
    });

    expect(result.current.status).toBe('done');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toEqual({ role: 'user', text: 'hello' });
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.messages[1].text).toBe('hi');
  });

  it('abort() sends POST to abort endpoint', async () => {
    const { result } = renderHook(() => useChatStream('test-cid'));

    // Stream without message_stop so send stays in 'streaming' after consumption
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      makeMockStream([
        'event: message_start\ndata: {"streamId":"abc","cid":"c","seq":1}\n\n',
        'event: content_block_delta\ndata: {"seq":2,"delta":{"text":"x"}}\n\n',
      ])
    );

    // Start send — stream will be fully consumed, status becomes 'streaming'
    await act(async () => {
      await result.current.send('x');
    });

    expect(result.current.status).toBe('streaming');

    // Now abort while in streaming state (streamId is already set)
    await act(async () => {
      await result.current.abort();
    });

    expect(result.current.status).toBe('aborted');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sessions/test-cid/messages/abort',
      expect.objectContaining({ method: 'POST' })
    );
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

    it('abort 后第二次 send 必须能起新 fetch（避免 controllerRef 悬挂导致新请求被瞬 abort）', async () => {
      // 这条聚焦 controller 清理：修复前的 bug 是 abort 没把 controllerRef 清 null，
      // 下一次 send 会复用已被 abort 的旧 AbortController，fetch 立刻 reject AbortError。
      // 用「只看 messages/stream 调用的次数」来隔离 history fetch 的干扰。
      const fetchSpy = vi.spyOn(global, 'fetch')
        // mount → GET history（无论内容）
        .mockResolvedValue(
          new Response(JSON.stringify({ ok: true, data: { messages: [] } }), { status: 200 }),
        );

      const { result } = renderHook(() => useChatStream('test-cid'));
      // 等 history 加载好
      await waitFor(() => expect(result.current.historyLoaded).toBe(true));

      const streamCallCount = () =>
        fetchSpy.mock.calls.filter(
          ([url, init]) =>
            String(url).endsWith('/messages/stream') &&
            ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
        ).length;

      act(() => { result.current.send('first'); });
      expect(streamCallCount()).toBe(1);

      // 中止
      act(() => { result.current.abort(); });
      expect(result.current.status).toBe('aborted');

      // 立刻再次发送：必须能跑出第二次 stream fetch（且不被 statusRef guard 阻断）
      act(() => { result.current.send('second'); });
      expect(streamCallCount()).toBe(2);
      // 第二次 send 走到 submitting 阶段（fetch 永远不 resolve）
      expect(['submitting', 'streaming']).toContain(result.current.status);
    });
  });
});
