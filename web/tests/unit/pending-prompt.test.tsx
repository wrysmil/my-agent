/**
 * pending-message → Composer 填 textarea 流程单测。
 *
 * 来源：plan § Step 4.2
 *
 * 覆盖：
 *   - setPendingMessage / takePendingMessage 基本契约
 *   - ChatPage mount 后消费 pending → 填入 Composer textarea（**不自动发送**）
 *   - 「dashboard 任务卡跳转」走 '__dashboard__' 通道
 *   - 没有任何 pending 时 textarea 为空
 *   - 消费后 → 第二次 takePendingMessage 返回 undefined（单次消费）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  setPendingMessage,
  takePendingMessage,
} from '../../src/features/chat/pending-message';
import { ChatPage, getGreetingKey } from '../../src/pages/ChatPage';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'zh',
  }),
}));

// 把 lucide-react 简单化，避免一堆图标导入导致 network/disk overhead
vi.mock('lucide-react', () => ({
  ChevronDown: () => null,
  RefreshCw: () => null,
  Sparkles: () => null,
  Brain: () => null,
  Plus: () => null,
  Upload: () => null,
  ClipboardPaste: () => null,
  Link2: () => null,
  FileText: () => null,
  Image: () => null,
  AlertCircle: () => null,
  X: () => null,
  Send: () => null,
  Square: () => null,
  ArrowUpRight: () => null,
  ArrowRight: () => null,
  MessageSquare: () => null,
  Bot: () => null,
  Blocks: () => null,
  Plug: () => null,
  Loader2: () => null,
  // TaskSuggestionCard 用到的图标（import * as Icons 动态索引）
  Search: () => null,
  Video: () => null,
  Palette: () => null,
  FileSpreadsheet: () => null,
  PenLine: () => null,
  Code: () => null,
  TrendingUp: () => null,
}));

function wrapperWith({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/chat']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // 关键：mock fetch 拒绝，避免 useChatStream 触发 setInterval 重连导致 hang
  vi.spyOn(global, 'fetch').mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/history')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { messages: [] } }), { status: 200 }),
      );
    }
    if (u.includes('/api/models') || u.includes('/api/providers/active')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { models: [], providers: [] } }), {
          status: 200,
        }),
      );
    }
    if (u.includes('/api/agents')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { agents: [] } }), { status: 200 }),
      );
    }
    return Promise.reject(new Error('test-fail'));
  });
  try { localStorage.clear(); } catch { /* ignore */ }
  // 清理 pending map
  takePendingMessage('__dashboard__');
});

describe('ChatPage 空白页动态问候语', () => {
  it.each([
    [0, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('%i 时使用 %s 问候语', (hour, expected) => {
    expect(getGreetingKey(hour)).toBe(expected);
  });

  it('根据浏览器本地小时渲染对应问候语', () => {
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14);

    render(<ChatPage />, { wrapper: wrapperWith });

    expect(screen.getByTestId('chat-empty-greeting')).toHaveTextContent(
      'dashboard.greeting.afternoon',
    );
  });
});

describe('pending-message 模块', () => {
  it('setPendingMessage + takePendingMessage 双向：单次消费', () => {
    setPendingMessage('sess-1', 'hello');
    expect(takePendingMessage('sess-1')?.text).toBe('hello');
    expect(takePendingMessage('sess-1')).toBeUndefined();
  });

  it('不同 sessionId 互不干扰', () => {
    setPendingMessage('a', 'A');
    setPendingMessage('b', 'B');
    expect(takePendingMessage('a')?.text).toBe('A');
    expect(takePendingMessage('b')?.text).toBe('B');
  });

  it('"__dashboard__" session 也能 set / take', () => {
    setPendingMessage('__dashboard__', 'task prompt');
    expect(takePendingMessage('__dashboard__')?.text).toBe('task prompt');
  });
});

describe('ChatPage 消费 pending → 填 textarea', () => {
  it('无 sessionId 时消费 __dashboard__ pending → textarea 填入', async () => {
    setPendingMessage('__dashboard__', '写一篇 AI 办公助手推荐社媒文章');
    render(<ChatPage />, { wrapper: wrapperWith });
    const textarea = await screen.findByTestId('composer-textarea');
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(
        '写一篇 AI 办公助手推荐社媒文章',
      );
    });
  });

  it('有 sessionId + historyLoaded 时消费该 session 的 pending → textarea 填入', async () => {
    setPendingMessage('abc123', '历史会话续发');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/chat/abc123']}>
          <Routes>
            <Route path="/chat/:sessionId" element={<ChatPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const textarea = await screen.findByTestId('composer-textarea');
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('历史会话续发');
    });
  });

  it('没有任何 pending 时 textarea 为空', async () => {
    render(<ChatPage />, { wrapper: wrapperWith });
    const textarea = await screen.findByTestId('composer-textarea');
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('消费后 takePendingMessage 第二次返回 undefined（单次消费）', async () => {
    setPendingMessage('__dashboard__', '一次性');
    render(<ChatPage />, { wrapper: wrapperWith });
    const textarea = await screen.findByTestId('composer-textarea');
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('一次性');
    });
    // 第二个 take 应该 undefined
    expect(takePendingMessage('__dashboard__')).toBeUndefined();
  });
});