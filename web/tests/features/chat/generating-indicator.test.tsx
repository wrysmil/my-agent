/**
 * GeneratingIndicator 组件测试
 *
 * 覆盖：role/aria-live、文本、Loader2 图标存在。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GeneratingIndicator } from '@/components/chat/GeneratingIndicator';

describe('GeneratingIndicator', () => {
  it('role=status + aria-live=polite', () => {
    // Arrange / Act
    render(<GeneratingIndicator />);

    // Assert
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('含「AI 仍在生成中」文本', () => {
    // Arrange / Act
    render(<GeneratingIndicator />);

    // Assert
    expect(screen.getByText('AI 仍在生成中…')).toBeTruthy();
  });

  it('含 Loader2 svg 图标（animate-spin）', () => {
    // Arrange
    const { container } = render(<GeneratingIndicator />);

    // Assert
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toBeTruthy();
  });

  it('与 final 之间存在分隔线（border-dashed）', () => {
    // Arrange
    const { container } = render(<GeneratingIndicator />);

    // Assert
    const root = container.firstElementChild;
    expect(root?.className ?? '').toContain('border-dashed');
  });
});