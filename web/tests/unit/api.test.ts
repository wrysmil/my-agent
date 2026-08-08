import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { apiGet, apiPost } from '../../src/lib/api';

describe('api', () => {
  it('GET /api/sessions returns sessions', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    );
    const res = await apiGet('/api/sessions?limit=10');
    expect(res).toEqual({ sessions: [] });
  });
  it('throws ApiError on 4xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'SESSION_NOT_FOUND', message: 'x' }), { status: 404 })
    );
    await expect(apiGet('/api/sessions/abc/history')).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND', status: 404 });
  });
  it('POST /api/sessions/:id/messages/abort with body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(null, { status: 200 }));
    await apiPost('/api/sessions/x/messages/abort', { streamId: 'y' });
    expect(fetch).toHaveBeenCalledWith('/api/sessions/x/messages/abort', expect.objectContaining({ method: 'POST' }));
  });
});

// Task 3: useChatStream history reload tests
// We need to dynamically import useChatStream to avoid hoisting issues with mocks
describe('useChatStream history reload on sessionId change', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should reset historyLoaded and reload when sessionId changes', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    // Mock history API for session-1
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [] }), { status: 200 })
    );

    const { useChatStream } = await import('../../src/features/chat/useChatStream');

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useChatStream(sessionId),
      { initialProps: { sessionId: 'session-1' } }
    );

    // Wait for initial history load
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));

    // Mock history API for session-2
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ messages: [] }), { status: 200 })
    );

    // Switch to new session
    rerender({ sessionId: 'session-2' });

    // Should reload history for new session
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sessions/session-2/history',
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });
});
