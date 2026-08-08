/**
 * my-agent Web 前端 — ToolsPage 页面组件测试。
 *
 * 来源：spec 2026-08-08-tools-management-page-spec § 5。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToolsPage } from '../../src/pages/ToolsPage';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function jsonText(data: unknown) {
  return () => Promise.resolve(JSON.stringify(data));
}

const mockTools = [
  { name: 'read_file', description: 'Read file contents', executionMode: 'sequential' },
  { name: 'bash', description: 'Execute shell commands', executionMode: 'sequential' },
  { name: 'web_fetch', description: 'Fetch web page content' },
];

const toolDetail = {
  name: 'read_file',
  description: 'Read file contents with offset/limit support',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Path to file' },
      offset: { type: 'number', description: 'Start line number' },
    },
    required: ['filePath'],
  },
  executionMode: 'sequential',
};

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

beforeEach(() => { mockFetch.mockReset(); });

describe('ToolsPage', () => {
  it('渲染 Loading 骨架屏', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // 永远 pending
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    expect(screen.getByTestId('tools-loading')).toBeDefined();
  });

  it('成功加载后渲染工具卡片列表', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tools: mockTools } }),
    });
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    await waitFor(() => {
      expect(screen.getByText('read_file')).toBeDefined();
      expect(screen.getByText('bash')).toBeDefined();
      expect(screen.getByText('web_fetch')).toBeDefined();
    });
    expect(screen.getByText('Read file contents')).toBeDefined();
  });

  it('API 错误时渲染 ErrorState + 重试按钮', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'server error' } }),
    });
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId('tools-error')).toBeDefined();
    });
    expect(screen.getByText('重试')).toBeDefined();
  });

  it('空列表时渲染 EmptyState', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tools: [] } }),
    });
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    await waitFor(() => {
      expect(screen.getByTestId('tools-empty')).toBeDefined();
    });
  });

  it('点击卡片打开 DetailPanel 展示 inputSchema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tools: mockTools } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tool: toolDetail } }),
    });
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    await waitFor(() => expect(screen.getByText('read_file')).toBeDefined());

    fireEvent.click(screen.getByText('read_file'));

    await waitFor(() => {
      expect(screen.getByText('Read file contents with offset/limit support')).toBeDefined();
    });
    // inputSchema 以 JSON 形式展示
    expect(screen.getByText(/"filePath"/)).toBeDefined();
  });

  it('DetailPanel 点击遮罩关闭弹窗', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tools: mockTools } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: jsonText({ ok: true, data: { tool: toolDetail } }),
    });
    const Wrapper = createWrapper();
    render(
      React.createElement(Wrapper, null,
        React.createElement(MemoryRouter, null,
          React.createElement(ToolsPage, null)
        )
      )
    );
    await waitFor(() => expect(screen.getByText('read_file')).toBeDefined());
    fireEvent.click(screen.getByText('read_file'));
    await waitFor(() => expect(screen.getByText(/"filePath"/)).toBeDefined());

    // 点击遮罩关闭
    const overlay = document.querySelector('.fixed.inset-0.z-50');
    if (overlay) fireEvent.click(overlay);

    // Detail 内容应该消失
    await waitFor(() => {
      expect(screen.queryByText('Read file contents with offset/limit support')).toBeNull();
    });
  });
});
