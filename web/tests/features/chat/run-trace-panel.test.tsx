/**
 * RunTracePanel 组件测试
 *
 * 覆盖：默认展开策略、userOverride、空 trace、合并步骤、键盘与无障碍。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunTracePanel } from '@/components/chat/RunTracePanel';
import type {
  RunTraceViewModel,
  ThinkingTraceStep,
  ToolTraceStep,
} from '@/features/chat/runTrace';

function thinking(
  overrides: Partial<ThinkingTraceStep> & Pick<ThinkingTraceStep, 'id'>,
): ThinkingTraceStep {
  return {
    kind: 'thinking',
    status: 'done',
    label: '思考已完成',
    detail: 'reasoning…',
    mergedCount: 1,
    ...overrides,
  };
}

function tool(
  overrides: Partial<ToolTraceStep> & Pick<ToolTraceStep, 'id' | 'toolName'>,
): ToolTraceStep {
  return {
    kind: 'tool',
    status: 'done',
    actionLabel: overrides.actionLabel ?? overrides.toolName,
    isError: false,
    ...overrides,
  };
}

function vm(overrides: Partial<RunTraceViewModel> = {}): RunTraceViewModel {
  return {
    steps: [
      thinking({ id: 't1', mergedCount: 2, detail: 'a\nb' }),
      tool({
        id: 'tc1',
        toolName: 'web_fetch',
        actionLabel: '获取网页',
        inputPreview: 'example.com',
        resultPreview: '1 个网页',
        resultDetail: '{"ok":true}',
      }),
    ],
    toolCount: 1,
    completedCount: 2,
    errorCount: 0,
    summaryLabel: '已完成 2 个步骤 · 1 个工具',
    status: 'done',
    ...overrides,
  };
}

describe('RunTracePanel', () => {
  it('摘要按钮：多个 thinking 合并后顶层只有一个 aria-expanded 按钮', () => {
    // Arrange
    const trace = vm({
      steps: [
        thinking({ id: 't1', mergedCount: 3, detail: 'one\ntwo\nthree' }),
        tool({ id: 'tc1', toolName: 'web_search', actionLabel: '搜索网页' }),
      ],
      toolCount: 1,
      completedCount: 2,
      summaryLabel: '已完成 2 个步骤 · 1 个工具',
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />);

    // Assert
    const expandButtons = screen.getAllByRole('button', { expanded: false });
    const summaryButtons = expandButtons.filter((btn) =>
      btn.hasAttribute('aria-controls'),
    );
    expect(summaryButtons).toHaveLength(1);
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('默认展开：运行中且无最终 text 时 timeline 可见', () => {
    // Arrange
    const trace = vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      steps: [
        thinking({ id: 't1', status: 'done' }),
        tool({
          id: 'tc1',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'streaming',
        }),
      ],
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />);

    // Assert
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('默认折叠：历史完成态不展示 timeline', () => {
    // Arrange
    const trace = vm({ status: 'done' });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />);

    // Assert
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('用户手动折叠后：props 变为完成态仍保持折叠（不被自动策略覆盖）', async () => {
    // Arrange
    const user = userEvent.setup();
    const streaming = vm({
      status: 'running',
      summaryLabel: '正在思考',
    });
    const { rerender } = render(
      <RunTracePanel trace={streaming} isStreaming={true} hasFinalText={false} />,
    );
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();

    // Act — 用户手动折叠
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();

    // Act — 变为完成态
    rerender(
      <RunTracePanel
        trace={vm({ status: 'done', summaryLabel: '已完成 2 个步骤 · 1 个工具' })}
        isStreaming={false}
        hasFinalText={true}
      />,
    );

    // Assert — 仍折叠
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('错误默认展开：无最终 text 且 errorCount>0 时展开，摘要含失败文案与错误图标标签', () => {
    // Arrange
    const trace = vm({
      status: 'error',
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      steps: [
        tool({
          id: 'tc1',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'error',
          isError: true,
          resultPreview: '请求失败',
        }),
      ],
      toolCount: 1,
      completedCount: 0,
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />);

    // Assert
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.getByText('完成，但有 1 个步骤失败')).toBeInTheDocument();
    expect(screen.getByLabelText(/失败|错误/)).toBeInTheDocument();
  });

  it('中止摘要：vm.status 为 aborted 时展示 summaryLabel', () => {
    // Arrange
    const trace = vm({
      status: 'aborted',
      summaryLabel: '已停止 · 保留 2 个步骤',
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />);

    // Assert
    expect(screen.getByText('已停止 · 保留 2 个步骤')).toBeInTheDocument();
  });

  it('空 trace：完全不渲染容器', () => {
    // Arrange
    const empty = vm({
      steps: [],
      toolCount: 0,
      completedCount: 0,
      errorCount: 0,
      summaryLabel: '已完成 0 个步骤 · 0 个工具',
      status: 'done',
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={empty} isStreaming={false} hasFinalText={true} />,
    );

    // Assert
    expect(container.firstChild).toBeNull();
  });

  it('合并步骤：一对 call/result 在 timeline 中只占一个 li', () => {
    // Arrange — 派生层已合并，组件只渲染 steps 数组
    const trace = vm({
      steps: [
        tool({
          id: 'merged-1',
          toolName: 'web_search',
          actionLabel: '搜索网页',
          inputPreview: '平潭',
          resultPreview: '11 个结果',
          resultDetail: 'hit1\nhit2',
        }),
      ],
      toolCount: 1,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 1 个工具',
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />);

    // Assert
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('键盘：聚焦摘要按钮后 Enter 可切换 aria-expanded', async () => {
    // Arrange
    const user = userEvent.setup();
    render(
      <RunTracePanel trace={vm()} isStreaming={false} hasFinalText={true} />,
    );
    const summary = screen.getByRole('button', { expanded: false });
    summary.focus();

    // Act
    await user.keyboard('{Enter}');

    // Assert
    expect(summary).toHaveAttribute('aria-expanded', 'true');

    // Act
    await user.keyboard(' ');

    // Assert
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('无嵌套滚动：面板 className 不含 overflow-y 与 max-h-', () => {
    // Arrange / Act
    const { container } = render(
      <RunTracePanel trace={vm()} isStreaming={true} hasFinalText={false} />,
    );

    // Assert
    const root = container.querySelector('[data-run-trace]');
    expect(root).not.toBeNull();
    const withForbidden = Array.from(container.querySelectorAll('[class]')).filter(
      (el) => {
        const c = el.className;
        if (typeof c !== 'string') return false;
        return /\boverflow-y(?:-|\b)/.test(c) || /\bmax-h-/.test(c);
      },
    );
    expect(withForbidden).toHaveLength(0);
  });
});
