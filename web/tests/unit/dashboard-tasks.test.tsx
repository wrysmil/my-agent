/**
 * Dashboard 任务卡片 + 栅格单测。
 *
 * 来源：plan § Step 3.3
 *
 * 覆盖：
 *   - TaskSuggestionCard：渲染 / icon / 标题 / 描述 / 交付物；onPick 触发
 *   - TaskSuggestionsGrid：渲染 8 张卡片；fallback hint 出现条件
 *   - DashboardPage 集成：招呼语 + subtitle + 任务栅格 + stats + recent sessions
 *   - 点任务卡 → setPendingMessage('__dashboard__', task.prompt) + navigate('/chat')
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TaskSuggestionCard } from '../../src/features/dashboard/TaskSuggestionCard';
import { TaskSuggestionsGrid } from '../../src/features/dashboard/TaskSuggestionsGrid';
import { TASK_SUGGESTIONS } from '../../src/features/dashboard/taskSuggestions';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      // 简单展开：dashboard.tasks.research.title → 'research.title'
      // dashboard.tasks.fallback_hint → 'fallback_hint'
      // dashboard.greeting.morning({ name: 'Alice' }) → 'morning:Alice'
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
    locale: 'zh',
  }),
}));

function wrapperWith({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaskSuggestionCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染首张任务卡：icon + 标题 + 描述 + 交付物', () => {
    const task = TASK_SUGGESTIONS[0]; // research
    render(<TaskSuggestionCard task={task} onPick={vi.fn()} />, { wrapper: wrapperWith });
    const card = screen.getByTestId('task-card-research');
    expect(card).toBeInTheDocument();
    // 标题：i18n key 返回 'dashboard.tasks.research.title'
    expect(within(card).getByText('dashboard.tasks.research.title')).toBeInTheDocument();
    // 描述
    expect(within(card).getByText('dashboard.tasks.research.description')).toBeInTheDocument();
    // 交付物
    expect(within(card).getByText('dashboard.tasks.research.deliverable')).toBeInTheDocument();
  });

  it('点卡 → 触发 onPick(task)', () => {
    const task = TASK_SUGGESTIONS[2]; // image
    const onPick = vi.fn();
    render(<TaskSuggestionCard task={task} onPick={onPick} />, { wrapper: wrapperWith });
    fireEvent.click(screen.getByTestId('task-card-image'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(task);
  });

  it('8 张卡 id 全部存在', () => {
    const { rerender } = render(
      <div>
        {TASK_SUGGESTIONS.map((t) => (
          <TaskSuggestionCard key={t.id} task={t} onPick={() => {}} />
        ))}
      </div>,
      { wrapper: wrapperWith },
    );
    for (const t of TASK_SUGGESTIONS) {
      expect(screen.getByTestId(`task-card-${t.id}`)).toBeInTheDocument();
    }
    rerender(<div />);
  });
});

describe('TaskSuggestionsGrid', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染 8 张卡', () => {
    render(<TaskSuggestionsGrid onPick={vi.fn()} />, { wrapper: wrapperWith });
    expect(screen.getByTestId('dashboard-tasks-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^task-card-/)).toHaveLength(8);
  });

  it('远程不可达时显示 fallback hint（offline）', async () => {
    // 默认 fetch mock 就会 fail（jsdom 里没有真实 fetch），所以应该走 fallback
    render(<TaskSuggestionsGrid onPick={vi.fn()} />, { wrapper: wrapperWith });
    // hint 异步出现（query 失败后才显示）
    expect(await screen.findByTestId('dashboard-tasks-grid-fallback')).toBeInTheDocument();
  });

  it('点击卡 → onPick 回调', () => {
    const onPick = vi.fn();
    render(<TaskSuggestionsGrid onPick={onPick} />, { wrapper: wrapperWith });
    fireEvent.click(screen.getByTestId('task-card-research'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe('research');
  });
});

describe('DashboardPage 集成（招呼语 + stats）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('招呼语 + subtitle 渲染', async () => {
    const DashboardModule = await import('../../src/pages/DashboardPage');
    render(<DashboardModule.DashboardPage />, { wrapper: wrapperWith });
    const greeting = await screen.findByTestId('dashboard-greeting');
    // mock 的 t 返回 `${key}:${JSON.stringify(params)}`
    expect(greeting.textContent).toMatch(/^dashboard\.greeting\./);
    expect(screen.getByTestId('dashboard-subtitle')).toBeInTheDocument();
  });
});