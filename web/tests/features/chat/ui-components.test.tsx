/**
 * Unit tests for new UI components.
 * Coverage: ApprovalDialog, QuestionComposer, ProgressIndicator
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalDialog } from '@/components/chat/ApprovalDialog';
import { QuestionComposer } from '@/components/chat/QuestionComposer';
import { ProgressIndicator } from '@/components/chat/ProgressIndicator';

describe('ApprovalDialog', () => {
  const defaultProps = {
    toolName: 'Bash',
    payload: { command: 'ls -la' },
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };

  it('renders tool name and payload', () => {
    render(<ApprovalDialog {...defaultProps} />);

    expect(screen.getByText('工具执行审批')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('calls onApprove when allow button clicked', async () => {
    render(<ApprovalDialog {...defaultProps} />);

    const approveButton = screen.getByRole('button', { name: /允许执行/i });
    fireEvent.click(approveButton);

    expect(defaultProps.onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onReject when reject button clicked', async () => {
    render(<ApprovalDialog {...defaultProps} />);

    // Find the reject button (contains "拒绝" text)
    const buttons = screen.getAllByRole('button');
    const rejectButton = buttons.find(btn => btn.textContent?.includes('拒绝'));
    expect(rejectButton).toBeDefined();
    fireEvent.click(rejectButton!);

    expect(defaultProps.onReject).toHaveBeenCalled();
  });

  it('shows high risk warning for dangerous tools', () => {
    render(<ApprovalDialog {...defaultProps} toolName="rm" />);

    expect(screen.getByText(/高风险操作/i)).toBeInTheDocument();
  });

  it('hides details by default', () => {
    render(<ApprovalDialog {...defaultProps} />);

    expect(screen.getByText(/点击「显示」查看完整参数/i)).toBeInTheDocument();
  });

  it('shows details when show button clicked', async () => {
    render(<ApprovalDialog {...defaultProps} />);

    const showButton = screen.getByRole('button', { name: /显示/i });
    fireEvent.click(showButton);

    expect(screen.getByText(/"command": "ls -la"/i)).toBeInTheDocument();
  });

  it('renders dialog when pending', () => {
    const { container } = render(<ApprovalDialog {...defaultProps} pending />);
    // Dialog should render without crashing when pending
    expect(container.querySelector('[role="dialog"]')).toBeInTheDocument();
  });
});

describe('QuestionComposer', () => {
  const defaultProps = {
    title: '请选择',
    onSubmit: vi.fn(),
  };

  describe('radio type', () => {
    it('renders options', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="radio"
          options={[
            { id: 'a', label: 'Option A' },
            { id: 'b', label: 'Option B' },
          ]}
        />,
      );

      expect(screen.getByText('Option A')).toBeInTheDocument();
      expect(screen.getByText('Option B')).toBeInTheDocument();
    });

    it('calls onSubmit with selected value', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="radio"
          options={[
            { id: 'a', label: 'Option A' },
            { id: 'b', label: 'Option B' },
          ]}
        />,
      );

      fireEvent.click(screen.getByText('Option A'));
      fireEvent.click(screen.getByRole('button', { name: /提交/i }));

      expect(defaultProps.onSubmit).toHaveBeenCalledWith('a');
    });
  });

  describe('checkbox type', () => {
    it('allows multiple selections', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="checkbox"
          options={[
            { id: 'a', label: 'Option A' },
            { id: 'b', label: 'Option B' },
          ]}
        />,
      );

      fireEvent.click(screen.getByText('Option A'));
      fireEvent.click(screen.getByText('Option B'));
      fireEvent.click(screen.getByRole('button', { name: /提交/i }));

      expect(defaultProps.onSubmit).toHaveBeenCalledWith(['a', 'b']);
    });
  });

  describe('text type', () => {
    it('renders textarea', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="text"
          placeholder="请输入..."
        />,
      );

      expect(screen.getByPlaceholderText(/请输入/i)).toBeInTheDocument();
    });

    it('calls onSubmit with text value', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="text"
          placeholder="请输入..."
        />,
      );

      fireEvent.change(screen.getByPlaceholderText(/请输入/i), {
        target: { value: 'user input' },
      });
      fireEvent.click(screen.getByRole('button', { name: /提交/i }));

      expect(defaultProps.onSubmit).toHaveBeenCalledWith('user input');
    });
  });

  describe('plan-review type', () => {
    it('renders plan review options', () => {
      render(
        <QuestionComposer
          {...defaultProps}
          type="plan-review"
        />,
      );

      // Use more specific selectors to avoid multiple matches
      expect(screen.getByText(/同意$/)).toBeInTheDocument();
      expect(screen.getByText(/对计划提出修改意见/)).toBeInTheDocument();
      expect(screen.getByText(/终止当前任务/)).toBeInTheDocument();
    });
  });
});

describe('ProgressIndicator', () => {
  it('renders tool progress', () => {
    render(
      <ProgressIndicator
        type="tool"
        toolName="ReadFile"
        progress={50}
      />,
    );

    expect(screen.getByText(/ReadFile/i)).toBeInTheDocument();
    expect(screen.getByText(/50%/i)).toBeInTheDocument();
  });

  it('renders thinking progress', () => {
    render(<ProgressIndicator type="thinking" />);

    expect(screen.getByText(/思考中/i)).toBeInTheDocument();
  });

  it('renders token cursor', () => {
    const { container } = render(<ProgressIndicator type="token" />);

    expect(container.querySelector('.token-cursor')).toBeInTheDocument();
  });
});
