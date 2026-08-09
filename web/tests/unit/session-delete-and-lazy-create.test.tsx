import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../../src/components/layout/AppShell';
import { ChatPage } from '../../src/pages/ChatPage';

// ============================================================
// 全局 mocks
// ============================================================

vi.mock('lucide-react', () => ({
  Sparkles: () => <span data-testid="icon-spark">sp</span>,
  Brain: () => <span data-testid="icon-brain">br</span>,
  ChevronDown: () => <span data-testid="icon-cd">cd</span>,
  RefreshCw: () => <span data-testid="icon-refresh">rf</span>,
  Plus: () => <span data-testid="icon-plus">+</span>,
  Trash2: () => <span data-testid="icon-trash">del</span>,
  Send: () => <span data-testid="icon-send">send</span>,
  Square: () => <span data-testid="icon-square">sq</span>,
  MessageSquare: () => <span>msg</span>,
  Bot: () => <span>bot</span>,
  Plug: () => <span>plug</span>,
  Settings2: () => <span>set</span>,
  SlidersHorizontal: () => <span>slid</span>,
  LayoutDashboard: () => <span>dash</span>,
  Loader2: () => <span>load</span>,
  Wrench: () => <span>wrench</span>,
  Sun: () => <span>sun</span>,
  Moon: () => <span>moon</span>,
  Languages: () => <span>lang</span>,
  Command: () => <span>cmd</span>,
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'zh',
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* jsdom 不支持时忽略 */
  }
});

// ============================================================
// ChatPage — 懒创建会话
// ============================================================

describe('ChatPage — 会话懒创建（首条消息触发）', () => {
  it('访问 /chat 时不应自动 POST /api/sessions', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('test-fail')),
    );
    render(<ChatPage />, { wrapper });

    await new Promise((r) => setTimeout(r, 50));

    const createCalls = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/api/sessions') &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
    );
    expect(createCalls.length).toBe(0);
  });

  it('首条消息触发 POST /api/sessions（带 kind）', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    // 1) POST /api/sessions → 返回新 id
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, data: { session: { id: 'gconv-newlycreated', kind: 'gconv' } } }),
        { status: 201 },
      ),
    );
    // 2) GET /api/sessions/:id/history → 空
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, data: { messages: [] } }),
        { status: 200 },
      ),
    );
    // 3) GET /api/sessions（侧边栏 refresh）→ 空
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, data: { sessions: [], total: 0, limit: 50, offset: 0 } }),
        { status: 200 },
      ),
    );
    // 4) POST messages/stream —— 这次允许 fail（test 不想真起 SSE）
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('test-stream-fail')));

    render(<ChatPage />, { wrapper });

    const textarea = await screen.findByPlaceholderText(/输入消息/);
    await userEvent.type(textarea, '你好');
    await userEvent.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => {
      const createCalls = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/sessions') &&
          ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
      );
      expect(createCalls.length).toBe(1);
    });
  });
});

// ============================================================
// Sidebar — 删除按钮
// ============================================================

describe('Sidebar — 会话删除按钮', () => {
  it('点击删除（已 confirm）→ 调用 DELETE /api/sessions/:id', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    // 1) GET /api/sessions → 返回 1 条
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 'gconv-deleteme', name: '可删除', messageCount: 2, lastTs: 100, archived: false },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 },
      ),
    );
    // 2) GET /api/providers/active
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }),
    );
    // 3) DELETE /api/sessions/gconv-deleteme → 204
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // 4) invalidate 后的 GET /api/sessions
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, data: { sessions: [], total: 0, limit: 50, offset: 0 } }),
        { status: 200 },
      ),
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AppShell />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/chat/gconv-deleteme']}>
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      ),
    });

    await screen.findByText('可删除');
    const delBtn = await screen.findByTestId('delete-session-gconv-deleteme');
    await userEvent.click(delBtn);

    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/sessions/gconv-deleteme') &&
          ((init as RequestInit | undefined)?.method ?? 'GET') === 'DELETE',
      );
      expect(deleteCalls.length).toBe(1);
    });
  });

  it('未 confirm 时不应触发删除请求', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            sessions: [
              { id: 'gconv-keep', name: '保留', messageCount: 1, lastTs: 100, archived: false },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        }),
        { status: 200 },
      ),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: null }), { status: 200 }),
    );

    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AppShell />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });

    await screen.findByText('保留');
    const delBtn = await screen.findByTestId('delete-session-gconv-keep');
    await userEvent.click(delBtn);

    await new Promise((r) => setTimeout(r, 50));
    const deleteCalls = fetchSpy.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/api/sessions/gconv-keep') &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'DELETE',
    );
    expect(deleteCalls.length).toBe(0);
  });
});
