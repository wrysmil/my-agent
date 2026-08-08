/**
 * my-agent Web 前端 — useTools / useToolDetail hook 测试。
 *
 * 来源：spec 2026-08-08-tools-management-page-spec § 5。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTools, useToolDetail } from '../../src/features/tools/useTools';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonText(data: unknown) {
  return () => Promise.resolve(JSON.stringify(data));
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => { mockFetch.mockReset(); });
afterEach(() => { mockFetch.mockReset(); });

describe('useTools', () => {
  it('成功时返回工具摘要列表', async () => {
    const mockTools = [
      { name: 'read_file', description: 'Read file', executionMode: 'sequential' },
      { name: 'bash', description: 'Run shell', executionMode: 'sequential' },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tools: mockTools } }),
    });

    const { result } = renderHook(() => useTools(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data![0].name).toBe('read_file');
    expect(result.current.data![0]).not.toHaveProperty('inputSchema');
  });

  it('API 错误时 isError 为 true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'fail' } }),
    });

    const { result } = renderHook(() => useTools(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('网络错误时 isError 为 true', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useTools(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useToolDetail', () => {
  it('enabled=false 时不发起请求', () => {
    renderHook(() => useToolDetail('read_file', false), { wrapper });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('成功时返回完整工具信息含 inputSchema', async () => {
    const toolDetail = {
      name: 'read_file',
      description: 'Read file content',
      inputSchema: { type: 'object', properties: { filePath: { type: 'string' } } },
      executionMode: 'sequential',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tool: toolDetail } }),
    });

    const { result } = renderHook(() => useToolDetail('read_file', true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(toolDetail);
    expect(result.current.data!.inputSchema).toBeDefined();
  });
});
