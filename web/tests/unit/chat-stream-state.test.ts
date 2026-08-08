import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
});
