import { describe, it, expect, vi } from 'vitest';
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
