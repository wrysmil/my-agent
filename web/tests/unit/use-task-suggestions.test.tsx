/**
 * useTaskSuggestions hook 三场景：远程成功 / 失败回落 / 5s 超时回落。
 * 来源：plan § Step 1.4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTaskSuggestions } from '../../src/features/dashboard/useTaskSuggestions';
import { TASK_SUGGESTIONS, type TaskSuggestion } from '../../src/features/dashboard/taskSuggestions';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useTaskSuggestions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('远程成功 → 返回 remote 数据', async () => {
    const remoteData: TaskSuggestion[] = [
      {
        id: 'remote1',
        category: 'research',
        titleKey: 'remote1.title',
        descriptionKey: 'remote1.description',
        deliverableKey: 'remote1.deliverable',
        prompt: 'remote prompt',
        iconName: 'Search',
      },
    ];
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ suggestions: remoteData }), { status: 200 }),
    );
    const { result } = renderHook(() => useTaskSuggestions(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.source).toBe('remote');
    });
    expect(result.current.suggestions).toEqual(remoteData);
    expect(result.current.suggestions).toHaveLength(1);
  });

  it('远程失败（HTTP 500）→ 回落常量，source=fallback', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );
    const { result } = renderHook(() => useTaskSuggestions(), { wrapper: makeWrapper() });
    // query 失败时 React Query 不会自动 throw，需要等稳定
    await waitFor(() => {
      expect(result.current.source).toBe('fallback');
    });
    expect(result.current.suggestions).toBe(TASK_SUGGESTIONS);
    expect(result.current.suggestions).toHaveLength(8);
  });

  it('远程失败（fetch reject）→ 回落常量', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useTaskSuggestions(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.source).toBe('fallback');
    });
    expect(result.current.suggestions).toBe(TASK_SUGGESTIONS);
  });

  it('远程返回非数组 suggestions → 回落常量', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ suggestions: 'oops' }), { status: 200 }),
    );
    const { result } = renderHook(() => useTaskSuggestions(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.source).toBe('fallback');
    });
    expect(result.current.suggestions).toBe(TASK_SUGGESTIONS);
  });

  it('未发起任何 fetch 时（首次同步渲染）→ 同步回落常量', () => {
    // fetch mock 设置为永不解析
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useTaskSuggestions(), { wrapper: makeWrapper() });
    // 同步阶段 source 必为 fallback
    expect(result.current.source).toBe('fallback');
    expect(result.current.suggestions).toBe(TASK_SUGGESTIONS);
  });

  it('常量数组 8 条不变', () => {
    expect(TASK_SUGGESTIONS).toHaveLength(8);
    expect(TASK_SUGGESTIONS.map((t) => t.id)).toEqual([
      'research',
      'video',
      'image',
      'design',
      'office',
      'writing',
      'development',
      'growth',
    ]);
  });
});